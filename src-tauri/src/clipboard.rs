//! Pano izleyici — MC `ClipboardWatcher` portu.
//!
//! Sistem panosunu 1 saniyede bir yoklar; yalnızca bağlantılardan oluşan
//! içerikte ve yalnızca yakalanan dosya türlerine uyan bağlantılarda
//! kullanıcıya sorar. Sorma kararı ve indirme ekleme uygulama katmanındadır:
//! buradan `ClipboardPrompt` olayı çıkar.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::sync::mpsc;

use crate::capture;

/// Kullanıcıya sorulacak bağlantılar.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardPrompt {
    pub urls: Vec<String>,
    /// Kaynak: pano izleme mi, yapıştırma mı?
    pub source: String,
    /// Tümü video sayfası gibi görünüyorsa önce "video" seçeneği sunulur.
    pub prefer_video: bool,
}

/// İzleyiciyi başlatır.
///
/// `settings_watch` kapalıysa yoklama durur. `tx` kanalına panoya kopyalanan
/// uygun bağlantılar gönderilir.
pub fn spawn_watcher(
    tx: mpsc::UnboundedSender<ClipboardPrompt>,
    is_enabled: Arc<dyn Fn() -> bool + Send + Sync>,
    capture_extensions: Arc<dyn Fn() -> Vec<String> + Send + Sync>,
) {
    std::thread::spawn(move || {
        let mut clipboard = match arboard::Clipboard::new() {
            Ok(c) => c,
            Err(_) => return, // Pano erişimi yoksa (uzak masaüstü vb.) sessiz kal.
        };
        let mut asked: Vec<String> = Vec::new();
        let prompting = AtomicBool::new(false);

        loop {
            std::thread::sleep(Duration::from_secs(1));

            if !is_enabled() || prompting.load(Ordering::SeqCst) {
                continue;
            }

            let Ok(text) = clipboard.get_text() else {
                continue;
            };

            // Yalnızca içeriği tamamen bağlantılardan oluşuyorsa tepki ver.
            let Some(urls) = url_only_content(&text) else {
                continue;
            };
            let exts = capture_extensions();
            let matching: Vec<String> = urls
                .iter()
                .filter(|u| capture::matches(u, &exts))
                .filter(|u| !asked.contains(u))
                .cloned()
                .collect();
            if matching.is_empty() {
                continue;
            }

            asked.extend(matching.iter().cloned());
            if asked.len() > 50 {
                asked.drain(..asked.len() - 50);
            }

            prompting.store(true, Ordering::SeqCst);
            let prompt = ClipboardPrompt {
                urls: matching,
                source: "clipboard".to_string(),
                prefer_video: urls
                    .iter()
                    .all(|u| capture::looks_like_video_page(u)),
            };
            let _ = tx.send(prompt);
        }
    });
}

/// Metnin her satırı tek bir http(s) bağlantısıysa bağlantıları döner
/// (MC `urlOnlyContent`); aksi halde `None`.
pub fn url_only_content(text: &str) -> Option<Vec<String>> {
    let lines: Vec<&str> = text
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();
    if lines.is_empty() || lines.len() > 50 {
        return None;
    }
    let mut urls: Vec<String> = Vec::new();
    for line in lines {
        if line.contains(' ') {
            return None;
        }
        let url = normalize_http_url(line)?;
        if !urls.contains(&url) {
            urls.push(url);
        }
    }
    Some(urls)
}

/// Serbest metinden bağlantı çıkarır (MC `extractURLs`).
pub fn extract_urls(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for token in text.split([' ', '\n', '\r', '\t']) {
        let token = token.trim_matches(|c: char| "<>\"'()[]{},;".contains(c));
        if let Some(url) = normalize_http_url(token)
            && !out.contains(&url)
        {
            out.push(url);
        }
    }
    out
}

/// http(s) şeması ve host'u olan bir metni normalleştirir.
fn normalize_http_url(candidate: &str) -> Option<String> {
    let lower = candidate.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return None;
    }
    // Host kısmı var mı?
    let after_scheme = candidate.split_once("://").map(|(_, r)| r)?;
    let host = after_scheme.split(['/', '?', '#']).next().unwrap_or("");
    if host.is_empty() || host.contains(' ') {
        return None;
    }
    Some(candidate.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn yalnizca_baglanti_iceriği() {
        let urls = url_only_content("https://ornek.tld/a.zip\nhttps://ornek.tld/b.zip").unwrap();
        assert_eq!(urls.len(), 2);

        // Arada boşluk olan metin bağlantı değildir.
        assert!(url_only_content("bugün https://ornek.tld/a.zip indirdim").is_none());
        // http dışı şema reddedilir.
        assert!(url_only_content("ftp://ornek.tld/a.zip").is_none());
        // 50 satırdan fazla reddedilir.
        assert!(url_only_content(&"https://x.tld/a\n".repeat(51)).is_none());
    }

    #[test]
    fn serbest_metinden_baglanti() {
        let urls = extract_urls("Bak <https://ornek.tld/a.mp4> ve https://x.tld/b.txt; bitti");
        assert_eq!(urls, vec!["https://ornek.tld/a.mp4", "https://x.tld/b.txt"]);
    }
}
