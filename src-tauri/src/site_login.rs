//! Site girişi — MC `SiteLoginManager` portu (dosya katmanı).
//!
//! Uygulama içi giriş penceresinde (WebView2) oturum açan kullanıcının
//! çerezleri Netscape biçiminde bir dosyaya yazılır; video indirmelerinde
//! yt-dlp'ye bu dosya verilir. Pencere yönetimi arayüze/komut katmanına
//! aittir; burada yalnızca dosya ve durum mantığı vardır.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Paylaşılan çerez dosyası: `%LOCALAPPDATA%\ADM\cookies\sites.txt`.
pub fn cookie_file_path() -> Option<PathBuf> {
    let path = crate::db::db_dir().join("cookies").join("sites.txt");
    path.is_file().then_some(path)
}

/// Tek bir çerez satırı (domain, flag, path, secure, expires, name, value).
///
/// Hem arayüzden (WebView2 `cookies()`), hem tarayıcı uzantısından gelen
/// gövdeden çözülür. Uzantı `expirationDate`, WebView2 `expires` adını
/// kullandığı için ikisi de kabul edilir.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieRow {
    pub domain: String,
    #[serde(default = "default_cookie_path")]
    pub path: String,
    #[serde(default)]
    pub secure: bool,
    /// Unix zamanı (saniye); `0` oturum çerezi demektir.
    #[serde(default, alias = "expires")]
    pub expiration_date: i64,
    pub name: String,
    pub value: String,
}

fn default_cookie_path() -> String {
    "/".to_string()
}

/// Netscape çerez dosyası metnini üretir (başlık satırları dahil).
pub fn render(rows: &[CookieRow]) -> String {
    let mut out = String::from("# Netscape HTTP Cookie File\n# Exported by ADM\n");
    for row in rows {
        out.push_str(&format_row(row));
    }
    out
}

/// Çerezleri verilen yola Netscape biçiminde yazar.
pub fn write_to(path: &Path, rows: &[CookieRow]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, render(rows))
}

/// `SID=abc; HSID=def` biçimindeki `Cookie:` başlığından satır üretir.
///
/// Uzantı yapılandırılmış çerez listesi göndermediyse bu yedek yol kullanılır:
/// yt-dlp'ye verilen dosya Netscape biçiminde olmak zorundadır, ham başlık
/// metni **geçersizdir**.
pub fn rows_from_header(header: &str, domain: &str) -> Vec<CookieRow> {
    header
        .split(';')
        .filter_map(|pair| {
            let (name, value) = pair.trim().split_once('=')?;
            let name = name.trim();
            if name.is_empty() {
                return None;
            }
            Some(CookieRow {
                domain: domain.to_string(),
                path: "/".to_string(),
                secure: false,
                expiration_date: 0,
                name: name.to_string(),
                value: value.trim().to_string(),
            })
        })
        .collect()
}

/// Çerezleri paylaşılan site girişi dosyasına yazar.
pub fn write_cookies(rows: &[CookieRow]) -> std::io::Result<()> {
    write_to(
        &crate::db::db_dir().join("cookies").join("sites.txt"),
        rows,
    )
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
        row.domain, flag, row.path, secure, row.expiration_date, row.name, row.value
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
            expiration_date: 0,
            name: "SID".into(),
            value: "secret".into(),
        };
        assert_eq!(
            format_row(&row),
            ".youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret\n"
        );
    }

    #[test]
    fn alan_adi_noktali_ise_flag_true() {
        let row = CookieRow {
            domain: "example.com".into(),
            path: "/a".into(),
            secure: false,
            expiration_date: 1735689600,
            name: "k".into(),
            value: "v".into(),
        };
        // Noktasız alan adı `FALSE`, `secure` kapalı.
        assert_eq!(
            format_row(&row),
            "example.com\tFALSE\t/a\tFALSE\t1735689600\tk\tv\n"
        );
    }

    #[test]
    fn ham_basliktan_satir_uretir() {
        let rows = rows_from_header("SID=abc; HSID=def;  ; =x", "youtube.com");
        assert_eq!(rows.len(), 2, "boş ad ve değersiz çift atlanır");
        assert_eq!(rows[0].name, "SID");
        assert_eq!(rows[0].value, "abc");
        assert_eq!(rows[0].domain, "youtube.com");
        assert_eq!(rows[1].name, "HSID");
    }

    #[test]
    fn render_netscape_basligi_icerir() {
        let text = render(&[]);
        assert!(text.starts_with("# Netscape HTTP Cookie File"));
    }

    #[test]
    fn uzanti_cerez_govdesi_cozulur() {
        // Tarayıcı uzantısının gönderdiği gövde (`expirationDate`).
        let json = r#"{"name":"SID","value":"x","domain":".youtube.com","path":"/","secure":true,"expirationDate":1735689600}"#;
        let row: CookieRow = serde_json::from_str(json).expect("çerez çözülemedi");
        assert_eq!(row.expiration_date, 1735689600);
        assert!(row.secure);

        // WebView2 tarafı `expires` adını kullanır; takma ad kabul edilir.
        let json = r#"{"name":"a","value":"b","domain":"x.tld","expires":7}"#;
        let row: CookieRow = serde_json::from_str(json).expect("çerez çözülemedi");
        assert_eq!(row.expiration_date, 7);
        assert_eq!(row.path, "/", "yol verilmezse kök varsayılır");
    }
}
