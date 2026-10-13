//! Rust tarafı mesaj i18n'i (TR/EN).
//!
//! Tüm kullanıcıya dönük metinler buradan üretilir. Tasarım:
//!
//! * **Tek tablo.** `MESSAGES` her anahtar için `(anahtar, tr, en)` üçlüsü
//!   içerir; iki dilin de tanımlı olması yapısal olarak zorunludur.
//! * **`t(key, args)`** — seçili dilde, `{0}` / `{1}` yer tutucuları doldurulmuş
//!   metni döner.
//! * **`canon(key, args)`** — kanonik biçimi (`␟adm:anahtar␟arg0␟arg1…`)
//!   üretir. Kalıcı hata mesajları (`downloads.error_message`) bu biçimde
//!   yazılır.
//! * **`render(s)`** — kanonik bir metni seçili dile çevirir; kanonik olmayan
//!   (düz, eski) bir metni olduğu gibi bırır.
//!
//! Bu sayede dil değiştiğinde liste yeniden yüklendiğinde **eski hata
//! kayıtları da yeni dilde** görünür; log satırları ise bellek içi oldukları
//! için yazıldıkları dilde kalır.
//!
//! Arayüzün karşılığı `src/lib/i18n/`dur; ikisi `set_language` komutuyla
//! senkronlanır.

use std::sync::atomic::{AtomicU8, Ordering};

use serde::{Deserialize, Serialize};

/// Aktif dil. Varsayılan Türkçedir; mevcut testler bunu varsayar.
///
/// `rename_all = "lowercase"` ile JSON'da `"tr"` / `"en"` olarak yazılır;
/// ayarlar tablosu da aynı metni saklar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    Tr,
    En,
}

impl Lang {
    /// Arayüzün gönderdiği metinden dili çevirir (bilinmeyen değer → TR).
    pub fn parse(raw: &str) -> Self {
        if raw.trim().eq_ignore_ascii_case("en") {
            Lang::En
        } else {
            Lang::Tr
        }
    }

    /// Veritabanında saklanan kısa biçim (`"tr"` / `"en"`).
    pub fn as_str(self) -> &'static str {
        match self {
            Lang::Tr => "tr",
            Lang::En => "en",
        }
    }
}

/// 0 = TR, 1 = EN. `AtomicU8` ile kilitsiz okunur.
static LANG: AtomicU8 = AtomicU8::new(0);

/// Aktif dil.
pub fn lang() -> Lang {
    if LANG.load(Ordering::Relaxed) == 1 {
        Lang::En
    } else {
        Lang::Tr
    }
}

/// Dili değiştirir (arayüzdeki dil anahtarından gelir).
pub fn set_lang(next: Lang) {
    LANG.store(
        match next {
            Lang::Tr => 0,
            Lang::En => 1,
        },
        Ordering::Relaxed,
    );
}

/// Kanonik kayıt ayracı: kullanıcı metninde görünmeyen ASCII ayraç.
const SEP: char = '\u{1F}';

/// Kanonik kayıt öneki. Düz metinler bu önekle başlamaz.
const PREFIX: &str = "\u{1F}adm:";

/// Mesaj tablosu: `(anahtar, Türkçe şablon, İngilizce şablon)`.
///
/// Yer tutucular sıra numarasıdır: `{0}`, `{1}`, … `t(key, &[a, b])` ile
/// doldurulur. Sıra dışı bir yer tutucu şablonda kalır.
static MESSAGES: &[(&str, &str, &str)] = &[
    // -----------------------------------------------------------------
    // Başlatma / yönetim hataları
    // -----------------------------------------------------------------
    ("err.url_empty", "URL boş olamaz", "URL cannot be empty"),
    (
        "err.download_not_found",
        "İndirme bulunamadı (#{0})",
        "Download not found (#{0})",
    ),
    (
        "err.not_restartable",
        "Bu indirme yeniden başlatılamaz",
        "This download cannot be restarted",
    ),
    (
        "err.already_running",
        "İndirme zaten çalışıyor",
        "This download is already running",
    ),
    (
        "err.running_not_found",
        "Çalışan indirme bulunamadı (#{0})",
        "Running download not found (#{0})",
    ),
    (
        "err.unknown",
        "Bilinmeyen bir hata oluştu",
        "An unknown error occurred",
    ),
    (
        "err.main_window",
        "Ana pencere bulunamadı",
        "The main window was not found",
    ),
    // -----------------------------------------------------------------
    // Dosya sistemi
    // -----------------------------------------------------------------
    (
        "err.dir_create_failed",
        "Klasör oluşturulamadı: {0}",
        "Could not create the folder: {0}",
    ),
    (
        "err.parent_dir_failed",
        "Kayıt dizini oluşturulamadı ({0}): {1}",
        "Could not create the target folder ({0}): {1}",
    ),
    (
        "err.dest_create_failed",
        "Hedef dosya oluşturulamadı: {0}",
        "Could not create the target file: {0}",
    ),
    (
        "err.dest_open_failed",
        "Hedef dosya açılamadı: {0}",
        "Could not open the target file: {0}",
    ),
    (
        "err.size_reserve_failed",
        "Dosya boyutu ayrılamadı: {0}",
        "Could not reserve the file size: {0}",
    ),
    (
        "err.io",
        "Dosya işlemi hatası: {0}",
        "File operation error: {0}",
    ),
    (
        "err.seek_failed",
        "Dosyada konumlanılamadı: {0}",
        "Could not seek in the file: {0}",
    ),
    (
        "err.write_failed",
        "Dosyaya yazılamadı: {0}",
        "Could not write to the file: {0}",
    ),
    (
        "err.open_file",
        "Dosya açılamadı: {0}",
        "Could not open the file: {0}",
    ),
    (
        "err.open_folder",
        "Klasör açılamadı: {0}",
        "Could not open the folder: {0}",
    ),
    (
        "err.open_url",
        "Bağlantı açılamadı: {0}",
        "Could not open the link: {0}",
    ),
    // -----------------------------------------------------------------
    // Ağ hataları
    // -----------------------------------------------------------------
    (
        "err.timeout",
        "Bağlantı zaman aşımına uğradı",
        "The connection timed out",
    ),
    (
        "err.connect",
        "Sunucuya bağlanılamadı (ağ ya da adres hatası)",
        "Could not connect to the server (network or address error)",
    ),
    ("err.redirect", "Yönlendirme hatası", "Redirect error"),
    ("err.net", "Ağ hatası: {0}", "Network error: {0}"),
    (
        "err.redirect_no_target",
        "Sunucu yönlendirme yaptı ancak hedef adresi yok",
        "The server redirected but did not send a target address",
    ),
    (
        "err.redirect_invalid",
        "Sunucu geçersiz yönlendirme adresi gönderdi",
        "The server sent an invalid redirect address",
    ),
    (
        "err.too_many_redirects",
        "Çok fazla yönlendirme ({0} sınırı aşıldı)",
        "Too many redirects (the limit of {0} was exceeded)",
    ),
    // -----------------------------------------------------------------
    // HTTP / kanal hataları
    // -----------------------------------------------------------------
    (
        "err.server_rejected",
        "Sunucu isteği reddetti: {0} {1}",
        "The server rejected the request: {0} {1}",
    ),
    (
        "err.server_error",
        "Sunucu hatası: {0} {1}",
        "Server error: {0} {1}",
    ),
    (
        "err.range_not_satisfiable",
        "Sunucu istenen {0}-{1} bayt aralığını sağlamıyor (416)",
        "The server cannot serve the requested {0}-{1} byte range (416)",
    ),
    (
        "err.no_partial_support",
        "Sunucu bölümlü indirmeyi desteklemiyor (200 OK döndü, 206 bekleniyordu)",
        "The server does not support partial downloads (returned 200 OK, expected 206)",
    ),
    (
        "err.unexpected_range",
        "Sunucu beklenmeyen aralık döndürdü: {0}",
        "The server returned an unexpected range: {0}",
    ),
    (
        "err.incomplete",
        "İndirme eksik kaldı: {0} / {1} bayt alındı",
        "The download is incomplete: {0} / {1} bytes received",
    ),
    (
        "err.stream_cut",
        "Sunucu akışı {0} denemeden sonra kesildi",
        "The server stream was cut after {0} attempts",
    ),
    (
        "err.stream_broken",
        "Veri akışı kesildi: {0}",
        "The data stream was interrupted: {0}",
    ),
    (
        "err.empty_body",
        "Sunucu boş gövde döndürdü",
        "The server returned an empty body",
    ),
    (
        "err.source_closed",
        "Dosya kaynağı kapatıldı",
        "The file source was closed",
    ),
    (
        "err.channel_task_ended",
        "Kanal görevi beklenmedik şekilde sonlandı: {0}",
        "The channel task ended unexpectedly: {0}",
    ),
    (
        "err.task_ended_unexpectedly",
        "İndirme görevi beklenmedik şekilde sonlandı",
        "The download task ended unexpectedly",
    ),
    // -----------------------------------------------------------------
    // Veritabanı
    // -----------------------------------------------------------------
    (
        "err.db_open",
        "Veritabanı açılamadı: {0}",
        "Could not open the database: {0}",
    ),
    (
        "err.db_dir_failed",
        "Veritabanı dizini oluşturulamadı: {0}",
        "Could not create the database directory: {0}",
    ),
    (
        "err.db_pool_failed",
        "SQLite bağlantı havuzu açılamadı",
        "Could not open the SQLite connection pool",
    ),
    (
        "err.db_schema",
        "Şema hazırlanamadı: {0}",
        "Could not prepare the schema: {0}",
    ),
    (
        "err.db_insert",
        "İndirme kaydı eklenemedi",
        "Could not insert the download record",
    ),
    (
        "err.db_update_progress",
        "İndirme ilerlemesi kaydedilemedi",
        "Could not save the download progress",
    ),
    (
        "err.db_update_status",
        "İndirme durumu güncellenemedi",
        "Could not update the download status",
    ),
    (
        "err.db_update_channels",
        "Kanal sayısı güncellenemedi",
        "Could not update the channel count",
    ),
    (
        "err.db_read",
        "İndirme kaydı okunamadı",
        "Could not read the download record",
    ),
    (
        "err.db_list",
        "İndirme listesi okunamadı",
        "Could not read the download list",
    ),
    (
        "err.db_list_active",
        "Aktif indirme listesi okunamadı",
        "Could not read the active download list",
    ),
    (
        "err.db_delete",
        "İndirme kaydı silinemedi",
        "Could not delete the download record",
    ),
    (
        "err.db_clear_all",
        "İndirme geçmişi temizlenemedi",
        "Could not clear the download history",
    ),
    (
        "err.db_settings_seed",
        "Varsayılan ayarlar oluşturulamadı",
        "Could not create the default settings",
    ),
    (
        "err.db_settings_load",
        "Ayarlar okunamadı",
        "Could not read the settings",
    ),
    (
        "err.db_settings_save",
        "Ayarlar kaydedilemedi",
        "Could not save the settings",
    ),
    // -----------------------------------------------------------------
    // Pencere komutları
    // -----------------------------------------------------------------
    (
        "err.win_minimize",
        "Pencere küçültülemedi: {0}",
        "Could not minimize the window: {0}",
    ),
    (
        "err.win_maximize",
        "Pencere büyütülemedi: {0}",
        "Could not maximize the window: {0}",
    ),
    (
        "err.win_state",
        "Pencere durumu okunamadı: {0}",
        "Could not read the window state: {0}",
    ),
    (
        "err.win_close",
        "Pencere kapatılamadı: {0}",
        "Could not close the window: {0}",
    ),
    // -----------------------------------------------------------------
    // Faz metinleri
    // -----------------------------------------------------------------
    ("status.aborted", "Duraklatıldı", "Paused"),
    ("phase.downloading", "İndiriliyor", "Downloading"),
    ("phase.completed", "Tamamlandı", "Completed"),
    ("phase.size_unknown", "Boyut bilinmiyor", "Size unknown"),
    // -----------------------------------------------------------------
    // Log satırları
    // -----------------------------------------------------------------
    (
        "log.new_added",
        "Yeni indirme eklendi: {0} ({1} kanal)",
        "New download added: {0} ({1} channels)",
    ),
    (
        "log.file_missing_restart",
        "Hedef dosya bulunamadı, sıfırdan başlatılıyor: {0}",
        "The target file was not found, restarting from scratch: {0}",
    ),
    (
        "log.resuming",
        "İndirme sürdürülüyor: {0}",
        "Resuming the download: {0}",
    ),
    (
        "log.resuming_pct",
        "İndirme sürdürülüyor: {0} (%{1})",
        "Resuming the download: {0} ({1}%)",
    ),
    (
        "log.paused",
        "İndirme duraklatıldı",
        "The download was paused",
    ),
    (
        "log.cancelled",
        "İndirme iptal edildi",
        "The download was cancelled",
    ),
    (
        "log.file_deleted",
        "Dosya silindi: {0}",
        "File deleted: {0}",
    ),
    (
        "log.file_delete_failed",
        "Dosya silinemedi ({0}): {1}",
        "Could not delete the file ({0}): {1}",
    ),
    (
        "log.move_failed",
        "Dosya hedef klasöre taşınamadı ({0}): {1}",
        "Could not move the file to its destination ({0}): {1}",
    ),
    (
        "log.record_deleted",
        "Kayıt silindi: {0}",
        "Record deleted: {0}",
    ),
    (
        "log.records_cleared",
        "{0} kayıt temizlendi",
        "{0} records cleared",
    ),
    (
        "log.channels_updated",
        "Kanal sayısı {0} olarak güncellendi",
        "The channel count was updated to {0}",
    ),
    (
        "log.shutdown",
        "Uygulama kapatılıyor, {0} indirme iptal ediliyor",
        "The application is closing, cancelling {0} downloads",
    ),
    (
        "log.bulk_paused",
        "{0} indirme duraklatıldı",
        "Paused {0} downloads",
    ),
    (
        "log.bulk_resumed",
        "{0} indirme sürdürüldü",
        "Resumed {0} downloads",
    ),
    (
        "log.bulk_cancelled",
        "{0} indirme iptal edildi",
        "Cancelled {0} downloads",
    ),
    (
        "err.disk_space",
        "Disk alanı okunamadı: {0}",
        "Could not read the disk space: {0}",
    ),
    (
        "log.completed",
        "İndirme tamamlandı: {0}",
        "The download completed: {0}",
    ),
    (
        "log.paused_pct",
        "İndirme duraklatıldı: {0} (%{1})",
        "The download was paused: {0} ({1}%)",
    ),
    (
        "log.cancelled_name",
        "İndirme iptal edildi: {0}",
        "The download was cancelled: {0}",
    ),
    (
        "log.failed",
        "İndirme başarısız: {0} — {1}",
        "The download failed: {0} — {1}",
    ),
    (
        "log.task_failed",
        "İndirme görevi hata verdi: {0}",
        "The download task failed: {0}",
    ),
    (
        "log.progress_save_failed",
        "İlerleme kaydedilemedi: {0}",
        "Could not save the progress: {0}",
    ),
    (
        "log.final_state_failed",
        "Son durum kaydedilemedi: {0}",
        "Could not save the final state: {0}",
    ),
    (
        "log.events_dropped",
        "{0} olay kaçırıldı, arayüz yeniden senkronlanıyor",
        "{0} events were dropped, resynchronizing the interface",
    ),
    // -----------------------------------------------------------------
    // MC portu: araçlar (yt-dlp / ffmpeg / deno)
    // -----------------------------------------------------------------
    ("err.tool_busy", "Başka bir araç kurulumu sürüyor", "Another tool installation is in progress"),
    (
        "err.tool_dir_failed",
        "Araç klasörü oluşturulamadı: {0}",
        "Could not create the tools folder: {0}",
    ),
    (
        "err.tool_download_failed",
        "İndirilemedi: {0}",
        "Could not download: {0}",
    ),
    ("err.tool_http", "İndirme başarısız (HTTP {0}): {1}", "Download failed (HTTP {0}): {1}"),
    (
        "err.tool_write_failed",
        "Dosya yazılamadı: {0}",
        "Could not write the file: {0}",
    ),
    (
        "err.tool_read_failed",
        "Dosya okunamadı: {0}",
        "Could not read the file: {0}",
    ),
    (
        "err.tool_not_runnable",
        "{0} çalıştırılamadı (indirme bozuk olabilir)",
        "{0} could not be run (the download may be corrupt)",
    ),
    (
        "err.tool_install_failed",
        "{0} kurulamadı",
        "{0} could not be installed",
    ),
    (
        "err.tool_zip_open",
        "Arşiv açılamadı: {0}",
        "Could not open the archive: {0}",
    ),
    ("err.tool_zip_read", "Arşiv bozuk", "The archive is corrupt"),
    (
        "err.tool_zip_missing",
        "Arşivde {0} bulunamadı",
        "{0} was not found in the archive",
    ),
    (
        "err.tool_checksum",
        "Sağlama toplamı uyuşmuyor, dosya silindi",
        "The checksum did not match; the file was deleted",
    ),
    ("tool.downloading", "İndiriliyor: {0}", "Downloading: {0}"),
    ("tool.verifying", "Doğrulanıyor…", "Verifying…"),
    // -----------------------------------------------------------------
    // MC portu: video (yt-dlp)
    // -----------------------------------------------------------------
    ("err.ytdlp_missing", "yt-dlp kurulu değil", "yt-dlp is not installed"),
    (
        "err.ytdlp_spawn_failed",
        "yt-dlp başlatılamadı: {0}",
        "Could not start yt-dlp: {0}",
    ),
    ("err.ytdlp_exit_code", "yt-dlp {0} koduyla çıktı", "yt-dlp exited with code {0}"),
    (
        "err.ytdlp_wait_failed",
        "yt-dlp beklenemedi: {0}",
        "Could not wait for yt-dlp: {0}",
    ),
    ("stage.downloading_audio", "Ses indiriliyor…", "Downloading audio…"),
    ("stage.downloading_video", "Video indiriliyor…", "Downloading video…"),
    ("stage.downloading", "İndiriliyor…", "Downloading…"),
    ("stage.merging", "Video ve ses birleştiriliyor (ffmpeg)…", "Merging video and audio (ffmpeg)…"),
    ("stage.converting", "Kapsayıcı dönüştürülüyor (ffmpeg)…", "Converting container (ffmpeg)…"),
    ("stage.extracting_audio", "Ses çıkarılıyor (ffmpeg)…", "Extracting audio (ffmpeg)…"),
    ("stage.selected", "Seçilen: {0}", "Selected: {0}"),
    ("stage.already_downloaded", "Dosya zaten indirilmiş", "The file has already been downloaded"),
    // -----------------------------------------------------------------
    // MC portu: sınırlama ve güncelleme
    // -----------------------------------------------------------------
    (
        "err.throttled",
        "Sunucu istekleri sınırlandırıyor ({0}); {1} deneme başarısız oldu",
        "The server is throttling requests ({0}); {1} attempts failed",
    ),
    (
        "err.update_check_failed",
        "Güncelleme denetlenemedi: {0}",
        "Could not check for updates: {0}",
    ),
    ("err.update_http", "Güncelleme denetlenemedi (HTTP {0})", "Could not check for updates (HTTP {0})"),
    (
        "err.update_parse_failed",
        "Sürüm bilgisi okunamadı: {0}",
        "Could not read the release info: {0}",
    ),
    // -----------------------------------------------------------------
    // MC portu: tarayıcı köprüsü ve site girişi
    // -----------------------------------------------------------------
    (
        "err.bridge_origin",
        "Köprü isteği uzantı kaynaklı değil",
        "The bridge request did not come from the extension",
    ),
    ("err.bridge_host", "Köprü isteği yerel adrese gitmiyor", "The bridge request did not target a local address"),
    ("err.bridge_empty_url", "İndirme adresi boş", "The download URL is empty"),
    ("err.bridge_bad_json", "Gönderilen veri okunamadı", "The submitted data could not be read"),
    ("err.bridge_unknown_action", "Bilinmeyen eylem: {0}", "Unknown action: {0}"),
    ("err.bridge_download_not_found", "İndirme bulunamadı (#{0})", "The download was not found (#{0})"),
    (
        "err.site_login_cookies",
        "Çerezler okunamadı: {0}",
        "Could not read the cookies: {0}",
    ),
    ("log.cookie_written", "Site girişi çerezleri kaydedildi ({0} çerez)", "Site login cookies saved ({0} cookies)"),
    ("log.bridge_started", "Tarayıcı köprüsü 127.0.0.1:{0} adresinde başladı", "The browser bridge started on 127.0.0.1:{0}"),
    ("log.bridge_stopped", "Tarayıcı köprüsü durduruldu", "The browser bridge stopped"),
    ("log.bridge_failed", "Tarayıcı köprüsü başlatılamadı: {0}", "The browser bridge could not start: {0}"),
    (
        "log.bridge_connection",
        "Tarayıcı bağlantısı: {0}",
        "Browser connection: {0}",
    ),
    ("log.clipboard_detected", "Panoda {0} bağlantı bulundu", "Found {0} links in the clipboard"),
    ("log.deno_missing", "deno kurulu değil; YouTube videoları için gerekli", "deno is not installed; it is required for YouTube videos"),
    ("log.tool_installed", "{0} kuruldu (sürüm {1})", "{0} installed (version {1})"),
    ("log.update_available", "Yeni sürüm mevcut: {0}", "A new version is available: {0}"),
    // -----------------------------------------------------------------
    // MC portu: tarayıcı eklentisi ve site girişi
    // -----------------------------------------------------------------
    (
        "err.browser_plugin_missing",
        "Tarayıcı eklenti dosyaları bulunamadı",
        "The browser extension files were not found",
    ),
    (
        "err.browser_not_found",
        "{0} tarayıcısı bulunamadı. Kurulu değil ya da taşınabilir bir sürüm kullanıyor olabilirsiniz; klasörü elle açıp uzantı sayfasını tarayıcıdan açabilirsiniz",
        "{0} could not be found. It may not be installed, or a portable build may be in use; open the folder manually and the extensions page from the browser",
    ),
    // -----------------------------------------------------------------
    // MC portu: `.crx` indirme ve geliştirici modu
    // -----------------------------------------------------------------
    (
        "err.crx_url_empty",
        "Eklenti adresi boş",
        "The extension address is empty",
    ),
    (
        "err.crx_url_not_https",
        "Eklenti adresi yalnızca https olabilir",
        "The extension address must use https",
    ),
    (
        "err.crx_download_failed",
        "Eklenti indirilemedi: {0}",
        "Could not download the extension: {0}",
    ),
    (
        "err.crx_http",
        "Eklenti indirilemedi (HTTP {0})",
        "Could not download the extension (HTTP {0})",
    ),
    (
        "err.crx_too_large",
        "Eklenti dosyası çok büyük (64 MB sınır)",
        "The extension file is too large (64 MB limit)",
    ),
    (
        "err.crx_invalid",
        "İndirilen dosya geçerli bir eklenti paketi (.crx) değil",
        "The downloaded file is not a valid extension package (.crx)",
    ),
    (
        "err.browser_running",
        "Geliştirici modunu açmak için tarayıcıyı kapatın",
        "Close the browser to let developer mode be turned on",
    ),
    (
        "log.crx_downloaded",
        "Eklenti paketi indirildi: {0}",
        "The extension package was downloaded: {0}",
    ),
    (
        "log.dev_mode_enabled",
        "{0} için geliştirici modu açıldı",
        "Developer mode was turned on for {0}",
    ),
    (
        "log.browser_files_ready",
        "Tarayıcı eklenti dosyaları hazırlandı: {0}",
        "Browser extension files are ready: {0}",
    ),
    (
        "browser.readme",
        "ADM tarayıcı eklentisi ({0})\n\n1. Tarayıcıda uzantı sayfasını açın ve geliştirici modunu etkinleştirin.\n2. \"Paketlenmemiş öğe yükle\" ile bu klasörü seçin.\n3. ADM açıkken indirmeler otomatik olarak yakalanır.\n",
        "ADM browser extension ({0})\n\n1. Open the extensions page in the browser and enable developer mode.\n2. Choose \"Load unpacked\" and select this folder.\n3. Downloads are captured automatically while ADM is running.\n",
    ),
    (
        "err.site_cookies_empty",
        "Kaydedilecek çerez bulunamadı",
        "No cookies were provided",
    ),
    (
        "log.cookie_cleared",
        "Site girişi çerezleri silindi",
        "Site login cookies were cleared",
    ),
    (
        "site_login.title",
        "Site Girişi — ADM",
        "Site Login — ADM",
    ),
    (
        "err.site_login_open",
        "Giriş penceresi açılamadı: {0}",
        "Could not open the login window: {0}",
    ),
    (
        "err.site_login_missing",
        "Site girişi penceresi açık değil",
        "The site login window is not open",
    ),
    (
        "err.detail_open",
        "Ayrıntı penceresi açılamadı: {0}",
        "Could not open the detail window: {0}",
    ),
    (
        "err.autostart",
        "Otomatik başlatma kaydı yazılamadı: {0}",
        "Could not write the automatic start entry: {0}",
    ),
    (
        "err.clipboard_unavailable",
        "Pano şu anda okunamıyor",
        "The clipboard cannot be read right now",
    ),
    (
        "err.clipboard_empty",
        "Panoda indirilecek bir bağlantı bulunamadı",
        "No link to download was found in the clipboard",
    ),
    (
        "err.clipboard_busy",
        "Bir pano sorusu zaten açık",
        "A clipboard prompt is already open",
    ),
    // -----------------------------------------------------------------
    // Tepsi simgesi menüsü
    // -----------------------------------------------------------------
    ("tray.show", "Göster", "Show"),
    ("tray.hide", "Gizle", "Hide"),
    ("tray.pause_all", "Tümünü duraklat", "Pause all"),
    ("tray.resume_all", "Tümünü sürdür", "Resume all"),
    ("tray.quit", "Çık", "Quit"),
    // -----------------------------------------------------------------
    // Sistem bildirimleri
    // -----------------------------------------------------------------
    ("notify.completed_title", "İndirme tamamlandı", "Download complete"),
];

/// Anahtarı tabloda arar.
fn lookup(key: &str) -> Option<(&'static str, &'static str)> {
    MESSAGES
        .iter()
        .find(|(k, _, _)| *k == key)
        .map(|(_, tr, en)| (*tr, *en))
}

/// Seçili dildeki şablonu seçer.
fn template(key: &str) -> Option<&'static str> {
    lookup(key).map(|(tr, en)| match lang() {
        Lang::Tr => tr,
        Lang::En => en,
    })
}

/// `{0}` / `{1}` yer tutucularını `args` ile doldurur.
///
/// Verilmemiş veya sayı olmayan bir yer tutucu **şablonda kalır**; böylece
/// eksik argüman sessizce boş metne dönüşmez.
fn fill(template: &str, args: &[&str]) -> String {
    let mut out = String::with_capacity(template.len() + args.len() * 8);
    let mut rest = template;

    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];

        let Some(close) = after.find('}') else {
            // Dengesiz parantez: kalanı olduğu gibi ekle.
            out.push_str(&rest[open..]);
            return out;
        };

        let token = &after[..close];
        match token.parse::<usize>().ok().and_then(|i| args.get(i)) {
            Some(value) => out.push_str(value),
            None => {
                out.push('{');
                out.push_str(token);
                out.push('}');
            }
        }
        rest = &after[close + 1..];
    }

    out.push_str(rest);
    out
}

/// Anahtarı seçili dile çevirir.
///
/// Bilinmeyen anahtar **kendini döner** — eksik bir kayıt üretimde boş metin
/// yerine okunabilir bir işaret olarak görünür.
pub fn t(key: &str, args: &[&str]) -> String {
    match template(key) {
        Some(tpl) => fill(tpl, args),
        None => key.to_string(),
    }
}

/// Mesajı kanonik biçimde üretir (kalıcı hata mesajları için).
///
/// Biçim: `␟adm:<anahtar>␟<arg0>␟<arg1>…`
pub fn canon(key: &str, args: &[&str]) -> String {
    let mut out = String::with_capacity(PREFIX.len() + key.len() + args.len() * 16);
    out.push_str(PREFIX);
    out.push_str(key);
    for arg in args {
        out.push(SEP);
        // Ayraç çakışmasını önle: argümanlarda `SEP` boşluğa çevrilir.
        out.push_str(&arg.replace(SEP, " "));
    }
    out
}

/// Metin kanonik biçimde mi?
pub fn is_canonical(s: &str) -> bool {
    s.starts_with(PREFIX)
}

/// Kanonik metni seçili dile çevirir.
///
/// Kanonik olmayan (düz, eski kayıtlardan gelen) metinler **olduğu gibi**
/// döner; böylece i18n öncesi yazılmış satırlar bozulmaz.
pub fn render(s: &str) -> String {
    let Some(rest) = s.strip_prefix(PREFIX) else {
        return s.to_string();
    };

    let mut parts = rest.split(SEP);
    let key = parts.next().unwrap_or_default();
    let args: Vec<&str> = parts.collect();

    match template(key) {
        Some(tpl) => fill(tpl, &args),
        // Anahtar tanınmıyor: kanonik biçim olduğu gibi kalır.
        None => s.to_string(),
    }
}

/// Dil durumu globaldir ve testler paralel çalışır; dili değiştiren testler
/// bu kilidi alarak birbirlerini beklemez.
#[cfg(test)]
pub(crate) static TEST_LANG_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Dili değiştiren testler için kilit (`LangGuard`'dan önce alınmalı).
#[cfg(test)]
pub(crate) fn lang_test_guard() -> std::sync::MutexGuard<'static, ()> {
    TEST_LANG_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Testler dil durumunu paylaşır; hem seri çalışma hem de testin sonunda
    /// TR'ye dönüş sağlar.
    struct LangGuard;

    impl LangGuard {
        fn set(next: Lang) -> Self {
            set_lang(next);
            LangGuard
        }
    }

    impl Drop for LangGuard {
        fn drop(&mut self) {
            set_lang(Lang::Tr);
        }
    }

    #[test]
    fn varsayilan_dil_turkce() {
        let _lock = lang_test_guard();
        let _guard = LangGuard::set(Lang::Tr);
        assert_eq!(t("log.paused", &[]), "İndirme duraklatıldı");
    }

    #[test]
    fn yer_tutucular_doldurulur() {
        let _lock = lang_test_guard();
        let _guard = LangGuard::set(Lang::Tr);
        assert_eq!(t("log.record_deleted", &["a.bin"]), "Kayıt silindi: a.bin");
        assert_eq!(
            t("log.new_added", &["b.bin", "8"]),
            "Yeni indirme eklendi: b.bin (8 kanal)"
        );
    }

    #[test]
    fn ingilizce_karsiliklar_kullanilir() {
        let _lock = lang_test_guard();
        let _guard = LangGuard::set(Lang::En);
        assert_eq!(t("log.paused", &[]), "The download was paused");
        assert_eq!(t("log.record_deleted", &["a.bin"]), "Record deleted: a.bin");
    }

    #[test]
    fn eksik_yer_tutucu_sablonda_kalir() {
        let _lock = lang_test_guard();
        let _guard = LangGuard::set(Lang::Tr);
        // Argüman verilmedi: şablon aynen korunur.
        assert_eq!(t("log.record_deleted", &[]), "Kayıt silindi: {0}");
    }

    #[test]
    fn bilinmeyen_anahtar_kendini_dondurur() {
        let _lock = lang_test_guard();
        let _guard = LangGuard::set(Lang::En);
        assert_eq!(t("hic.boyle.bir.anahtar", &["x"]), "hic.boyle.bir.anahtar");
    }

    #[test]
    fn kanonik_bicim_her_iki_dilde_de_cevrilir() {
        let _lock = lang_test_guard();
        let stored = canon("log.record_deleted", &["a.bin"]);
        assert!(is_canonical(&stored));

        let _guard = LangGuard::set(Lang::Tr);
        assert_eq!(render(&stored), "Kayıt silindi: a.bin");

        let _guard2 = LangGuard::set(Lang::En);
        assert_eq!(render(&stored), "Record deleted: a.bin");
    }

    #[test]
    fn duz_metin_aynen_gecer() {
        let _lock = lang_test_guard();
        let _guard = LangGuard::set(Lang::En);
        assert_eq!(render("Kayıt silindi: a.bin"), "Kayıt silindi: a.bin");
        assert_eq!(render(""), "");
    }

    #[test]
    fn bilinmeyen_kanonik_anahtar_aynen_gecer() {
        let _lock = lang_test_guard();
        let _guard = LangGuard::set(Lang::En);
        let stored = canon("hic.boyle.bir.anahtar", &[]);
        assert_eq!(render(&stored), stored);
    }

    #[test]
    fn kanonik_ayrac_kullanici_metninde_bulunmaz() {
        let _lock = lang_test_guard();
        let stored = canon("log.record_deleted", &["a\u{1F}b.bin"]);
        let _guard = LangGuard::set(Lang::Tr);
        // Ayraç boşluğa çevrildiği için gidiş-dönüş kayıpsızdır.
        assert_eq!(render(&stored), "Kayıt silindi: a b.bin");
    }

    #[test]
    fn hicbir_sablon_bos_veya_anahtarsiz_degil() {
        for (key, tr, en) in MESSAGES {
            assert!(!key.is_empty(), "boş anahtar bulundu");
            assert!(
                !key.contains(char::is_whitespace),
                "anahtar boşluk içermez: {key}"
            );
            assert!(!tr.is_empty(), "{key}: Türkçe şablon boş");
            assert!(!en.is_empty(), "{key}: İngilizce şablon boş");
        }
    }

    #[test]
    fn anahtarlar_benzersizdir() {
        let mut seen: Vec<&str> = MESSAGES.iter().map(|(k, _, _)| *k).collect();
        seen.sort_unstable();
        let total = seen.len();
        seen.dedup();
        assert_eq!(seen.len(), total, "yinelenen mesaj anahtarı var");
    }

    #[test]
    fn yer_tutucu_sayilari_iki_dilde_ayni() {
        for (key, tr, en) in MESSAGES {
            assert_eq!(
                count_placeholders(tr),
                count_placeholders(en),
                "{key}: yer tutucu sayıları farklı"
            );
        }
    }

    /// `{N}` biçimindeki yer tutucu sayısını (tekrarlar dahil) döner.
    fn count_placeholders(s: &str) -> usize {
        let mut count = 0;
        let mut rest = s;
        while let Some(open) = rest.find('{') {
            let after = &rest[open + 1..];
            let Some(close) = after.find('}') else {
                break;
            };
            if after[..close].parse::<usize>().is_ok() {
                count += 1;
            }
            rest = &after[close + 1..];
        }
        count
    }

    #[test]
    fn iki_dil_arasinda_ayni_kalan_anahtar_yok() {
        // Türkçe ile İngilizcesi birebir aynı olan bir mesaj, çevirinin
        // gözden kaçmış olduğunun işaretidir.
        for (key, tr, en) in MESSAGES {
            assert_ne!(tr, en, "{key}: iki dil aynı ({tr})");
        }
    }
}
