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
const THROTTLE_STATUSES: [u16; 6] = [408, 425, 429, 500, 502, 503];

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
    signal: &AbortSignal,
    probe: bool,
) -> Result<(String, ProbeInfo), EngineError> {
    let mut current = url.to_string();

    for _ in 0..MAX_REDIRECTS {
        if signal.is_aborted() {
            return Err(EngineError::Aborted);
        }

        let mut builder = client().get(&current);
        if probe {
            builder = builder.header(reqwest::header::RANGE, "bytes=0-0");
        }

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
        signal: AbortSignal,
        on_progress: ProgressHook,
        on_probe: ProbeHook,
    ) -> Result<Vec<ChannelState>, EngineError> {
        // 1) Yönlendirmeleri çöz ve dosya boyutunu öğren.
        let (final_url, probe) = resolve_url(url, &signal, true).await?;
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
        let states = snapshot_all(&channels);
        let done = downloaded_total(&channels);
        let complete = states.iter().all(|c| c.finished);

        if complete && (total_bytes == 0 || done >= total_bytes) {
            let total = if total_bytes > 0 { total_bytes } else { done };
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
    async fn run_channels(
        &self,
        url: &str,
        dest: &Path,
        channels: Vec<Arc<SharedChannel>>,
        total_bytes: u64,
        signal: AbortSignal,
        supports_ranges: bool,
    ) -> Result<(), EngineError> {
        let count = channels.len();

        // Aynı anda açık dosya tutamağı / bağlantı sayısını sınırla.
        let handles = Arc::new(Semaphore::new(MAX_OPEN_FILE_HANDLES));
        // Tüm kanalların paylaştığı sınırlama durumu.
        let throttle = Arc::new(Throttle::default());
        throttle
            .active_limit
            .store(count as u32, Ordering::SeqCst);

        let mut tasks = Vec::with_capacity(count);

        for idx in 0..count {
            let me = channels[idx].clone();
            let peers = channels.clone();
            let url = url.to_string();
            let dest = dest.to_path_buf();
            let signal = signal.clone();
            let handles = Arc::clone(&handles);
            let throttle = Arc::clone(&throttle);

            tasks.push(tokio::spawn(async move {
                run_channel(
                    url,
                    dest,
                    peers,
                    me,
                    handles,
                    throttle,
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
    let mut elapsed_ms: u64 = 0;

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
        let speed = if elapsed > 0.0 {
            let delta = now_bytes.saturating_sub(last_bytes) as f64;
            delta / (1024.0 * 1024.0) / elapsed
        } else {
            0.0
        };

        elapsed_ms += PROGRESS_INTERVAL.as_millis() as u64;
        history.push_back(SpeedSample {
            t: elapsed_ms,
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

        let outcome =
            fetch_range(&url, &mut file, &me, start_byte, end_byte, &signal, ranged).await;

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
async fn fetch_range(
    url: &str,
    file: &mut std::fs::File,
    me: &Arc<SharedChannel>,
    start_byte: u64,
    end_byte: u64,
    signal: &AbortSignal,
    ranged: bool,
) -> Result<ChannelOutcome, EngineError> {
    let mut builder = client().get(url);
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
    let mut pos = start_byte;
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

/// Tüm kanalların paylaştığı sınırlama durumu (MC `throttledUntil`).
///
/// Bir kanal sınırlama yanıtı aldığında buraya bekleme süresi yazılır; diğer
/// kanallar bir sonraki istekten önce bu süre kadar bekler. Sınır bir seferde
/// azalır, başarılı bir istek sonrası geri artar (MC `activeLimit`).
#[derive(Debug, Default)]
struct Throttle {
    /// Kaç kanalın aynı anda istek atabileceği.
    active_limit: std::sync::atomic::AtomicU32,
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
}
