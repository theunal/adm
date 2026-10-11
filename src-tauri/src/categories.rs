//! Dosya kategorileri — MC Download Manager'daki `FileCategory` portu.
//!
//! Kenar çubuğu filtreleri, "kategoriye göre klasörleme" ve eklentiye
//! gönderilen yakalama uzantıları bu taksonomiyi paylaşır.
//!
//! Not: ADM'nin kendi hedef klasörü çözümü (`settings::Category`) ayrıdır;
//! buradaki kategori kenar çubuğu ve klasörleme etiketi içindir.
//! `settings::resolve_dir` MC kategorisini mevcut klasör ayarlarına eşler.

use serde::{Deserialize, Serialize};

/// MC'nin yedi kategorisi.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Image,
    Music,
    Video,
    Apps,
    Document,
    Compressed,
    Other,
}

impl Category {
    /// Veritabanına/ayarlara yazılan kısa ad.
    pub fn as_str(self) -> &'static str {
        match self {
            Category::Image => "image",
            Category::Music => "music",
            Category::Video => "video",
            Category::Apps => "apps",
            Category::Document => "document",
            Category::Compressed => "compressed",
            Category::Other => "other",
        }
    }

    /// Kısa addan kategori çevirir.
    pub fn parse(raw: &str) -> Self {
        match raw {
            "image" => Category::Image,
            "music" => Category::Music,
            "video" => Category::Video,
            "apps" => Category::Apps,
            "document" => Category::Document,
            "compressed" => Category::Compressed,
            _ => Category::Other,
        }
    }

    /// Kenar çubuğunda gösterilecek ad (arayüzde çeviri katmanından geçer).
    pub fn label_key(self) -> &'static str {
        match self {
            Category::Image => "cat.image",
            Category::Music => "cat.music",
            Category::Video => "cat.video",
            Category::Apps => "cat.apps",
            Category::Document => "cat.document",
            Category::Compressed => "cat.compressed",
            Category::Other => "cat.other",
        }
    }

    /// Klasörleme etiketi (ayar kapalıyken bile kullanıcıya görülen ad).
    pub fn folder_label(self) -> &'static str {
        match self {
            Category::Image => "Images",
            Category::Music => "Music",
            Category::Video => "Video",
            Category::Apps => "Apps",
            Category::Document => "Documents",
            Category::Compressed => "Archives",
            Category::Other => "Other",
        }
    }

    /// Tüm kategoriler (kenar çubuğu sırası).
    pub fn all() -> [Category; 7] {
        [
            Category::Image,
            Category::Music,
            Category::Video,
            Category::Apps,
            Category::Document,
            Category::Compressed,
            Category::Other,
        ]
    }

    /// Dosya adına göre kategori (uzantı tablosuyla).
    pub fn detect(file_name: &str) -> Self {
        let ext = extension_of(file_name);
        let Some(ext) = ext else {
            return Category::Other;
        };
        let ext = ext.to_ascii_lowercase();
        for (cat, exts) in TABLE {
            if exts.contains(&ext.as_str()) {
                return *cat;
            }
        }
        Category::Other
    }
}

/// Uzantı tablosu — MC `FileCategory.table` portu.
const TABLE: &[(Category, &[&str])] = &[
    (
        Category::Image,
        &[
            "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tiff", "tif", "svg",
            "psd", "ai", "raw", "cr2", "nef", "ico",
        ],
    ),
    (
        Category::Music,
        &[
            "mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "wma", "aiff", "alac",
        ],
    ),
    (
        Category::Video,
        &[
            "mp4", "m4v", "mkv", "webm", "mov", "avi", "flv", "wmv", "mpg", "mpeg", "ts", "m3u8",
            "3gp",
        ],
    ),
    (
        Category::Apps,
        &[
            "dmg", "pkg", "app", "exe", "msi", "apk", "ipa", "deb", "rpm", "appimage", "jar",
            "xpi", "crx",
        ],
    ),
    (
        Category::Document,
        &[
            "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "odt", "ods", "odp",
            "epub", "mobi", "csv", "md", "pages", "numbers", "key",
        ],
    ),
    (
        Category::Compressed,
        &[
            "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst", "iso", "img", "cab",
        ],
    ),
];

/// Son `.`dan sonraki uzantı; noktasız/gizli adlarda `None`.
fn extension_of(file_name: &str) -> Option<&str> {
    let (stem, ext) = file_name.rsplit_once('.')?;
    if stem.is_empty() || stem.ends_with(['/', '\\']) || ext.is_empty() {
        return None;
    }
    Some(ext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kategori_uzantidan_algilanir() {
        assert_eq!(Category::detect("film.mp4"), Category::Video);
        assert_eq!(Category::detect("parca.FLAC"), Category::Music);
        assert_eq!(Category::detect("kurulum.exe"), Category::Apps);
        assert_eq!(Category::detect("arsiv.zip"), Category::Compressed);
        assert_eq!(Category::detect("rapor.pdf"), Category::Document);
        assert_eq!(Category::detect("foto.webp"), Category::Image);
        assert_eq!(Category::detect("bilinmeyen.qqq"), Category::Other);
        assert_eq!(Category::detect("rapor"), Category::Other);
    }

    #[test]
    fn kategori_kisa_ad_yuvarlanir() {
        for c in Category::all() {
            assert_eq!(Category::parse(c.as_str()), c);
        }
        assert_eq!(Category::parse("bogus"), Category::Other);
    }

    #[test]
    fn klasor_etikleri_benzersiz() {
        let labels: Vec<&str> = Category::all().iter().map(|c| c.folder_label()).collect();
        let unique: std::collections::HashSet<&str> = labels.iter().copied().collect();
        assert_eq!(labels.len(), unique.len());
    }
}
