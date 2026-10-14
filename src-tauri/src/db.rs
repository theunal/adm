//! SQLite veri katmanı.
//!
//! WPF sürümündeki `DbContext` paylaşımlı bir EF context'iydi ve çok
//! parçacıklı (thread) kullanımda thread-safety sorunları çıkarıyordu.
//! Burada `SqlitePool` kullanılır; `Pool` zaten `Send + Sync`'tir ve
//! eşzamanlı bağlantıları güvenle yönetir.
//!
//! Durum sütunu **İngilizce** metin olarak saklanır (`Queued`, `Downloading`,
//! ...); arayüzde `src/lib/format.ts` içindeki çeviri katmanıyla gösterilir.
//!
//! `error_message` ise **kanonik** biçimde saklanır (`i18n::canon`); okuma
//! sırasında `i18n::render` ile seçili dile çevrilir. Böylece dil değiştiğinde
//! liste yeniden yüklendiğinde eski hata kayıtları da yeni dilde görünür.

use anyhow::{Context, Result};
use chrono::{DateTime, Local};
use sqlx::sqlite::{
    SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteRow, SqliteSynchronous,
};
use sqlx::{Row, SqlitePool};
use std::path::PathBuf;

use crate::i18n;
use crate::models::{ChannelState, DownloadItem, DownloadStatus};
use crate::settings::Settings;

/// Veritabanı dosyasının bulunduğu dizin: `%LocalAppData%\ADM`
///
/// Araç kurulumu (`tools`), site çerezleri (`cookies`) ve günlükler de bu
/// dizin altında yaşar; bu yüzden kutu dışından erişilebilir.
pub fn db_dir() -> PathBuf {
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join("AppData").join("Local"));
    local_app_data.join("ADM")
}

/// Kullanıcı ana dizini (yedek çözüm).
fn home_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
}

/// `downloads.db` dosyasının tam yolu.
pub fn db_path() -> PathBuf {
    db_dir().join("downloads.db")
}

/// Kanonik biçimde hata metni üreten kısa yol (`i18n::canon`).
fn err(key: &str) -> anyhow::Error {
    anyhow::anyhow!(i18n::canon(key, &[]))
}

/// Kanonik biçimde, tek argümanlı hata metni üreten kısa yol.
fn err1(key: &str, arg: &str) -> anyhow::Error {
    anyhow::anyhow!(i18n::canon(key, &[arg]))
}

/// Tablo oluşturma / şema migrasyonu.
///
/// `DESC` indekste kullanılmaz: SQLite dizin sırasını desteklemez ve
/// `ORDER BY created_at DESC` sorgularında zaten azalan tarama yapar.
/// Her ifade ayrı çalıştırılır (çoklu ifade toplu gönderimi bazı
/// sürücülerde yalnızca ilk ifadeyi uygular).
const SCHEMA: &[&str] = &[
    r#"
    CREATE TABLE IF NOT EXISTS downloads (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        url              TEXT    NOT NULL,
        file_path        TEXT    NOT NULL,
        file_name        TEXT    NOT NULL,
        total_bytes      INTEGER NOT NULL DEFAULT 0,
        downloaded_bytes INTEGER NOT NULL DEFAULT 0,
        channel_count    INTEGER NOT NULL DEFAULT 4,
        status           TEXT    NOT NULL,
        created_at       TEXT    NOT NULL,
        completed_at     TEXT,
        last_updated     TEXT    NOT NULL,
        speed_mbps       REAL    NOT NULL DEFAULT 0,
        error_message    TEXT,
        channel_states   TEXT,
        kind             TEXT    NOT NULL DEFAULT 'file',
        supports_ranges  INTEGER NOT NULL DEFAULT 0,
        headers          TEXT,
        cookie_file      TEXT,
        final_path       TEXT,
        stage            TEXT    NOT NULL DEFAULT '',
        log              TEXT    NOT NULL DEFAULT ''
    )
    "#,
    "CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads (status)",
    "CREATE INDEX IF NOT EXISTS idx_downloads_created_at ON downloads (created_at)",
    r#"
    CREATE TABLE IF NOT EXISTS settings (
        id                    INTEGER PRIMARY KEY CHECK (id = 1),
        lang                  TEXT    NOT NULL DEFAULT 'tr',
        default_channel_count INTEGER NOT NULL DEFAULT 8,
        video_dir             TEXT,
        audio_dir             TEXT,
        other_dir             TEXT,
        default_dir           TEXT    NOT NULL,
        server_port           INTEGER NOT NULL DEFAULT 48213,
        max_concurrent        INTEGER NOT NULL DEFAULT 3,
        auto_start            INTEGER NOT NULL DEFAULT 1,
        notify_on_complete    INTEGER NOT NULL DEFAULT 1,
        show_detail_on_start  INTEGER NOT NULL DEFAULT 1,
        auto_close_detail     INTEGER NOT NULL DEFAULT 0,
        watch_clipboard       INTEGER NOT NULL DEFAULT 1,
        capture_group_ids     TEXT,
        custom_extensions     TEXT    NOT NULL DEFAULT '',
        organize_by_category  INTEGER NOT NULL DEFAULT 1,
        ytdlp_path            TEXT    NOT NULL DEFAULT '',
        video_format          TEXT    NOT NULL DEFAULT '',
        video_container       TEXT    NOT NULL DEFAULT 'mp4',
        video_max_height      INTEGER NOT NULL DEFAULT 1080,
        check_for_updates     INTEGER NOT NULL DEFAULT 1,
        start_in_tray         INTEGER NOT NULL DEFAULT 0,
        close_to_tray         INTEGER NOT NULL DEFAULT 1,
        autostart             INTEGER NOT NULL DEFAULT 0,
        deno_prompt_suppressed INTEGER NOT NULL DEFAULT 0,
        last_update_check     TEXT,
        skipped_update_version TEXT,
        /* Kullanılmıyor: `.crx` indirme akışı kaldırıldı, kurulum artik
           paketlenmemis klasörle yapiliyor. Kolon bilincli olarak duruyor —
           migrasyonlar geri alinamaz (AGENTS.md kural 7). */
        extension_crx_url TEXT NOT NULL DEFAULT ''
    )
    "#,
];

/// Var olan veritabanlarına eklenen kolonlar (MC portu).
///
/// `ALTER TABLE ... ADD COLUMN` yalnızca kolon yoksa çalıştırılır; SQLite
/// `ADD COLUMN` için varsayılan değer ister, bu yüzden eski kayıtlar
/// `kind = 'file'` ile doldurulur.
const ADDED_COLUMNS: &[(&str, &str)] = &[
    ("downloads", "kind TEXT NOT NULL DEFAULT 'file'"),
    ("downloads", "supports_ranges INTEGER NOT NULL DEFAULT 0"),
    ("downloads", "headers TEXT"),
    ("downloads", "cookie_file TEXT"),
    ("downloads", "final_path TEXT"),
    ("downloads", "stage TEXT NOT NULL DEFAULT ''"),
    ("downloads", "log TEXT NOT NULL DEFAULT ''"),
    ("settings", "server_port INTEGER NOT NULL DEFAULT 48213"),
    ("settings", "max_concurrent INTEGER NOT NULL DEFAULT 3"),
    ("settings", "auto_start INTEGER NOT NULL DEFAULT 1"),
    ("settings", "notify_on_complete INTEGER NOT NULL DEFAULT 1"),
    (
        "settings",
        "show_detail_on_start INTEGER NOT NULL DEFAULT 1",
    ),
    ("settings", "auto_close_detail INTEGER NOT NULL DEFAULT 0"),
    ("settings", "watch_clipboard INTEGER NOT NULL DEFAULT 1"),
    ("settings", "capture_group_ids TEXT"),
    ("settings", "custom_extensions TEXT NOT NULL DEFAULT ''"),
    (
        "settings",
        "organize_by_category INTEGER NOT NULL DEFAULT 1",
    ),
    ("settings", "ytdlp_path TEXT NOT NULL DEFAULT ''"),
    ("settings", "video_format TEXT NOT NULL DEFAULT ''"),
    ("settings", "video_container TEXT NOT NULL DEFAULT 'mp4'"),
    ("settings", "video_max_height INTEGER NOT NULL DEFAULT 1080"),
    ("settings", "check_for_updates INTEGER NOT NULL DEFAULT 1"),
    ("settings", "start_in_tray INTEGER NOT NULL DEFAULT 0"),
    ("settings", "close_to_tray INTEGER NOT NULL DEFAULT 1"),
    ("settings", "autostart INTEGER NOT NULL DEFAULT 0"),
    (
        "settings",
        "deno_prompt_suppressed INTEGER NOT NULL DEFAULT 0",
    ),
    ("settings", "last_update_check TEXT"),
    ("settings", "skipped_update_version TEXT"),
    /* Kullanılmıyor (ayni gerekçe: `.crx` akışi kaldirildi). */
    ("settings", "extension_crx_url TEXT NOT NULL DEFAULT ''"),
];

/// Uygulamanın veritabanı erişimi.
#[derive(Clone)]
pub struct Database {
    pool: SqlitePool,
}

impl Database {
    /// Havuzu açar ve şemayı hazırlar (varsayılan konum).
    pub async fn connect() -> Result<Self> {
        let dir = db_dir();
        std::fs::create_dir_all(&dir)
            .with_context(|| err1("err.db_dir_failed", &dir.display().to_string()))?;

        Self::connect_at(db_path()).await
    }

    /// Verilen dosya yolunda havuz açar ve şemayı hazırlar.
    ///
    /// Üretimde `connect()` kullanılır; testler her test için ayrı dosya
    /// açarak birbirlerinin verisini göremez.
    pub async fn connect_at(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| err1("err.db_dir_failed", &parent.display().to_string()))?;
        }

        let options = SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            // WAL: okuma ve yazma eşzamanlı, kilit çekişmesi yok.
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .foreign_keys(true)
            .busy_timeout(std::time::Duration::from_secs(10));

        let pool = SqlitePoolOptions::new()
            .max_connections(8)
            .acquire_timeout(std::time::Duration::from_secs(30))
            .connect_with(options)
            .await
            .context(err("err.db_pool_failed"))?;

        let db = Database { pool };
        db.migrate().await?;
        Ok(db)
    }

    /// Şemayı hazırlar (idempotent).
    async fn migrate(&self) -> Result<()> {
        migrate(&self.pool).await
    }

    /// Yeni bir indirme kaydı oluşturur ve `id`'yi döner.
    pub async fn insert(&self, item: &DownloadItem) -> Result<i64> {
        let res = sqlx::query(
            r#"
            INSERT INTO downloads
                (url, file_path, file_name, total_bytes, downloaded_bytes,
                 channel_count, status, created_at, completed_at, last_updated,
                 speed_mbps, error_message, channel_states, kind, supports_ranges,
                 headers, cookie_file, final_path, stage, log)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&item.url)
        .bind(&item.file_path)
        .bind(&item.file_name)
        .bind(item.total_bytes as i64)
        .bind(item.downloaded_bytes as i64)
        .bind(item.channel_count as i64)
        .bind(item.status.as_str())
        .bind(item.created_at.to_rfc3339())
        .bind(item.completed_at.map(|d| d.to_rfc3339()))
        .bind(item.last_updated.to_rfc3339())
        .bind(item.speed_mbps)
        .bind(item.error_message.as_deref())
        .bind(crate::models::channel_states_to_json(&item.channels))
        .bind(item.kind.as_str())
        .bind(item.supports_ranges as i64)
        .bind(headers_to_json(&item.headers))
        .bind(item.cookie_file.as_deref())
        .bind(item.final_path.as_deref())
        .bind(&item.stage)
        .bind(&item.log)
        .execute(&self.pool)
        .await
        .context(err("err.db_insert"))?;

        Ok(res.last_insert_rowid())
    }

    /// İlerleme alanlarını günceller (durum ve kanal durumları dahil).
    pub async fn update_progress(&self, item: &DownloadItem) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE downloads SET
                total_bytes      = ?,
                downloaded_bytes = ?,
                channel_count    = ?,
                status           = ?,
                last_updated     = ?,
                speed_mbps       = ?,
                error_message    = ?,
                channel_states   = ?,
                kind             = ?,
                supports_ranges  = ?,
                headers          = ?,
                cookie_file      = ?,
                final_path       = ?,
                stage            = ?,
                log              = ?
            WHERE id = ?
            "#,
        )
        .bind(item.total_bytes as i64)
        .bind(item.downloaded_bytes as i64)
        .bind(item.channel_count as i64)
        .bind(item.status.as_str())
        .bind(item.last_updated.to_rfc3339())
        .bind(item.speed_mbps)
        .bind(item.error_message.as_deref())
        .bind(crate::models::channel_states_to_json(&item.channels))
        .bind(item.kind.as_str())
        .bind(item.supports_ranges as i64)
        .bind(headers_to_json(&item.headers))
        .bind(item.cookie_file.as_deref())
        .bind(item.final_path.as_deref())
        .bind(&item.stage)
        .bind(&item.log)
        .bind(item.id)
        .execute(&self.pool)
        .await
        .context(err("err.db_update_progress"))?;
        Ok(())
    }

    /// Durum ve zaman damgalarını günceller.
    pub async fn update_status(
        &self,
        id: i64,
        status: DownloadStatus,
        completed_at: Option<DateTime<Local>>,
        error_message: Option<&str>,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE downloads SET
                status         = ?,
                completed_at   = COALESCE(?, completed_at),
                last_updated   = ?,
                speed_mbps     = 0,
                error_message  = ?
            WHERE id = ?
            "#,
        )
        .bind(status.as_str())
        .bind(completed_at.map(|d| d.to_rfc3339()))
        .bind(Local::now().to_rfc3339())
        .bind(error_message)
        .bind(id)
        .execute(&self.pool)
        .await
        .context(err("err.db_update_status"))?;
        Ok(())
    }

    /// Kanal sayısını değiştirir.
    pub async fn update_channel_count(&self, id: i64, channel_count: u32) -> Result<()> {
        sqlx::query("UPDATE downloads SET channel_count = ?, last_updated = ? WHERE id = ?")
            .bind(channel_count as i64)
            .bind(Local::now().to_rfc3339())
            .bind(id)
            .execute(&self.pool)
            .await
            .context(err("err.db_update_channels"))?;
        Ok(())
    }

    /// Tek bir kaydı okur.
    pub async fn get(&self, id: i64) -> Result<Option<DownloadItem>> {
        let row = sqlx::query("SELECT * FROM downloads WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .context(err("err.db_read"))?;

        Ok(row.as_ref().map(row_to_item))
    }

    /// Tüm kayıtlar, en yeni önce.
    pub async fn list_all(&self) -> Result<Vec<DownloadItem>> {
        let rows = sqlx::query("SELECT * FROM downloads ORDER BY created_at DESC, id DESC")
            .fetch_all(&self.pool)
            .await
            .context(err("err.db_list"))?;
        Ok(rows.iter().map(row_to_item).collect())
    }

    /// Yalnızca aktif / duraklatılmış kayıtlar.
    pub async fn list_active(&self) -> Result<Vec<DownloadItem>> {
        let rows = sqlx::query(
            "SELECT * FROM downloads WHERE status IN ('Queued','Downloading','Paused') \
             ORDER BY created_at DESC, id DESC",
        )
        .fetch_all(&self.pool)
        .await
        .context(err("err.db_list_active"))?;
        Ok(rows.iter().map(row_to_item).collect())
    }

    /// Açılışta yarım kalmış indirmeleri duraklatır (MC `DownloadStore.load`).
    ///
    /// Görev yalnızca süreç yaşarken biter: çökme, güç kesintisi ya da
    /// zorla kapatma hâlinde satır `Downloading`/`Queued` olarak kalır ama
    /// artık hiçbir görev yoktur. Böyle bir satır arayüzde sonsuza dek
    /// "İndiriliyor" görünür, kullanıcı ne devam ettirebilir ne silebilir —
    /// ilerleme hiç artmadığı için fark edilmesi de zordur.
    ///
    /// Durum `Paused`a çevrilir; alınan baytlar ve kanal sınırları
    /// korunur, yani kaldığı yerden devam edilebilir. Etkilenen satır
    /// sayısını döndürür (0 ise hiçbir şey değişmemiştir).
    pub async fn recover_interrupted(&self) -> Result<usize> {
        let res = sqlx::query(
            "UPDATE downloads SET status = 'Paused', speed_mbps = 0 \
             WHERE status IN ('Queued', 'Downloading')",
        )
        .execute(&self.pool)
        .await
        .context(err("err.db_update_status"))?;
        Ok(res.rows_affected() as usize)
    }

    /// Tek bir kaydı siler.
    pub async fn delete(&self, id: i64) -> Result<()> {
        sqlx::query("DELETE FROM downloads WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await
            .context(err("err.db_delete"))?;
        Ok(())
    }

    /// Tüm kayıtları siler (testler ve toplu temizlik).
    #[cfg(test)]
    pub async fn delete_all(&self) -> Result<()> {
        sqlx::query("DELETE FROM downloads")
            .execute(&self.pool)
            .await
            .context(err("err.db_clear_all"))?;
        Ok(())
    }

    /// Ham bağlantı havuzu (yalnızca testler).
    #[cfg(test)]
    pub(crate) fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// Uygulama ayarlarını okur.
    ///
    /// Satır yoksa (yedek veritabanı, silinmiş kayıt) varsayılanlar döner;
    /// `migrate` satırı zaten oluşturduğu için bu bir hata değil.
    pub async fn load_settings(&self) -> Result<Settings> {
        let row = sqlx::query("SELECT * FROM settings WHERE id = 1")
            .fetch_optional(&self.pool)
            .await
            .context(err("err.db_settings_load"))?;

        let Some(r) = row else {
            return Ok(Settings::default());
        };

        let mut settings = Settings {
            lang: i18n::Lang::parse(&r.try_get::<String, _>("lang").unwrap_or_default()),
            default_channel_count: r
                .try_get::<i64, _>("default_channel_count")
                .unwrap_or(8)
                .clamp(1, i64::from(crate::settings::MAX_CHANNELS))
                as u32,
            video_dir: opt_dir_of(&r, "video_dir"),
            audio_dir: opt_dir_of(&r, "audio_dir"),
            other_dir: opt_dir_of(&r, "other_dir"),
            default_dir: opt_dir_of(&r, "default_dir")
                .unwrap_or_else(crate::manager::default_download_dir),
            server_port: r.try_get::<i64, _>("server_port").unwrap_or(48213).clamp(
                i64::from(crate::settings::MIN_PORT),
                i64::from(crate::settings::MAX_PORT),
            ) as u16,
            max_concurrent: r
                .try_get::<i64, _>("max_concurrent")
                .unwrap_or(3)
                .clamp(1, i64::from(crate::settings::MAX_CONCURRENT))
                as u32,
            auto_start: bool_of(&r, "auto_start", true),
            notify_on_complete: bool_of(&r, "notify_on_complete", true),
            show_detail_on_start: bool_of(&r, "show_detail_on_start", true),
            auto_close_detail: bool_of(&r, "auto_close_detail", false),
            watch_clipboard: bool_of(&r, "watch_clipboard", true),
            capture_group_ids: capture_groups_of(&r),
            custom_extensions: r
                .try_get::<String, _>("custom_extensions")
                .unwrap_or_default(),
            organize_by_category: bool_of(&r, "organize_by_category", true),
            ytdlp_path: r.try_get::<String, _>("ytdlp_path").unwrap_or_default(),
            video_format: r.try_get::<String, _>("video_format").unwrap_or_default(),
            video_container: r
                .try_get::<String, _>("video_container")
                .unwrap_or_else(|_| "mp4".to_string()),
            video_max_height: r.try_get::<i64, _>("video_max_height").unwrap_or(1080) as i32,
            check_for_updates: bool_of(&r, "check_for_updates", true),
            start_in_tray: bool_of(&r, "start_in_tray", false),
            close_to_tray: bool_of(&r, "close_to_tray", true),
            autostart: bool_of(&r, "autostart", false),
            deno_prompt_suppressed: bool_of(&r, "deno_prompt_suppressed", false),
            last_update_check: r
                .try_get::<Option<String>, _>("last_update_check")
                .unwrap_or(None),
            skipped_update_version: r
                .try_get::<Option<String>, _>("skipped_update_version")
                .unwrap_or(None),
        };
        settings.normalize();

        Ok(settings)
    }

    /// Uygulama ayarlarını yazar (tek satır).
    pub async fn save_settings(&self, settings: &Settings) -> Result<()> {
        let mut normalized = settings.clone();
        normalized.normalize();

        sqlx::query(
            "INSERT INTO settings \
                 (id, lang, default_channel_count, video_dir, audio_dir, other_dir, default_dir, \
                  server_port, max_concurrent, auto_start, notify_on_complete, show_detail_on_start, \
                  auto_close_detail, watch_clipboard, capture_group_ids, custom_extensions, \
                  organize_by_category, ytdlp_path, video_format, video_container, video_max_height, \
                  check_for_updates, start_in_tray, close_to_tray, autostart, deno_prompt_suppressed, \
                  last_update_check, skipped_update_version) \
             VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT (id) DO UPDATE SET \
                 lang                  = excluded.lang, \
                 default_channel_count = excluded.default_channel_count, \
                 video_dir             = excluded.video_dir, \
                 audio_dir             = excluded.audio_dir, \
                 other_dir             = excluded.other_dir, \
                 default_dir           = excluded.default_dir, \
                 server_port           = excluded.server_port, \
                 max_concurrent        = excluded.max_concurrent, \
                 auto_start            = excluded.auto_start, \
                 notify_on_complete    = excluded.notify_on_complete, \
                 show_detail_on_start  = excluded.show_detail_on_start, \
                 auto_close_detail     = excluded.auto_close_detail, \
                 watch_clipboard       = excluded.watch_clipboard, \
                 capture_group_ids     = excluded.capture_group_ids, \
                 custom_extensions     = excluded.custom_extensions, \
                 organize_by_category  = excluded.organize_by_category, \
                 ytdlp_path            = excluded.ytdlp_path, \
                 video_format          = excluded.video_format, \
                 video_container       = excluded.video_container, \
                 video_max_height      = excluded.video_max_height, \
                 check_for_updates     = excluded.check_for_updates, \
                 start_in_tray         = excluded.start_in_tray, \
                 close_to_tray         = excluded.close_to_tray, \
                 autostart             = excluded.autostart, \
                 deno_prompt_suppressed = excluded.deno_prompt_suppressed, \
                 last_update_check     = excluded.last_update_check, \
                 skipped_update_version = excluded.skipped_update_version",
        )
        .bind(normalized.lang.as_str())
        .bind(normalized.default_channel_count as i64)
        .bind(bind_dir(&normalized.video_dir))
        .bind(bind_dir(&normalized.audio_dir))
        .bind(bind_dir(&normalized.other_dir))
        .bind(normalized.default_dir.to_string_lossy().to_string())
        .bind(normalized.server_port as i64)
        .bind(normalized.max_concurrent as i64)
        .bind(normalized.auto_start as i64)
        .bind(normalized.notify_on_complete as i64)
        .bind(normalized.show_detail_on_start as i64)
        .bind(normalized.auto_close_detail as i64)
        .bind(normalized.watch_clipboard as i64)
        .bind(serde_json::to_string(&normalized.capture_group_ids).unwrap_or_else(|_| "[]".into()))
        .bind(&normalized.custom_extensions)
        .bind(normalized.organize_by_category as i64)
        .bind(&normalized.ytdlp_path)
        .bind(&normalized.video_format)
        .bind(&normalized.video_container)
        .bind(normalized.video_max_height as i64)
        .bind(normalized.check_for_updates as i64)
        .bind(normalized.start_in_tray as i64)
        .bind(normalized.close_to_tray as i64)
        .bind(normalized.autostart as i64)
        .bind(normalized.deno_prompt_suppressed as i64)
        .bind(normalized.last_update_check.clone())
        .bind(normalized.skipped_update_version.clone())
        .execute(&self.pool)
        .await
        .context(err("err.db_settings_save"))?;

        Ok(())
    }
}

/// SQL satırındaki klasör sütununu okur; boş hücre `None` olur.
fn opt_dir_of(row: &SqliteRow, column: &str) -> Option<PathBuf> {
    row.try_get::<Option<String>, _>(column)
        .ok()
        .flatten()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
}

/// `Option<PathBuf>` -> bağlanabilir metin (`None` ise SQL NULL).
fn bind_dir(dir: &Option<PathBuf>) -> Option<String> {
    dir.as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .filter(|s| !s.trim().is_empty())
}

/// Başlık listesini JSON metnine çevirir; boşsa `NULL`.
fn headers_to_json(headers: &[(String, String)]) -> Option<String> {
    if headers.is_empty() {
        return None;
    }
    serde_json::to_string(headers).ok()
}

/// JSON metinden başlık listesini okur.
fn headers_from_json(raw: Option<String>) -> Vec<(String, String)> {
    raw.as_deref()
        .and_then(|s| serde_json::from_str::<Vec<(String, String)>>(s).ok())
        .unwrap_or_default()
}

/// Satırdaki 0/1 tam sayısını oku; kolon yoksa varsayılan.
fn bool_of(row: &SqliteRow, column: &str, default: bool) -> bool {
    row.try_get::<i64, _>(column)
        .map(|v| v != 0)
        .unwrap_or(default)
}

/// Yakalama grupları JSON dizisini okur; boşsa varsayılan gruplar.
fn capture_groups_of(row: &SqliteRow) -> Vec<String> {
    let raw: Option<String> = row.try_get("capture_group_ids").unwrap_or(None);
    match raw
        .as_deref()
        .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
    {
        Some(groups) if !groups.is_empty() => groups,
        _ => crate::capture::DEFAULT_GROUPS
            .iter()
            .map(|s| (*s).to_string())
            .collect(),
    }
}

/// Tablo oluşturma / şema migrasyonu.
///
/// `SCHEMA` bir sabit `&[&str]` olduğu için SQL enjeksiyonu riski yoktur;
/// clippy'in dinamik SQL uyarısı bunun için bastırılır.
async fn migrate(pool: &SqlitePool) -> Result<()> {
    for stmt in SCHEMA {
        #[allow(clippy::unnecessary_literal_unwrap)]
        let sql = *stmt;
        sqlx::query(sql)
            .execute(pool)
            .await
            .with_context(|| err1("err.db_schema", first_line(sql)))?;
    }
    add_missing_columns(pool).await?;
    seed_settings(pool).await
}

/// Var olan veritabanına, MC portunun ihtiyaç duyduğu kolonları ekler.
///
/// Kolon adları sabit listeden geldiği için SQL birleştirme güvenlidir.
/// `ALTER TABLE` başarısızsa (kolon zaten veya tablo yok) sessizce geçilir:
/// yeni kurulumlarda kolonlar `SCHEMA` içinde tanımlıdır.
async fn add_missing_columns(pool: &SqlitePool) -> Result<()> {
    for (table, column) in ADDED_COLUMNS {
        let sql = format!("ALTER TABLE {table} ADD COLUMN {column}");
        // Kolon zaten varsa hata verir; bu beklenen durumdur.
        // Tablo/kolon adları `ADDED_COLUMNS` sabitinden gelir; enjeksiyon yok.
        let _ = sqlx::query(sqlx::AssertSqlSafe(sql)).execute(pool).await;
    }
    Ok(())
}

/// Ayar satırını ilk kez oluşturur (idempotent).
///
/// `INSERT OR IGNORE` sayesinde var olan satıra dokunmaz; kullanıcının
/// kaydettiği ayarlar korunur.
async fn seed_settings(pool: &SqlitePool) -> Result<()> {
    let defaults = Settings::default();
    sqlx::query(
        "INSERT OR IGNORE INTO settings \
         (id, lang, default_channel_count, default_dir) \
         VALUES (1, ?, ?, ?)",
    )
    .bind(defaults.lang.as_str())
    .bind(defaults.default_channel_count as i64)
    .bind(defaults.default_dir.to_string_lossy().to_string())
    .execute(pool)
    .await
    .context(err("err.db_settings_seed"))?;
    Ok(())
}

/// SQL metninin ilk satırı (hata mesajları için).
fn first_line(sql: &str) -> &str {
    sql.lines().next().unwrap_or(sql).trim()
}

/// RFC 3339 metninden yerel zaman damgasına çevirir.
fn parse_dt(raw: &str) -> DateTime<Local> {
    DateTime::parse_from_rfc3339(raw)
        .map(|d| d.with_timezone(&Local))
        .unwrap_or_else(|_| Local::now())
}

/// İsteğe bağlı zaman damgası.
fn parse_dt_opt(raw: Option<String>) -> Option<DateTime<Local>> {
    raw.as_deref().and_then(|s| {
        DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|d| d.with_timezone(&Local))
    })
}

/// SQL satırını uygulama modeline çevirir.
fn row_to_item(r: &SqliteRow) -> DownloadItem {
    let channels_json: Option<String> = r.try_get("channel_states").unwrap_or(None);
    let channels: Vec<ChannelState> = channels_json
        .as_deref()
        .map(crate::models::channel_states_from_json)
        .unwrap_or_default();

    let status_str: String = r
        .try_get::<String, _>("status")
        .unwrap_or_else(|_| DownloadStatus::Failed.as_str().to_string());

    DownloadItem {
        id: r.try_get::<i64, _>("id").unwrap_or(0),
        url: r.try_get("url").unwrap_or_default(),
        file_path: r.try_get("file_path").unwrap_or_default(),
        file_name: r.try_get("file_name").unwrap_or_default(),
        total_bytes: r.try_get::<i64, _>("total_bytes").unwrap_or(0).max(0) as u64,
        downloaded_bytes: r.try_get::<i64, _>("downloaded_bytes").unwrap_or(0).max(0) as u64,
        channel_count: r.try_get::<i64, _>("channel_count").unwrap_or(1).max(1) as u32,
        status: DownloadStatus::from_db(&status_str),
        created_at: parse_dt(&r.try_get::<String, _>("created_at").unwrap_or_default()),
        completed_at: parse_dt_opt(r.try_get("completed_at").unwrap_or(None)),
        last_updated: parse_dt(&r.try_get::<String, _>("last_updated").unwrap_or_default()),
        speed_mbps: r.try_get::<f64, _>("speed_mbps").unwrap_or(0.0),
        // Kanonik kayıtlar seçili dile çevrilir; eski düz satırlar aynen
        // kalır. Böylece dil değişimi sonrası `reloadList()` eski hataları da
        // yeniden çevirir.
        error_message: r
            .try_get::<Option<String>, _>("error_message")
            .unwrap_or(None)
            .map(|raw| i18n::render(&raw)),
        channels,
        kind: crate::models::DownloadKind::from_db(
            &r.try_get::<String, _>("kind").unwrap_or_default(),
        ),
        supports_ranges: bool_of(r, "supports_ranges", false),
        headers: headers_from_json(r.try_get("headers").unwrap_or(None)),
        cookie_file: r.try_get("cookie_file").unwrap_or(None),
        final_path: r.try_get("final_path").unwrap_or(None),
        stage: r.try_get::<String, _>("stage").unwrap_or_default(),
        log: r.try_get::<String, _>("log").unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test sonunda dili test öncesi değerine döndürür.
    struct LangRestore(i18n::Lang);

    impl Drop for LangRestore {
        fn drop(&mut self) {
            i18n::set_lang(self.0);
        }
    }

    /// Testler için bellek içi geçici veritabanı açar.
    async fn test_db(name: &str) -> Database {
        let opts = SqliteConnectOptions::new()
            .filename(std::env::temp_dir().join(format!("adm_test_{name}.db")))
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Delete);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(opts)
            .await
            .expect("test veritabanı açılamadı");
        let db = Database { pool };
        db.migrate().await.expect("şema hazırlanamadı");
        db.delete_all().await.expect("temizlenemedi");
        db
    }

    /// Test verisi üretir.
    fn sample(name: &str) -> DownloadItem {
        let now = Local::now();
        DownloadItem {
            id: 0,
            url: format!("https://ornek.tld/{name}"),
            file_path: format!("C:/tmp/{name}.bin"),
            file_name: format!("{name}.bin"),
            total_bytes: 0,
            downloaded_bytes: 0,
            channel_count: 4,
            status: DownloadStatus::Queued,
            created_at: now,
            completed_at: None,
            last_updated: now,
            speed_mbps: 0.0,
            error_message: None,
            channels: Vec::new(),
            ..DownloadItem::default()
        }
    }

    #[tokio::test]
    async fn insert_and_get_roundtrips_all_fields() {
        let db = test_db("roundtrip").await;

        let mut item = sample("giris");
        item.total_bytes = 1000;
        item.downloaded_bytes = 400;
        item.channels = vec![ChannelState {
            id: 0,
            start_byte: 0,
            end_byte: 999,
            current_byte: 400,
            finished: false,
        }];

        let id = db.insert(&item).await.unwrap();
        assert!(id > 0);

        let got = db.get(id).await.unwrap().expect("kayıt bulunamadı");
        assert_eq!(got.id, id);
        assert_eq!(got.url, item.url);
        assert_eq!(got.file_name, "giris.bin");
        assert_eq!(got.total_bytes, 1000);
        assert_eq!(got.downloaded_bytes, 400);
        assert_eq!(got.channel_count, 4);
        assert_eq!(got.status, DownloadStatus::Queued);
        assert_eq!(got.channels.len(), 1);
        assert_eq!(got.channels[0].current_byte, 400);
    }

    #[tokio::test]
    async fn status_is_stored_in_english() {
        let db = test_db("status").await;
        let mut item = sample("durum");
        item.status = DownloadStatus::Paused;

        let id = db.insert(&item).await.unwrap();

        // Ham sütun İngilizce olmalı.
        let raw: String = sqlx::query("SELECT status FROM downloads WHERE id = ?")
            .bind(id)
            .fetch_one(db.pool())
            .await
            .unwrap()
            .try_get("status")
            .unwrap();
        assert_eq!(raw, "Paused");
        assert_eq!(
            db.get(id).await.unwrap().unwrap().status,
            DownloadStatus::Paused
        );
    }

    #[tokio::test]
    async fn update_progress_persists_channels_for_resume() {
        let db = test_db("resume").await;
        let item = sample("devam");
        let id = db.insert(&item).await.unwrap();

        // Duraklatma anında kanal durumları yazılır.
        let paused = DownloadItem {
            id,
            total_bytes: 2048,
            downloaded_bytes: 1024,
            status: DownloadStatus::Paused,
            channels: vec![
                ChannelState {
                    id: 0,
                    start_byte: 0,
                    end_byte: 1023,
                    current_byte: 1024,
                    finished: true,
                },
                ChannelState {
                    id: 1,
                    start_byte: 1024,
                    end_byte: 2047,
                    current_byte: 1500,
                    finished: false,
                },
            ],
            ..item.clone()
        };
        db.update_progress(&paused).await.unwrap();

        let got = db.get(id).await.unwrap().unwrap();
        assert_eq!(got.status, DownloadStatus::Paused);
        assert_eq!(got.total_bytes, 2048);
        assert_eq!(got.downloaded_bytes, 1024);
        assert_eq!(got.channels.len(), 2);
        assert!(got.channels[0].finished);
        assert_eq!(got.channels[1].current_byte, 1500);
        assert_eq!(got.channels[1].remaining(), 548);
    }

    #[tokio::test]
    async fn list_active_filters_by_status() {
        let db = test_db("liste").await;

        for (name, status) in [
            ("a", DownloadStatus::Completed),
            ("b", DownloadStatus::Downloading),
            ("c", DownloadStatus::Paused),
            ("d", DownloadStatus::Failed),
            ("e", DownloadStatus::Cancelled),
        ] {
            let mut item = sample(name);
            item.status = status;
            db.insert(&item).await.unwrap();
        }

        let active = db.list_active().await.unwrap();
        assert_eq!(
            active.len(),
            2,
            "yalnızca Downloading ve Paused aktif sayılır"
        );
        assert_eq!(db.list_all().await.unwrap().len(), 5);
    }

    #[tokio::test]
    async fn delete_removes_record() {
        let db = test_db("sil").await;
        let id = db.insert(&sample("silinecek")).await.unwrap();

        db.delete(id).await.unwrap();
        assert!(db.get(id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn completed_at_is_set_only_when_provided() {
        let db = test_db("zaman").await;
        let id = db.insert(&sample("zamanli")).await.unwrap();

        db.update_status(id, DownloadStatus::Completed, Some(Local::now()), None)
            .await
            .unwrap();

        let got = db.get(id).await.unwrap().unwrap();
        assert_eq!(got.status, DownloadStatus::Completed);
        assert!(got.completed_at.is_some());

        // Hata durumunda `completed_at` boş kalmalı.
        db.update_status(id, DownloadStatus::Failed, None, Some("hata"))
            .await
            .unwrap();
        let got = db.get(id).await.unwrap().unwrap();
        assert_eq!(got.status, DownloadStatus::Failed);
        assert_eq!(got.error_message.as_deref(), Some("hata"));
    }

    #[tokio::test]
    async fn change_channel_count_persists() {
        let db = test_db("kanal").await;
        let id = db.insert(&sample("kanalli")).await.unwrap();

        db.update_channel_count(id, 16).await.unwrap();
        assert_eq!(db.get(id).await.unwrap().unwrap().channel_count, 16);
    }

    /// Kanonik hata mesajı sütunda kanonik kalır, okunurken seçili dile
    /// çevrilir. Dil değiştiğinde liste yeniden yüklendiğinde eski hata
    /// kayıtları da yeni dilde görünür.
    #[tokio::test]
    // Kilit `await` boyunca bilinçli olarak tutulur: `Lang` globaldir ve
    // okumanın bu dilde yapılması gerekir. Kilit yalnızca test içinde
    // paylaşılan bir izolasyon kilididir; hiçbir şeyi bloklamaz.
    #[allow(clippy::await_holding_lock)]
    async fn kanonik_hata_mesaji_okunurken_cevrilir() {
        let _lock = crate::i18n::lang_test_guard();
        let _lang = LangRestore(i18n::lang());

        let db = test_db("hata").await;

        let stored = i18n::canon("err.no_partial_support", &[]);
        let mut item = sample("hatali");
        item.status = DownloadStatus::Failed;
        item.error_message = Some(stored.clone());

        let id = db.insert(&item).await.unwrap();

        // Ham sütun kanonik biçimde saklanır.
        let raw: String = sqlx::query("SELECT error_message FROM downloads WHERE id = ?")
            .bind(id)
            .fetch_one(db.pool())
            .await
            .unwrap()
            .try_get("error_message")
            .unwrap();
        assert_eq!(raw, stored, "ham sütun kanonik biçimde kalmalı");

        // Okuma seçili dile çevirir: dil değişince aynı kayıt yeniden yüklenir.
        i18n::set_lang(i18n::Lang::Tr);
        assert_eq!(
            db.get(id).await.unwrap().unwrap().error_message.as_deref(),
            Some("Sunucu bölümlü indirmeyi desteklemiyor (200 OK döndü, 206 bekleniyordu)")
        );

        i18n::set_lang(i18n::Lang::En);
        assert_eq!(
            db.get(id).await.unwrap().unwrap().error_message.as_deref(),
            Some("The server does not support partial downloads (returned 200 OK, expected 206)")
        );
    }

    /// Düz (kanonik olmayan) eski hata satırları bozulmadan aynen kalır.
    #[tokio::test]
    async fn plain_error_message_is_kept() {
        let db = test_db("duzhata").await;

        let mut item = sample("duz");
        item.status = DownloadStatus::Failed;
        item.error_message = Some("Eski biçimli hata".to_string());

        let id = db.insert(&item).await.unwrap();
        assert_eq!(
            db.get(id).await.unwrap().unwrap().error_message.as_deref(),
            Some("Eski biçimli hata")
        );
    }

    // -----------------------------------------------------------------
    // Ayarlar
    // -----------------------------------------------------------------

    #[tokio::test]
    async fn ayarlar_migrasyonla_seed_edilir() {
        let db = test_db("ayar_seed").await;

        let s = db.load_settings().await.unwrap();
        assert_eq!(s.default_dir, crate::manager::default_download_dir());
        assert_eq!(s.default_channel_count, 8);
        assert_eq!(s.lang, i18n::Lang::Tr);
        assert!(s.video_dir.is_none());
        assert!(s.audio_dir.is_none());
        assert!(s.other_dir.is_none());
    }

    #[tokio::test]
    async fn ayarlar_kaydedilip_okunur() {
        let db = test_db("ayar_rt").await;

        // Varsayılan dilden farklı bir değer seçilir: aksi halde dilin
        // gerçekten kalıcı olduğu doğrulanmış olmaz.
        let saved = Settings {
            lang: i18n::Lang::En,
            default_channel_count: 16,
            video_dir: Some(PathBuf::from("C:/Video")),
            audio_dir: Some(PathBuf::from("C:/Muzik")),
            other_dir: None,
            default_dir: PathBuf::from("C:/Genel"),
            ..Settings::default()
        };
        db.save_settings(&saved).await.unwrap();

        let got = db.load_settings().await.unwrap();
        assert_eq!(got.lang, i18n::Lang::En);
        assert_eq!(got.default_channel_count, 16);
        assert_eq!(got.video_dir, Some(PathBuf::from("C:/Video")));
        assert_eq!(got.audio_dir, Some(PathBuf::from("C:/Muzik")));
        assert_eq!(got.other_dir, None);
        assert_eq!(got.default_dir, PathBuf::from("C:/Genel"));
    }

    #[tokio::test]
    async fn ayar_kaydinda_sifirlanan_klasor_none_olur() {
        let db = test_db("ayar_sifir").await;

        let s = Settings {
            video_dir: Some(PathBuf::from("C:/Video")),
            default_channel_count: 4,
            ..Settings::default()
        };
        db.save_settings(&s).await.unwrap();

        // Kullanıcı videoyu sıfırladı: boş metin NULL olarak yazılır.
        let cleared = Settings {
            video_dir: Some(PathBuf::from("  ")),
            ..s
        };
        db.save_settings(&cleared).await.unwrap();

        assert_eq!(db.load_settings().await.unwrap().video_dir, None);
    }

    #[tokio::test]
    async fn ayar_kaydinda_kanal_sayisi_sikistirilir() {
        let db = test_db("ayar_kanal").await;

        let s = Settings {
            default_channel_count: 9999,
            ..Settings::default()
        };
        db.save_settings(&s).await.unwrap();

        assert_eq!(
            db.load_settings().await.unwrap().default_channel_count,
            crate::settings::MAX_CHANNELS
        );
    }

    #[tokio::test]
    async fn yeniden_migrate_kullanici_ayarlarini_silmez() {
        let db = test_db("ayar_seed2").await;

        let saved = Settings {
            lang: i18n::Lang::En,
            video_dir: Some(PathBuf::from("C:/Video")),
            ..Settings::default()
        };
        db.save_settings(&saved).await.unwrap();

        // Uygulama her açılışta migrate çalıştırır; seed `INSERT OR IGNORE`
        // olduğu için kayıtlı ayarlar korunmalıdır.
        migrate(db.pool()).await.unwrap();

        let got = db.load_settings().await.unwrap();
        assert_eq!(got.lang, i18n::Lang::En);
        assert_eq!(got.video_dir, Some(PathBuf::from("C:/Video")));
    }

    // -----------------------------------------------------------------
    // MC portu alanları
    // -----------------------------------------------------------------

    #[tokio::test]
    async fn mc_kolonlari_migrasyonla_eklenir() {
        let db = test_db("mc_kolon").await;

        // Var olan bir kayıt bulunsun: yeni kolonların bu satıra da
        // varsayılanla uygulandığı doğrulanacak.
        sqlx::query(
            "INSERT INTO downloads \
                 (url, file_path, file_name, status, created_at, last_updated) \
             VALUES ('http://x/y.bin', 'C:/y.bin', 'y.bin', 'completed', \
                     '2024-01-01T00:00:00', '2024-01-01T00:00:00')",
        )
        .execute(db.pool())
        .await
        .unwrap();

        // Eski şema gibi davran: yeni kolonları düşür, sonra migrate çalıştır.
        sqlx::query("ALTER TABLE downloads DROP COLUMN kind")
            .execute(db.pool())
            .await
            .ok();
        sqlx::query("ALTER TABLE downloads DROP COLUMN stage")
            .execute(db.pool())
            .await
            .ok();
        sqlx::query("ALTER TABLE settings DROP COLUMN server_port")
            .execute(db.pool())
            .await
            .ok();

        migrate(db.pool()).await.unwrap();

        // Kolonlar geri geldi mi?
        let row: (String, String, i64) =
            sqlx::query("SELECT kind, stage, channel_count FROM downloads LIMIT 1")
                .fetch_optional(db.pool())
                .await
                .map(|r| {
                    r.map(|row| {
                        (
                            row.try_get("kind").unwrap_or_default(),
                            row.try_get("stage").unwrap_or_default(),
                            row.try_get("channel_count").unwrap_or(0),
                        )
                    })
                    .unwrap_or_default()
                })
                .unwrap_or_default();
        assert_eq!(row.0, "file");

        let port: i64 = sqlx::query("SELECT server_port FROM settings WHERE id = 1")
            .fetch_optional(db.pool())
            .await
            .unwrap()
            .map(|r| r.try_get("server_port").unwrap_or(48213))
            .unwrap_or(48213);
        assert_eq!(port, 48213);
    }

    #[tokio::test]
    async fn kind_ve_ek_alanlar_yuvarlanir() {
        let db = test_db("kind_rt").await;

        let mut item = sample("video");
        item.kind = crate::models::DownloadKind::Video;
        item.supports_ranges = true;
        item.headers = vec![("Referer".to_string(), "https://x.tld".to_string())];
        item.cookie_file = Some("C:/tmp/cookies.txt".to_string());
        item.final_path = Some("C:/out/video.mp4".to_string());
        item.stage = "Video indiriliyor…".to_string();
        item.log = "[download] Destination: Video.f137.mp4".to_string();

        let id = db.insert(&item).await.unwrap();

        let got = db.get(id).await.unwrap().unwrap();
        assert_eq!(got.kind, crate::models::DownloadKind::Video);
        assert!(got.supports_ranges);
        assert_eq!(
            got.headers,
            vec![("Referer".to_string(), "https://x.tld".to_string())]
        );
        assert_eq!(got.cookie_file.as_deref(), Some("C:/tmp/cookies.txt"));
        assert_eq!(got.final_path.as_deref(), Some("C:/out/video.mp4"));
        assert_eq!(got.stage, "Video indiriliyor…");
        assert!(got.log.contains("Destination"));
    }

    #[tokio::test]
    async fn mc_ayarlari_kaydedilip_okunur() {
        let db = test_db("mc_ayar").await;

        let saved = Settings {
            server_port: 55555,
            max_concurrent: 5,
            auto_start: false,
            watch_clipboard: false,
            organize_by_category: false,
            capture_group_ids: vec!["video".to_string()],
            custom_extensions: "mkv, iso".to_string(),
            ytdlp_path: "C:/tools/yt-dlp.exe".to_string(),
            video_container: "webm".to_string(),
            video_max_height: 720,
            start_in_tray: true,
            close_to_tray: false,
            ..Settings::default()
        };
        db.save_settings(&saved).await.unwrap();

        let got = db.load_settings().await.unwrap();
        assert_eq!(got.server_port, 55555);
        assert_eq!(got.max_concurrent, 5);
        assert!(!got.auto_start);
        assert!(!got.watch_clipboard);
        assert!(!got.organize_by_category);
        assert_eq!(got.capture_group_ids, vec!["video".to_string()]);
        assert_eq!(got.custom_extensions, "mkv, iso");
        assert_eq!(got.ytdlp_path, "C:/tools/yt-dlp.exe");
        assert_eq!(got.video_container, "webm");
        assert_eq!(got.video_max_height, 720);
        assert!(got.start_in_tray);
        assert!(!got.close_to_tray);
    }
}
