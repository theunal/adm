//! Site girişi — MC `SiteLoginManager` portu (dosya katmanı).
//!
//! Uygulama içi giriş penceresinde (WebView2) oturum açan kullanıcının
//! çerezleri Netscape biçiminde bir dosyaya yazılır; video indirmelerinde
//! yt-dlp'ye bu dosya verilir. Pencere yönetimi arayüze/komut katmanına
//! aittir; burada yalnızca dosya ve durum mantığı vardır.

use std::path::PathBuf;

use serde::Serialize;

/// Paylaşılan çerez dosyası: `%LOCALAPPDATA%\ADM\cookies\sites.txt`.
pub fn cookie_file_path() -> Option<PathBuf> {
    let path = crate::db::db_dir().join("cookies").join("sites.txt");
    path.is_file().then_some(path)
}

/// Cookie satırı (domain, flag, path, secure, expires, name, value).
pub struct CookieRow {
    pub domain: String,
    pub path: String,
    pub secure: bool,
    pub expires: i64,
    pub name: String,
    pub value: String,
}

/// Çerezleri Netscape dosyasına yazar (dosya yoksa oluşturur).
pub fn write_cookies(rows: &[CookieRow]) -> std::io::Result<()> {
    let path = crate::db::db_dir().join("cookies").join("sites.txt");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut out = String::from("# Netscape HTTP Cookie File\n# Exported by ADM\n");
    for row in rows {
        out.push_str(&format_row(row));
    }
    std::fs::write(&path, out)
}

/// Tek çerez satırını Netscape biçiminde üretir.
fn format_row(row: &CookieRow) -> String {
    let flag = if row.domain.starts_with('.') {
        "TRUE"
    } else {
        "FALSE"
    };
    let secure = if row.secure { "TRUE" } else { "FALSE" };
    format!(
        "{}\t{}\t{}\t{}\t{}\t{}\t{}\n",
        row.domain, flag, row.path, secure, row.expires, row.name, row.value
    )
}

/// Çerez dosyasının durumu (ayarlar ekranı için).
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LoginStatus {
    pub cookie_count: usize,
    pub saved_at: Option<String>,
    pub domains: Vec<String>,
}

/// Dosyadan çerez durumunu okur (dosya yoksa sıfır değerler).
pub fn status() -> LoginStatus {
    let Some(path) = cookie_file_path() else {
        return LoginStatus::default();
    };
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => return LoginStatus::default(),
    };
    let rows: Vec<&str> = text
        .lines()
        .filter(|l| !l.starts_with('#') && !l.is_empty())
        .collect();

    let domains: Vec<String> = {
        let mut hosts: Vec<String> = Vec::new();
        for row in &rows {
            if let Some(host) = row.split('\t').next() {
                let mut host = host.trim_start_matches('.').to_ascii_lowercase();
                // Yalnızca son iki etiket (alan.tld) tutulur.
                let parts: Vec<&str> = host.split('.').collect();
                if parts.len() >= 2 {
                    host = parts[parts.len() - 2..].join(".");
                }
                if !host.is_empty() && !hosts.contains(&host) {
                    hosts.push(host);
                }
            }
        }
        hosts.sort();
        hosts
    };

    LoginStatus {
        cookie_count: rows.len(),
        saved_at: std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| {
                t.duration_since(std::time::UNIX_EPOCH)
                    .ok()
                    .map(|d| d.as_secs().to_string())
            }),
        domains,
    }
}

/// Çerez dosyasındaki domain'ler (video sarmalayıcısı kullanır).
pub fn cookie_domains() -> Vec<String> {
    status().domains
}

/// Çerez dosyasını siler.
pub fn clear() {
    if let Some(path) = cookie_file_path() {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durum_dosya_yoksa_bos() {
        // Testler gerçek kullanıcı dizinine yazmaz; dosya yoksa sıfır döner.
        assert_eq!(status().cookie_count, 0);
    }

    #[test]
    fn netscape_satir_bicimi() {
        let row = CookieRow {
            domain: ".youtube.com".into(),
            path: "/".into(),
            secure: true,
            expires: 0,
            name: "SID".into(),
            value: "secret".into(),
        };
        assert_eq!(
            format_row(&row),
            ".youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret\n"
        );
    }
}
