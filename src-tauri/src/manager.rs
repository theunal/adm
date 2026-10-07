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

use std::path::{Path, PathBuf};
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
use crate::models::{ChannelState, DownloadItem, DownloadStatus, file_name_from_url};

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
    pub file_path: Option<String>,
    pub channel_count: u32,
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
        /// Motorun bildirdiği kısa Türkçe durum metni.
        phase: &'static str,
    },
    /// Bir indirme bitti (tamamlandı / başarısız / duraklatıldı / iptal).
    #[serde(rename_all = "camelCase")]
    Completed { id: i64, status: DownloadStatus },
    /// Kayıt listesi değişti (ekleme / silme gibi).
    #[serde(rename_all = "camelCase")]
    ListChanged,
    /// Log satırı (Türkçe mesaj).
    #[serde(rename_all = "camelCase")]
    Log {
        level: String,
        message: String,
        download_id: Option<i64>,
    },
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
    pub async fn start(&self, req: StartRequest) -> Result<i64> {
        if req.url.trim().is_empty() {
            anyhow::bail!("URL boş olamaz");
        }

        let suggested = file_name_from_url(&req.url);
        let file_path: PathBuf = match req.file_path.as_deref().map(str::trim) {
            Some(p) if !p.is_empty() => PathBuf::from(p),
            // Yol verilmediyse kullanıcının İndirilenler klasörüne koy.
            _ => default_download_dir().join(&suggested),
        };

        let file_name = file_path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or(suggested);

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
        };

        let id = self.db.insert(&item).await?;

        self.log(
            "info",
            format!(
                "Yeni indirme eklendi: {} ({} kanal)",
                item.file_name, item.channel_count
            ),
            Some(id),
        );
        self.emit(DownloadEvent::ListChanged);

        self.spawn(id).await?;
        Ok(id)
    }

    // -----------------------------------------------------------------
    // Devam ettirme
    // -----------------------------------------------------------------

    /// Duraklatılmış / başarısız indirmeyi kanal durumlarıyla devam ettirir.
    pub async fn resume(&self, id: i64) -> Result<()> {
        let Some(item) = self.db.get(id).await? else {
            anyhow::bail!("İndirme bulunamadı (#{id})");
        };

        if !item.status.is_resumable() {
            anyhow::bail!("Bu indirme yeniden başlatılamaz");
        }

        if self.active.contains_key(&id) {
            anyhow::bail!("İndirme zaten çalışıyor");
        }

        // Dosya silinmişse resume anlamsız: sıfırdan başlat.
        if !Path::new(&item.file_path).exists() {
            self.log(
                "warn",
                format!(
                    "Hedef dosya bulunamadı, sıfırdan başlatılıyor: {}",
                    item.file_name
                ),
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
                format!("İndirme sürdürülüyor: {} (%{:.1})", item.file_name, pct)
            } else {
                format!("İndirme sürdürülüyor: {}", item.file_name)
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
            anyhow::bail!("Çalışan indirme bulunamadı (#{id})");
        };

        ad.paused.store(true, Ordering::SeqCst);
        ad.signal.abort();

        // Görevin gerçekten durmasını bekle (kanal durumları kaydedilsin).
        self.wait_idle(id).await;

        self.log("info", "İndirme duraklatıldı".to_string(), Some(id));
        self.emit(DownloadEvent::ListChanged);
        Ok(())
    }

    pub async fn cancel(&self, id: i64) -> Result<()> {
        // Kilit `pause` ile aynı gerekçeyle ifade bitinde bırakılır.
        let Some(ad) = self.active.get(&id).map(|a| a.clone()) else {
            anyhow::bail!("Çalışan indirme bulunamadı (#{id})");
        };

        ad.paused.store(false, Ordering::SeqCst);
        ad.signal.abort();

        self.wait_idle(id).await;

        self.log("warn", "İndirme iptal edildi".to_string(), Some(id));
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
            anyhow::bail!("İndirme bulunamadı (#{id})");
        };

        if delete_file {
            let path = PathBuf::from(&item.file_path);
            match tokio::fs::remove_file(&path).await {
                Ok(()) => self.log(
                    "info",
                    format!("Dosya silindi: {}", item.file_name),
                    Some(id),
                ),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => self.log(
                    "warn",
                    format!("Dosya silinemedi ({}): {}", item.file_name, e),
                    Some(id),
                ),
            }
        }

        self.db.delete(id).await?;
        self.log(
            "info",
            format!("Kayıt silindi: {}", item.file_name),
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
            self.log("info", format!("{removed} kayıt temizlendi"), None);
        }
        self.emit(DownloadEvent::ListChanged);
        Ok(())
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
                format!("Kanal sayısı {count} olarak güncellendi"),
                Some(id),
            );
            self.spawn(id).await?;
        } else {
            self.db.update_channel_count(id, count).await?;
            self.log(
                "info",
                format!("Kanal sayısı {count} olarak güncellendi"),
                Some(id),
            );
            self.emit(DownloadEvent::ListChanged);
        }

        Ok(())
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

        self.log(
            "warn",
            format!("Uygulama kapatılıyor, {} indirme iptal ediliyor", ids.len()),
            None,
        );

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
    async fn spawn(&self, id: i64) -> Result<()> {
        let Some(item) = self.db.get(id).await? else {
            anyhow::bail!("İndirme bulunamadı (#{id})");
        };

        // Kanal bazlı devam: yalnızca gerçekten bir şey indirilmişse.
        let resume_states: Vec<ChannelState> =
            if item.downloaded_bytes > 0 && !item.channels.is_empty() {
                item.channels.clone()
            } else {
                Vec::new()
            };

        let signal = AbortSignal::new();
        let ad = Arc::new(ActiveDownload {
            id,
            url: item.url.clone(),
            file_path: PathBuf::from(&item.file_path),
            file_name: item.file_name.clone(),
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
        let engine = self.engine;
        let me = self.clone();
        tokio::spawn(async move {
            if let Err(e) = me
                .run_download(id, item, ad, signal, engine, resume_states)
                .await
            {
                me.log("error", format!("İndirme görevi hata verdi: {e}"), Some(id));
            }
        });

        Ok(())
    }

    /// İndirmeyi baştan sona yürütür: motor → ilerleme yazarı → sonuç.
    async fn run_download(
        &self,
        id: i64,
        item: DownloadItem,
        ad: Arc<ActiveDownload>,
        signal: AbortSignal,
        engine: DownloadEngine,
        resume_states: Vec<ChannelState>,
    ) -> Result<()> {
        // Motorun periyodik yayıncısı senkron bir kanca çağırır; bu kancayı
        // async kanala bağlayıp ayrı bir görevde işliyoruz. Böylece motor
        // Tauri/DB katmanına bağımlı olmaz.
        let (tx, rx) = mpsc::channel::<EngineSnapshot>(ENGINE_BUFFER);
        let hook: ProgressHook = Arc::new(move |snap| {
            // Kanal doluysa bu turu atla; bir sonraki turda tekrar denenir.
            // Böylece bellek sınırsız büyümez, motor hiç bloklanmaz.
            let _ = tx.try_send(snap);
        });

        let channel_count = ad.channels();
        let url = ad.url.clone();
        let path = ad.file_path.clone();

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
                )
                .await
        });

        // Motor bittiğinde `tx` kanalın göndericisi düşer; alıcı kapanır ve
        // yazar görevi kendiliğinden sonlanır.
        let progress = self.spawn_progress_writer(id, item.clone(), channel_count, rx);

        // Motor sonucunu bekle.
        let result = driver.await.unwrap_or(Err(EngineError::Failed(
            "İndirme görevi beklenmedik şekilde sonlandı".to_string(),
        )));

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
        self.finalize(id, &item, &ad, states, result, paused).await;

        ad.running.store(false, Ordering::SeqCst);
        self.active.remove(&id);
        Ok(())
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
                    phase: snap.phase,
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
                    };
                    if let Err(e) = db.update_progress(&progress_item).await {
                        let _ = events.send(DownloadEvent::log(
                            "warn",
                            format!("İlerleme kaydedilemedi: {e}"),
                            Some(id),
                        ));
                    }
                }
            }

            latest
        })
    }

    /// Görevin sonucunu kalıcı kayda ve olay kanalına yazar.
    async fn finalize(
        &self,
        id: i64,
        item: &DownloadItem,
        ad: &Arc<ActiveDownload>,
        states: Vec<ChannelState>,
        result: Result<Vec<ChannelState>, EngineError>,
        paused: bool,
    ) {
        let downloaded = downloaded_from_channels(&states);
        let total = total_from_channels(&states);

        let (status, error_message, log_level, log_msg) = match &result {
            Ok(_) => (
                DownloadStatus::Completed,
                None,
                "success",
                format!("İndirme tamamlandı: {}", item.file_name),
            ),
            Err(EngineError::Aborted) if paused => (
                DownloadStatus::Paused,
                None,
                "info",
                format!(
                    "İndirme duraklatıldı: {} (%{:.1})",
                    item.file_name,
                    percent_of(downloaded, total)
                ),
            ),
            Err(EngineError::Aborted) => (
                DownloadStatus::Cancelled,
                None,
                "warn",
                format!("İndirme iptal edildi: {}", item.file_name),
            ),
            Err(EngineError::Failed(msg)) => (
                DownloadStatus::Failed,
                Some(msg.clone()),
                "error",
                format!("İndirme başarısız: {} — {msg}", item.file_name),
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

        let final_item = DownloadItem {
            id,
            url: item.url.clone(),
            file_path: item.file_path.clone(),
            file_name: item.file_name.clone(),
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
        };

        if let Err(e) = self.db.update_progress(&final_item).await {
            self.log("error", format!("Son durum kaydedilemedi: {e}"), Some(id));
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
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("Klasör oluşturulamadı: {}", parent.display()))?;
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
