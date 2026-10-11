//! Tarayıcı köprüsü — MC `LocalServer` + `ServerController` portu.
//!
//! 127.0.0.1 üzerinde dinler; yalnızca tarayıcı uzantısı kaynaklı istekleri
//! kabul eder. Güvenlik kuralları MC ile aynıdır:
//!
//! * `Origin` boş, `null` veya uzantı kaynağı değilse → 403
//! * `Origin` yoksa (Chrome'un host iznine tabi GET'lerinde) özel
//!   `X-ADM-Extension` başlığı şarttır; web sayfaları bu biçimi üretemez
//! * `Host` yalnızca yerel adres olabilir
//! * CORS başlıkları yalnızca izinli uzantı kaynaklarına gönderilir
//!   (Chrome Private Network Access preflight'i için özel başlıklar dahil)

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::i18n;

/// İstek boyutu üst sınırı (MC: 16 MB).
const MAX_REQUEST_BYTES: usize = 16 * 1024 * 1024;

/// Ayrıştırılmış HTTP isteği.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpRequest {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Yanıt.
#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub json: Value,
}

impl HttpResponse {
    pub fn json(value: Value, status: u16) -> Self {
        Self {
            status,
            json: value,
        }
    }

    pub fn ok(value: Value) -> Self {
        Self::json(value, 200)
    }

    fn error(message: &str, status: u16) -> Self {
        Self::json(json!({"ok": false, "error": message}), status)
    }

    /// Tüm yanıt metnini üretir (başlıklar dahil).
    fn to_bytes(&self, origin: Option<&str>, allowed: bool) -> Vec<u8> {
        let body = self.json.to_string();
        let reason = match self.status {
            200 => "OK",
            400 => "Bad Request",
            403 => "Forbidden",
            404 => "Not Found",
            405 => "Method Not Allowed",
            500 => "Internal Server Error",
            _ => "Error",
        };
        let mut head = format!(
            "HTTP/1.1 {} {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\n",
            self.status,
            reason,
            body.len()
        );
        if let Some(origin) = origin
            && allowed
        {
            head.push_str(&format!(
                "Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\nAccess-Control-Allow-Headers: Content-Type, X-ADM-Extension\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Allow-Local-Network: true\r\n"
            ));
        }
        head.push_str("Connection: close\r\n\r\n");
        let mut out = head.into_bytes();
        out.extend_from_slice(body.as_bytes());
        out
    }
}

/// Yalnızca uzantı kaynaklarına CORS verilir (MC `originAllowed`).
pub fn origin_allowed(origin: Option<&str>) -> bool {
    let Some(origin) = origin else {
        return false;
    };
    if origin.is_empty() || origin == "null" {
        return false;
    }
    origin.starts_with("chrome-extension://")
        || origin.starts_with("safari-web-extension://")
        || origin.starts_with("moz-extension://")
}

/// İsteğin uzantıdan gelip gelmediği (MC `extensionRequest`).
pub fn extension_request(req: &HttpRequest) -> bool {
    if origin_allowed(req.headers.get("origin").map(String::as_str)) {
        return true;
    }
    let has_header = req
        .headers
        .get("x-adm-extension")
        .map(|v| !v.is_empty())
        .unwrap_or(false);
    // Chrome, host iznine tabi GET'lerde Origin göndermez; özel başlık
    // yalnızca uzantıdan gelebilir (preflight'in Origin'i web kaynağıdır
    // ve yukarıda reddedilir).
    !req.headers.contains_key("origin") && has_header
}

/// `Host` başlığının yerel adres olup olmadığı (MC `hostAllowed`).
///
/// Kabul edilen biçimler: `127.0.0.1:<port>`, `localhost:<port>`,
/// `[::1]:<port>`. Port, ayarlardaki köprü portuyla birebir eşleşmelidir.
pub fn host_allowed(host: Option<&str>, port: u16) -> bool {
    let Some(host) = host else {
        return false;
    };
    let host = host.trim().to_ascii_lowercase();
    let want = port.to_string();
    if let Some(addr) = host.strip_prefix('[') {
        // IPv6: `[::1]:48213`
        return addr.split(']').next() == Some("::1")
            && host.rsplit(':').next() == Some(want.as_str());
    }
    let Some((addr, host_port)) = host.rsplit_once(':') else {
        // Port yoksa reddet.
        return false;
    };
    (addr == "127.0.0.1" || addr == "localhost") && host_port == want
}

/// İstekte adı geçen tarayıcı (bağlantı durumu için).
///
/// Önce uzantının kendi bildirdiği başlığa bakılır: Chrome, Edge ve Brave
/// aynı `chrome-extension://` kaynağını kullandığı için origin tek başına
/// tarayıcıyı ayırt edemez.
pub fn browser_of(req: &HttpRequest) -> String {
    if let Some(h) = req.headers.get("x-adm-extension") {
        let h = h.to_ascii_lowercase();
        if ["safari", "chrome", "brave", "edge", "firefox"].contains(&h.as_str()) {
            return h;
        }
    }
    if let Some(origin) = req.headers.get("origin") {
        if origin.starts_with("safari-web-extension://") {
            return "safari".to_string();
        }
        if origin.starts_with("chrome-extension://") {
            return "chrome".to_string();
        }
        if origin.starts_with("moz-extension://") {
            return "firefox".to_string();
        }
    }
    if let Some(q) = req.path.split('?').nth(1) {
        for pair in q.split('&') {
            let mut kv = pair.splitn(2, '=');
            if kv.next() == Some("browser")
                && let Some(v) = kv.next()
            {
                let v = v.to_ascii_lowercase();
                if ["safari", "chrome", "brave", "edge", "firefox"].contains(&v.as_str()) {
                    return v;
                }
            }
        }
    }
    "other".to_string()
}

/// HTTP isteği ayrıştırma (MC `LocalServer.parse`).
///
/// Başlık sınırı ve `Content-Length` kadar gövde geldiyse tam istek döner.
pub fn parse_http(data: &[u8]) -> Option<HttpRequest> {
    let header_end = find_subslice(data, b"\r\n\r\n")?;
    let head = std::str::from_utf8(&data[..header_end]).ok()?;
    let mut lines = head.split("\r\n");
    let req_line = lines.next()?;
    let mut parts = req_line.split(' ');
    let method = parts.next()?.to_uppercase();
    let path = parts.next()?.to_string();

    let mut headers = HashMap::new();
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
    }

    let length: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let body_start = header_end + 4;
    if data.len() < body_start + length {
        return None;
    }
    let body = String::from_utf8_lossy(&data[body_start..body_start + length]).to_string();

    Some(HttpRequest {
        method,
        path,
        headers,
        body,
    })
}

/// Bayt dizisinde alt dizi arar.
fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// Uygulama tarafı işleyici türü.
pub type RouteHandler =
    Box<dyn Fn(HttpRequest) -> Pin<Box<dyn Future<Output = HttpResponse> + Send>> + Send + Sync>;

/// Köprü sunucusu.
pub struct Bridge {
    port: u16,
    listener: TcpListener,
    handler: Arc<RouteHandler>,
}

/// Sunucuyu başlatır; dinleyen porta bağlanamazsa hata döner.
///
/// `handler` tüm yönlendirmeyi üstlenir (uygulama katmanı kurar).
pub async fn start(port: u16, handler: Arc<RouteHandler>) -> Result<Bridge, std::io::Error> {
    let listener = TcpListener::bind(("127.0.0.1", port)).await?;
    Ok(Bridge {
        port,
        listener,
        handler,
    })
}

impl Bridge {
    /// Bağlantı kabul döngüsü (sonsuz).
    pub async fn serve(self) {
        let handler = Arc::clone(&self.handler);
        loop {
            let Ok((stream, _)) = self.listener.accept().await else {
                continue;
            };
            let handler = Arc::clone(&handler);
            let port = self.port;
            tokio::spawn(async move {
                let _ = serve_connection(stream, port, handler).await;
            });
        }
    }
}

/// Tek bağlantıyı okur, yanıtlar ve kapatır.
async fn serve_connection(
    mut stream: TcpStream,
    port: u16,
    handler: Arc<RouteHandler>,
) -> Result<(), std::io::Error> {
    let mut buf: Vec<u8> = Vec::with_capacity(4096);
    let mut chunk = [0u8; 8192];

    loop {
        // Tam istek geldiyse çöz.
        if let Some(req) = parse_http(&buf) {
            // `Host` yalnızca yerel adres olabilir (DNS yeniden bağlama
            // saldırılarına karşı: uzak bir alan adı 127.0.0.1'e çözülse bile
            // `Host` başlığı o alan adını taşır ve burada reddedilir).
            if !host_allowed(req.headers.get("host").map(String::as_str), port) {
                let response = HttpResponse::error(&i18n::t("err.bridge_host", &[]), 403);
                stream.write_all(&response.to_bytes(None, false)).await?;
                stream.flush().await?;
                return Ok(());
            }

            let origin = req.headers.get("origin").cloned();
            let allowed = origin_allowed(origin.as_deref());
            let response = handler(req).await;
            stream
                .write_all(&response.to_bytes(origin.as_deref(), allowed))
                .await?;
            stream.flush().await?;
            return Ok(());
        }
        if buf.len() > MAX_REQUEST_BYTES {
            return Ok(());
        }

        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            // Bağlantı kapandı ve istek eksik.
            return Ok(());
        }
        buf.extend_from_slice(&chunk[..n]);
    }
}

/// OPTIONS preflight host formları (yardımcı).
#[allow(dead_code)]
fn local_host_forms(port: u16) -> [String; 3] {
    [
        format!("127.0.0.1:{port}"),
        format!("localhost:{port}"),
        format!("[::1]:{port}"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_kontrolu() {
        assert!(origin_allowed(Some("chrome-extension://abc")));
        assert!(origin_allowed(Some("moz-extension://abc")));
        assert!(origin_allowed(Some("safari-web-extension://abc")));
        assert!(!origin_allowed(Some("https://example.com")));
        assert!(!origin_allowed(Some("null")));
        assert!(!origin_allowed(Some("")));
        assert!(!origin_allowed(None));
    }

    #[test]
    fn uzanti_istegi_dogrulanir() {
        let mut req = HttpRequest {
            method: "POST".into(),
            path: "/download".into(),
            headers: HashMap::new(),
            body: String::new(),
        };
        assert!(!extension_request(&req), "origin yok, başlık da yok");

        req.headers
            .insert("x-adm-extension".into(), "chrome".into());
        assert!(extension_request(&req), "origin yok ama başlık var");

        req.headers.insert("origin".into(), "null".into());
        assert!(!extension_request(&req), "null origin reddedilir");

        req.headers
            .insert("origin".into(), "moz-extension://x".into());
        assert!(extension_request(&req));
    }

    #[test]
    fn host_kontrolu() {
        assert!(host_allowed(Some("127.0.0.1:48213"), 48213));
        assert!(host_allowed(Some("localhost:48213"), 48213));
        assert!(!host_allowed(Some("127.0.0.1:9999"), 48213));
        assert!(!host_allowed(Some("evil.com:48213"), 48213));
        assert!(!host_allowed(None, 48213));
    }

    #[test]
    fn tarayici_tespiti() {
        let mut headers = HashMap::new();
        headers.insert("origin".to_string(), "chrome-extension://x".to_string());
        let req = HttpRequest {
            method: "GET".into(),
            path: "/ping".into(),
            headers: headers.clone(),
            body: String::new(),
        };
        assert_eq!(browser_of(&req), "chrome");

        headers.insert("x-adm-extension".to_string(), "brave".into());
        let req = HttpRequest {
            method: "GET".into(),
            path: "/ping?browser=firefox".into(),
            headers,
            body: String::new(),
        };
        assert_eq!(browser_of(&req), "brave");
    }

    #[test]
    fn http_ayristirma() {
        let raw = b"POST /download HTTP/1.1\r\nHost: 127.0.0.1:48213\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{\"url\":\"x\"}";
        let req = parse_http(raw).expect("istek ayrıştırılamadı");
        assert_eq!(req.method, "POST");
        assert_eq!(req.path, "/download");
        assert_eq!(
            req.headers.get("host").map(String::as_str),
            Some("127.0.0.1:48213")
        );
        assert_eq!(req.body, "{\"url\":\"x\"}");
    }

    #[test]
    fn eksik_govde_none() {
        let raw = b"POST /download HTTP/1.1\r\nContent-Length: 13\r\n\r\n{\"url\"";
        assert!(parse_http(raw).is_none());
    }

    #[test]
    fn sorgu_yolu_icin_host_formlari() {
        let forms = local_host_forms(48213);
        assert!(forms.contains(&"127.0.0.1:48213".to_string()));
    }
}
