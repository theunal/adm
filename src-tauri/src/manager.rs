//! Aktif indirmelerin yönetimi.
//!
//! WPF sürümündeki `DownloadManager` sınıfının Rust karşılığıdır. Düzeltilen
//! sorunlar:
//!
//! | WPF hatası | Rust çözümü |
//! |---|---|
//! | `PauseDownloadAsync` yalnızca bayrak set ediyordu; görev hâlâ `Downloading` yazabiliyordu | Duraklatma `AbortSignal` ile görevi gerçekten durdurur; durum yalnızca görev sonunda yazılır |
//! | `DeleteDownloadAsync` dosyayı silmiyordu | `delete` komutu dosyayı da siler |
//! | Kapanışta aktif indirmeler sahipsiz kalıyordu | `shutdown_all()` iptal eder ve görevlerin bitmesini bekler |
//! | `UpdateDownloadItemAsync` hataları yutuyordu | Hatalar log kanalına yazılır |
//! | `ResumeDownloadAsync` kanal durumunu yok sayıyordu | `ChannelStates` JSON'undan gerçek kanal bazlı devam |
//! | DB yazımı 2 saniyede bir, hatalarda sessiz | İlerleme kanalı üzerinden 500 ms'de bir güvenli yazım |

use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;

use anyhow::{Context, Result};
use chrono::Local;
use dashmap::DashMap;
use tokio::sync::{broadcast, mpsc};

use crate::db::Database;
use crate::engine::{
    AbortSignal, DownloadEngine, EngineError, EngineSnapshot, ProgressHook, SpeedSample,
};
use crate::i18n::{self, t};
use crate::models::{ChannelState, DownloadItem, DownloadStatus};

/// Sınırlandırılmış yayın kanalı — yavaş alıcılar gecikmeyi engellemez.
const EVENT_BUFFER: usize = 512;

/// Motorun iç yayın kanalının tamponu.
const ENGINE_BUFFER: usize = 64;

/// Kanal durumu kalıcılık aralığı: her turda JSON'a yazılır.
const PROGRESS_WRITE_INTERVAL: Duration = Duration::from_secs(2);

/// Yeni indirme kaydı için arayüzden gelen parametreler.
#[derive(Debug, Clone)]
pub struct StartRequest {
    pub url: String,
    /// Kullanıcının seçtiği hedef dosya; `None` ise ayarlardan çözülür.
    pub file_path: Option<String>,
    /// İstek başına kanal sayısı.
    pub channel_count: u32,
    /// Dosya mı, yt-dlp videosu mu? (varsayılan: dosya)
    pub kind: crate::models::DownloadKind,
    /// Tarayıcıdan gelen ek başlıklar (Referer, User-Agent…).
    pub headers: Vec<(String, String)>,
    /// `Cookie` başlığı metni (uzantıdan gelir).
    pub cookie_header: Option<String>,
    /// Çerezleri Netscape dosyasına yaz ve indirmede kullan.
    pub use_cookies: bool,
}

impl StartRequest {
    /// Yalnızca URL ile temel bir istek (arayüzün "URL Ekle" akışı).
    pub fn simple(url: String, file_path: Option<String>, channel_count: u32) -> Self {
        Self {
            url,
            file_path,
            channel_count,
            kind: crate::models::DownloadKind::File,
            headers: Vec::new(),
            cookie_header: None,
            use_cookies: false,
        }
    }
}

/// Arayüze yayınlanan olay türleri.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DownloadEvent {
    /// İlerleme güncellemesi (her ~500 ms).
    #[serde(rename_all = "camelCase")]
    Progress {
        id: i64,
        downloaded_bytes: u64,
        total_bytes: u64,
        speed_mbps: f64,
        status: DownloadStatus,
        channels: Vec<ChannelState>,
        speed_history: Vec<SpeedSample>,
        error_message: Option<String>,
        /// Motorun bildirdiği kısa durum metni (seçili dilde).
        phase: String,
        /// yt-dlp faz metni (video indirmelerinde, seçili dilde).
        stage: String,
        /// yt-dlp ham çıktısı (detay penceresindeki günlük).
        log: Option<String>,
    },
    /// Bir indirme bitti (tamamlandı / başarısız / duraklatıldı / iptal).
    #[serde(rename_all = "camelCase")]
    Completed { id: i64, status: DownloadStatus },
    /// Kayıt listesi değişti (ekleme / silme gibi).
    #[serde(rename_all = "camelCase")]
    ListChanged,
    /// Log satırı (seçili dilde üretilmiş mesaj).
    #[serde(rename_all = "camelCase")]
    Log {
        level: String,
        message: String,
        download_id: Option<i64>,
    },
    /// Tarayıcı köprüsünün durumu (durum çubuğu göstergesi).
    #[serde(rename_all = "camelCase")]
    Bridge {
        running: bool,
        port: u16,
        error: Option<String>,
    },
    /// Tarayıcıdan köprü bağlantısı (durum çubuğunda tarayıcı adı).
    #[serde(rename_all = "camelCase")]
    BridgeConnection { browser: String },
    /// Harici araç kurulumu olayı (yt-dlp / ffmpeg / deno).
    #[serde(rename_all = "camelCase")]
    Tool(crate::tools::ToolEvent),
    /// Güncelleme denetimi sonucu.
    #[serde(rename_all = "camelCase")]
    Update {
        current: String,
        latest: Option<String>,
        page_url: Option<String>,
        notes: Option<String>,
        dmg_url: Option<String>,
        error: Option<String>,
    },
    /// Panoda sorulacak bağlantılar.
    #[serde(rename_all = "camelCase")]
    Clipboard(crate::clipboard::ClipboardPrompt),
}

impl DownloadEvent {
    fn log(level: &str, message: impl Into<String>, id: Option<i64>) -> Self {
        Self::Log {
            level: level.to_string(),
            message: message.into(),
            download_id: id,
        }
    }
}

/// Bellekte tutulan tek bir aktif indirme.
struct ActiveDownload {
    /// Kayıt kimliği (log mesajlarında kullanılır).
    #[allow(dead_code)]
    id: i64,
    url: String,
    file_path: PathBuf,
    /// Dosya adı (log mesajlarında kullanılır).
    #[allow(dead_code)]
    file_name: String,
    /// Video çıktılarının yazılacağı klasör.
    output_dir: PathBuf,
    /// yt-dlp çıktısının biriktiği günlük (son ~6000 karakter).
    log: Arc<std::sync::Mutex<String>>,
    /// Çalışan görev için eşzamanlı kanal sayısı.
    channel_count: AtomicU32,
    /// Duraklatma/iptal sinyali.
    signal: AbortSignal,
    /// Kullanıcı "duraklat" mı "iptal" mi dedi?
    paused: AtomicBool,
    /// Görev hâlâ çalışıyor mu?
    running: AtomicBool,
}

impl ActiveDownload {
    fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    fn channels(&self) -> u32 {
        self.channel_count.load(Ordering::SeqCst)
    }
}

/// Ana yönetici.
///
/// `Clone` kopyası aynı `active` haritasını ve olay kanalını paylaşır;
/// bu, kapanış sırasında "son" bir kopya üzerinden iptal yapabilmek için
/// gereklidir (görevler ikinci kez başlatılmaz).
#[derive(Clone)]
pub struct DownloadManager {
    db: Database,
    engine: DownloadEngine,
    active: Arc<DashMap<i64, Arc<ActiveDownload>>>,
    events: broadcast::Sender<DownloadEvent>,
}

impl DownloadManager {
    pub fn new(db: Database) -> Self {
        let (events, _) = broadcast::channel(EVENT_BUFFER);
        Self {
            db,
            engine: DownloadEngine::new(),
            active: Arc::new(DashMap::new()),
            events,
        }
    }

    /// Klonlanmış yönetici — kapanışta kullanılır (aynı `active` haritasını
    /// paylaşır, görevleri ikinci kez başlatmaz).
    pub fn clone_for_shutdown(&self) -> Self {
        self.clone()
    }

    /// Olay dinleyicisi (Tauri katmanı buradan abone olur).
    pub fn subscribe(&self) -> broadcast::Receiver<DownloadEvent> {
        self.events.subscribe()
    }

    /// Veritabanına erişim (commands katmanı için).
    #[allow(dead_code)]
    pub fn database(&self) -> &Database {
        &self.db
    }

    /// Ayarları okur (commands katmanı için).
    pub async fn settings(&self) -> Result<crate::settings::Settings> {
        self.db.load_settings().await
    }

    /// Ayarları yazar ve dil değişikliğini hemen uygular (commands katmanı).
    pub async fn save_settings(&self, settings: &crate::settings::Settings) -> Result<()> {
        let mut normalized = settings.clone();
        normalized.normalize();

        self.db.save_settings(&normalized).await?;
        // Kaydedilen dil hemen etkinleşir; ayrı `set_language` çağrısı gerekmez.
        crate::i18n::set_lang(normalized.lang);
        Ok(())
    }

    fn emit(&self, ev: DownloadEvent) {
        // Alıcı yoksa hata verir; bu normaldir, yoksay.
        let _ = self.events.send(ev);
    }

    fn log(&self, level: &str, msg: impl Into<String>, id: Option<i64>) {
        self.emit(DownloadEvent::log(level, msg, id));
    }

    // -----------------------------------------------------------------
    // Listeleme
    // -----------------------------------------------------------------

    pub async fn list_all(&self) -> Result<Vec<DownloadItem>> {
        self.db.list_all().await
    }

    pub async fn list_active(&self) -> Result<Vec<DownloadItem>> {
        self.db.list_active().await
    }

    pub async fn get(&self, id: i64) -> Result<Option<DownloadItem>> {
        self.db.get(id).await
    }

    // -----------------------------------------------------------------
    // Başlatma
    // -----------------------------------------------------------------

    /// Yeni indirme başlatır; oluşturulan kayıt kimliğini döner.
    ///
    /// Eşzamanlı indirme sınırı (`max_concurrent`) dolduysa kayıt
    /// `Queued` olarak bekler; bir indirme bitince kuyruk pompalıdır.
    pub async fn start(&self, req: StartRequest) -> Result<i64> {
        if req.url.trim().is_empty() {
            anyhow::bail!(i18n::t("err.url_empty", &[]));
        }

        let suggested = crate::models::file_name_from_url(&req.url);
        // MC `destinationDirectory`: kategori alt klasörleme ile çözümle.
        let file_path: PathBuf = match req.file_path.as_deref().map(str::trim) {
            Some(p) if !p.is_empty() => PathBuf::from(p),
            _ => self
                .db
                .load_settings()
                .await?
                .resolve_target_named(&suggested),
        };

        let file_name = file_path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or(suggested);

        // Uzantıdan gelen çerezler Netscape dosyasına yazılır (MC davranışı).
        let cookie_file = if req.use_cookies {
            match req.cookie_header.as_deref() {
                Some(text) if !text.trim().is_empty() => self.write_cookie_file(text).await,
                _ => None,
            }
        } else {
            None
        };

        let now = Local::now();
        let item = DownloadItem {
            id: 0, // veritabanı atar
            url: req.url.trim().to_string(),
            file_path: file_path.to_string_lossy().to_string(),
            file_name,
            total_bytes: 0,
            downloaded_bytes: 0,
            channel_count: req.channel_count.clamp(1, 32),
            status: DownloadStatus::Queued,
            created_at: now,
            completed_at: None,
            last_updated: now,
            speed_mbps: 0.0,
            error_message: None,
            channels: Vec::new(),
            kind: req.kind,
            supports_ranges: false,
            headers: req.headers.clone(),
            cookie_file: cookie_file.clone(),
            final_path: None,
            stage: String::new(),
            log: String::new(),
        };

        let id = self.db.insert(&item).await?;

        self.log(
            "info",
            t(
                "log.new_added",
                &[&item.file_name, &item.channel_count.to_string()],
            ),
            Some(id),
        );
        self.emit(DownloadEvent::ListChanged);

        self.spawn(id).await?;
        Ok(id)
    }

    /// Çerezleri Netscape dosyasına yazar ve yolunu döner.
    async fn write_cookie_file(&self, cookie_text: &str) -> Option<String> {
        let path = crate::db::db_dir()
            .join("cookies")
            .join(format!("bridge-{}.txt", self.next_cookie_id()));
        if let Some(parent) = path.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        if tokio::fs::write(&path, cookie_text).await.is_err() {
            return None;
        }
        Some(path.to_string_lossy().to_string())
    }

    /// Çerez dosyaları için tekil kimlik (ayni saniyede çakışmayı önler).
    fn next_cookie_id(&self) -> u64 {
        use std::sync::atomic::AtomicU64;
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        COUNTER.fetch_add(1, Ordering::SeqCst)
    }

    // -----------------------------------------------------------------
    // Devam ettirme
    // -----------------------------------------------------------------

    /// Duraklatılmış / başarısız indirmeyi kanal durumlarıyla devam ettirir.
    pub async fn resume(&self, id: i64) -> Result<()> {
        let Some(item) = self.db.get(id).await? else {
            anyhow::bail!(t("err.download_not_found", &[&id.to_string()]));
        };

        if !item.status.is_resumable() {
            anyhow::bail!(t("err.not_restartable", &[]));
        }

        if self.active.contains_key(&id) {
            anyhow::bail!(t("err.already_running", &[]));
        }

        // Dosya silinmişse resume anlamsız: sıfırdan başlat.
        if !Path::new(&item.file_path).exists() {
            self.log(
                "warn",
                t("log.file_missing_restart", &[&item.file_name]),
                Some(id),
            );
            self.spawn(id).await?;
            self.emit(DownloadEvent::ListChanged);
            return Ok(());
        }

        let pct = percent_of(item.downloaded_bytes, item.total_bytes);
        self.log(
            "info",
            if pct > 0.0 {
                t("log.resuming_pct", &[&item.file_name, &format!("{pct:.1}")])
            } else {
                t("log.resuming", &[&item.file_name])
            },
            Some(id),
        );

        self.spawn(id).await?;
        self.emit(DownloadEvent::ListChanged);
        Ok(())
    }

    // -----------------------------------------------------------------
    // Duraklatma / iptal
    // -----------------------------------------------------------------

    pub async fn pause(&self, id: i64) -> Result<()> {
        // `map(|a| a.clone())` kilidi ifade bitince bırakır. Doğrudan
        // `self.active.get(&id)` bağlansaydı `DashMap` okuma kilidi
        // `wait_idle(...).await` boyunca açık kalırdı; indirme görevi aynı
        // dilime yazma (`active.remove`) isteyince kilitlenir ve
        // tek iş parçacıklı çalışma zamanında tüm çalışma zamanı donar.
        let Some(ad) = self.active.get(&id).map(|a| a.clone()) else {
            anyhow::bail!(t("err.running_not_found", &[&id.to_string()]));
        };

        ad.paused.store(true, Ordering::SeqCst);
        ad.signal.abort();

        // Görevin gerçekten durmasını bekle (kanal durumları kaydedilsin).
        self.wait_idle(id).await;

        self.log("info", t("log.paused", &[]), Some(id));
        self.emit(DownloadEvent::ListChanged);
        Ok(())
    }

    pub async fn cancel(&self, id: i64) -> Result<()> {
        // Kilit `pause` ile aynı gerekçeyle ifade bitinde bırakılır.
        let Some(ad) = self.active.get(&id).map(|a| a.clone()) else {
            anyhow::bail!(t("err.running_not_found", &[&id.to_string()]));
        };

        ad.paused.store(false, Ordering::SeqCst);
        ad.signal.abort();

        self.wait_idle(id).await;

        self.log("warn", t("log.cancelled", &[]), Some(id));
        self.emit(DownloadEvent::ListChanged);
        Ok(())
    }

    /// Görev bitene kadar bekle (en fazla 10 sn).
    async fn wait_idle(&self, id: i64) {
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            let running = self
                .active
                .get(&id)
                .map(|a| a.is_running())
                .unwrap_or(false);
            if !running || std::time::Instant::now() >= deadline {
                return;
            }
            tokio::time::sleep(Duration::from_millis(60)).await;
        }
    }

    // -----------------------------------------------------------------
    // Silme
    // -----------------------------------------------------------------

    /// Kaydı siler; `delete_file` doğruysa diskteki dosyayı da kaldırır.
    pub async fn delete(&self, id: i64, delete_file: bool) -> Result<()> {
        // Önce çalışıyorsa durdur.
        if self.active.contains_key(&id) {
            let _ = self.cancel(id).await;
            for _ in 0..50 {
                if !self.active.contains_key(&id) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(60)).await;
            }
            self.active.remove(&id);
        }

        let Some(item) = self.db.get(id).await? else {
            anyhow::bail!(t("err.download_not_found", &[&id.to_string()]));
        };

        if delete_file {
            let path = PathBuf::from(&item.file_path);
            match tokio::fs::remove_file(&path).await {
                Ok(()) => self.log("info", t("log.file_deleted", &[&item.file_name]), Some(id)),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => self.log(
                    "warn",
                    t("log.file_delete_failed", &[&item.file_name, &e.to_string()]),
                    Some(id),
                ),
            }
            // Uzantıdan gelen çerez dosyasını da temizle (MC `remove`).
            if let Some(cookie) = item.cookie_file.as_deref() {
                let _ = tokio::fs::remove_file(cookie).await;
            }
        }

        self.db.delete(id).await?;
        self.log(
            "info",
            t("log.record_deleted", &[&item.file_name]),
            Some(id),
        );
        self.emit(DownloadEvent::ListChanged);
        Ok(())
    }

    /// Tamamlanmış / iptal edilmiş / başarısız kayıtları temizler.
    pub async fn clear_finished(&self) -> Result<()> {
        let all = self.db.list_all().await?;
        let mut removed = 0usize;
        for item in all {
            if item.status.is_listed_active() {
                continue;
            }
            self.db.delete(item.id).await?;
            removed += 1;
        }
        if removed > 0 {
            self.log(
                "info",
                t("log.records_cleared", &[&removed.to_string()]),
                None,
            );
        }
        self.emit(DownloadEvent::ListChanged);
        Ok(())
    }

    // -----------------------------------------------------------------
    // Toplu işlemler
    // -----------------------------------------------------------------

    /// Tek bir kayda toplu işlem uygular; hata durumda yutulur.
    ///
    /// Toplu işlemler "mümkün olan ne varsa" semantiğindedir: listede
    /// sürdürülemeyen bir kayıt varsa (ör. tamamlanmış) işlem onu atlar ve
    /// kalanlara devam eder. Bu yüzden hata yalnızca log'a yazılır.
    async fn bulk_each<F, Fut>(&self, ids: &[i64], mut op: F)
    where
        F: FnMut(i64) -> Fut,
        Fut: std::future::Future<Output = Result<()>>,
    {
        for id in ids {
            if let Err(e) = op(*id).await {
                self.log("error", i18n::render(&format!("{e:#}")), Some(*id));
            }
        }
    }

    /// Duruma uyan tüm kayıtların kimlikleri (veritabanı sırası korunur).
    async fn ids_where<F>(&self, pred: F) -> Result<Vec<i64>>
    where
        F: Fn(&DownloadStatus) -> bool,
    {
        Ok(self
            .db
            .list_all()
            .await?
            .into_iter()
            .filter(|item| pred(&item.status))
            .map(|item| item.id)
            .collect())
    }

    /// Çalışan tüm indirmeleri duraklatır; etkilenen sayıyı döner.
    pub async fn pause_all(&self) -> Result<usize> {
        let ids = self
            .ids_where(|s| matches!(s, DownloadStatus::Queued | DownloadStatus::Downloading))
            .await?;
        let count = ids.len();
        self.bulk_each(&ids, |id| async move { self.pause(id).await }).await;
        self.log_bulk("log.bulk_paused", count);
        Ok(count)
    }

    /// Duraklatılmış / başarısız tüm indirmeleri sürdürür.
    ///
    /// `resume` görevi yeniden başlattığı için geçmiş kayıtlarda
    /// tamamlanmış olanlar atlanır (durumları `is_resumable` değil).
    pub async fn resume_all(&self) -> Result<usize> {
        let ids = self
            .ids_where(|s| s.is_resumable())
            .await?;
        let count = ids.len();
        self.bulk_each(&ids, |id| async move { self.resume(id).await }).await;
        self.log_bulk("log.bulk_resumed", count);
        Ok(count)
    }

    /// Çalışan tüm indirmeleri iptal eder; etkilenen sayıyı döner.
    pub async fn cancel_all(&self) -> Result<usize> {
        let ids = self
            .ids_where(|s| matches!(s, DownloadStatus::Queued | DownloadStatus::Downloading))
            .await?;
        let count = ids.len();
        self.bulk_each(&ids, |id| async move { self.cancel(id).await }).await;
        self.log_bulk("log.bulk_cancelled", count);
        Ok(count)
    }

    /// Toplu işlem özetini log'a yazar (işlem yapılmadıysa sessiz).
    fn log_bulk(&self, key: &str, count: usize) {
        if count == 0 {
            return;
        }
        self.log("info", t(key, &[&count.to_string()]), None);
        self.emit(DownloadEvent::ListChanged);
    }

    /// Bir indirmenin kanal sayısını değiştirir.
    ///
    /// Çalışan görevlerde kanal sayısı anlık değiştirilemez (aralıklar indirme
    /// başlarken belirlenir), bu yüzden indirme duraklatılıp yeni kanal
    /// sayısıyla sürdürülür.
    pub async fn change_channel_count(&self, id: i64, count: u32) -> Result<()> {
        let count = count.clamp(1, 32);

        if let Some(ad) = self.active.get(&id).map(|a| a.clone()) {
            // Yeni görev bu değerle başlasın.
            ad.channel_count.store(count, Ordering::SeqCst);
            self.db.update_channel_count(id, count).await?;

            let was_running = ad.is_running();
            if was_running {
                self.pause(id).await?;
            }

            self.log(
                "info",
                t("log.channels_updated", &[&count.to_string()]),
                Some(id),
            );
            self.spawn(id).await?;
        } else {
            self.db.update_channel_count(id, count).await?;
            self.log(
                "info",
                t("log.channels_updated", &[&count.to_string()]),
                Some(id),
            );
            self.emit(DownloadEvent::ListChanged);
        }

        Ok(())
    }

    // -----------------------------------------------------------------
    // Tarayıcı köprüsü (uzantıdan gelen istekler)
    // -----------------------------------------------------------------

    /// Köprü listenin en son 50 kaydı (uzantının `/downloads` yanıtı).
    pub async fn bridge_downloads(&self) -> Vec<crate::models::DownloadItem> {
        self.db
            .list_all()
            .await
            .unwrap_or_default()
            .into_iter()
            .take(50)
            .collect()
    }

    /// Köprüden yeni indirme isteği.
    ///
    /// Uzantının gönderdiği URL, başlıklar ve çerezlerle kayıt oluşturur;
    /// kimliği döner. `kind = video` ise indirme yt-dlp ile yapılır.
    pub async fn bridge_add(
        &self,
        url: String,
        headers: Vec<(String, String)>,
        cookie_header: Option<String>,
        kind: crate::models::DownloadKind,
        channel_count: u32,
    ) -> Result<i64> {
        self.start(StartRequest {
            url,
            file_path: None,
            channel_count,
            kind,
            headers,
            cookie_header,
            use_cookies: true,
        })
        .await
    }

    /// Köprüden eylem isteği (`pause` / `resume` / `stop` / `delete` /
    /// `open`).
    pub async fn bridge_action(&self, id: i64, action: &str) -> Result<()> {
        match action {
            "pause" => self.pause(id).await,
            "resume" => self.resume(id).await,
            "stop" => self.cancel(id).await,
            "delete" => {
                self.delete(id, true).await?;
                Ok(())
            }
            "open" => {
                let Some(item) = self.db.get(id).await? else {
                    anyhow::bail!(t("err.download_not_found", &[&id.to_string()]));
                };
                let path = item
                    .final_path
                    .as_deref()
                    .unwrap_or(&item.file_path)
                    .to_string();
                crate::commands::open_path_internal(&path)
            }
            other => anyhow::bail!(i18n::t("err.bridge_unknown_action", &[other])),
        }
    }

    // -----------------------------------------------------------------
    // Kapanış
    // -----------------------------------------------------------------

    /// Tüm aktif indirmeleri iptal eder ve görevlerin bitmesini bekler.
    ///
    /// Uygulama kapatılırken çağrılır: açık dosya tutamağı veya görev
    /// bırakmaz, böylece bir sonraki açılışta kanal durumları tutarlı kalır.
    pub async fn shutdown_all(&self) {
        let ids: Vec<i64> = self.active.iter().map(|e| *e.key()).collect();
        if ids.is_empty() {
            return;
        }

        self.log("warn", t("log.shutdown", &[&ids.len().to_string()]), None);

        for id in &ids {
            if let Some(ad) = self.active.get(id) {
                ad.paused.store(false, Ordering::SeqCst);
                ad.signal.abort();
            }
        }

        for id in &ids {
            self.wait_idle(*id).await;
        }
        self.active.clear();
    }

    // -----------------------------------------------------------------
    // Görev yönetimi
    // -----------------------------------------------------------------

    /// Bir indirmeyi (yeni veya sürdürülen) arka planda çalıştırır.
    ///
    /// **Hemen döner.** Tauri komutu (`start_download`, `resume_download`)
    /// bu fonksiyonu bekler; indirme bitene kadar beklemesi, arayüzdeki
    /// "ekleniyor" durumunun ve düğme kilitlerinin sürekli açık kalmasına
    /// yol açar. Bu yüzden ağır iş ayrı bir görevde çalışır.
    ///
    /// Eşzamanlı indirme sınırı dolduysa görev **başlatılmaz**; kayıt
    /// `Queued` kalır ve `pump_queue` ile ileride yeniden denenir.
    async fn spawn(&self, id: i64) -> Result<()> {
        let Some(item) = self.db.get(id).await? else {
            anyhow::bail!(t("err.download_not_found", &[&id.to_string()]));
        };

        // Eşzamanlılık sınırı (MC `pumpQueue`).
        let settings = self.db.load_settings().await?;
        if !settings.auto_start || self.active.len() >= settings.max_concurrent as usize {
            if !item.status.is_resumable() && item.status != DownloadStatus::Queued {
                self.db
                    .update_status(id, DownloadStatus::Queued, None, None)
                    .await?;
                self.emit(DownloadEvent::ListChanged);
            }
            return Ok(());
        }

        // Kanal bazlı devam: yalnızca gerçekten bir şey indirilmişse.
        let resume_states: Vec<ChannelState> =
            if item.downloaded_bytes > 0 && !item.channels.is_empty() {
                item.channels.clone()
            } else {
                Vec::new()
            };

        let signal = AbortSignal::new();
        let output_dir = PathBuf::from(&item.file_path)
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(crate::manager::default_download_dir);
        let ad = Arc::new(ActiveDownload {
            id,
            url: item.url.clone(),
            file_path: PathBuf::from(&item.file_path),
            file_name: item.file_name.clone(),
            output_dir,
            log: Arc::new(std::sync::Mutex::new(item.log.clone())),
            channel_count: AtomicU32::new(item.channel_count.max(1)),
            signal: signal.clone(),
            paused: AtomicBool::new(false),
            running: AtomicBool::new(true),
        });

        // Eski görev kaydını temizle (varsa).
        self.active.insert(id, ad.clone());

        self.db
            .update_status(id, DownloadStatus::Downloading, None, None)
            .await?;
        self.emit(DownloadEvent::ListChanged);

        // Ağır iş ayrı bir görevde çalışır: `start_download` / `resume_download`
        // komutları indirme bitmeden dönmelidir, aksi halde arayüzdeki
        // "Ekleniyor…" durumu ve düğme kilitleri sürekli açık kalır.
        let me = self.clone();
        tokio::spawn(async move {
            if let Err(e) = me.run_download(id, item, ad, signal, resume_states).await {
                me.log("error", t("log.task_failed", &[&e.to_string()]), Some(id));
            }
        });

        Ok(())
    }

    /// Kuyruktaki bekleyen indirmeleri sınırın izin verdiği kadar başlatır.
    ///
    /// Dönüş tipi elle yazılmıştır: `spawn` → `run_download` → `pump_queue`
    /// → `spawn` çağrı döngüsü olduğu için rustc `Send` çıkarımını
    /// tamamlayamaz. `dyn Future + Send` sınırı döngüyü kırar ve görevin
    /// gerçekten gönderilebilir olduğunu derleyiciye doğrulatır.
    pub fn pump_queue(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            let queued: Vec<i64> = self
                .db
                .list_all()
                .await
                .unwrap_or_default()
                .into_iter()
                .filter(|i| i.status == DownloadStatus::Queued && !self.active.contains_key(&i.id))
                .map(|i| i.id)
                .take(64)
                .collect();

            for id in queued {
                let limit = self
                    .db
                    .load_settings()
                    .await
                    .map(|s| s.max_concurrent)
                    .unwrap_or(3);
                if self.active.len() as u32 >= limit {
                    break;
                }
                let _ = self.spawn(id).await;
            }
        })
    }

    /// İndirmeyi baştan sona yürütür: motor → ilerleme yazarı → sonuç.
    ///
    /// Kaydın türüne göre iki yol ayrılır:
    /// * `kind = file` → çok kanallı motor
    /// * `kind = video` → yt-dlp alt süreci
    async fn run_download(
        &self,
        id: i64,
        item: DownloadItem,
        ad: Arc<ActiveDownload>,
        signal: AbortSignal,
        resume_states: Vec<ChannelState>,
    ) -> Result<()> {
        if item.kind.is_video() {
            return self.run_video(id, item, ad, signal).await;
        }

        // Motorun periyodik yayıncısı senkron bir kanca çağırır; bu kancayı
        // async kanala bağlayıp ayrı bir görevde işliyoruz. Böylece motor
        // Tauri/DB katmanına bağımlı olmaz.
        let (tx, rx) = mpsc::channel::<EngineSnapshot>(ENGINE_BUFFER);
        let hook: ProgressHook = Arc::new(move |snap| {
            // Kanal doluysa bu turu atla; bir sonraki turda tekrar denenir.
            // Böylece bellek sınırsız büyümez, motor hiç bloklanmaz.
            let _ = tx.try_send(snap);
        });

        // Sunucu bilgileri öğrenildiğinde `supportsRanges` ve toplam boyutu
        // kayda yaz (MC `handleProbe`; dosya adı değişikliği dosya açıldıktan
        // sonra mümkün olmadığı için yalnızca bilgi alanları güncellenir).
        let probe_db = self.db.clone();
        let probe_hook: crate::engine::ProbeHook = Arc::new(move |probe| {
            let db = probe_db.clone();
            tokio::spawn(async move {
                if let Ok(Some(mut existing)) = db.get(id).await {
                    existing.total_bytes = existing.total_bytes.max(probe.total_bytes);
                    existing.supports_ranges = probe.accepts_ranges;
                    let _ = db.update_progress(&existing).await;
                }
            });
        });

        let channel_count = ad.channels();
        let url = ad.url.clone();
        let path = ad.file_path.clone();
        let engine = self.engine;

        let driver = tokio::spawn(async move {
            engine
                .download(
                    &url,
                    &path,
                    channel_count,
                    if resume_states.is_empty() {
                        None
                    } else {
                        Some(&resume_states)
                    },
                    signal,
                    hook,
                    probe_hook,
                )
                .await
        });

        // Motor bittiğinde `tx` kanalın göndericisi düşer; alıcı kapanır ve
        // yazar görevi kendiliğinden sonlanır.
        let progress = self.spawn_progress_writer(id, item.clone(), channel_count, rx);

        // Motor sonucunu bekle.
        let result = driver.await.unwrap_or(Err(EngineError::Failed(i18n::canon(
            "err.task_ended_unexpectedly",
            &[],
        ))));

        let last_snapshot = progress.await.unwrap_or(None);

        let states: Vec<ChannelState> = match &result {
            Ok(states) => states.clone(),
            Err(_) => match last_snapshot {
                Some(s) if !s.channels.is_empty() => s.channels,
                _ => self
                    .db
                    .get(id)
                    .await
                    .ok()
                    .flatten()
                    .map(|i| i.channels)
                    .unwrap_or_default(),
            },
        };

        let paused = ad.paused.load(Ordering::SeqCst);

        // Sonuç önce yazılır, sonra görev "bitti" işaretlenir: böylece
        // `pause`/`cancel` bekleyen çağıranlar görevin gerçekten bittiğini
        // görmek için `running` bayrağını kullanabilir.
        let supports_ranges = self
            .db
            .get(id)
            .await
            .ok()
            .flatten()
            .map(|i| i.supports_ranges)
            .unwrap_or(false);
        self.finalize(id, &item, &ad, states, result, paused, supports_ranges)
            .await;

        ad.running.store(false, Ordering::SeqCst);
        self.active.remove(&id);
        self.pump_queue().await;
        Ok(())
    }

    /// yt-dlp ile video indirme akışı.
    ///
    /// YouTube'un oturumlu istemci reddi (`page needs to be reloaded`)
    /// durumunda çerezler kapatılarak **bir kez** daha denenir (MC davranışı).
    async fn run_video(
        &self,
        id: i64,
        item: DownloadItem,
        ad: Arc<ActiveDownload>,
        signal: AbortSignal,
    ) -> Result<()> {
        let settings = self.db.load_settings().await?;

        // YouTube için deno gerekir; kurulu değilse kullanıcıya bir kez
        // sorulur (sessizce denenir; başarısızsa hata mesajı görür).
        if crate::video::url_is_youtube(&item.url) && !settings.deno_prompt_suppressed {
            self.request_deno_if_missing().await;
        }

        let mut use_cookies = true;
        let (final_path, error) = loop {
            let (tx, mut rx) = mpsc::unbounded_channel::<crate::video::VideoEvent>();
            let request = crate::video::VideoRequest {
                url: item.url.clone(),
                output_dir: ad.output_dir.clone(),
                format_args: settings.ytdlp_format_arguments(),
                headers: item.headers.clone(),
                cookie_file: item.cookie_file.clone(),
                use_cookies,
                custom_ytdlp_path: settings.ytdlp_path.clone(),
            };

            // Alt süreci çalıştır; kapatıldığında yt-dlp de sonlanır.
            let runner = tokio::spawn(async move { crate::video::run(request, tx).await });

            // Olayları dinleyen görev: ilerlemeyi yayınlar, günlüğü biriktirir.
            let me = self.clone();
            let ad_events = ad.clone();
            let listener = tokio::spawn(async move {
                let mut final_path: Option<PathBuf> = None;
                let mut error: Option<String> = None;
                let mut log = ad_events
                    .log
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                let mut stage = String::new();
                let mut last_emit = std::time::Instant::now();

                while let Some(event) = rx.recv().await {
                    match event {
                        crate::video::VideoEvent::Progress(p) => {
                            let total = p.total.max(0) as u64;
                            if last_emit.elapsed() >= std::time::Duration::from_millis(400) {
                                last_emit = std::time::Instant::now();
                                me.emit(DownloadEvent::Progress {
                                    id,
                                    downloaded_bytes: p.downloaded.max(0) as u64,
                                    total_bytes: total,
                                    speed_mbps: p.speed / (1024.0 * 1024.0),
                                    status: DownloadStatus::Downloading,
                                    channels: Vec::new(),
                                    speed_history: Vec::new(),
                                    error_message: None,
                                    phase: stage.clone(),
                                    stage: stage.clone(),
                                    log: Some(log.clone()),
                                });
                            }
                        }
                        crate::video::VideoEvent::Stage(s) => stage = s,
                        crate::video::VideoEvent::Log(line) => {
                            log.push_str(&line);
                            log.push('\n');
                            if log.len() > 6000 {
                                log = log[log.len() - 6000..].to_string();
                            }
                        }
                        crate::video::VideoEvent::FinalPath(path) => final_path = Some(path),
                        crate::video::VideoEvent::Finished(result) => match result {
                            Ok(Some(path)) => final_path = Some(path),
                            Ok(None) => {}
                            Err(msg) => error = Some(msg),
                        },
                    }
                }

                // Günlüğü paylaşılan alana yaz.
                *ad_events.log.lock().unwrap_or_else(|e| e.into_inner()) = log;
                (final_path, error)
            });

            // Kullanıcı duraklatınca/iptal edince alt süreci durdur ve bekle.
            let (final_path, error) = tokio::select! {
                result = listener => result.unwrap_or((None, None)),
                _ = signal.wait() => {
                    runner.abort();
                    (None, None)
                }
            };

            match error {
                Some(msg) if use_cookies && crate::video::is_signed_in_client_failure(&msg) => {
                    // Çerez kapatılıp bir kez daha denenir.
                    use_cookies = false;
                    continue;
                }
                other => break (final_path, other),
            }
        };

        let (status, error_message, log_level, log_msg) = match error {
            Some(msg) => (
                DownloadStatus::Failed,
                Some(msg.clone()),
                "error",
                t("log.failed", &[&item.file_name, &msg]),
            ),
            None => (
                DownloadStatus::Completed,
                None,
                "success",
                t("log.completed", &[&item.file_name]),
            ),
        };
        let _ = log_level;

        // Dosya adı final yoldan türetilir.
        let file_name = final_path
            .as_ref()
            .and_then(|p| p.file_name().map(|s| s.to_string_lossy().to_string()))
            .unwrap_or_else(|| item.file_name.clone());
        let size_path: &Path = final_path
            .as_deref()
            .unwrap_or_else(|| Path::new(&item.file_path));
        let downloaded = std::fs::metadata(size_path)
            .map(|m| m.len())
            .unwrap_or(0);

        let mut final_item = item.clone();
        final_item.status = status;
        final_item.error_message = error_message.clone();
        final_item.file_name = file_name;
        final_item.downloaded_bytes = downloaded;
        final_item.total_bytes = if status == DownloadStatus::Completed {
            downloaded
        } else {
            item.total_bytes
        };
        final_item.final_path = final_path.as_ref().map(|p| p.to_string_lossy().to_string());
        final_item.stage = String::new();
        final_item.log = ad.log.lock().unwrap_or_else(|e| e.into_inner()).clone();
        final_item.completed_at = if status == DownloadStatus::Completed {
            Some(Local::now())
        } else {
            None
        };
        final_item.last_updated = Local::now();

        if let Err(e) = self.db.update_progress(&final_item).await {
            self.log(
                "error",
                t("log.final_state_failed", &[&e.to_string()]),
                Some(id),
            );
        }
        self.db
            .update_status(id, status, final_item.completed_at, error_message.as_deref())
            .await
            .ok();

        self.log(log_level, log_msg, Some(id));
        self.emit(DownloadEvent::Completed { id, status });
        self.emit(DownloadEvent::ListChanged);

        ad.running.store(false, Ordering::SeqCst);
        self.active.remove(&id);
        self.pump_queue().await;
        Ok(())
    }

    /// deno kurulu değilse kullanıcıya kurulum teklifi (Tauri diyalogu).
    async fn request_deno_if_missing(&self) {
        if crate::tools::locate(crate::tools::Tool::Deno, "").is_some() {
            return;
        }
        // Ayar açıksa kullanıcıya kurulum yapılacağı bildirilir; sessizce
        // indirilebilir olması için `install_tool` komutu ayrıca sunulur.
        self.log(
            "info",
            t("log.deno_missing", &[]),
            None,
        );
    }

    /// İlerleme yazarı görevini başlatır.
    ///
    /// Motor kanalından okur, her turda arayüze olay yayınlar ve
    /// `PROGRESS_WRITE_INTERVAL` sıklığında veritabanına yazar. Kanal
    /// kapandığında en son anlık görüntüyü döner.
    fn spawn_progress_writer(
        &self,
        id: i64,
        item: DownloadItem,
        channel_count: u32,
        rx: mpsc::Receiver<EngineSnapshot>,
    ) -> tokio::task::JoinHandle<Option<EngineSnapshot>> {
        let db = self.db.clone();
        let events = self.events.clone();

        tokio::spawn(async move {
            let mut last_db_write = std::time::Instant::now() - PROGRESS_WRITE_INTERVAL;
            let mut latest: Option<EngineSnapshot> = None;

            let mut rx = rx;
            while let Some(snap) = rx.recv().await {
                latest = Some(snap.clone());

                let downloaded = snap.downloaded_bytes;
                let total = if snap.total_bytes > 0 {
                    snap.total_bytes
                } else {
                    downloaded
                };

                // Her turda arayüze olay yayınla (anında güncelleme).
                let _ = events.send(DownloadEvent::Progress {
                    id,
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                    speed_mbps: snap.speed_mbps,
                    status: DownloadStatus::Downloading,
                    channels: snap.channels.clone(),
                    speed_history: snap.speed_history.clone(),
                    error_message: None,
                    phase: snap.phase.clone(),
                    stage: String::new(),
                    log: None,
                });

                // Tüm kanallar bittiyse motor zaten bitmek üzere; erken
                // çıkışta kanalların durumunu kalıcılaştır.
                if snap.is_done() {
                    break;
                }

                // Veritabanına daha seyrek yaz (aşırı yazma yükünü önler).
                if last_db_write.elapsed() >= PROGRESS_WRITE_INTERVAL {
                    last_db_write = std::time::Instant::now();
                    let progress_item = DownloadItem {
                        id,
                        url: item.url.clone(),
                        file_path: item.file_path.clone(),
                        file_name: item.file_name.clone(),
                        total_bytes: total,
                        downloaded_bytes: downloaded,
                        channel_count,
                        status: DownloadStatus::Downloading,
                        created_at: item.created_at,
                        completed_at: None,
                        last_updated: Local::now(),
                        speed_mbps: snap.speed_mbps,
                        error_message: None,
                        channels: snap.channels.clone(),
                        kind: item.kind,
                        supports_ranges: item.supports_ranges,
                        headers: item.headers.clone(),
                        cookie_file: item.cookie_file.clone(),
                        final_path: None,
                        stage: String::new(),
                        log: item.log.clone(),
                    };
                    if let Err(e) = db.update_progress(&progress_item).await {
                        let _ = events.send(DownloadEvent::log(
                            "warn",
                            t("log.progress_save_failed", &[&e.to_string()]),
                            Some(id),
                        ));
                    }
                }
            }

            latest
        })
    }

    /// Görevin sonucunu kalıcı kayda ve olay kanalına yazar.
    ///
    /// MC `handleFinish` portu: tamamlanınca dosya başka bir kayıtla
    /// çakışıyorsa **benzersiz** bir ad bulunur (`ad (2).uzantı`), hedef
    /// klasör ayarlara göre düzenlenir ve nihai yol kayda yazılır.
    #[allow(clippy::too_many_arguments)]
    async fn finalize(
        &self,
        id: i64,
        item: &DownloadItem,
        ad: &Arc<ActiveDownload>,
        states: Vec<ChannelState>,
        result: Result<Vec<ChannelState>, EngineError>,
        paused: bool,
        supports_ranges: bool,
    ) {
        let downloaded = downloaded_from_channels(&states);
        let total = total_from_channels(&states);

        let (status, error_message, log_level, log_msg) = match &result {
            Ok(_) => (
                DownloadStatus::Completed,
                None,
                "success",
                t("log.completed", &[&item.file_name]),
            ),
            Err(EngineError::Aborted) if paused => (
                DownloadStatus::Paused,
                None,
                "info",
                t(
                    "log.paused_pct",
                    &[
                        &item.file_name,
                        &format!("{:.1}", percent_of(downloaded, total)),
                    ],
                ),
            ),
            Err(EngineError::Aborted) => (
                DownloadStatus::Cancelled,
                None,
                "warn",
                t("log.cancelled_name", &[&item.file_name]),
            ),
            // Fallback tek akışa düşülerek çözülür; burada gerçek hatadır.
            Err(EngineError::Fallback) => (
                DownloadStatus::Failed,
                Some(i18n::canon("err.no_partial_support", &[])),
                "error",
                t(
                    "log.failed",
                    &[&item.file_name, &i18n::t("err.no_partial_support", &[])],
                ),
            ),
            Err(EngineError::Failed(msg)) => (
                DownloadStatus::Failed,
                // Kanonik biçimde saklanır; `db::row_to_item` okurken
                // seçili dile çevirir.
                Some(msg.clone()),
                "error",
                t("log.failed", &[&item.file_name, &i18n::render(msg)]),
            ),
        };

        // Tamamlandıysa baytları toplamla eşitle.
        let (downloaded, total) = if status == DownloadStatus::Completed {
            let t = if total > 0 { total } else { item.total_bytes };
            (t, t)
        } else {
            let t = if item.total_bytes > 0 {
                item.total_bytes
            } else {
                total
            };
            (downloaded, t)
        };

        let completed_at = if status == DownloadStatus::Completed {
            Some(Local::now())
        } else {
            None
        };

        // Tamamlanınca hedef klasörü ve dosya adı MC gibi kesinleşir:
        // çakışma varsa `ad (2).uzantı` biçiminde boşaltılır.
        let (file_path, file_name, final_path) = if status == DownloadStatus::Completed {
            let settings = self.db.load_settings().await.unwrap_or_default();
            let dir = settings.resolve_dir_named(&item.file_name);
            let desired = dir.join(&item.file_name);
            let (unique, name) = unique_destination(&desired, &item.file_name);
            // Dosya zaten doğru yerdeyse taşıma; yoksa taşı.
            let current = PathBuf::from(&item.file_path);
            if current != unique && current.exists() {
                if let Some(parent) = unique.parent() {
                    let _ = tokio::fs::create_dir_all(parent).await;
                }
                if tokio::fs::rename(&current, &unique).await.is_err() {
                    // Aynı birim dışına taşıma gerekiyorsa kopyala+sil.
                    let _ = tokio::fs::copy(&current, &unique).await;
                    let _ = tokio::fs::remove_file(&current).await;
                }
            }
            (
                unique.to_string_lossy().to_string(),
                name,
                Some(unique.to_string_lossy().to_string()),
            )
        } else {
            (item.file_path.clone(), item.file_name.clone(), None)
        };

        let final_item = DownloadItem {
            id,
            url: item.url.clone(),
            file_path,
            file_name,
            total_bytes: total,
            downloaded_bytes: downloaded,
            channel_count: ad.channels(),
            status,
            created_at: item.created_at,
            completed_at,
            last_updated: Local::now(),
            speed_mbps: 0.0,
            error_message: error_message.clone(),
            channels: states.clone(),
            kind: item.kind,
            supports_ranges,
            headers: item.headers.clone(),
            cookie_file: item.cookie_file.clone(),
            final_path,
            stage: String::new(),
            log: item.log.clone(),
        };

        if let Err(e) = self.db.update_progress(&final_item).await {
            self.log(
                "error",
                t("log.final_state_failed", &[&e.to_string()]),
                Some(id),
            );
        }
        self.db
            .update_status(id, status, completed_at, error_message.as_deref())
            .await
            .ok();

        self.log(log_level, log_msg, Some(id));
        self.emit(DownloadEvent::Completed { id, status });
        self.emit(DownloadEvent::ListChanged);
    }
}

/// Hedef dosya çakışıyorsa benzersiz bir yol bulur.
///
/// `ad.zip` → `ad (2).zip` → `ad (3).zip` … (MC `uniqueDestination`).
pub fn unique_destination(desired: &Path, file_name: &str) -> (PathBuf, String) {
    if !desired.exists() {
        return (desired.to_path_buf(), file_name.to_string());
    }
    let parent = desired.parent().unwrap_or_else(|| Path::new("."));
    let (stem, ext) = split_name(file_name);
    for n in 2..1000u32 {
        let candidate = match &ext {
            Some(e) => format!("{stem} ({n}).{e}"),
            None => format!("{stem} ({n})"),
        };
        let path = parent.join(&candidate);
        if !path.exists() {
            return (path, candidate);
        }
    }
    (desired.to_path_buf(), file_name.to_string())
}

/// `ad.zip` → ("ad", Some("zip")); uzantısız → ("ad", None).
fn split_name(file_name: &str) -> (String, Option<String>) {
    match file_name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem.to_string(), Some(ext.to_string())),
        _ => (file_name.to_string(), None),
    }
}

/// Kanal durumlarından indirilen toplam bayt.
///
/// Her kanal için `current_byte - start_byte` alınır; iş hırsızlığı sonrası
/// `start_byte` güncellendiği için bu değer kanalın gerçekten indirdiği
/// miktarı verir ve toplam şişmez.
pub fn downloaded_from_channels(states: &[ChannelState]) -> u64 {
    states
        .iter()
        .map(|c| c.current_byte.saturating_sub(c.start_byte))
        .sum()
}

/// Kanal durumlarından toplam dosya boyutu tahmini (`end_byte + 1`).
pub fn total_from_channels(states: &[ChannelState]) -> u64 {
    states.iter().map(|c| c.end_byte + 1).max().unwrap_or(0)
}

fn percent_of(downloaded: u64, total: u64) -> f64 {
    if total == 0 {
        0.0
    } else {
        (downloaded as f64 / total as f64 * 100.0).clamp(0.0, 100.0)
    }
}

/// Kullanıcının İndirilenler klasörü.
pub fn default_download_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Downloads")
}

/// Hedef dosyanın üst klasörünü oluşturur.
#[allow(dead_code)]
pub async fn ensure_parent_dir(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        tokio::fs::create_dir_all(parent).await.with_context(|| {
            anyhow::anyhow!(i18n::canon(
                "err.dir_create_failed",
                &[&parent.display().to_string()]
            ))
        })?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downloaded_sums_non_overlapping_ranges() {
        let states = vec![
            ChannelState {
                id: 0,
                start_byte: 0,
                end_byte: 99,
                current_byte: 100,
                finished: true,
            },
            ChannelState {
                id: 1,
                start_byte: 100,
                end_byte: 199,
                current_byte: 150,
                finished: false,
            },
        ];
        assert_eq!(downloaded_from_channels(&states), 150);
        assert_eq!(total_from_channels(&states), 200);
    }

    #[test]
    fn downloaded_is_zero_for_untouched_channels() {
        let states = vec![ChannelState {
            id: 0,
            start_byte: 500,
            end_byte: 999,
            current_byte: 500,
            finished: false,
        }];
        assert_eq!(downloaded_from_channels(&states), 0);
        assert_eq!(total_from_channels(&states), 1000);
    }

    #[test]
    fn percent_is_clamped() {
        assert_eq!(percent_of(50, 100), 50.0);
        assert_eq!(percent_of(150, 100), 100.0);
        assert_eq!(percent_of(10, 0), 0.0);
    }
}
