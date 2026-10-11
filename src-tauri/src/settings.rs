//! Kullanıcı ayarları: dil, varsayılan kanal sayısı ve uzantıya göre
//! indirme konumu.
//!
//! Ayar **tek kaynaktan** okunur: `settings` tablosunda tek satır tutulur
//! (`db::Database::load_settings` / `save_settings`). Yol kararı Rust
//! tarafında verildiği için ayar da Rust tarafında yaşamalıdır.
//!
//! Konum çözümü:
//!
//! ```text
//! film.mp4   -> video_dir    (yoksa default_dir)
//! parca.mp3  -> audio_dir    (yoksa default_dir)
//! arsiv.zip  -> other_dir    (yoksa default_dir)
//! rapor      -> default_dir
//! ```
//!
//! Uzantı listeleri bilinçli olarak **sabit**tir: kullanıcı hedef klasörleri
//! seçer, eşleme mantığı gizli kalır.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::i18n::Lang;
use crate::manager::default_download_dir;

/// Bir indirmenin uzantısına göre düştüğü kategori.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    Video,
    Audio,
    Other,
    /// Eşleşme yok — genel hedef klasör.
    Default,
}

/// Video uzantıları.
const VIDEO_EXT: &[&str] = &[
    "mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "m2ts", "ts", "3gp",
    "rmvb", "ogv", "vob", "mts",
];

/// Ses uzantıları.
const AUDIO_EXT: &[&str] = &[
    "mp3", "flac", "wav", "aac", "ogg", "oga", "m4a", "wma", "opus", "alac", "aiff", "ape", "mid",
    "midi", "dsf", "dff",
];

/// "Diğer" — arşiv, yükleyici, belge ve disk görüntüsü.
const OTHER_EXT: &[&str] = &[
    "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz", "zst", "iso", "exe", "msi", "apk", "dmg",
    "deb", "rpm", "pdf", "epub", "cbz", "cbr",
];

/// Dosya adındaki uzantı (son `.`dan sonrası, küçük harfe çevrilmiş).
///
/// Nokta içermeyen adlarda, uzantısı boş adlarda ve yalnızca nokta olan
/// adlarda `None` döner.
fn extension_of(file_name: &str) -> Option<&str> {
    let (stem, ext) = file_name.rsplit_once('.')?;
    // `.mp4` gibi gizli dosyalarda noktadan önceki kısım boftur; uzantı sayma.
    if stem.is_empty() || stem.ends_with(['/', '\\']) {
        return None;
    }
    if ext.is_empty() {
        return None;
    }
    Some(ext)
}

/// Dosya adına göre kategori.
pub fn classify(file_name: &str) -> Category {
    let Some(ext) = extension_of(file_name) else {
        return Category::Default;
    };
    let ext = ext.to_ascii_lowercase();

    if VIDEO_EXT.contains(&ext.as_str()) {
        Category::Video
    } else if AUDIO_EXT.contains(&ext.as_str()) {
        Category::Audio
    } else if OTHER_EXT.contains(&ext.as_str()) {
        Category::Other
    } else {
        Category::Default
    }
}

/// Uygulama ayarları (arayüze de aynı biçimde gider).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Arayüz dili.
    pub lang: Lang,
    /// Yeni indirmelerde varsayılan kanal sayısı (1..=32).
    pub default_channel_count: u32,
    /// Video dosyalarının hedef klasörü; `None` ise genel hedefe düşer.
    pub video_dir: Option<PathBuf>,
    /// Ses dosyalarının hedef klasörü.
    pub audio_dir: Option<PathBuf>,
    /// Diğer dosyaların hedef klasörü.
    pub other_dir: Option<PathBuf>,
    /// Eşleşmeyen dosyaların (ve boş bırakılan kategorilerin) hedefi.
    pub default_dir: PathBuf,

    // -----------------------------------------------------------------
    // MC portu ayarları
    // -----------------------------------------------------------------
    /// Tarayıcı köprüsünün dinlediği port (varsayılan 48213).
    pub server_port: u16,
    /// Aynı anda çalışan indirme sayısı (MC `maxConcurrent`).
    pub max_concurrent: u32,
    /// Yeni indirmeler hemen başlar (aksi halde kuyrukta bekler).
    pub auto_start: bool,
    /// Tamamlanınca bildirim göster.
    pub notify_on_complete: bool,
    /// İndirme başlarken detay penceresini aç.
    pub show_detail_on_start: bool,
    /// Detay penceresini tamamlanınca kapat.
    pub auto_close_detail: bool,
    /// Panoyu izleyip bağlantıları sor.
    pub watch_clipboard: bool,
    /// Yakalanan dosya türü grupları.
    pub capture_group_ids: Vec<String>,
    /// Yakalamaya eklenen özel uzantılar (virgülle).
    pub custom_extensions: String,
    /// İndirmeleri kategori alt klasörlerine ayır.
    pub organize_by_category: bool,
    /// Özel yt-dlp yolu (boş = kurulu olan).
    pub ytdlp_path: String,
    /// Özel yt-dlp `-f` ifadesi (boş = seçiciler).
    pub video_format: String,
    /// Video kapsayıcısı: mp4 | mkv | webm | original.
    pub video_container: String,
    /// Azami çözünürlük (0 = en iyi, -1 = ses m4a, -2 = ses mp3).
    pub video_max_height: i32,
    /// Güncellemeleri otomatik denetle.
    pub check_for_updates: bool,
    /// Uygulamayı tepki simgesinde (pencere açmadan) başlat.
    pub start_in_tray: bool,
    /// Pencere kapatılnca uygulamayı arka planda tut.
    pub close_to_tray: bool,
    /// Windows oturum açılışında çalıştır.
    pub autostart: bool,
    /// yt-dlp deno kurulum sorusu bir daha sorulmasın.
    pub deno_prompt_suppressed: bool,
    /// Son güncelleme denetimi (RFC 3339).
    pub last_update_check: Option<String>,
    /// Kullanıcının atladığı sürüm.
    pub skipped_update_version: Option<String>,
}

/// Azami kanal sayısı — motorla aynı sınır.
pub const MAX_CHANNELS: u32 = 32;

/// Seçilebilir çözünürlükler (MC'nin "Maximum resolution" seçicisiyle aynı).
///
/// `0` = en iyi, `-1` = yalnızca ses (m4a), `-2` = yalnızca ses (mp3).
pub const VIDEO_MAX_HEIGHTS: &[i32] = &[-2, -1, 0, 360, 480, 720, 1080, 1440, 2160];

/// Azami eşzamanlı indirme sayısı (MC: 1...10).
pub const MAX_CONCURRENT: u32 = 10;

/// Köprü portu aralığı.
pub const MIN_PORT: u16 = 1024;
pub const MAX_PORT: u16 = 65535;

impl Default for Settings {
    fn default() -> Self {
        Self {
            lang: Lang::Tr,
            default_channel_count: 8,
            video_dir: None,
            audio_dir: None,
            other_dir: None,
            default_dir: default_download_dir(),
            server_port: 48213,
            max_concurrent: 3,
            auto_start: true,
            notify_on_complete: true,
            show_detail_on_start: true,
            auto_close_detail: false,
            watch_clipboard: true,
            capture_group_ids: crate::capture::DEFAULT_GROUPS
                .iter()
                .map(|s| (*s).to_string())
                .collect(),
            custom_extensions: String::new(),
            organize_by_category: true,
            ytdlp_path: String::new(),
            video_format: String::new(),
            video_container: "mp4".to_string(),
            video_max_height: 1080,
            check_for_updates: true,
            start_in_tray: false,
            close_to_tray: true,
            autostart: false,
            deno_prompt_suppressed: false,
            last_update_check: None,
            skipped_update_version: None,
        }
    }
}

impl Settings {
    /// Kanal sayısını ve klasör alanlarını geçerli aralığa indirger.
    ///
    /// Arayüzden gelen değerler doğrulanmadan kabul edilmez: boş klasör
    /// `None` olur, kanal sayısı 1..=32 aralığına sıkıştırılır.
    pub fn normalize(&mut self) {
        self.default_channel_count = self.default_channel_count.clamp(1, MAX_CHANNELS);
        self.default_dir = clean_dir(&self.default_dir).unwrap_or_else(default_download_dir);
        self.server_port = self.server_port.clamp(MIN_PORT, MAX_PORT);
        self.max_concurrent = self.max_concurrent.clamp(1, MAX_CONCURRENT);
        self.ytdlp_path = self.ytdlp_path.trim().to_string();
        self.custom_extensions = self.custom_extensions.trim().to_string();
        self.video_container = match self.video_container.as_str() {
            "mkv" | "webm" | "original" => self.video_container.clone(),
            _ => "mp4".to_string(),
        };
        // Yalnızca seçicideki değerler geçerlidir; aksi halde 1080p'ye dönülür.
        if !VIDEO_MAX_HEIGHTS.contains(&self.video_max_height) {
            self.video_max_height = 1080;
        }

        // Yalnızca bilinen gruplar tutulur.
        self.capture_group_ids
            .retain(|g| crate::capture::GROUPS.iter().any(|(name, _)| name == g));

        for dir in [
            &mut self.video_dir,
            &mut self.audio_dir,
            &mut self.other_dir,
        ] {
            *dir = dir.as_deref().and_then(clean_dir);
        }
    }

    /// Kategorinin hedef klasörü (boşsa genel hedefe düşer).
    pub fn dir_for(&self, category: Category) -> &Path {
        let candidate = match category {
            Category::Video => self.video_dir.as_deref(),
            Category::Audio => self.audio_dir.as_deref(),
            Category::Other => self.other_dir.as_deref(),
            Category::Default => None,
        };

        match candidate {
            Some(dir) => dir,
            None => self.default_dir.as_path(),
        }
    }

    /// Dosya adına göre hedef klasör.
    pub fn resolve_dir(&self, file_name: &str) -> PathBuf {
        self.dir_for(classify(file_name)).to_path_buf()
    }

    /// Dosya adına göre tam hedef yol (klasör + dosya adı).
    pub fn resolve_target(&self, file_name: &str) -> PathBuf {
        self.resolve_dir(file_name).join(file_name)
    }

    // -----------------------------------------------------------------
    // MC portu: kategori klasörleme
    // -----------------------------------------------------------------

    /// MC kategorisine karşılık gelen temel klasör.
    ///
    /// MC'nin yedi kategorisi ADM'nin üç klasör ayarına eşlenir:
    /// video → video_dir, müzik → audio_dir, görsel/belge/arşiv/uygulama →
    /// other_dir, diğer → default_dir.
    pub fn dir_for_mc_category(&self, category: crate::categories::Category) -> &Path {
        use crate::categories::Category as C;
        let candidate = match category {
            C::Video => self.video_dir.as_deref(),
            C::Music => self.audio_dir.as_deref(),
            C::Image | C::Document | C::Compressed | C::Apps => self.other_dir.as_deref(),
            C::Other => None,
        };
        candidate.unwrap_or(self.default_dir.as_path())
    }

    /// MC kategorisine göre hedef klasör; `organize_by_category` açıksa
    /// kategori alt klasörü eklenir (MC `destinationDirectory`).
    pub fn resolve_dir_named(&self, file_name: &str) -> PathBuf {
        let category = crate::categories::Category::detect(file_name);
        let base = self.dir_for_mc_category(category);
        if self.organize_by_category {
            base.join(category.folder_label())
        } else {
            base.to_path_buf()
        }
    }

    /// MC kategorisine göre tam hedef yol.
    pub fn resolve_target_named(&self, file_name: &str) -> PathBuf {
        self.resolve_dir_named(file_name).join(file_name)
    }

    // -----------------------------------------------------------------
    // MC portu: yt-dlp biçim argümanları
    // -----------------------------------------------------------------

    /// Seçilen biçim/çözünürlüğe göre yt-dlp argümanları
    /// (MC `AppSettings.ytdlpFormatArguments`).
    pub fn ytdlp_format_arguments(&self) -> Vec<String> {
        let custom = self.video_format.trim();
        if !custom.is_empty() {
            let container = if self.video_container == "original" {
                "mkv"
            } else {
                self.video_container.as_str()
            };
            return vec![
                "-f".to_string(),
                custom.to_string(),
                "--merge-output-format".to_string(),
                container.to_string(),
            ];
        }
        if self.video_max_height == -1 {
            return vec![
                "-f".to_string(),
                "ba/b".to_string(),
                "-x".to_string(),
                "--audio-format".to_string(),
                "m4a".to_string(),
                "--audio-quality".to_string(),
                "0".to_string(),
            ];
        }
        if self.video_max_height == -2 {
            return vec![
                "-f".to_string(),
                "ba/b".to_string(),
                "-x".to_string(),
                "--audio-format".to_string(),
                "mp3".to_string(),
                "--audio-quality".to_string(),
                "0".to_string(),
            ];
        }

        let h = if self.video_max_height > 0 {
            format!("[height<={}]", self.video_max_height)
        } else {
            String::new()
        };
        let mut expr;
        let mut args: Vec<String> = Vec::new();
        match self.video_container.as_str() {
            "mp4" => {
                // H.264 + AAC tercih edilir (QuickTime/iOS uyumlu); olmazsa
                // birleştirilip mp4'e çevrilir.
                expr = format!(
                    "bv*{h}[vcodec^=avc1]+ba[acodec^=mp4a]/bv*{h}[ext=mp4]+ba[ext=m4a]/bv*{h}+ba/b{h}/b"
                );
                args.push("--merge-output-format".to_string());
                args.push("mp4".to_string());
                args.push("--remux-video".to_string());
                args.push("mp4".to_string());
            }
            "webm" => {
                expr = format!("bv*{h}[ext=webm]+ba[ext=webm]/bv*{h}+ba/b{h}/b");
                args.push("--merge-output-format".to_string());
                args.push("webm".to_string());
            }
            "mkv" => {
                expr = format!("bv*{h}+ba/b{h}/b");
                args.push("--merge-output-format".to_string());
                args.push("mkv".to_string());
            }
            _ => {
                expr = format!("bv*{h}+ba/b{h}/b");
            }
        }
        let mut out = vec!["-f".to_string(), std::mem::take(&mut expr)];
        out.extend(args);
        out
    }
}

/// Boş / yalnızca boşluk içeren yol metnini temizler; dolu olanı korur.
fn clean_dir(path: &Path) -> Option<PathBuf> {
    let text = path.to_string_lossy().trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(PathBuf::from(text))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> Settings {
        Settings {
            default_dir: PathBuf::from("C:/Downloads"),
            ..Settings::default()
        }
    }

    #[test]
    fn video_uzantilari_video_kategorisine_duser() {
        for name in [
            "film.mp4",
            "kayit.MKV",
            "klip.webm",
            "video.mov",
            "yayin.ts",
        ] {
            assert_eq!(classify(name), Category::Video, "{name}");
        }
    }

    #[test]
    fn ses_uzantilari_audio_kategorisine_duser() {
        for name in [
            "parca.mp3",
            "kayit.FLAC",
            "ses.m4a",
            "tema.opus",
            "vokal.wav",
        ] {
            assert_eq!(classify(name), Category::Audio, "{name}");
        }
    }

    #[test]
    fn arsiv_ve_kurulum_dosyalari_other_kategorisine_duser() {
        for name in [
            "arsiv.zip",
            "kurulum.exe",
            "disk.iso",
            "kitap.epub",
            "yedek.7z",
        ] {
            assert_eq!(classify(name), Category::Other, "{name}");
        }
    }

    #[test]
    fn eslesmeyen_uzanti_genel_kategoriye_duser() {
        for name in ["veri.xyz", "rapor", "notlar.txt", "bilinmeyen.qqq"] {
            assert_eq!(classify(name), Category::Default, "{name}");
        }
    }

    #[test]
    fn gizli_dosya_uzanti_sayilmaz() {
        // ".mp4" gizli bir dosyadır; uzantısı yok sayılır.
        assert_eq!(classify(".mp4"), Category::Default);
        assert_eq!(classify(".."), Category::Default);
        assert_eq!(classify("son."), Category::Default);
    }

    #[test]
    fn cok_lu_uzanti_son_parca_yogunlugu_esnas_belirler() {
        // `kaynak.tar.gz` -> `gz` -> Diğer
        assert_eq!(classify("kaynak.tar.gz"), Category::Other);
    }

    #[test]
    fn konumlar_kategoriye_gore_cozulur() {
        let s = Settings {
            video_dir: Some(PathBuf::from("C:/Video")),
            audio_dir: Some(PathBuf::from("C:/Muzik")),
            other_dir: Some(PathBuf::from("C:/Diger")),
            ..settings()
        };

        assert_eq!(s.resolve_dir("film.mp4"), PathBuf::from("C:/Video"));
        assert_eq!(s.resolve_dir("parca.mp3"), PathBuf::from("C:/Muzik"));
        assert_eq!(s.resolve_dir("arsiv.zip"), PathBuf::from("C:/Diger"));
        assert_eq!(s.resolve_dir("rapor.txt"), PathBuf::from("C:/Downloads"));
    }

    #[test]
    fn bos_kategori_genel_hedefe_duser() {
        let s = Settings {
            video_dir: Some(PathBuf::from("C:/Video")),
            ..settings()
        };
        assert_eq!(s.resolve_dir("film.mp4"), PathBuf::from("C:/Video"));
        assert_eq!(s.resolve_dir("parca.mp3"), PathBuf::from("C:/Downloads"));
        assert_eq!(s.resolve_dir("arsiv.zip"), PathBuf::from("C:/Downloads"));
    }

    #[test]
    fn tam_hedef_klasoru_dosya_adini_icerir() {
        let s = Settings {
            video_dir: Some(PathBuf::from("C:/Video")),
            ..settings()
        };
        assert_eq!(
            s.resolve_target("film.mp4"),
            PathBuf::from("C:/Video").join("film.mp4")
        );
    }

    #[test]
    fn normalize_kanal_sayisini_sikistirir() {
        let mut s = settings();
        s.default_channel_count = 999;
        s.normalize();
        assert_eq!(s.default_channel_count, MAX_CHANNELS);

        s.default_channel_count = 0;
        s.normalize();
        assert_eq!(s.default_channel_count, 1);
    }

    #[test]
    fn normalize_bos_klasorleri_none_yapar() {
        let mut s = Settings {
            video_dir: Some(PathBuf::from("   ")),
            audio_dir: Some(PathBuf::from("")),
            default_dir: PathBuf::from("   "),
            ..settings()
        };
        s.normalize();

        assert_eq!(s.video_dir, None);
        assert_eq!(s.audio_dir, None);
        // Genel hedef boşsa kullanıcının İndirilenler klasörüne döner.
        assert_eq!(s.default_dir, default_download_dir());
    }

    #[test]
    fn varsayilan_genel_hedef_indirilenler_klasoru() {
        assert_eq!(Settings::default().default_dir, default_download_dir());
    }

    // -----------------------------------------------------------------
    // MC portu ayarları
    // -----------------------------------------------------------------

    #[test]
    fn mc_kategorilere_gore_klasor_eslesmesi() {
        let s = Settings {
            video_dir: Some(PathBuf::from("C:/Video")),
            audio_dir: Some(PathBuf::from("C:/Muzik")),
            other_dir: Some(PathBuf::from("C:/Diger")),
            ..settings()
        };
        // Video → video_dir, müzik → audio_dir, arşiv → other_dir.
        assert_eq!(
            s.resolve_dir_named("film.mp4"),
            PathBuf::from("C:/Video/Video")
        );
        assert_eq!(
            s.resolve_dir_named("parca.mp3"),
            PathBuf::from("C:/Muzik/Music")
        );
        assert_eq!(
            s.resolve_dir_named("arsiv.zip"),
            PathBuf::from("C:/Diger/Archives")
        );
    }

    #[test]
    fn organize_kapaliyse_alt_klasor_eklenmez() {
        let s = Settings {
            organize_by_category: false,
            video_dir: Some(PathBuf::from("C:/Video")),
            ..settings()
        };
        assert_eq!(s.resolve_dir_named("film.mp4"), PathBuf::from("C:/Video"));
    }

    #[test]
    fn normalize_yeni_alanlari_sikistirir() {
        let mut s = Settings {
            server_port: 80, // 1024'ün altı
            max_concurrent: 0,
            video_max_height: 999,
            video_container: "bogus".to_string(),
            capture_group_ids: vec!["tanimsiz".to_string()],
            ..Settings::default()
        };
        s.normalize();

        assert_eq!(s.server_port, MIN_PORT);
        assert_eq!(s.max_concurrent, 1);
        assert_eq!(s.video_max_height, 1080);
        assert_eq!(s.video_container, "mp4");
        assert!(!s.capture_group_ids.contains(&"tanimsiz".to_string()));
    }

    #[test]
    fn ytdlp_format_argumanlari() {
        let mut s = Settings::default();
        // Varsayılan: mp4, 1080p.
        let args = s.ytdlp_format_arguments();
        assert_eq!(args[0], "-f");
        assert!(args[1].contains("[height<=1080]"));
        assert!(args.contains(&"--merge-output-format".to_string()));

        // Özel ifade seçicileri geçersiz kılar.
        s.video_format = "bv*+ba".to_string();
        let custom = s.ytdlp_format_arguments();
        assert_eq!(custom[1], "bv*+ba");

        // Yalnızca ses.
        s.video_format.clear();
        s.video_max_height = -2;
        let audio = s.ytdlp_format_arguments();
        assert!(audio.contains(&"mp3".to_string()));
    }
}
