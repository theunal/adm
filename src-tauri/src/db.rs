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
fn db_dir() -> PathBuf {
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
        channel_states   TEXT
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
        default_dir           TEXT    NOT NULL
    )
    "#,
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
                 speed_mbps, error_message, channel_states)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                channel_states   = ?
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
                 (id, lang, default_channel_count, video_dir, audio_dir, other_dir, default_dir) \
             VALUES (1, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT (id) DO UPDATE SET \
                 lang                  = excluded.lang, \
                 default_channel_count = excluded.default_channel_count, \
                 video_dir             = excluded.video_dir, \
                 audio_dir             = excluded.audio_dir, \
                 other_dir             = excluded.other_dir, \
                 default_dir           = excluded.default_dir",
        )
        .bind(normalized.lang.as_str())
        .bind(normalized.default_channel_count as i64)
        .bind(bind_dir(&normalized.video_dir))
        .bind(bind_dir(&normalized.audio_dir))
        .bind(bind_dir(&normalized.other_dir))
        .bind(normalized.default_dir.to_string_lossy().to_string())
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
    seed_settings(pool).await
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

        let saved = Settings {
            lang: i18n::Lang::En,
            default_channel_count: 16,
            video_dir: Some(PathBuf::from("C:/Video")),
            audio_dir: Some(PathBuf::from("C:/Muzik")),
            other_dir: None,
            default_dir: PathBuf::from("C:/Genel"),
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
}
