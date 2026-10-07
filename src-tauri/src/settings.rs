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
}

/// Azami kanal sayısı — motorla aynı sınır.
pub const MAX_CHANNELS: u32 = 32;

impl Default for Settings {
    fn default() -> Self {
        Self {
            lang: Lang::Tr,
            default_channel_count: 8,
            video_dir: None,
            audio_dir: None,
            other_dir: None,
            default_dir: default_download_dir(),
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
}
