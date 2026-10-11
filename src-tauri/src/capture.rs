//! Yakalanacak dosya türleri — MC `CaptureTypes` portu.
//!
//! Tarayıcıdan gelen indirmeler ve panoya kopyalanan bağlantılar yalnızca
//! bu uzantılarla eşleşiyorsa uygulamaya devredilir.
//!
//! MC'deki `captureGroupIDs` + `customExtensions` ikilisinin karşılığıdır.

use crate::categories::Category;

/// Hazır uzantı grupları.
pub const GROUPS: &[(&str, &[&str])] = &[
    (
        "image",
        &[
            "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "ico", "heic", "tiff",
        ],
    ),
    (
        "music",
        &[
            "mp3", "flac", "wav", "aac", "ogg", "opus", "m4a", "wma", "aiff", "alac",
        ],
    ),
    (
        "video",
        &[
            "mp4", "mkv", "webm", "mov", "avi", "wmv", "flv", "m4v", "3gp", "ts",
        ],
    ),
    (
        "apps",
        &[
            "exe", "msi", "dmg", "pkg", "apk", "deb", "rpm", "appimage", "jar", "xpi",
        ],
    ),
    (
        "document",
        &[
            "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "epub", "mobi", "csv",
        ],
    ),
    (
        "compressed",
        &[
            "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "iso", "img",
        ],
    ),
];

/// Varsayılan olarak etkin gruplar (MC `defaultGroupIDs`).
pub const DEFAULT_GROUPS: &[&str] = &["music", "video", "apps", "document", "compressed"];

/// Seçili gruplar + özel listeden tüm uzantıları çıkarır (küçük harf, noktasız).
pub fn extensions(group_ids: &[String], custom: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for (name, exts) in GROUPS {
        if group_ids.iter().any(|g| g == name) {
            for e in *exts {
                if !out.iter().any(|x| x == e) {
                    out.push((*e).to_string());
                }
            }
        }
    }
    for part in custom.split([',', ';', ' ', '\n', '\r', '\t']) {
        let e = part.trim().trim_start_matches('.').to_ascii_lowercase();
        if !e.is_empty()
            && e.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            && !out.contains(&e)
        {
            out.push(e);
        }
    }
    out.sort();
    out
}

/// URL'in eklentisi listeyle eşleşiyor mu? Liste boşsa her şey eşleşir.
pub fn matches(url: &str, extensions: &[String]) -> bool {
    if extensions.is_empty() {
        return true;
    }
    let Some(ext) = extension_of_url(url) else {
        return false;
    };
    extensions.iter().any(|e| e.eq_ignore_ascii_case(ext))
}

/// URL yolundan dosya adı uzantısı (`?x=1` sorgusunu yok sayar).
fn extension_of_url(url: &str) -> Option<&str> {
    let without_query = url.split(['?', '#']).next().unwrap_or(url);
    let last = without_query.rsplit('/').find(|s| !s.is_empty())?;
    let (stem, ext) = last.rsplit_once('.')?;
    if stem.is_empty() || ext.is_empty() {
        return None;
    }
    // Uzantı yalnızca kısa alfanümerik olabilir (`mp4?x=1` sorgusu zaten atıldı).
    if ext.len() > 8 || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    Some(ext)
}

/// Uzantı grubunun kullanıcıya gösterilen etiketi.
pub fn group_label(group: &str) -> &'static str {
    match group {
        "image" => "capture.image",
        "music" => "capture.music",
        "video" => "capture.video",
        "apps" => "capture.apps",
        "document" => "capture.document",
        "compressed" => "capture.compressed",
        _ => "capture.unknown",
    }
}

/// Bağlantının bir video sayfası gibi görünüp görünmediğini tahmin eder
/// (pano sorması için): host bilinen video sitelerinden biri ve yol bir
/// dosya uzantısı taşımıyor.
pub fn looks_like_video_page(url: &str) -> bool {
    const VIDEO_HOSTS: &[&str] = &[
        "youtube.com",
        "youtu.be",
        "vimeo.com",
        "dailymotion.com",
        "twitter.com",
        "x.com",
        "instagram.com",
        "tiktok.com",
        "twitch.tv",
        "facebook.com",
        "reddit.com",
        "bilibili.com",
    ];

    let host = url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(url)
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();

    let path = url
        .split_once("://")
        .map(|(_, rest)| rest)
        .and_then(|rest| rest.find('/').map(|i| &rest[i..]))
        .unwrap_or("");

    // Yol bir dosya uzantısı taşıyorsa bu bir video sayfası değil, dosyadır.
    if let Some(last) = path.rsplit('/').find(|s| !s.is_empty())
        && Category::detect(last) != Category::Other
    {
        return false;
    }

    VIDEO_HOSTS
        .iter()
        .any(|h| host == *h || host.ends_with(&format!(".{h}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn groups(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn grup_uzantilari_birlesir() {
        let exts = extensions(&groups(&["video", "music"]), "");
        assert!(exts.contains(&"mp4".to_string()));
        assert!(exts.contains(&"mp3".to_string()));
        assert!(!exts.contains(&"pdf".to_string()));
    }

    #[test]
    fn ozel_liste_noktasiz_kucuk_harf() {
        let exts = extensions(&groups(&[]), "  .MKV , iso , ");
        assert_eq!(exts, vec!["iso".to_string(), "mkv".to_string()]);
    }

    #[test]
    fn bos_liste_her_seyi_esler() {
        assert!(matches("https://x.tld/dosya.xyz", &[]));
    }

    #[test]
    fn url_uzantisi_eslesir() {
        let exts = extensions(&groups(&["compressed"]), "");
        assert!(matches("https://x.tld/a/b.7z?token=1", &exts));
        assert!(matches("https://x.tld/a/b.ZIP", &exts));
        assert!(!matches("https://x.tld/a/b.7zz", &exts));
        assert!(!matches("https://x.tld/indir", &exts));
    }

    #[test]
    fn video_sayfasi_tahmini() {
        assert!(looks_like_video_page("https://www.youtube.com/watch?v=abc"));
        assert!(looks_like_video_page("https://vimeo.com/123456"));
        assert!(!looks_like_video_page("https://www.youtube.com/film.mp4"));
        assert!(!looks_like_video_page("https://ornek.tld/sayfa"));
    }

    #[test]
    fn uzanti_buyuk_kucuk_harf_duyarsiz() {
        let exts = extensions(&groups(&["video"]), "");
        // Liste küçük harftir; URL büyük harfli uzantı taşıyabilir.
        assert!(matches("https://x.tld/FILM.MP4", &exts));
        assert!(matches("https://x.tld/Film.Mp4", &exts));
        // Sorgu dizesi ve çapa yok sayılır.
        assert!(matches("https://x.tld/a.mkv?token=abc#x", &exts));
    }

    #[test]
    fn uzantisiz_ve_gecersiz_uzantilar_eslesmez() {
        let exts = extensions(&groups(&["compressed"]), "");
        assert!(!matches("https://x.tld/indir", &exts), "uzantı yok");
        assert!(!matches("https://x.tld/", &exts), "yalnızca kök");
        assert!(!matches("https://x.tld/a.", &exts), "boş uzantı");
        assert!(!matches("https://x.tld/a.toolongext", &exts), "8'den uzun");
        // Uzantı alfanümerik olmalı.
        assert!(!matches("https://x.tld/a.z-p", &exts), "tire uzantı sayılmaz");
    }

    #[test]
    fn ozel_uzanti_gecersiz_girdileri_atar() {
        // Nokta temizlenir, boşluklar kırpılır, geçersiz karakterli
        // parçalar (yol, boşluk) atlanır.
        let exts = extensions(&groups(&[]), ".MP4; , zip , a/b , , 7z");
        assert_eq!(
            exts,
            vec!["7z".to_string(), "mp4".to_string(), "zip".to_string()]
        );
    }

    #[test]
    fn varsayilan_gruplar_resim_icermez() {
        // MC `defaultGroupIDs`: resim grubu varsayılan olarak kapalıdır
        // (tarayıcı her küçük görseli ADM'ye devretmesin).
        assert!(!DEFAULT_GROUPS.contains(&"image"));
        for g in ["music", "video", "apps", "document", "compressed"] {
            assert!(DEFAULT_GROUPS.contains(&g), "{g} varsayılan olmalı");
        }
    }

    #[test]
    fn grup_etiketi_i18n_anahtari_dondurur() {
        assert_eq!(group_label("video"), "capture.video");
        assert_eq!(group_label("bilinmeyen"), "capture.unknown");
    }
}
