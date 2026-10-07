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

/// Aktif dil. Varsayılan Türkçedir; mevcut testler bunu varsayar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
