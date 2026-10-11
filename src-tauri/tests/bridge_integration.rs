//! Tarayıcı köprüsü entegrasyon testleri.
//!
//! Köprü gerçek bir TCP soketi üzerinde (geçici port) çalıştırılır ve
//! güvenlik kuralları ham HTTP istekleriyle sınanır. Kurallar MC
//! `LocalServer` ile birebir aynı olmalıdır:
//!
//! * `Host` yalnızca yerel adres olabilir (DNS yeniden bağlama koruması)
//! * CORS başlıkları yalnızca izinli uzantı kaynaklarına verilir
//! * Web sayfalarından gelen istekler yanıt alır ama CORS başlığı almaz

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use adm_lib::bridge::{self, HttpRequest, HttpResponse, RouteHandler};
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// İsteği yankılayan işleyici (yol ve gövde yanıta konur).
fn yankilayici() -> Arc<RouteHandler> {
    let handler: RouteHandler = Box::new(|req: HttpRequest| {
        let yanit: Pin<Box<dyn Future<Output = HttpResponse> + Send>> = Box::pin(async move {
            HttpResponse::ok(json!({
                "ok": true,
                "path": req.path,
                "method": req.method,
                "body": req.body,
            }))
        });
        yanit
    });
    Arc::new(handler)
}

/// Geçici portta köprüyü başlatır ve arka planda sunmaya başlar.
///
/// Dönen port, `Host` başlığında kullanılması gereken gerçek porttur.
async fn kopru_baslat() -> u16 {
    let bridge = bridge::start(0, yankilayici())
        .await
        .expect("köprü geçici portta başlatılamadı");
    let port = bridge.port();
    assert_ne!(port, 0, "gerçek port atanmalıydı");
    tokio::spawn(bridge.serve());
    port
}

/// Ham bir HTTP isteği gönderir ve tüm yanıtı döner.
async fn ham_istek(port: u16, raw: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("köprüye bağlanılamadı");
    stream.write_all(raw.as_bytes()).await.expect("istek yazılamadı");
    stream.flush().await.ok();

    let mut buf = Vec::new();
    // Sunucu yanıtı yazıp bağlantıyı kapatır (`Connection: close`).
    let _ = tokio::time::timeout(Duration::from_secs(5), stream.read_to_end(&mut buf)).await;
    String::from_utf8_lossy(&buf).to_string()
}

/// Yanıtın durum kodunu ayrıştırır.
fn durum(yanit: &str) -> u16 {
    yanit
        .lines()
        .next()
        .and_then(|l| l.split(' ').nth(1))
        .and_then(|c| c.parse().ok())
        .unwrap_or(0)
}

/// Yanıt gövdesini ayrıştırır.
fn govde(yanit: &str) -> serde_json::Value {
    let idx = yanit.find("\r\n\r\n").expect("başlık sınırı yok");
    serde_json::from_str(&yanit[idx + 4..]).expect("gövde JSON değil")
}

/// Başlık var mı? (büyük/küçük harf duyarsız)
fn baslik_var(yanit: &str, ad: &str) -> bool {
    yanit
        .lines()
        .any(|l| l.to_ascii_lowercase().starts_with(&format!("{}:", ad.to_ascii_lowercase())))
}

// ---------------------------------------------------------------------
// Kabul edilen istekler
// ---------------------------------------------------------------------

#[tokio::test]
async fn uzanti_istegi_kabul_edilir_ve_cors_alir() {
    let port = kopru_baslat().await;

    // Gövde `{"url":"x"}` = 11 bayt.
    let raw = format!(
        "POST /download HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
         Origin: chrome-extension://abcdefgh\r\nContent-Type: application/json\r\n\
         Content-Length: 11\r\n\r\n{{\"url\":\"x\"}}"
    );
    let yanit = ham_istek(port, &raw).await;

    assert_eq!(durum(&yanit), 200, "yanıt: {yanit}");
    let body = govde(&yanit);
    assert_eq!(body["ok"], json!(true));
    assert_eq!(body["path"], json!("/download"));
    assert_eq!(body["method"], json!("POST"));
    assert_eq!(body["body"], json!("{\"url\":\"x\"}"));

    // CORS yalnızca izinli kaynağa verilir ve Chrome PNA preflight'i
    // için özel başlıkları içerir.
    assert!(
        yanit.contains("Access-Control-Allow-Origin: chrome-extension://abcdefgh"),
        "izinli kaynağa CORS verilmeli: {yanit}"
    );
    assert!(
        yanit.contains("Access-Control-Allow-Private-Network: true"),
        "PNA başlığı bulunmalı: {yanit}"
    );
    assert!(
        yanit.contains("Access-Control-Allow-Local-Network: true"),
        "yerel ağ başlığı bulunmalı: {yanit}"
    );
    // Yanıt önbelleğe alınmamalı ve gövde koklanmamalı.
    assert!(baslik_var(&yanit, "Cache-Control"), "Cache-Control yok");
    assert!(
        yanit.contains("X-Content-Type-Options: nosniff"),
        "nosniff bulunmalı: {yanit}"
    );
}

#[tokio::test]
async fn localhost_host_formu_kabul_edilir() {
    let port = kopru_baslat().await;
    let raw = format!(
        "GET /ping HTTP/1.1\r\nHost: localhost:{port}\r\n\
         Origin: moz-extension://xyz\r\n\r\n"
    );
    let yanit = ham_istek(port, &raw).await;

    assert_eq!(durum(&yanit), 200, "yanıt: {yanit}");
    assert_eq!(govde(&yanit)["path"], json!("/ping"));
    assert!(yanit.contains("Access-Control-Allow-Origin: moz-extension://xyz"));
}

#[tokio::test]
async fn ipv6_yerel_host_formu_kabul_edilir() {
    let port = kopru_baslat().await;
    let raw = format!("GET /ping HTTP/1.1\r\nHost: [::1]:{port}\r\n\r\n");
    let yanit = ham_istek(port, &raw).await;

    assert_eq!(durum(&yanit), 200, "IPv6 yerel adres kabul edilmeli: {yanit}");
}

// ---------------------------------------------------------------------
// Reddedilen istekler (DNS yeniden bağlama koruması)
// ---------------------------------------------------------------------

#[tokio::test]
async fn uzak_host_reddedilir() {
    let port = kopru_baslat().await;
    let raw = format!(
        "POST /download HTTP/1.1\r\nHost: evil.example.com:{port}\r\n\
         Origin: chrome-extension://abcdefgh\r\nContent-Length: 2\r\n\r\n{{}}"
    );
    let yanit = ham_istek(port, &raw).await;

    assert_eq!(durum(&yanit), 403, "uzak Host reddedilmeli: {yanit}");
    assert_eq!(govde(&yanit)["ok"], json!(false));
    // Reddedilen yanıtta CORS başlığı olmamalı.
    assert!(
        !baslik_var(&yanit, "Access-Control-Allow-Origin"),
        "reddedilen yanıtta CORS olmamalı: {yanit}"
    );
}

#[tokio::test]
async fn yanlis_portlu_host_reddedilir() {
    let port = kopru_baslat().await;
    // Yerel adres ama port uyuşmuyor.
    let raw = "GET /ping HTTP/1.1\r\nHost: 127.0.0.1:9\r\n\r\n".to_string();
    let yanit = ham_istek(port, &raw).await;

    assert_eq!(durum(&yanit), 403, "yanlış port reddedilmeli: {yanit}");
}

#[tokio::test]
async fn portsuz_host_reddedilir() {
    let port = kopru_baslat().await;
    let raw = "GET /ping HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".to_string();
    let yanit = ham_istek(port, &raw).await;

    assert_eq!(durum(&yanit), 403, "portsuz Host reddedilmeli: {yanit}");
}

#[tokio::test]
async fn host_basligi_yoksa_reddedilir() {
    let port = kopru_baslat().await;
    let raw = "GET /ping HTTP/1.1\r\n\r\n".to_string();
    let yanit = ham_istek(port, &raw).await;

    assert_eq!(durum(&yanit), 403, "Host zorunlu olmalı: {yanit}");
}

// ---------------------------------------------------------------------
// CORS kapsamı
// ---------------------------------------------------------------------

#[tokio::test]
async fn web_kaynagi_yanit_alir_ama_cors_almaz() {
    let port = kopru_baslat().await;
    // Köprü seviyesinde web kaynağı reddedilmez (uygulama katmanı
    // `extension_request` ile karar verir) ama CORS başlığı verilmez.
    let raw = format!(
        "GET /ping HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
         Origin: https://evil.example.com\r\n\r\n"
    );
    let yanit = ham_istek(port, &raw).await;

    assert_eq!(durum(&yanit), 200, "yanıt: {yanit}");
    assert!(
        !baslik_var(&yanit, "Access-Control-Allow-Origin"),
        "web kaynağına CORS verilmemeli: {yanit}"
    );
    assert!(
        !yanit.contains("Access-Control-Allow-Private-Network"),
        "PNA başlığı da verilmemeli: {yanit}"
    );
}

#[tokio::test]
async fn null_origin_cors_almaz() {
    let port = kopru_baslat().await;
    let raw = format!(
        "GET /ping HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: null\r\n\r\n"
    );
    let yanit = ham_istek(port, &raw).await;

    assert_eq!(durum(&yanit), 200);
    assert!(
        !baslik_var(&yanit, "Access-Control-Allow-Origin"),
        "`null` kaynağa CORS verilmemeli: {yanit}"
    );
}

#[tokio::test]
async fn origin_yoksa_cors_almaz() {
    let port = kopru_baslat().await;
    // Chrome host iznine tabi GET'lerde Origin göndermez; istek yanıtlanır
    // ama CORS başlığı olmaz (uzantı `X-ADM-Extension` ile doğrulanır).
    let raw = format!("GET /ping HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n");
    let yanit = ham_istek(port, &raw).await;

    assert_eq!(durum(&yanit), 200);
    assert!(!baslik_var(&yanit, "Access-Control-Allow-Origin"));
}

// ---------------------------------------------------------------------
// Eşzamanlılık ve gerçek port
// ---------------------------------------------------------------------

#[tokio::test]
async fn ayni_anda_gelen_istekler_karismaz() {
    let port = kopru_baslat().await;

    let mut handles = Vec::new();
    for i in 0..8 {
        handles.push(tokio::spawn(async move {
            let raw = format!(
                "GET /indirme/{i} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
                 Origin: chrome-extension://abc\r\n\r\n"
            );
            let yanit = ham_istek(port, &raw).await;
            (i, yanit)
        }));
    }

    for h in handles {
        let (i, yanit) = h.await.expect("görev panikledi");
        assert_eq!(durum(&yanit), 200, "istek {i}: {yanit}");
        assert_eq!(
            govde(&yanit)["path"],
            json!(format!("/indirme/{i}")),
            "istek {i} yanlış yola düştü"
        );
    }
}

#[tokio::test]
async fn ikinci_kopru_ayni_portta_baslatilamaz() {
    let port = kopru_baslat().await;

    // Aynı portu yeniden bağlamak hata vermelidir; uygulama bunu
    // "köprü zaten çalışıyor" olarak yorumlar.
    let sonuc = bridge::start(port, yankilayici()).await;
    assert!(
        sonuc.is_err(),
        "aynı port ikinci kez bağlanamamalı (çift köprü koruması)"
    );
}

#[tokio::test]
async fn govde_eksik_gelirse_yanit_verilmez() {
    let port = kopru_baslat().await;

    let mut stream = TcpStream::connect(("127.0.0.1", port))
        .await
        .expect("bağlanılamadı");
    // `Content-Length` 100 diyor ama yalnızca 2 bayt gönderiliyor.
    let raw = format!(
        "POST /download HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: 100\r\n\r\n{{}}"
    );
    stream.write_all(raw.as_bytes()).await.unwrap();
    stream.flush().await.ok();
    // Bağlantıyı kapat: sunucu eksik isteği yanıtlamadan bırakır.
    drop(stream);

    // Köprü hâlâ sağlıklı olmalı ve yeni istekleri yanıtlamalı.
    let yanit = ham_istek(
        port,
        &format!("GET /ping HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n"),
    )
    .await;
    assert_eq!(durum(&yanit), 200, "köprü ayakta kalmalı: {yanit}");
}
