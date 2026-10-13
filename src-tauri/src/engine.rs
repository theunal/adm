//! Çok kanallı indirme motoru.
//!
//! WPF sürümündeki `DownloadEngine` sınıfının Rust karşılığıdır. Düzeltilen
//! hatalar:
//!
//! | WPF hatası | Rust çözümü |
//! |---|---|
//! | TLS doğrulaması kapatılmıştı (`RemoteCertificateValidationCallback = true`) | `reqwest` + `rustls` varsayılan olarak **tam doğrulama** yapar; `danger_accept_invalid_certs` hiç çağrılmaz |
//! | `Range` isteğine rağmen `200 OK` gelirse tüm dosya yazılıyordu (dosya bozuluyordu) | `206 Partial Content` **zorunlu**: aksi halde kanal hata verir |
//! | Sonsuz yeniden deneme (`while` + sayaç yok) | Kanal başına **en fazla 3 deneme**, üstel geri çekilme, sonra `Failed` |
//! | `DownloadedBytes` tek sayıydı, kanal sınırları kayboluyordu | `ChannelState` JSON kalıcı; **kanal bazlı** devam gerçekten çalışır |
//! | Dosya önceden ayrılmıyordu, çok kanallı yazma bozuk veri üretiyordu | `set_len` ile ön ayrım; her kanal kendi aralığına konumlanıp yazar |
//! | Boyut bilinmiyorsa `long.MaxValue` aralığı kullanılıyordu | Boyut bilinmiyorsa **tek kanal** + `Content-Length` doğrulaması |

use std::collections::VecDeque;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use bytes::Bytes;
use futures_util::StreamExt;
use tokio::sync::{Notify, Semaphore};

use crate::i18n::{self, canon, t};
use crate::models::{ChannelState, SharedChannel};

/// Kanonik biçimde hata üretir: veritabanına öyle yazılır, ekranda
/// `render()` ile seçili dilde görünür.
fn cerr(key: &str) -> EngineError {
    EngineError::Failed(canon(key, &[]))
}

/// Kanonik biçimde, tek argümanlı hata üretir.
fn cerr1(key: &str, arg: &str) -> EngineError {
    EngineError::Failed(canon(key, &[arg]))
}

/// Kanonik biçimde, iki argümanlı hata üretir.
fn cerr2(key: &str, a: &str, b: &str) -> EngineError {
    EngineError::Failed(canon(key, &[a, b]))
}

/// Hata mesajını seçili dilde gösterilebilir metne çevirir.
fn emsg(e: &EngineError) -> String {
    match e {
        EngineError::Aborted => t("status.aborted", &[]),
        // Fallback içseldir; kullanıcıya düşerse "aralık desteklenmiyor" der.
        EngineError::Fallback => t("err.no_partial_support", &[]),
        EngineError::Failed(msg) => i18n::render(msg),
    }
}

/// Yazma tamponu (256 KB). Akış parçaları bu boyutta biriktirilip tek
/// sistem çağrısıyla diske yazılır.
const CHUNK_SIZE: usize = 256 * 1024;

/// Bir kanal için azami yeniden deneme sayısı (MC: 12).
const MAX_RETRIES_PER_CHANNEL: u32 = 12;

/// Sunucu sınırlamasında beklenen temel süre (MC: 1.5 sn × deneme).
const THROTTLE_BASE_DELAY: Duration = Duration::from_millis(1500);

/// Geri çekilmenin üst sınırı (MC: 15 sn).
const THROTTLE_MAX_DELAY: Duration = Duration::from_secs(15);

/// Sunucunun sınırlandırdığını bildirdiği durum kodları (MC `throttle`).
///
/// MC `SegmentedDownloader` bu yedi kodu tek bir `case` içinde toplar
/// (`408, 425, 429, 500, 502, 503, 504`); 504'ün eklenmesi önemlidir, aksi
/// halde ağ geçidi zaman aşımı sert bir hata sayılıp kanal düşürülmez.
const THROTTLE_STATUSES: [u16; 7] = [408, 425, 429, 500, 502, 503, 504];

/// İlerleme olaylarının yayınlanma aralığı.
const PROGRESS_INTERVAL: Duration = Duration::from_millis(500);

/// İzin verilen azami yönlendirme (redirect) sayısı.
const MAX_REDIRECTS: usize = 10;

/// Bir indirmede azami kanal sayısı.
pub const MAX_CHANNELS: u32 = 32;

/// Aynı anda açık dosya tutamağı / bağlantı üst sınırı.
const MAX_OPEN_FILE_HANDLES: usize = 32;

/// İş hırsızlığı için minimum kalan bayt eşiği (20 MB).
const STEAL_THRESHOLD_BYTES: u64 = 20 * 1024 * 1024;

/// Sparkline için saklanan hız örneği sayısı.
const SPEED_HISTORY_LEN: usize = 60;

/// Anlık hızın üstel hareketli ortalama katsayısı.
///
/// Ham örnek tek bir 500 ms penceresinden gelir ve çok kanallı indirmede
/// (görev çalma, yeniden deneme) ani sıçramalar yapar. `0.35` bir titreşimi
/// ~3 turda söndürürken yanıtı hâlâ birkaç saniyenin altında tutar.
const SPEED_SMOOTHING: f64 = 0.35;

/// Motor tarafından üretilen hata.
///
/// `Failed` **kanonik** bir metin taşır (bkz. `i18n::canon`): veritabanına
/// bu biçimde yazılır, kullanıcıya `i18n::render` ile gösterilir.
#[derive(Debug, Clone)]
pub enum EngineError {
    /// Kullanıcı duraklattı veya iptal etti.
    Aborted,
    /// Sunucu `Range` isteğine `200` döndürdü: tek akışa düşülmeli.
    ///
    /// Dahili sinyaldir; kullanıcıya gösterilmez.
    Fallback,
    /// Gerçek bir hata (kanonik mesaj taşır).
    Failed(String),
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", emsg(self))
    }
}

impl std::error::Error for EngineError {}

impl From<std::io::Error> for EngineError {
    fn from(e: std::io::Error) -> Self {
        cerr1("err.io", &e.to_string())
    }
}

/// İndirmeyi duraklatmak/iptal etmek için paylaşılan sinyal.
#[derive(Clone, Default)]
pub struct AbortSignal {
    flag: Arc<AtomicBool>,
    notify: Arc<Notify>,
}

impl AbortSignal {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn abort(&self) {
        self.flag.store(true, Ordering::SeqCst);
        // Bekleyen görevleri uyandır. `Notify` yalnızca o an beklemede
        // olan kayıtlara ulaşır, bu yüzden döngüler ayrıca `is_aborted()`
        // kontrolü yapar.
        self.notify.notify_waiters();
        self.notify.notify_one();
    }

    pub fn is_aborted(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    /// İptal bayrağını temizler — tek akışa düşme (fallback) sonrası aynı
    /// indirmenin yeniden başlatılabilmesi için kullanılır.
    pub fn resume(&self) {
        self.flag.store(false, Ordering::SeqCst);
    }

    /// İptal edilene kadar bekle; `true` dönerse iptal edildi.
    pub async fn wait(&self) {
        loop {
            if self.is_aborted() {
                return;
            }
            tokio::select! {
                _ = self.notify.notified() => {}
                _ = tokio::time::sleep(Duration::from_millis(100)) => {}
            }
        }
    }
}

/// Hız geçmişi örneği — arayüzdeki sparkline grafiğini besler.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeedSample {
    /// İndirme başlangıcından bu yana geçen süre (ms).
    pub t: u64,
    pub speed_mbps: f64,
}

/// İndirme sırasında periyodik olarak yayınlanan durum.
#[derive(Debug, Clone)]
pub struct EngineSnapshot {
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub speed_mbps: f64,
    pub channels: Vec<ChannelState>,
    pub speed_history: Vec<SpeedSample>,
    /// Kısa durum metni (seçili dilde, log panelinde gösterilir).
    pub phase: String,
    /// Tüm kanallar bitti mi?
    pub done: bool,
}

/// `EngineSnapshot.done` alanı manager tarafından okunur (tüm kanallar
/// bittiğinde son durum bildiriminde kullanılır); motor içinde yalnızca
/// üretilir.
impl EngineSnapshot {
    pub fn is_done(&self) -> bool {
        self.done
    }
}

/// Motorun çağırdığı ilerleme kancası.
pub type ProgressHook = Arc<dyn Fn(EngineSnapshot) + Send + Sync>;

/// Paylaşılan HTTP istemcisi — TLS doğrulaması **açık** kalacak şekilde kurulur.
///
/// Tüm indirmeler tek istemciyi paylaşır; bağlantı havuzu sayesinde her
/// kanal için yeni TLS el sıkışması yapılmaz.
static CLIENT: std::sync::LazyLock<reqwest::Client> = std::sync::LazyLock::new(|| {
    reqwest::Client::builder()
        // TLS: varsayılan rustls ile sertifika + hostname doğrulaması yapılır.
        // (WPF sürümündeki `RemoteCertificateValidationCallback = true` YOK)
        .redirect(reqwest::redirect::Policy::none()) // yönlendirmeyi elle yönetiyoruz
        .pool_idle_timeout(Duration::from_secs(90))
        .tcp_keepalive(Duration::from_secs(30))
        .user_agent(concat!(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ",
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ADM/2.0"
        ))
        .connect_timeout(Duration::from_secs(20))
        .pool_max_idle_per_host(MAX_OPEN_FILE_HANDLES)
        // Gövde akışı bu zaman aşımından etkilenmesin diye genel
        // `timeout` kullanılmaz; bağlantı ve okuma zaman aşımları
        // kanal döngüsünde ele alınır.
        .read_timeout(Duration::from_secs(45))
        .build()
        .expect("HTTP istemcisi oluşturulamadı")
});

fn client() -> &'static reqwest::Client {
    &CLIENT
}

/// Tarayıcının gönderdiği ek başlıklar için (`Referer`, `User-Agent`…) geçerli
/// bir `HeaderMap` kurar.
///
/// Bu başlıklar olmadan hotlink korumalı sunucular 403 döner ve indirilen
/// dosyanın kendisi reddedilir — köprüden alınan `Referer` bu yüzden yalnızca
/// kayda değil, gerçekten isteğin kendisine de girmek zorunda.
///
/// Boş liste ya da hiç geçerli başlık yoksa `None` döner; böylece varsayılan
/// `User-Agent` bozulmaz.
///
/// `Range` ve `Accept-Encoding` bilinçli olarak reddedilir: motorun kendi
/// segmentleme sözleşmesini bir tarayıcı başlığıyla çiğnamak dosyayı bozar.
/// `Cookie` de reddedilir — çerezler alan adına süzüldüğü için ayrı bir yoldan
/// (Netscape dosyası) iletilir; ham başlık olarak yollandığında yönlendirme
/// başka bir sunucuya gittiğinde sızar.
fn build_extra_headers(extra: &[(String, String)]) -> Option<reqwest::header::HeaderMap> {
    const DENY: [&str; 6] = [
        "range",
        "accept-encoding",
        "host",
        "content-length",
        "transfer-encoding",
        "cookie",
    ];

    let mut map = reqwest::header::HeaderMap::new();
    for (k, v) in extra {
        let name = k.trim().to_ascii_lowercase();
        if name.is_empty() || DENY.contains(&name.as_str()) {
            continue;
        }
        let Ok(name) = reqwest::header::HeaderName::from_bytes(name.as_bytes()) else {
            continue;
        };
        let Ok(value) = reqwest::header::HeaderValue::from_str(v.trim()) else {
            continue;
        };
        // Aynı başlık iki kez geldiyse son değer geçerli olsun.
        map.insert(name, value);
    }

    (!map.is_empty()).then_some(map)
}

/// `Content-Range: bytes 0-0/12345` -> `12345`
fn parse_content_range_total(value: &str) -> Option<u64> {
    let total = value.rsplit('/').next()?.trim();
    if total == "*" {
        return None;
    }
    total.parse::<u64>().ok()
}

fn header_string(
    headers: &reqwest::header::HeaderMap,
    name: reqwest::header::HeaderName,
) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

/// Sunucudan alınan dosya bilgileri.
///
/// Probe sonrası manager'a bildirilir (MC `handleProbe`): dosya adı ve
/// uzantı bu bilgiye göre düzeltilir.
#[derive(Debug, Clone, Default)]
pub struct ProbeInfo {
    pub total_bytes: u64,
    pub accepts_ranges: bool,
    #[allow(dead_code)]
    pub etag: Option<String>,
    #[allow(dead_code)]
    pub last_modified: Option<String>,
    /// `Content-Disposition` başlığı (dosya adı önerisi için).
    pub content_disposition: Option<String>,
    /// `Content-Type` başlığı (uzantı önerisi için).
    pub content_type: Option<String>,
}

/// Probe sonuç kancası — manager dosya adını düzeltmek için kullanır.
pub type ProbeHook = Arc<dyn Fn(ProbeInfo) + Send + Sync>;

fn net_error_message(e: &reqwest::Error) -> String {
    let key = if e.is_timeout() {
        "err.timeout"
    } else if e.is_connect() {
        "err.connect"
    } else if e.is_redirect() {
        "err.redirect"
    } else {
        // Kaynak hata varsa onu, yoksa hatanın kendisini göster.
        let detail = std::error::Error::source(e)
            .map(|s| s.to_string())
            .unwrap_or_else(|| e.to_string());
        return canon("err.net", &[&detail]);
    };
    canon(key, &[])
}

/// İstek gönderir; iptal sinyali gelirse `Aborted` döner.
async fn send(
    builder: reqwest::RequestBuilder,
    signal: &AbortSignal,
) -> Result<reqwest::Response, EngineError> {
    tokio::select! {
        r = builder.send() => r.map_err(|e| EngineError::Failed(net_error_message(&e))),
        _ = signal.wait() => Err(EngineError::Aborted),
    }
}

/// Yönlendirmeleri elle takip ederek son URL'yi ve dosya bilgisini bulur.
///
/// `probe = true` iken `Range: bytes=0-0` gönderilir; böylece `Content-Range`
/// başlığından toplam boyut öğrenilir ve `Range` desteği test edilir.
async fn resolve_url(
    url: &str,
    extra: Option<&reqwest::header::HeaderMap>,
    signal: &AbortSignal,
    probe: bool,
) -> Result<(String, ProbeInfo), EngineError> {
    let mut current = url.to_string();

    for _ in 0..MAX_REDIRECTS {
        if signal.is_aborted() {
            return Err(EngineError::Aborted);
        }

        let mut builder = client().get(&current);
        // `Referer` burada da gerekir: probe isteği sıradan bir indirme
        // isteği gibi hotlink korumasına takılabilir.
        if let Some(extra) = extra {
            builder = builder.headers(extra.clone());
        }
        if probe {
            builder = builder.header(reqwest::header::RANGE, "bytes=0-0");
        }
        // Sıkıştırma, `Content-Range`'in adlandırdığı gövdeyi değiştirir:
        // `bytes=0-0/N` gövdesi sıkıştırılmış gövdenin uzunluğunu söyleyebilir
        // ve kanalların paylaştığı toplam boyut bu yüzden yanlış hesaplanır.
        builder = builder.header(reqwest::header::ACCEPT_ENCODING, "identity");

        let resp = send(builder, signal).await?;
        let status = resp.status();

        if status.is_redirection() {
            let Some(loc) = resp.headers().get(reqwest::header::LOCATION) else {
                return Err(cerr("err.redirect_no_target"));
            };
            let Ok(loc_str) = loc.to_str() else {
                return Err(cerr("err.redirect_invalid"));
            };
            let loc_str = loc_str.to_string();
            current = reqwest::Url::parse(&current)
                .and_then(|base| base.join(&loc_str))
                .map(|u| u.to_string())
                .unwrap_or(loc_str);
            continue;
        }

        let etag = header_string(resp.headers(), reqwest::header::ETAG);
        let last_modified = header_string(resp.headers(), reqwest::header::LAST_MODIFIED);
        let content_disposition =
            header_string(resp.headers(), reqwest::header::CONTENT_DISPOSITION);
        let content_type = header_string(resp.headers(), reqwest::header::CONTENT_TYPE);

        // 206 -> boyut kesin, Range desteği var.
        if status == reqwest::StatusCode::PARTIAL_CONTENT {
            let total = resp
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|v| v.to_str().ok())
                .and_then(parse_content_range_total)
                .unwrap_or(0);
            return Ok((
                current,
                ProbeInfo {
                    total_bytes: total,
                    accepts_ranges: total > 0,
                    etag,
                    last_modified,
                    content_disposition,
                    content_type,
                },
            ));
        }

        if status.is_success() {
            // Sunucu `Range`'i yok sayıp `200 OK` ve tüm dosyayı gönderdi.
            return Ok((
                current,
                ProbeInfo {
                    total_bytes: resp.content_length().unwrap_or(0),
                    accepts_ranges: false,
                    etag,
                    last_modified,
                    content_disposition,
                    content_type,
                },
            ));
        }

        return Err(cerr2(
            "err.server_rejected",
            &status.as_u16().to_string(),
            status.canonical_reason().unwrap_or(""),
        ));
    }

    Err(cerr1("err.too_many_redirects", &MAX_REDIRECTS.to_string()))
}

/// `total_bytes` değerini kanal aralıklarına böler.
///
/// Aralıklar boşluk bırakmadan tüm dosyayı kaplar; artan baytlar son
/// kanala verilir. Çok küçük aralıklar (1 MB altı) birleştirilir.
pub fn plan_channels(total_bytes: u64, channel_count: u32) -> Vec<ChannelState> {
    if total_bytes == 0 {
        return vec![ChannelState {
            id: 0,
            start_byte: 0,
            end_byte: 0,
            current_byte: 0,
            finished: false,
        }];
    }

    // Her kanalın anlamlı bir boyut almasını sağla: 1 MB'ın altındaki
    // aralıklar için ayrı HTTP isteği kurmak işten değmez.
    let min_useful = 1024 * 1024u64; // 1 MB
    let mut n = (channel_count.max(1) as u64).min(MAX_CHANNELS as u64);
    while n > 1 && (total_bytes / n) < min_useful {
        n -= 1;
    }
    let n = n as usize;

    let part = total_bytes / n as u64;
    let mut channels = Vec::with_capacity(n);

    for i in 0..n {
        let start = part * i as u64;
        let end = if i == n - 1 {
            total_bytes - 1
        } else {
            start + part - 1
        };
        channels.push(ChannelState {
            id: i as i64,
            start_byte: start,
            end_byte: end.max(start),
            current_byte: start,
            finished: false,
        });
    }

    channels
}

/// Dosya boyutunu döner.
fn file_len(p: &Path) -> Option<u64> {
    std::fs::metadata(p).ok().map(|m| m.len())
}

/// Dosyayı verilen boyutta önceden ayırır.
fn preallocate(dest: &Path, size: u64) -> Result<(), EngineError> {
    let f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(dest)
        .map_err(|e| cerr1("err.dest_create_failed", &e.to_string()))?;
    f.set_len(size)
        .map_err(|e| cerr1("err.size_reserve_failed", &e.to_string()))?;
    Ok(())
}

/// Tek bir indirmeyi yürüten motor.
///
/// Tüm istemci ve yardımcılar statiktir; motor yalnızca iş koordinasyonu
/// yapar. Bu, motorun `Send + Sync` olmasını ve manager tarafından
/// paylaşılmasını sağlar.
#[derive(Debug, Default, Clone, Copy)]
pub struct DownloadEngine;

impl DownloadEngine {
    pub fn new() -> Self {
        Self
    }

    /// İndirmeyi başlatır ve tamamlanana kadar bekler.
    ///
    /// * `url` — indirilecek adres (yönlendirme otomatik izlenir)
    /// * `dest` — hedef dosya yolu
    /// * `channel_count` — eşzamanlı kanal sayısı (1..=32)
    /// * `resume_states` — kanal bazlı devam için önceki kanal durumları
    /// * `signal` — duraklatma/iptal sinyali
    /// * `on_progress` — periyodik ilerleme bildirimi
    /// * `on_probe` — sunucu bilgileri öğrenildiğinde bir kez çağrılır
    #[allow(clippy::too_many_arguments)]
    pub async fn download(
        &self,
        url: &str,
        dest: &Path,
        channel_count: u32,
        resume_states: Option<&[ChannelState]>,
        extra_headers: &[(String, String)],
        signal: AbortSignal,
        on_progress: ProgressHook,
        on_probe: ProbeHook,
    ) -> Result<Vec<ChannelState>, EngineError> {
        // Tarayıcının gönderdiği `Referer`/`User-Agent` isteklere eklenir.
        // Boşsa motor kendi varsayılan User-Agent'ıyla çalışır.
        let extra = build_extra_headers(extra_headers).map(std::sync::Arc::new);

        // 1) Yönlendirmeleri çöz ve dosya boyutunu öğren.
        let (final_url, probe) = resolve_url(url, extra.as_deref(), &signal, true).await?;
        on_probe(probe.clone());

        let total_bytes = probe.total_bytes;

        // 2) Dosyayı hazırla ve kanal planını kur (resume varsa geri yükle).
        //
        // Sunucu probe'a 206 ile yanıt verip kanal isteğinde `200` döndürürse
        // (MC'nin `fallbackToSingle` davranışı) indirme bir kez tek akışa
        // düşürülerek yeniden başlatılır.
        let mut single_stream = false;
        // Döngü, son kanal kurulumunu da dışarı taşır: tek akışa düşüldüğünde
        // kanallar yeniden kurulur ve tamamlanma doğrulaması son kurulumu
        // okumak zorundadır.
        let (outcome, channels) = loop {
            let planned = self.prepare_file(
                dest,
                total_bytes,
                channel_count,
                if single_stream { None } else { resume_states },
                !single_stream,
            )?;

            let channels: Vec<Arc<SharedChannel>> = planned
                .into_iter()
                .map(|c| Arc::new(SharedChannel::new(c)))
                .collect();

            // Zaten tamamlanmış bir indirme (dosya dolu ama kayıt güncel değil).
            if total_bytes > 0 && all_finished(&channels) {
                on_progress(EngineSnapshot {
                    total_bytes,
                    downloaded_bytes: total_bytes,
                    speed_mbps: 0.0,
                    channels: snapshot_all(&channels),
                    speed_history: Vec::new(),
                    phase: t("phase.completed", &[]),
                    done: true,
                });
                return Ok(snapshot_all(&channels));
            }

            // 3) İlerleme yayıncısı (hız hesabı + kanal anlık görüntüsü).
            let publisher = tokio::spawn(progress_publisher(
                Arc::new(channels.clone()),
                total_bytes,
                signal.clone(),
                on_progress.clone(),
            ));

            // 4) Kanalları eşzamanlı çalıştır.
            let attempt = self
                .run_channels(
                    &final_url,
                    dest,
                    channels.clone(),
                    total_bytes,
                    extra.clone(),
                    signal.clone(),
                    !single_stream,
                )
                .await;

            // 5) Yayıncıyı durdur.
            publisher.abort();
            let _ = publisher.await;

            if matches!(attempt, Err(EngineError::Fallback)) && !single_stream {
                // Sunucu aralığı yok saydı: tek akışa düş ve baştan başlat.
                single_stream = true;
                signal.resume();
                continue;
            }
            // Tek akışa düşüldükten sonra tekrar `200` geldiyse gerçek hata.
            let attempt = match attempt {
                Err(EngineError::Fallback) => Err(cerr("err.no_partial_support")),
                other => other,
            };
            break (attempt, channels);
        };

        outcome?;

        // 6) Tamamlanma doğrulaması: her bayt yazıldı mı?
        let done = downloaded_total(&channels);
        let complete = channels.iter().all(|c| c.bounds().2);

        if complete && (total_bytes == 0 || done >= total_bytes) {
            let total = if total_bytes > 0 { total_bytes } else { done };

            // Boyut bilinmeyen indirmede kanal planı `end_byte = 0` ile kurulur
            // ve `mark_finished` onu `1`'e çeker. Aralığı gerçek dosya boyutuna
            // hizalamazsak `total_from_channels` 1 döner ve kayıt "1 B" olarak
            // tamamlanmış görünür (hem `finalize` hem de arayüzdeki kanal
            // tablosu bu değeri kullanır).
            //
            // `plan_channels(0, n)` tek kanal döndürdüğü için hizalama güvenli.
            if total_bytes == 0 && total > 0 && channels.len() == 1 {
                channels[0].align_to_total(total);
            }

            let states = snapshot_all(&channels);
            on_progress(EngineSnapshot {
                total_bytes: total,
                downloaded_bytes: total,
                speed_mbps: 0.0,
                channels: states.clone(),
                speed_history: Vec::new(),
                phase: t("phase.completed", &[]),
                done: true,
            });
            Ok(states)
        } else if signal.is_aborted() {
            Err(EngineError::Aborted)
        } else {
            Err(cerr2(
                "err.incomplete",
                &done.to_string(),
                &total_bytes.to_string(),
            ))
        }
    }

    /// Dosyayı hazırlar ve başlangıç kanal durumlarını döner.
    fn prepare_file(
        &self,
        dest: &Path,
        total_bytes: u64,
        channel_count: u32,
        resume_states: Option<&[ChannelState]>,
        supports_ranges: bool,
    ) -> Result<Vec<ChannelState>, EngineError> {
        ensure_parent_dir(dest)?;

        // Range desteklenmiyorsa tek kanal + düz akış kullanılır.
        if !supports_ranges {
            return Ok(vec![ChannelState {
                id: 0,
                start_byte: 0,
                end_byte: 0,
                current_byte: 0,
                finished: false,
            }]);
        }

        // Resume için dosya tam boyutta olmalı; değilse sıfırdan başla.
        let resume = resume_states
            .filter(|s| !s.is_empty())
            .map(|s| s.to_vec())
            .filter(|_| file_len(dest) == Some(total_bytes));

        if let Some(states) = resume {
            return Ok(states
                .into_iter()
                .map(|mut c| {
                    if c.current_byte > c.end_byte {
                        c.current_byte = c.end_byte + 1;
                        c.finished = true;
                    }
                    c
                })
                .collect());
        }

        // Yeni indirme: dosyayı önceden ayırarak yer ayır.
        let planned = plan_channels(total_bytes, channel_count);
        preallocate(dest, total_bytes)?;
        Ok(planned)
    }

    /// Kanalları eşzamanlı çalıştırır, iş hırsızlığı uygular.
    // Her argümanın ayrı bir anlamı var; başlıkları tek bir "isteğe özel"
    // yapıya bölmek okunurluğu artırmaz (`download` de aynı izni kullanıyor).
    #[allow(clippy::too_many_arguments)]
    async fn run_channels(
        &self,
        url: &str,
        dest: &Path,
        channels: Vec<Arc<SharedChannel>>,
        total_bytes: u64,
        extra: Option<std::sync::Arc<reqwest::header::HeaderMap>>,
        signal: AbortSignal,
        supports_ranges: bool,
    ) -> Result<(), EngineError> {
        let count = channels.len();

        // Aynı anda açık dosya tutamağı / bağlantı sayısını sınırla.
        let handles = Arc::new(Semaphore::new(MAX_OPEN_FILE_HANDLES));
        // Tüm kanalların paylaştığı sınırlama durumu.
        let throttle = Arc::new(Throttle::default());
        throttle.active_limit.store(count as u32, Ordering::SeqCst);

        let mut tasks = Vec::with_capacity(count);

        for idx in 0..count {
            let me = channels[idx].clone();
            let peers = channels.clone();
            let url = url.to_string();
            let dest = dest.to_path_buf();
            let signal = signal.clone();
            let handles = Arc::clone(&handles);
            let throttle = Arc::clone(&throttle);
            let extra = extra.clone();

            tasks.push(tokio::spawn(async move {
                run_channel(
                    url,
                    dest,
                    peers,
                    me,
                    handles,
                    throttle,
                    extra.as_deref(),
                    signal,
                    total_bytes,
                    supports_ranges,
                )
                .await
            }));
        }

        // Tüm kanallar bitene kadar bekle; ilk hatayı hatırla.
        let mut first_error: Option<EngineError> = None;
        for t in tasks {
            match t.await {
                Ok(Ok(())) => {}
                Ok(Err(e)) => {
                    if first_error.is_none() {
                        first_error = Some(e);
                    }
                }
                Err(join_err) => {
                    if first_error.is_none() {
                        first_error = Some(cerr1("err.channel_task_ended", &join_err.to_string()));
                    }
                }
            }
        }

        // Gerçek bir hata (veya tek akışa düşme gereksinimi) varsa kalan
        // kanalları da durdur.
        if matches!(
            first_error,
            Some(EngineError::Failed(_)) | Some(EngineError::Fallback)
        ) {
            signal.abort();
        }

        match first_error {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }
}

/// Hedef dosyanın üst klasörünü oluşturur.
fn ensure_parent_dir(path: &Path) -> Result<(), EngineError> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        std::fs::create_dir_all(parent).map_err(|e| {
            cerr2(
                "err.parent_dir_failed",
                &parent.display().to_string(),
                &e.to_string(),
            )
        })?;
    }
    Ok(())
}

/// Tüm kanalların anlık görüntüsünü alır.
fn snapshot_all(channels: &[Arc<SharedChannel>]) -> Vec<ChannelState> {
    channels.iter().map(|c| c.snapshot()).collect()
}

/// Tüm kanallar bitti mi?
fn all_finished(channels: &[Arc<SharedChannel>]) -> bool {
    channels.iter().all(|c| c.snapshot().finished)
}

/// Kanalların toplam indirilen baytı.
fn downloaded_total(channels: &[Arc<SharedChannel>]) -> u64 {
    channels
        .iter()
        .map(|c| c.downloaded())
        .fold(0u64, |acc, v| acc.saturating_add(v))
}

/// Periyodik ilerleme yayıncısı: hız hesaplar, kanal anlık görüntüsünü okur.
async fn progress_publisher(
    channels: Arc<Vec<Arc<SharedChannel>>>,
    total_bytes: u64,
    signal: AbortSignal,
    hook: ProgressHook,
) {
    let mut last_bytes = downloaded_total(&channels);
    let mut last_time = Instant::now();
    let mut history: VecDeque<SpeedSample> = VecDeque::with_capacity(SPEED_HISTORY_LEN);
    // Hız grafiğinin x ekseni gerçek geçen süreyi göstermeli; `t` nominal
    // değil, başlangıçtan itibaren ölçülen milisaniye.
    let started = Instant::now();
    // Yumuşatılmış hız. İlk turda ham örnekle tohumlanır (sıfırdan başlamak
    // yerine), sonraki turlarda ağırlıklı ortalama.
    let mut smoothed: Option<f64> = None;

    loop {
        if signal.is_aborted() {
            break;
        }

        tokio::select! {
            _ = tokio::time::sleep(PROGRESS_INTERVAL) => {}
            _ = signal.wait() => {
                if signal.is_aborted() { break; }
            }
        }

        if signal.is_aborted() {
            break;
        }

        let now_bytes = downloaded_total(&channels);
        let elapsed = last_time.elapsed().as_secs_f64();
        let raw = if elapsed > 0.0 {
            let delta = now_bytes.saturating_sub(last_bytes) as f64;
            delta / (1024.0 * 1024.0) / elapsed
        } else {
            0.0
        };

        // Tek bir 500 ms penceresi çok gürültülüdür: kanal görev çalma
        // sınırlarında `raw` sıfıra düşüp bir sonraki turda ikiye çıkar; bu da
        // satırdaki hız ve "kalan süre" metni titretir. Üstel hareketli
        // ortalama titreşimi söner, tepkiyi birkaç tur geciktirir.
        let speed = match smoothed {
            None => raw,
            Some(prev) => prev + SPEED_SMOOTHING * (raw - prev),
        };
        smoothed = Some(speed);

        history.push_back(SpeedSample {
            t: started.elapsed().as_millis() as u64,
            speed_mbps: speed,
        });
        while history.len() > SPEED_HISTORY_LEN {
            history.pop_front();
        }

        last_bytes = now_bytes;
        last_time = Instant::now();

        hook(EngineSnapshot {
            total_bytes,
            downloaded_bytes: now_bytes,
            speed_mbps: speed,
            channels: snapshot_all(&channels),
            speed_history: history.iter().cloned().collect(),
            phase: if total_bytes == 0 {
                t("phase.size_unknown", &[])
            } else {
                t("phase.downloading", &[])
            },
            done: all_finished(&channels),
        });
    }
}

/// Tek bir kanalın indirme döngüsü.
#[allow(clippy::too_many_arguments)]
async fn run_channel(
    url: String,
    dest: PathBuf,
    peers: Vec<Arc<SharedChannel>>,
    me: Arc<SharedChannel>,
    handles: Arc<Semaphore>,
    throttle: Arc<Throttle>,
    extra: Option<&reqwest::header::HeaderMap>,
    signal: AbortSignal,
    total_bytes: u64,
    supports_ranges: bool,
) -> Result<(), EngineError> {
    let _permit = handles
        .acquire()
        .await
        .map_err(|_| cerr("err.source_closed"))?;

    // Dosya tutamağını bir kez aç ve tüm denemelerde yeniden kullan.
    let ranged = supports_ranges && total_bytes > 0;
    let mut file = open_target(&dest, ranged)?;

    // Sınırlama yanıtlarına tepki olarak pencerenin daraldığını izle; bu
    // kanal da sınırlandığında sırasını bekler.
    let mut attempts: u32 = 0;

    loop {
        if signal.is_aborted() {
            return Err(EngineError::Aborted);
        }

        let (start_byte, end_byte, finished) = me.bounds();

        if finished {
            // Kanal bitti: iş hırsızlığı dene, yoksa çık.
            if !steal_work(&peers, &me) {
                return Ok(());
            }
            attempts = 0;
            continue;
        }

        // MC `fillSlots`: yeni istek iki kapıdan geçer — önce ortak bekleme
        // (`throttledUntil`), sonra eşzamanlılık sınırı (`activeLimit`).
        // Slot yalnızca HTTP isteği boyunca tutulur: geri çekilme uykusu
        // bağlantı sayısını meşgul etmemeli.
        let outcome = {
            let _slot = throttle.acquire(&signal).await?;
            fetch_range(
                &url,
                &mut file,
                &me,
                start_byte,
                end_byte,
                extra,
                &signal,
                ranged,
            )
            .await
        };

        match outcome {
            Ok(ChannelOutcome::Done) => {
                me.mark_finished();
                attempts = 0;
                // Başarılı istek: paylaşılan sınırı geri aç.
                throttle.widen(peers.len() as u32);
                if !steal_work(&peers, &me) {
                    return Ok(());
                }
            }
            Ok(ChannelOutcome::Interrupted) => {
                // Sunucu akışı beklenenden erken kapattı.
                attempts += 1;
                if attempts > MAX_RETRIES_PER_CHANNEL {
                    return Err(cerr1(
                        "err.stream_cut",
                        &MAX_RETRIES_PER_CHANNEL.to_string(),
                    ));
                }
                sleep_backoff(&signal, attempts).await;
            }
            Ok(ChannelOutcome::Fallback) => {
                // Sunucu `Range`'i yok sayıp 200 döndürdü (MC fallbackToSingle).
                return Err(EngineError::Fallback);
            }
            Ok(ChannelOutcome::Throttled(status)) => {
                // Sunucu sınırlandırma yanıtı verdi: pencereyi daralt ve bekle.
                // Yanıt kodu hata mesajına taşınır (429/503 ayrımı kullanıcı
                // için anlamlıdır).
                throttle.narrow();
                attempts += 1;
                if attempts > MAX_RETRIES_PER_CHANNEL {
                    return Err(cerr2(
                        "err.throttled",
                        &status.to_string(),
                        &MAX_RETRIES_PER_CHANNEL.to_string(),
                    ));
                }
                // Ceza yalnızca bu kanalı değil TÜM kanalları yavaşlatır
                // (MC `throttledUntil`). `sleep_backoff` ile aynı eğri
                // kullanıldığı için bu kanalın uykusu bittiğinde ortak kapı
                // da açılmış olur.
                throttle.set_throttled_for(attempts);
                sleep_backoff(&signal, attempts).await;
            }
            Err(EngineError::Aborted) => return Err(EngineError::Aborted),
            Err(e) => {
                attempts += 1;
                if attempts > MAX_RETRIES_PER_CHANNEL {
                    return Err(e);
                }
                sleep_backoff(&signal, attempts).await;
            }
        }
    }
}

enum ChannelOutcome {
    /// Aralık tamamen indirildi.
    Done,
    /// Akış beklenenden erken bitti; kaldığı yerden tekrar denenecek.
    Interrupted,
    /// Sunucu aralığı yok sayıp `200` döndürdü: tek akışa düşülmeli.
    Fallback,
    /// Sunucu sınırlandırma yanıtı verdi (durum kodu).
    Throttled(u16),
}

/// Hedef dosyayı yazma modunda açar.
///
/// * `ranged = true` → var olan, önceden ayrılmış dosyaya konumlanarak yazılır.
/// * `ranged = false` → tek kanal modunda dosya baştan oluşturulur.
fn open_target(dest: &Path, ranged: bool) -> Result<std::fs::File, EngineError> {
    ensure_parent_dir(dest)?;

    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true);
    if !ranged {
        opts.truncate(true);
    }

    opts.open(dest)
        .map_err(|e| cerr1("err.dest_open_failed", &e.to_string()))
}

/// Bir kanalın `[start, end]` aralığını indirir ve diske yazar.
#[allow(clippy::too_many_arguments)]
async fn fetch_range(
    url: &str,
    file: &mut std::fs::File,
    me: &Arc<SharedChannel>,
    start_byte: u64,
    end_byte: u64,
    extra: Option<&reqwest::header::HeaderMap>,
    signal: &AbortSignal,
    ranged: bool,
) -> Result<ChannelOutcome, EngineError> {
    // Aralıksız modda istek `Range` taşımaz, sunucu dosyayı **0'dan baştan**
    // gönderir. Yazma konumu ile kanal sayacı da 0'dan başlamalı.
    //
    // `start_byte` burada kanalın ilerlemesidir; bir yeniden denemede sıfırdan
    // büyük olur. Onu konum almak dosyanın başına ilerleme kadar boşluk
    // sıkıştırır ve kalanı kaydırır — sonuç, sayımlara göre "Tamamlandı"
    // görünmesine rağmen boyutu şişmiş ve içeriği kaymış bir dosyadır.
    if !ranged {
        me.restart_from_zero();
    }

    let mut builder = client().get(url);
    // Ek başlıklar ÖNCE eklenir; `Range`/`Accept-Encoding` sonradan yazılır ki
    // segmentleme sözleşmesi bir tarayıcı başlığıyla ezilmesin.
    if let Some(extra) = extra {
        builder = builder.headers(extra.clone());
    }
    if ranged {
        builder = builder
            .header(
                reqwest::header::RANGE,
                format!("bytes={start_byte}-{end_byte}"),
            )
            // Sıkıştırma, byte aralıklarını bozduğu için devre dışı.
            .header(reqwest::header::ACCEPT_ENCODING, "identity");
    }

    let resp = send(builder, signal).await?;
    let status = resp.status();

    if ranged {
        // DÜZELTME (eski bug): Range istendi ama 206 gelmediyse hata ver.
        if status != reqwest::StatusCode::PARTIAL_CONTENT {
            // Sınırlandırma: pencere daraltılır, kısa beklenip denenir.
            if THROTTLE_STATUSES.contains(&status.as_u16()) {
                return Ok(ChannelOutcome::Throttled(status.as_u16()));
            }
            // Sunucu aralığı yok sayıp 200 döndürdü: tek akışa düş (MC).
            if status.is_success() {
                return Ok(ChannelOutcome::Fallback);
            }
            return Err(match status {
                s if s == reqwest::StatusCode::RANGE_NOT_SATISFIABLE => cerr2(
                    "err.range_not_satisfiable",
                    &start_byte.to_string(),
                    &end_byte.to_string(),
                ),
                s => cerr2(
                    "err.server_error",
                    &s.as_u16().to_string(),
                    s.canonical_reason().unwrap_or(""),
                ),
            });
        }

        // Sunucu farklı bir aralık döndürdüyse bu da bozuktur.
        if let Some(cr) = resp
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            && !cr.starts_with(&format!("bytes {start_byte}-"))
        {
            return Err(cerr1("err.unexpected_range", cr));
        }
    } else if !status.is_success() {
        return Err(cerr2(
            "err.server_error",
            &status.as_u16().to_string(),
            status.canonical_reason().unwrap_or(""),
        ));
    }

    // Akış parçalarını 256 KB'lık bloklarda biriktirip diske yazarız.
    // Parçalar doğrudan yazılırsa çok sayıda küçük sistem çağrısı oluşur;
    // blok biriktirme bunu belirgin biçimde azaltır.
    let mut stream = resp.bytes_stream();
    // Aralıksız modda gövde 0'dan gelir; `start_byte` yalnızca aralıklı modda
    // yazma konumudur.
    let mut pos = if ranged { start_byte } else { 0 };
    let mut got_any = false;
    let mut buf: Vec<u8> = Vec::with_capacity(CHUNK_SIZE);
    let mut base = start_byte;

    loop {
        if signal.is_aborted() {
            return Err(EngineError::Aborted);
        }

        let next = tokio::select! {
            item = stream.next() => item,
            _ = signal.wait() => {
                if signal.is_aborted() { return Err(EngineError::Aborted); }
                continue;
            }
        };

        let Some(chunk) = next else { break };
        let chunk: Bytes = chunk.map_err(|e| cerr1("err.stream_broken", &e.to_string()))?;
        if chunk.is_empty() {
            continue;
        }
        got_any = true;

        let mut slice: &[u8] = &chunk;

        while !slice.is_empty() {
            // Tampon dolduysa yaz ve sıfırla.
            if buf.len() == CHUNK_SIZE {
                flush(file, &mut buf, base, me)?;
                base = pos;
            }

            // Aralık sınırını aşan baytları yazma: sunucu fazladan veri
            // gönderirse durdur (aksi halde sonraki kanalın verisi bozulur).
            let take = if ranged {
                let remaining = end_byte.saturating_sub(pos).saturating_add(1);
                (slice.len() as u64).min(remaining) as usize
            } else {
                slice.len()
            };

            if take == 0 {
                // Aralık tamamen doldu.
                flush(file, &mut buf, base, me)?;
                return Ok(ChannelOutcome::Done);
            }

            buf.extend_from_slice(&slice[..take]);
            slice = &slice[take..];
            pos += take as u64;

            // Aralık bitti: kalanı yaz ve çık.
            if ranged && pos > end_byte {
                flush(file, &mut buf, base, me)?;
                return Ok(ChannelOutcome::Done);
            }
        }
    }

    // Akış bitti: kalan tamponu yaz.
    flush(file, &mut buf, base, me)?;

    if ranged {
        if pos > end_byte {
            Ok(ChannelOutcome::Done)
        } else if got_any {
            Ok(ChannelOutcome::Interrupted)
        } else {
            Err(cerr("err.empty_body"))
        }
    } else {
        // `downloaded` sayaç zaten yazma sırasında artırıldı.
        Ok(ChannelOutcome::Done)
    }
}

/// Tamponlanan veriyi diske yazar ve kanal sayacını günceller.
fn flush(
    file: &mut std::fs::File,
    buf: &mut Vec<u8>,
    base: u64,
    me: &Arc<SharedChannel>,
) -> Result<(), EngineError> {
    if buf.is_empty() {
        return Ok(());
    }
    write_chunk(file, base, buf)?;
    me.add_downloaded(buf.len() as u64);
    me.set_current(base + buf.len() as u64);
    buf.clear();
    Ok(())
}

/// Veriyi belirtilen konuma yazar.
///
/// Kanal başına **ayrı** dosya tutamağı vardır; bu yüzden konum değiştirme
/// (`seek`) kanalı yalnızca kendi tutamağını etkiler, eşzamanlı erişim
/// sorunu oluşmaz. Yazma senkron `std::io` ile yapılır (256 KB bloklar
/// için sistem çağrısı beklenir), böylece `AsyncWriteExt`'e gerek kalmaz.
fn write_chunk(file: &mut std::fs::File, pos: u64, data: &[u8]) -> Result<(), EngineError> {
    file.seek(SeekFrom::Start(pos))
        .map_err(|e| cerr1("err.seek_failed", &e.to_string()))?;
    file.write_all(data)
        .map_err(|e| cerr1("err.write_failed", &e.to_string()))?;
    Ok(())
}

/// İş hırsızlığı: biten kanal, en çok işi kalan bitmemiş kanalın yarısını alır.
///
/// WPF sürümünde de bu mantık vardı ancak kanal durumu paylaşılmadığı için
/// güvenli çalışmıyordu. Burada kanal durumu `Mutex` ile korunur ve alınan
/// aralığın baytlarının sayaca **eklenmemesi** `SharedChannel::recalibrate`
/// ile garanti edilir; böylece toplam indirilen miktar asla şişmez.
fn steal_work(peers: &[Arc<SharedChannel>], me: &Arc<SharedChannel>) -> bool {
    // En çok kalan işi olan bitmemiş kanalı seç (kendimiz hariç).
    let mut candidate: Option<&Arc<SharedChannel>> = None;
    let mut candidate_remaining = STEAL_THRESHOLD_BYTES;

    for p in peers {
        if Arc::ptr_eq(p, me) {
            continue;
        }
        let st = p.snapshot();
        if st.finished {
            continue;
        }
        let rem = p.remaining();
        if rem > candidate_remaining {
            candidate_remaining = rem;
            candidate = Some(p);
        }
    }

    let Some(target) = candidate else {
        return false;
    };

    // Bölünen parça anlamlı bir iş olmalı.
    let half = candidate_remaining / 2;
    if half <= STEAL_THRESHOLD_BYTES / 2 {
        return false;
    }

    // Hedefi kısalt: yarısını bırak.
    let (split_at, old_end) = {
        let mut t = target.state.lock().unwrap_or_else(|e| e.into_inner());
        if t.finished {
            return false;
        }
        let split_at = t.current_byte + half;
        let old_end = t.end_byte;
        t.end_byte = split_at - 1;
        (split_at, old_end)
    };

    // Kalan yarıyı kendime al.
    {
        let mut m = me.state.lock().unwrap_or_else(|e| e.into_inner());
        m.start_byte = split_at;
        m.end_byte = old_end;
        m.current_byte = split_at;
        m.finished = false;
    }

    // Alınan aralığın baytları henüz indirilmedi -> sayaca eklenmez.
    me.recalibrate(split_at);

    true
}
/// Üstel geri çekilme ile bekle (iptal edilebilir).
///
/// MC'nin throttle eğrisi: `min(15, 1.5 × deneme)` saniye.
async fn sleep_backoff(signal: &AbortSignal, attempt: u32) {
    let delay = THROTTLE_BASE_DELAY
        .saturating_mul(attempt.min(10))
        .min(THROTTLE_MAX_DELAY);

    tokio::select! {
        _ = tokio::time::sleep(delay) => {}
        _ = signal.wait() => {}
    }
}

/// Tüm kanalların paylaştığı sınırlama durumu (MC `SegmentedDownloader`).
///
/// MC `fillSlots()` yeni bir isteği başlatmadan önce iki kapıdan geçirir:
///
/// 1. **`throttledUntil`** — sınırlama yanıtı gelince bu ana kadar YENİ
///    istek atılmaz. Ceza yalnızca çeken kanala değil, bekleyen tüm
///    kanallara yayılır.
/// 2. **`activeLimit`** — aynı anda kaç kanalın istek atabileceği.
///    `throttle()` bir azaltır, başarılı istekte geri artar.
///
/// ADM'de ikisi de yalnızca yazılıyordu: `narrow`/`widen` çağrılıyor ama
/// `active_limit` hiç okunmadığı için daraltma ekranda hiçbir şeyi
/// değiştirmiyordu. `throttledUntil` ise hiç yoktu — bir kanal ceza
/// yediğinde diğerleri son hız devam ediyordu.
#[derive(Debug)]
struct Throttle {
    /// Aynı anda istek atabilecek kanal sayısı (MC `activeLimit`).
    active_limit: std::sync::atomic::AtomicU32,
    /// Şu anda istekte olan kanal sayısı (MC `segmentTasks.count`).
    used: std::sync::atomic::AtomicU32,
    /// Ortak bekleme bitişi (MC `throttledUntil`).
    throttled_until: std::sync::Mutex<Option<Instant>>,
    /// Durum değiştiğinde slot bekleyen kanalları uyandırır.
    ///
    /// `watch` kullanılmasının nedeni kayıp bildirimdir: koşul kontrolü ile
    /// beklemeye geçme arasına sıkışan bildirim `Notify::notify_waiters`
    /// ile yutulur ve kanal sonsuza dek uyur. `watch` alıcısının gördüğü
    /// sürüm kaydı bu boşluğu kapatır — bu yüzden alıcı, koşul ÖNCESENDEĞİL
    /// ÖNCE oluşturulur.
    changed: tokio::sync::watch::Sender<u64>,
}

impl Default for Throttle {
    fn default() -> Self {
        Self {
            active_limit: std::sync::atomic::AtomicU32::new(0),
            used: std::sync::atomic::AtomicU32::new(0),
            throttled_until: std::sync::Mutex::new(None),
            changed: tokio::sync::watch::channel(0).0,
        }
    }
}

impl Throttle {
    /// Sınırlandırmaya tepki: sınırı bir azalt (en az 1).
    fn narrow(&self) {
        let _ = self
            .active_limit
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| {
                Some(v.saturating_sub(1).max(1))
            });
    }

    /// Sınırı geri artır (`max` üst sınır).
    fn widen(&self, max: u32) {
        let _ = self
            .active_limit
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| {
                Some((v + 1).min(max.max(1)))
            });
        self.wake();
    }

    /// Ortak bekleme anını yaz (MC `throttledUntil = now + min(15, 1.5 × deneme)`).
    ///
    /// `attempts` 1'den başlar; eğri `sleep_backoff` ile aynıdır, böylece
    /// çeken kanalın kendi geri çekilme uykusu bittiğinde ortak kapı da
    /// açılmış olur.
    fn set_throttled_for(&self, attempts: u32) {
        let delay = THROTTLE_BASE_DELAY
            .saturating_mul(attempts.min(10))
            .min(THROTTLE_MAX_DELAY);

        if let Ok(mut slot) = self.throttled_until.lock() {
            // Var olan süre daha uzunsa uzatma; diğer kanalları gereksiz
            // bekletme (MC `max(throttledUntil, ...)` mantığı).
            let yeni = Instant::now() + delay;
            match *slot {
                Some(mevcut) if mevcut >= yeni => {}
                _ => *slot = Some(yeni),
            }
        }
        self.wake();
    }

    /// Bekleyen tüm kanalları durum yeniden değerlendirmesi için uyandırır.
    fn wake(&self) {
        self.changed.send_modify(|v| *v = v.wrapping_add(1));
    }

    /// Boşta bir slot varsa kapar; yoksa `false`.
    fn try_take_slot(&self) -> bool {
        // MC de `max(1, ...)` kullanır: sınır 0 kalırsa hiçbir kanal
        // açılmaz ve indirme sessizce durur.
        let limit = self.active_limit.load(Ordering::SeqCst).max(1);
        self.used
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |v| {
                (v < limit).then_some(v + 1)
            })
            .is_ok()
    }

    /// Yeni bir isteği başlatmadan önce çağrılır (MC `fillSlots`).
    ///
    /// Ortak bekleme ve eşzamanlılık sınırı dolana kadar bekler. Dönen
    /// tutamaç düşürülünce slot geri verilir; `?`, `return` ya da panik
    /// yolu fark etmez, RAII sayesinde sayaç sarkmaz.
    ///
    /// Sinyal alınırsa `EngineError::Aborted` döner; slot hiç kapılmamış
    /// olur.
    async fn acquire(&self, signal: &AbortSignal) -> Result<ThrottleSlot<'_>, EngineError> {
        // Alıcı KOŞULDAN ÖNCE kurulmalı (yukarıdaki `changed` açıklaması).
        let mut changed = self.changed.subscribe();

        loop {
            if signal.is_aborted() {
                return Err(EngineError::Aborted);
            }

            // 1) Ortak kapı (MC `throttledUntil`). Kilit yalnızca `Instant`
            //    kopyalanır; `await` sırasında elde tutulmaz.
            let ortak_bekleme = {
                let kilit = self.throttled_until.lock().expect("kilit bozuk");
                match *kilit {
                    Some(until) => {
                        let now = Instant::now();
                        (until > now).then_some(until - now)
                    }
                    None => None,
                }
            };
            if let Some(durak) = ortak_bekleme {
                tokio::select! {
                    _ = tokio::time::sleep(durak) => {}
                    _ = signal.wait() => {}
                }
                continue; // uyandıktan sonra kapılar yeniden denenir
            }

            // 2) Eşzamanlılık kapısı (MC `segmentTasks.count < activeLimit`).
            if self.try_take_slot() {
                return Ok(ThrottleSlot { throttle: self });
            }

            // Boşalması için başka bir kanalın isteği bitmesi gerekir.
            tokio::select! {
                _ = changed.changed() => {}
                _ = signal.wait() => {}
            }
        }
    }
}

/// `Throttle::acquire` ile alınmış slotun tutamaçı.
///
/// Düşürülmesi slotu serbest bırakır ve bekleyen kanalları uyandırır.
#[derive(Debug)]
struct ThrottleSlot<'a> {
    throttle: &'a Throttle,
}

impl Drop for ThrottleSlot<'_> {
    fn drop(&mut self) {
        self.throttle.used.fetch_sub(1, Ordering::SeqCst);
        self.throttle.wake();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_channels_covers_exactly() {
        // Kanal başına en az 1 MB gerektiği için dosya büyük olmalı.
        let total = 64 * 1024 * 1024u64;
        let cs = plan_channels(total, 4);
        assert_eq!(cs.len(), 4);
        assert_eq!(cs[0].start_byte, 0);
        assert_eq!(cs[3].end_byte, total - 1);
        // Aralıklar boşluk bırakmadan bitişik olmalı.
        for w in cs.windows(2) {
            assert_eq!(w[0].end_byte + 1, w[1].start_byte);
        }
    }

    #[test]
    fn plan_channels_handles_remainder() {
        let total = 4_000_001u64;
        let cs = plan_channels(total, 4);
        let covered: u64 = cs.iter().map(|c| c.remaining()).sum();
        assert_eq!(covered, total);
    }

    #[test]
    fn plan_channels_clamps_channel_count() {
        let cs = plan_channels(4 * 1024 * 1024 * 1024u64, 1000);
        assert!(cs.len() <= MAX_CHANNELS as usize);
    }

    #[test]
    fn plan_channels_single_channel_for_tiny_file() {
        let cs = plan_channels(1000, 32);
        assert_eq!(cs.len(), 1);
        assert_eq!(cs[0].start_byte, 0);
        assert_eq!(cs[0].end_byte, 999);
    }

    /// Boş ya da tamamen reddedilen bir liste `None` döner; böylece
    /// istemcinin varsayılan `User-Agent`'ı bozulmaz.
    #[test]
    fn ek_baslik_yoksa_none_doner() {
        assert!(build_extra_headers(&[]).is_none());

        let denied = vec![("Range".to_string(), "bytes=0-99".to_string())];
        assert!(
            build_extra_headers(&denied).is_none(),
            "yalnızca reddedilen başlıklardan oluşan liste None olmalı"
        );
    }

    /// Segmentleme sözleşmesi ve çerez, tarayıcı başlığıyla ezilemez.
    #[test]
    fn ek_baslik_reddedilenleri_eler() {
        let mixed = vec![
            ("Referer".to_string(), "https://ornek.tv/".to_string()),
            ("Range".to_string(), "bytes=0-99".to_string()),
            ("Accept-Encoding".to_string(), "gzip".to_string()),
            ("Host".to_string(), "yanlis.example".to_string()),
            ("Cookie".to_string(), "oturum=abc".to_string()),
        ];

        let map = build_extra_headers(&mixed).expect("referer kalmalı");
        assert_eq!(
            map.get("referer").and_then(|v| v.to_str().ok()),
            Some("https://ornek.tv/")
        );
        for denied in ["range", "accept-encoding", "host", "cookie"] {
            assert!(
                map.get(denied).is_none(),
                "{denied} başlığı reddedilmedi"
            );
        }
    }

    /// Başlık adı büyük/küçük harf duyarsız eşleşir, değer korunur.
    #[test]
    fn ek_baslik_adi_kucuk_harflestirilir() {
        let map = build_extra_headers(&[(
            "USER-AGENT".to_string(),
            "TarayiciUA/9.9".to_string(),
        )])
        .expect("başlık geçerli");

        assert_eq!(
            map.get("user-agent").and_then(|v| v.to_str().ok()),
            Some("TarayiciUA/9.9"),
            "değerin büyük/küçük harfi değişmemeli"
        );
    }

    #[test]
    fn plan_channels_small_file_collapses_to_one() {
        // 1 MB'ın altındaki dosyada çok kanallı indirme anlamsızdır.
        let cs = plan_channels(900 * 1024, 8);
        assert_eq!(cs.len(), 1);
    }

    #[test]
    fn plan_channels_zero_size_single_channel() {
        let cs = plan_channels(0, 8);
        assert_eq!(cs.len(), 1);
    }

    #[test]
    fn parse_content_range_extracts_total() {
        assert_eq!(parse_content_range_total("bytes 0-0/12345"), Some(12345));
        assert_eq!(parse_content_range_total("bytes 0-100/*"), None);
    }

    #[test]
    fn abort_signal_is_observable() {
        let s = AbortSignal::new();
        assert!(!s.is_aborted());
        s.abort();
        assert!(s.is_aborted());
    }

    #[tokio::test]
    async fn abort_signal_wait_returns_on_abort() {
        let s = AbortSignal::new();
        let s2 = s.clone();
        let handle = tokio::spawn(async move { s2.wait().await });
        tokio::time::sleep(Duration::from_millis(30)).await;
        s.abort();
        tokio::time::timeout(Duration::from_secs(2), handle)
            .await
            .expect("wait iptal edilmedi")
            .unwrap();
    }

    #[test]
    fn preallocate_sets_length() {
        let dir = std::env::temp_dir().join("adm_test_prealloc");
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("f.bin");
        preallocate(&p, 4096).unwrap();
        assert_eq!(file_len(&p), Some(4096));
        let _ = std::fs::remove_dir_all(&dir);
    }

    // -----------------------------------------------------------------
    // 429 adaptif sınırlama (MC `throttle` / `activeLimit`)
    // -----------------------------------------------------------------

    #[test]
    fn sinirlama_kodlari_mc_ile_ayni() {
        // MC `SegmentedDownloader`: `case 408, 425, 429, 500, 502, 503, 504`.
        for code in [408u16, 425, 429, 500, 502, 503, 504] {
            assert!(
                THROTTLE_STATUSES.contains(&code),
                "{code} sınırlama kodu olmalı"
            );
        }
        assert_eq!(THROTTLE_STATUSES.len(), 7, "MC tam yedi kod kullanır");
        // Sıradan sunucu hataları sınırlama sayılmaz.
        for code in [400u16, 401, 403, 404, 410, 416] {
            assert!(
                !THROTTLE_STATUSES.contains(&code),
                "{code} sınırlama kodu olmamalı"
            );
        }
    }

    #[test]
    fn sinirlama_kanal_sayisini_bir_azaltir() {
        let t = Throttle::default();
        t.active_limit.store(8, Ordering::SeqCst);
        t.narrow();
        assert_eq!(t.active_limit.load(Ordering::SeqCst), 7);
        t.narrow();
        t.narrow();
        assert_eq!(t.active_limit.load(Ordering::SeqCst), 5);
    }

    #[test]
    fn sinirlama_tabanda_birde_kalir() {
        let t = Throttle::default();
        t.active_limit.store(2, Ordering::SeqCst);
        for _ in 0..10 {
            t.narrow();
        }
        assert_eq!(
            t.active_limit.load(Ordering::SeqCst),
            1,
            "sınır 1'in altına inmemeli"
        );

        // Sıfırdan başlasa bile taban 1'dir (taşma olmamalı).
        let t0 = Throttle::default();
        assert_eq!(t0.active_limit.load(Ordering::SeqCst), 0);
        t0.narrow();
        assert_eq!(t0.active_limit.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn basarili_istek_siniri_max_a_kadar_genisler() {
        let t = Throttle::default();
        t.active_limit.store(4, Ordering::SeqCst);
        t.widen(8);
        assert_eq!(t.active_limit.load(Ordering::SeqCst), 5);
        t.widen(8);
        t.widen(8);
        assert_eq!(t.active_limit.load(Ordering::SeqCst), 7);
    }

    #[test]
    fn genisleme_max_i_asamaz() {
        let t = Throttle::default();
        t.active_limit.store(8, Ordering::SeqCst);
        for _ in 0..5 {
            t.widen(8);
        }
        assert_eq!(
            t.active_limit.load(Ordering::SeqCst),
            8,
            "sınır kanal sayısını aşmamalı"
        );
    }

    #[test]
    fn genisleme_max_sifirsa_bir_kabul_eder() {
        // Kanal sayısı bozuk (0) gelse bile sınır 1'e çıkar: aksi halde
        // hiçbir kanal açılamaz ve indirme sessizce dururdu.
        let t = Throttle::default();
        t.widen(0);
        assert_eq!(t.active_limit.load(Ordering::SeqCst), 1);
    }

    // -----------------------------------------------------------------
    // Sınırın gerçekten uygulanması (daha önce yalnızca yazılıyordu)
    // -----------------------------------------------------------------

    /// Sınır doluyken ikinci kanal slot alamaz; boşalınca uyanır.
    ///
    /// Bu, `active_limit`'in ilk kez okunmasıdır: eski kodda `narrow`/
    /// `widen` çağrılıyor ama hiçbir istek gecikmiyordu.
    #[tokio::test]
    async fn sinirlama_ikinci_kanali_geride_birakir() {
        let t = Arc::new(Throttle::default());
        t.active_limit.store(1, Ordering::SeqCst);
        let signal = AbortSignal::new();

        let birinci = t.acquire(&signal).await.expect("ilk slot alınmalı");

        let bekleyen = tokio::spawn({
            let t = Arc::clone(&t);
            let signal = signal.clone();
            async move {
                let slot = t.acquire(&signal).await?;
                drop(slot);
                Ok::<(), EngineError>(())
            }
        });

        // Kanal hâlâ bekiyor olmalı: sınır 1 ve o slot dolu.
        tokio::time::sleep(Duration::from_millis(80)).await;
        assert!(
            !bekleyen.is_finished(),
            "sınır doluyken ikinci kanal slot alamamalı"
        );

        drop(birinci);

        tokio::time::timeout(Duration::from_secs(5), bekleyen)
            .await
            .expect("ikinci kanal uyanmadı")
            .expect("görev panikledi")
            .expect("slot boşalınca alınmalı");
    }

    /// Ortak bekleme (`throttledUntil`) yeni isteği erteler.
    ///
    /// MC `fillSlots()`: `if throttledUntil.timeIntervalSinceNow > 0 { bekle }`.
    /// Tek bir kanalın yediği ceza, diğerlerini de yavaşlatır.
    #[tokio::test]
    async fn ortak_bekleme_yeni_istekleri_erteler() {
        let t = Throttle::default();
        t.active_limit.store(4, Ordering::SeqCst);
        let signal = AbortSignal::new();

        let bekleme = Duration::from_millis(300);
        *t.throttled_until.lock().expect("kilit bozuk") =
            Some(Instant::now() + bekleme);

        let baslangic = Instant::now();
        let slot = t.acquire(&signal).await.expect("slot alınmalı");
        let gecen = baslangic.elapsed();
        drop(slot);

        // Zamanlayıcı er uyanabilir; 250 ms altında kalmışsa kapı işlememiş.
        assert!(
            gecen >= Duration::from_millis(250),
            "ortak kapı isteği ertelemeliydi, yalnızca {gecen:?} geçti"
        );
    }

    /// Var olan ortak süre daha uzunsa yenisi onu kısaltmaz.
    #[tokio::test]
    async fn ortak_bekleme_kisa_cezayla_uzatilmaz() {
        let t = Throttle::default();
        let uzun = Instant::now() + Duration::from_secs(10);
        *t.throttled_until.lock().expect("kilit bozuk") = Some(uzun);

        t.set_throttled_for(1); // 1.5 sn'lik ceza

        let kalan = *t.throttled_until.lock().expect("kilit bozuk");
        assert!(
            kalan.is_some_and(|k| k >= uzun - Duration::from_millis(100)),
            "kısa ceza on yıllık bekleme etmemeli"
        );
    }

    /// Slot tutamacı RAII ile serbest kalır: `?`, `return` ya da panik
    /// yolu fark etmez, sayaç sarkmaz.
    ///
    /// Sayaç sarsa bir sonraki indirme az kanalla başlar ve hiçbir zaman
    /// tam hıza çıkmaz — hata sessizdir.
    #[tokio::test]
    async fn slot_dusunce_sayac_sifirlanir() {
        let t = Throttle::default();
        t.active_limit.store(2, Ordering::SeqCst);
        let signal = AbortSignal::new();

        assert_eq!(t.used.load(Ordering::SeqCst), 0);

        {
            let _a = t.acquire(&signal).await.expect("slot");
            let _b = t.acquire(&signal).await.expect("slot");
            assert_eq!(
                t.used.load(Ordering::SeqCst),
                2,
                "iki slot da tutuluyor olmalı"
            );
        }

        assert_eq!(
            t.used.load(Ordering::SeqCst),
            0,
            "tutamaçlar düşünce slot geri vermeli"
        );

        // Sayaç sarsaydı bu slot artık alınamazdı.
        let _yine = t.acquire(&signal).await.expect("slot tekrar alınmalı");
    }

    /// Slot beklerken iptal edilen kanal slot KAPMAZ ve `Aborted` döner.
    #[tokio::test]
    async fn iptal_edilen_bekleyen_slot_kapmaz() {
        let t = Arc::new(Throttle::default());
        t.active_limit.store(1, Ordering::SeqCst);
        let signal = AbortSignal::new();

        let _tutuyor = t.acquire(&signal).await.expect("slot");

        let bekleyen = tokio::spawn({
            let t = Arc::clone(&t);
            let signal = signal.clone();
            async move {
                // Slot alındıysa bırakılır: tutamaç fonksiyondan dışarı
                // taşınamaz (borrow), sonuç yine de Ok/Err olarak ölçülür.
                match t.acquire(&signal).await {
                    Ok(slot) => {
                        drop(slot);
                        Ok(())
                    }
                    Err(e) => Err(e),
                }
            }
        });

        tokio::time::sleep(Duration::from_millis(50)).await;
        signal.abort();

        let sonuc = tokio::time::timeout(Duration::from_secs(5), bekleyen)
            .await
            .expect("iptal bekleyen kanal uyanmadı")
            .expect("görev panikledi");

        assert!(
            matches!(sonuc, Err(EngineError::Aborted)),
            "iptal bekleyen kanal Aborted dönmeli, alınan: {sonuc:?}"
        );
        assert_eq!(
            t.used.load(Ordering::SeqCst),
            1,
            "yalnızca ilk kanal slot tutuyor olmalı"
        );
    }

    #[test]
    fn geri_cekilme_egrisi_mc_ile_ayni() {
        // MC: `min(15, 1.5 × deneme)` saniye; 10 denemede 15 sn'ye oturur.
        let delay = |attempt: u32| {
            THROTTLE_BASE_DELAY
                .saturating_mul(attempt.min(10))
                .min(THROTTLE_MAX_DELAY)
        };
        assert_eq!(delay(1), Duration::from_millis(1500));
        assert_eq!(delay(2), Duration::from_secs(3));
        assert_eq!(delay(10), Duration::from_secs(15));
        // Doygunluk: 10'un üstünde de üst sınır korunur.
        assert_eq!(delay(11), Duration::from_secs(15));
        assert_eq!(delay(u32::MAX), Duration::from_secs(15));
        // Deneme başına sınır MC ile aynı (12).
        assert_eq!(MAX_RETRIES_PER_CHANNEL, 12);
    }
}
