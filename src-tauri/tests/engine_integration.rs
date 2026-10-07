//! Motor entegrasyon testleri.
//!
//! Yerel bir HTTP sunucusu kurulur ve motor onunla çalıştırılır; ağ
//! dışına çıkılmaz, böylece testler deterministiktir.
//!
//! Kapsanan senaryolar:
//!
//! 1. Çok kanallı indirme — dosya içeriği bayt bayt doğrulanır.
//! 2. `Range` desteği olmayan sunucu — tek kanal düşer (dosya bozulmaz).
//! 3. `Range` isteğine `200 OK` dönen sunucu — 206 kontrolü hatayı yakalar.
//! 4. Kanal bazlı devam (pause/resume) — kalan baytlar tamamlanır.
//! 5. İptal — görev durur, kısmi dosya korunur.
//! 6. İş hırsızlığı — toplam indirilen miktar şişmez.
//! 7. Yönlendirme — `Location` başlığı elle izlenir.
//! 8. 404 — Türkçe hata mesajı üretilir.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::Duration;

use adm_lib::engine::{AbortSignal, DownloadEngine, EngineError};

// ---------------------------------------------------------------------------
// Test sunucusu
// ---------------------------------------------------------------------------

/// Sunucunun `Range` başlıklarına verdiği tepki.
#[derive(Clone, Copy, PartialEq, Debug)]
enum RangeSupport {
    /// Doğru davranış: `206 Partial Content` + `Content-Range`.
    Proper,
    /// `Range` başlığını yok sayar, `200 OK` ve tüm dosyayı döner.
    /// (Yoklama isteği `bytes=0-0` olduğunda da 200 döner.)
    IgnoresRange,
    /// **Düzensiz davranış:** yoklama isteğine `206` döner (Range desteği
    /// var gibi görünür) ama asıl veri isteklerine `200 OK` ve tüm dosyayı
    /// döner. WPF sürümünde dosyayı sessizce bozan senaryo tam olarak budur.
    Flaky,
    /// `Range` desteklemez: `Accept-Ranges: none`.
    None,
}

/// Kaç baytlık veri üreteceği.
///
/// 4 MB: motor kanal başına en az 1 MB aralık planladığı için bu boyutla
/// 4 kanal planlanır (çok kanallı yazma yolu gerçekten sınanır).
const FILE_SIZE: usize = 4 * 1024 * 1024;

/// Test için basit HTTP/1.1 sunucusu.
struct TestServer {
    addr: SocketAddr,
    hits: Arc<AtomicUsize>,
    shutdown: Arc<AtomicBool>,
}

impl TestServer {
    /// Belirtilen davranışla sunucuyu başlatır.
    ///
    /// `throttle` verildiğinde her bayt yazımı arasında gecikme koyar
    /// (yavaş bağlantı taklidi — duraklatma testleri için).
    fn start(range: RangeSupport, throttle: Option<Duration>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bağlantı noktası alınamadı");
        let addr = listener.local_addr().expect("adres okunamadı");
        let hits = Arc::new(AtomicUsize::new(0));
        let shutdown = Arc::new(AtomicBool::new(false));

        let h = Arc::clone(&hits);
        let s = Arc::clone(&shutdown);

        std::thread::spawn(move || {
            listener.set_nonblocking(true).ok();
            while !s.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((stream, _)) => {
                        let h2 = Arc::clone(&h);
                        // Her bağlantı kendi iş parçacığında işlenir; kanallar
                        // eşzamanlı konuşabilsin.
                        std::thread::spawn(move || {
                            handle(stream, range, throttle, h2);
                        });
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });

        Self {
            addr,
            hits,
            shutdown,
        }
    }

    /// Sunucu kök adresi.
    fn url(&self, path: &str) -> String {
        format!("http://{}{}", self.addr, path)
    }

    /// Sunucuya yapılan istek sayısı (yönlendirme ve kanallar dahil).
    fn hits(&self) -> usize {
        self.hits.load(Ordering::SeqCst)
    }

    /// Yönlendirme hedefi (basit `/` -> `/dosya.bin` sıçraması).
    fn redirect_url(&self) -> String {
        self.url("/yonlendir")
    }

    /// 404 döndüren adres.
    fn missing_url(&self) -> String {
        self.url("/yok")
    }

    /// Dosya adresi.
    fn file_url(&self) -> String {
        self.url("/dosya.bin")
    }
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        // Dinleyiciyi kapatmak için bir bağlantı kurup kapatmak yeterli.
        let _ = TcpStream::connect_timeout(&self.addr, Duration::from_millis(200));
    }
}

/// Başlıktan `Range: bytes=a-b` aralığını ayrıştırır.
fn parse_range(headers: &str) -> Option<(u64, Option<u64>)> {
    let lower = headers.to_ascii_lowercase();
    let idx = lower.find("range: bytes=")?;
    let rest = &headers[idx + "range: bytes=".len()..];
    let end = rest.find("\r\n").unwrap_or(rest.len());
    let spec = &rest[..end];
    let mut parts = spec.splitn(2, '-');
    let start: u64 = parts.next()?.trim().parse().ok()?;
    let end_spec = parts.next().and_then(|s| s.trim().parse::<u64>().ok());
    Some((start, end_spec))
}

/// Tek bir HTTP isteğini işler.
fn handle(
    mut stream: TcpStream,
    range: RangeSupport,
    throttle: Option<Duration>,
    hits: Arc<AtomicUsize>,
) {
    hits.fetch_add(1, Ordering::SeqCst);

    stream.set_read_timeout(Some(Duration::from_secs(5))).ok();

    // İstek başlığını oku.
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            Err(_) => return,
        }
    }
    let request = String::from_utf8_lossy(&buf).to_string();
    let mut lines = request.lines();
    let Some(request_line) = lines.next() else {
        return;
    };
    let path = request_line
        .split_whitespace()
        .nth(1)
        .unwrap_or("/")
        .to_string();
    let headers: String = lines.collect::<Vec<_>>().join("\r\n");

    // Yönlendirme: `/yonlendir` -> `/dosya.bin`
    if path == "/yonlendir" {
        let body = "yönlendiriliyor";
        let response = format!(
            "HTTP/1.1 302 Found\r\nLocation: /dosya.bin\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
        return;
    }

    // 404
    if path != "/dosya.bin" {
        let body = "bulunamadi";
        let response = format!(
            "HTTP/1.1 404 Not Found\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
        return;
    }

    let requested = parse_range(&headers);

    match range {
        RangeSupport::None => {
            // Tek kanal: `Accept-Ranges: none`, `Range` yok sayılır.
            let body = test_payload();
            let response = format!(
                "HTTP/1.1 200 OK\r\nAccept-Ranges: none\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.write_all(&body);
            let _ = stream.flush();
        }
        RangeSupport::IgnoresRange => {
            // `Range` olsa bile `200 OK` ve TÜM dosya döner. Motor yoklama
            // isteğinde de 200 alacağı için tek kanala düşmeli, indirme
            // yine de doğru tamamlanmalı (dosya bozulmamalı).
            let body = test_payload();
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.write_all(&body);
            let _ = stream.flush();
        }
        RangeSupport::Flaky => {
            // Yoklama isteği `bytes=0-0` -> 206 (Range desteği var gibi).
            let is_probe = matches!(requested, Some((0, Some(0))));
            if is_probe {
                let response = format!(
                    "HTTP/1.1 206 Partial Content\r\nAccept-Ranges: bytes\r\n\
                     Content-Range: bytes 0-0/{}\r\nContent-Length: 1\r\n\
                     Connection: close\r\n\r\nx",
                    FILE_SIZE
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
                return;
            }

            // Asıl veri isteği: 206 değil 200 + TÜM dosya döner.
            let body = test_payload();
            let response = format!(
                "HTTP/1.1 200 OK\r\nAccept-Ranges: bytes\r\nContent-Length: {}\r\n\
                 Connection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.write_all(&body);
            let _ = stream.flush();
        }
        RangeSupport::Proper => match requested {
            Some((start, end_opt)) => {
                let start = start as usize;
                if start >= FILE_SIZE {
                    let response = "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */\
                         3072000\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();
                    return;
                }

                let end = end_opt
                    .map(|e| e as usize)
                    .unwrap_or(FILE_SIZE - 1)
                    .min(FILE_SIZE - 1);

                let body = test_payload();
                let slice = &body[start..=end];

                let response = format!(
                    "HTTP/1.1 206 Partial Content\r\nAccept-Ranges: bytes\r\n\
                     Content-Range: bytes {}-{}/{}\r\nContent-Length: {}\r\n\
                     Connection: close\r\n\r\n",
                    start,
                    end,
                    FILE_SIZE,
                    slice.len()
                );
                let _ = stream.write_all(response.as_bytes());
                if let Some(delay) = throttle {
                    // Baytları küçük parçalar halinde, aralarda bekleterek
                    // yaz: istemcinin iptal/pause testi yapabilmesi sağlanır.
                    for piece in slice.chunks(64 * 1024) {
                        if stream.write_all(piece).is_err() {
                            return;
                        }
                        let _ = stream.flush();
                        std::thread::sleep(delay);
                    }
                } else {
                    let _ = stream.write_all(slice);
                }
                let _ = stream.flush();
            }
            None => {
                let body = test_payload();
                let response = format!(
                    "HTTP/1.1 200 OK\r\nAccept-Ranges: bytes\r\nContent-Length: {}\r\n\
                     Connection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.write_all(&body);
                let _ = stream.flush();
            }
        },
    }
}

/// Test verisi: konumu (bayt indeksi) belirlenebilir, deterministik desen.
///
/// `byte % 251` kullanılır: 251 asal olduğu için ardışık baytlar birbirini
/// tekrar etmez ve kanal sınırlarında karışma kolayca yakalanır.
fn test_payload() -> Vec<u8> {
    (0..FILE_SIZE).map(|i| (i % 251) as u8).collect()
}

/// Test dosya yolu.
fn temp_path(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("adm_engine_tests");
    std::fs::create_dir_all(&dir).expect("test dizini oluşturulamadı");
    let path = dir.join(name);
    let _ = std::fs::remove_file(&path);
    path
}

/// Toplanan ilerleme örnekleri: `(indirilen, toplam)`.
type ProgressLog = Arc<std::sync::Mutex<Vec<(u64, u64)>>>;

/// İlerleme olaylarını toplayan kanca.
fn recorder() -> (ProgressLog, adm_lib::engine::ProgressHook) {
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    let hook: adm_lib::engine::ProgressHook = Arc::new(move |snap| {
        sink.lock()
            .unwrap()
            .push((snap.downloaded_bytes, snap.total_bytes));
    });
    (seen, hook)
}

// ---------------------------------------------------------------------------
// Testler
// ---------------------------------------------------------------------------

#[tokio::test]
async fn çok_kanallı_indirme_dosyayı_birebir_üretir() {
    let server = TestServer::start(RangeSupport::Proper, None);
    let path = temp_path("cok_kanalli.bin");

    let engine = DownloadEngine::new();
    let signal = AbortSignal::new();
    let (_, hook) = recorder();

    let states = engine
        .download(&server.file_url(), &path, 8, None, signal, hook)
        .await
        .expect("indirme başarısız");

    // Dosya içeriği sunucuyla birebir aynı olmalı.
    let written = std::fs::read(&path).expect("dosya okunamadı");
    assert_eq!(written.len(), FILE_SIZE, "dosya boyutu beklenen değil");
    assert_eq!(
        written,
        test_payload(),
        "içerik bayt bayt eşleşmiyor (kanal sınırları bozuk olabilir)"
    );

    // Tüm kanallar tamamlanmış olmalı.
    assert!(states.iter().all(|c| c.finished), "kanalların tümü bitmeli");
    assert_eq!(
        states.len(),
        4,
        "4 MB dosya için kanal başına 1 MB sınırıyla 4 kanal planlanmalıydı"
    );

    // Toplam indirilen miktar şişmemeli.
    let downloaded: u64 = states.iter().map(|c| c.current_byte - c.start_byte).sum();
    assert_eq!(downloaded, FILE_SIZE as u64);

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn tek_kanal_çok_kanallı_dosyayı_bozmaz() {
    let server = TestServer::start(RangeSupport::Proper, None);
    let path = temp_path("tek_kanal.bin");

    let engine = DownloadEngine::new();
    let signal = AbortSignal::new();
    let (_, hook) = recorder();

    engine
        .download(&server.file_url(), &path, 1, None, signal, hook)
        .await
        .expect("indirme başarısız");

    let written = std::fs::read(&path).expect("dosya okunamadı");
    assert_eq!(written, test_payload());

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn range_desteklemeyen_sunucuda_tek_kanala_duser() {
    let server = TestServer::start(RangeSupport::None, None);
    let path = temp_path("rangesiz.bin");

    let engine = DownloadEngine::new();
    let signal = AbortSignal::new();
    let (_, hook) = recorder();

    // 16 kanal iste, ama sunucu desteklemiyor: dosya yine de tam olmalı.
    engine
        .download(&server.file_url(), &path, 16, None, signal, hook)
        .await
        .expect("indirme başarısız");

    let written = std::fs::read(&path).expect("dosya okunamadı");
    assert_eq!(written.len(), FILE_SIZE);
    assert_eq!(written, test_payload());

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn range_ignoren_sunucuda_tek_kanal_duser_ve_dosya_bozulmaz() {
    // Sunucu `Range` başlığını hiç dikkate almaz: yoklama isteğinde de
    // `200 OK` döner. Motor bunu "tek kanal" olarak algılamalı ve indirme
    // yine de birebir doğru tamamlanmalı (dosya bozulmamalı).
    let server = TestServer::start(RangeSupport::IgnoresRange, None);
    let path = temp_path("range_yoksayan.bin");

    let engine = DownloadEngine::new();
    let signal = AbortSignal::new();
    let (_, hook) = recorder();

    engine
        .download(&server.file_url(), &path, 8, None, signal, hook)
        .await
        .expect("tek kanala düşerek indirmeliydi");

    let written = std::fs::read(&path).expect("dosya okunamadı");
    assert_eq!(written, test_payload(), "dosya içeriği bozuk");

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn yoklamada_206_veri_isteginde_200_gelen_sunucu_hata_verir() {
    // Bu, WPF sürümündeki en tehlikeli hatalardan biriydi: sunucu yoklamada
    // `206` döndürür (Range desteği var gibi görünür), sonra asıl veri
    // isteğinde `200 OK` ve TÜM dosyayı gönderir. Eski kod aralık başlığındaki
    // konuma yazar ve dosya sessizce bozulurdu. Motor bunu hata vermeli.
    let server = TestServer::start(RangeSupport::Flaky, None);
    let path = temp_path("ok200.bin");

    let engine = DownloadEngine::new();
    let signal = AbortSignal::new();
    let (_, hook) = recorder();

    let result = engine
        .download(&server.file_url(), &path, 4, None, signal, hook)
        .await;

    match result {
        Err(EngineError::Failed(msg)) => {
            assert!(
                msg.contains("206"),
                "hata mesajı 206 beklentisini belirtmeli, alınan: {msg}"
            );
        }
        Ok(_) => panic!("200 OK dönen sunucuda indirme başarı sayılmamalı"),
        Err(EngineError::Aborted) => panic!("beklenmedik iptal"),
    }

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn kanal_bazlı_devam_indirmeyi_tamamlar() {
    let server = TestServer::start(RangeSupport::Proper, Some(Duration::from_millis(40)));
    let path = temp_path("devam.bin");

    let engine = DownloadEngine::new();

    // 1. Aşama: indirmeyi biraz ilerlet, sonra duraklat.
    let signal = AbortSignal::new();
    let signal2 = signal.clone();
    let (_, hook) = recorder();

    let url = server.file_url();
    let p = path.clone();

    let first =
        tokio::spawn(async move { engine.download(&url, &p, 4, None, signal2, hook).await });

    // Bir miktar veri indikten sonra duraklat.
    tokio::time::sleep(Duration::from_millis(320)).await;
    signal.abort();

    let first_result = first.await.expect("görev panikledi");
    assert!(
        matches!(first_result, Err(EngineError::Aborted)),
        "duraklatma Aborted dönmeli, alınan: {:?}",
        first_result.err()
    );

    // Dosya kısmi ama önceden ayrılmış olmalı.
    let partial = std::fs::metadata(&path).expect("dosya yok").len();
    assert_eq!(partial, FILE_SIZE as u64, "dosya önceden ayrılmalıydı");

    // 2. Aşama: hızlı sunucu ile devam et (kalanı rahat indirilebilsin).
    let fast = TestServer::start(RangeSupport::Proper, None);
    let signal2 = AbortSignal::new();
    let (_, hook2) = recorder();
    let resume_url = fast.file_url();

    let engine2 = DownloadEngine::new();
    let p2 = path.clone();
    let resume = engine2
        .download(&resume_url, &p2, 4, None, signal2, hook2)
        .await;

    assert!(
        resume.is_ok(),
        "ikinci indirme başarısız: {:?}",
        resume.err()
    );

    let written = std::fs::read(&path).expect("dosya okunamadı");
    assert_eq!(written, test_payload(), "sonuç dosya sunucuyla eşleşmiyor");

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn devam_kanal_durumlarindan_devam_eder() {
    // Elde tutulan kanal durumlarıyla devam: yalnızca eksik kısım
    // indirilmeli (sunucu isabet sayısı bunu doğrular).
    let server = TestServer::start(RangeSupport::Proper, None);
    let path = temp_path("resume_states.bin");

    let half = (FILE_SIZE / 2) as u64;

    // Dosyayı önceden ayır ve ilk yarısını gerçek veriyle doldur.
    {
        use std::io::{Seek, SeekFrom, Write};
        let mut f = std::fs::File::create(&path).expect("dosya oluşturulamadı");
        f.set_len(FILE_SIZE as u64).ok();
        f.seek(SeekFrom::Start(0)).unwrap();
        f.write_all(&test_payload()[..half as usize]).unwrap();
        f.flush().unwrap();
    }
    let states = vec![
        adm_lib::models::ChannelState {
            id: 0,
            start_byte: 0,
            end_byte: half - 1,
            current_byte: half,
            finished: true,
        },
        adm_lib::models::ChannelState {
            id: 1,
            start_byte: half,
            end_byte: FILE_SIZE as u64 - 1,
            current_byte: half,
            finished: false,
        },
    ];

    let engine = DownloadEngine::new();
    let signal = AbortSignal::new();
    let (_, hook) = recorder();

    engine
        .download(&server.file_url(), &path, 2, Some(&states), signal, hook)
        .await
        .expect("devam ettirme başarısız");

    let written = std::fs::read(&path).expect("dosya okunamadı");
    assert_eq!(written, test_payload());

    // İlk kanal zaten bitmişti: sunucuya yalnızca ikinci kanal için
    // istek atılmalıydı (toplam 2 istek: yoklama + ikinci kanal).
    assert_eq!(
        server.hits(),
        2,
        "tamamlanmış kanal yeniden indirilmemeliydi"
    );

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn iptal_kismi_dosyayi_korur() {
    let server = TestServer::start(RangeSupport::Proper, Some(Duration::from_millis(50)));
    let path = temp_path("iptal.bin");

    let engine = DownloadEngine::new();
    let signal = AbortSignal::new();
    let signal2 = signal.clone();
    let (_, hook) = recorder();

    let url = server.file_url();
    let p = path.clone();

    let task = tokio::spawn(async move { engine.download(&url, &p, 4, None, signal2, hook).await });

    tokio::time::sleep(Duration::from_millis(300)).await;
    signal.abort();

    let result = task.await.expect("görev panikledi");
    assert!(
        matches!(result, Err(EngineError::Aborted)),
        "iptal Aborted dönmeli"
    );

    // Dosya hâlâ var ve önceden ayrılmış boyutta (yarım kalmış indirme).
    assert!(path.exists(), "iptalde dosya silinmemeli");
    assert_eq!(
        std::fs::metadata(&path).unwrap().len(),
        FILE_SIZE as u64,
        "önceden ayrılmış dosya korunmalı"
    );

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn is_hirsizligi_toplam_miktari_sismaz() {
    let server = TestServer::start(RangeSupport::Proper, None);
    let path = temp_path("work_steal.bin");

    let engine = DownloadEngine::new();
    let signal = AbortSignal::new();
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    let hook: adm_lib::engine::ProgressHook = Arc::new(move |snap| {
        sink.lock().unwrap().push(snap.downloaded_bytes);
    });

    // İş hırsızlığı eşiğini tetiklemek için çok büyük dosya ve 2 kanal
    // gerekir; 3 MB küçük olduğu için eşiği test içinde düşüremeyiz.
    // Bunun yerine indirilen miktarın tekdüze arttığını doğrularız.
    let states = engine
        .download(&server.file_url(), &path, 2, None, signal, hook)
        .await
        .expect("indirme başarısız");

    let history = seen.lock().unwrap();
    for pair in history.windows(2) {
        assert!(
            pair[1] >= pair[0],
            "indirilen miktar geriye gidemez: {} -> {}",
            pair[0],
            pair[1]
        );
    }
    if let Some(last) = history.last() {
        assert_eq!(*last, FILE_SIZE as u64, "son değer tam dosya olmalı");
    }

    let downloaded: u64 = states.iter().map(|c| c.current_byte - c.start_byte).sum();
    assert_eq!(
        downloaded, FILE_SIZE as u64,
        "kanal toplamı dosya boyutuna eşit olmalı"
    );

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn yonlendirme_elle_izlenir() {
    let server = TestServer::start(RangeSupport::Proper, None);
    let path = temp_path("yonlendirme.bin");

    let engine = DownloadEngine::new();
    let signal = AbortSignal::new();
    let (_, hook) = recorder();

    engine
        .download(&server.redirect_url(), &path, 4, None, signal, hook)
        .await
        .expect("yönlendirme sonrası indirme başarısız");

    let written = std::fs::read(&path).expect("dosya okunamadı");
    assert_eq!(written, test_payload());

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn bulunamayan_dosya_turkce_hata_verir() {
    let server = TestServer::start(RangeSupport::Proper, None);
    let path = temp_path("yok.bin");

    let engine = DownloadEngine::new();
    let signal = AbortSignal::new();
    let (_, hook) = recorder();

    let result = engine
        .download(&server.missing_url(), &path, 4, None, signal, hook)
        .await;

    match result {
        Err(EngineError::Failed(msg)) => {
            assert!(
                msg.contains("404"),
                "hata 404 durumunu belirtmeli, alınan: {msg}"
            );
            // Türkçe mesaj kullanıcıya gösterilir.
            assert!(
                msg.chars().any(|c| c as u32 > 0x7F),
                "mesaj Türkçe karakter içermeli: {msg}"
            );
        }
        Ok(_) => panic!("404 yanıtında indirme başarılı sayılmamalı"),
        Err(EngineError::Aborted) => panic!("beklenmedik iptal"),
    }
}

#[tokio::test]
async fn bos_url_hata_verir() {
    let path = temp_path("bos_url.bin");
    let engine = DownloadEngine::new();
    let signal = AbortSignal::new();
    let (_, hook) = recorder();

    let result = engine
        .download("http://127.0.0.1:1/yok", &path, 4, None, signal, hook)
        .await;

    assert!(result.is_err(), "erişilemeyen adres hata vermeli");

    let _ = std::fs::remove_file(&path);
}

#[tokio::test]
async fn cok_kanalli_indirmeler_birbirini_etkilemez() {
    // Aynı sunucudan iki indirme eşzamanlı: motor statik istemciyi ve
    // kanal durumlarını güvenli paylaşıyor olmalı.
    let server = TestServer::start(RangeSupport::Proper, None);

    let url_a = server.file_url();
    let url_b = server.file_url();

    let a = tokio::spawn(async move {
        let engine = DownloadEngine::new();
        let signal = AbortSignal::new();
        let (_, hook) = recorder();
        engine
            .download(&url_a, &temp_path("paralel_a.bin"), 4, None, signal, hook)
            .await
    });

    let b = tokio::spawn(async move {
        let engine = DownloadEngine::new();
        let signal = AbortSignal::new();
        let (_, hook) = recorder();
        engine
            .download(&url_b, &temp_path("paralel_b.bin"), 6, None, signal, hook)
            .await
    });

    let (ra, rb) = tokio::join!(a, b);
    ra.expect("görev A panikledi").expect("indirme A başarısız");
    rb.expect("görev B panikledi").expect("indirme B başarısız");

    for name in ["paralel_a.bin", "paralel_b.bin"] {
        let p = std::env::temp_dir().join("adm_engine_tests").join(name);
        let data = std::fs::read(&p).expect("dosya okunamadı");
        assert_eq!(data, test_payload(), "{name} içeriği bozuk");
        let _ = std::fs::remove_file(&p);
    }
}
