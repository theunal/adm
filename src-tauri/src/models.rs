//! Uygulama genelinde kullanılan veri modelleri.
//!
//! Not: `DownloadStatus` veritabanında **İngilizce** metin olarak saklanır
//! (`Queued`, `Downloading`, ...) ve arayüzde Türkçe karşılıklarına
//! çevrilir. Bu katman hem API hem de kalıcı kayıt için kullanılır.

use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

/// Bir indirmenin türü — MC `DownloadKind` portu.
///
/// `video` türündeki kayıtlar motor yerine yt-dlp ile indirilir.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadKind {
    File,
    Video,
}

impl DownloadKind {
    pub fn as_str(self) -> &'static str {
        match self {
            DownloadKind::File => "file",
            DownloadKind::Video => "video",
        }
    }

    /// Veritabanından okunan metni çevirir.
    pub fn from_db(raw: &str) -> Self {
        match raw {
            "video" => DownloadKind::Video,
            _ => DownloadKind::File,
        }
    }

    pub fn is_video(self) -> bool {
        matches!(self, DownloadKind::Video)
    }
}

impl std::fmt::Display for DownloadKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Bir indirmenin yaşam döngüsü durumu.
///
/// WPF sürümündeki `DownloadStatus` enum'ının birebir karşılığıdır;
/// sıralama ve isimler korunmuştur.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DownloadStatus {
    Queued,
    Downloading,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

impl DownloadStatus {
    /// Veritabanına yazılacak İngilizce ad.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "Queued",
            Self::Downloading => "Downloading",
            Self::Paused => "Paused",
            Self::Completed => "Completed",
            Self::Failed => "Failed",
            Self::Cancelled => "Cancelled",
        }
    }

    /// Veritabanından okunan metni enum'a çevirir.
    pub fn from_db(raw: &str) -> Self {
        match raw {
            "Queued" => Self::Queued,
            "Downloading" => Self::Downloading,
            "Paused" => Self::Paused,
            "Completed" => Self::Completed,
            "Cancelled" => Self::Cancelled,
            // Tanınmayan veya bozuk değer: en güvenli durum "Başarısız".
            _ => Self::Failed,
        }
    }

    /// Bu durumda listede "aktif" sekmesinde görünmeli mi?
    pub fn is_listed_active(self) -> bool {
        matches!(self, Self::Queued | Self::Downloading | Self::Paused)
    }

    /// Bu durumda devam ettirme anlamlı mı?
    pub fn is_resumable(self) -> bool {
        matches!(self, Self::Paused | Self::Failed | Self::Cancelled)
    }
}

impl std::fmt::Display for DownloadStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Tek bir indirme kanalının aralık ve ilerleme durumu.
///
/// Bu yapı `DownloadItem::channel_states` alanına JSON olarak yazılır ve
/// böylece **kanal bazlı** devam ettirme (resume) mümkün olur.
/// WPF sürümünde bu alan hiç doldurulmuyordu; bu yüzden resume hep bozuktu.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelState {
    pub id: i64,
    /// Bu kanalın sorumlu olduğu aralığın başlangıcı (dahil).
    pub start_byte: u64,
    /// Bu kanalın sorumlu olduğu aralığın bitişi (dahil).
    pub end_byte: u64,
    /// Kanalın bir sonraki yazılacak baytı.
    pub current_byte: u64,
    pub finished: bool,
}

impl ChannelState {
    /// Kanalın indirmesi gereken kalan bayt sayısı.
    ///
    /// Yalnızca `SharedChannel` üzerinden okunur; doğrudan `ChannelState`
    /// çağrılarında `self.remaining()` kullanılır.
    ///
    /// `end_byte` **dahil** olduğu için `current_byte <= end_byte` iken
    /// `end_byte - current_byte + 1` bayt kalmıştır.
    pub fn remaining(&self) -> u64 {
        if self.current_byte > self.end_byte {
            0
        } else {
            self.end_byte - self.current_byte + 1
        }
    }
}

/// Kanalların paylaşımlı, eşzamanlı-erişim güvenli hâli.
///
/// Kısa kritik bölümler (`Mutex`) senkron tutulur; kanal durumu okuma/yazma
/// işlemi birkaç bayttan ibaret olduğu için async kilit gereksizdir ve
/// `block_in_place` maliyeti oluşturur.
#[derive(Debug)]
pub struct SharedChannel {
    pub state: Mutex<ChannelState>,
    downloaded: AtomicU64,
}

impl SharedChannel {
    /// Yeni bir kanal oluşturur.
    ///
    /// `downloaded` sayacı kanalın **zaten indirmiş olduğu** baytlarla
    /// başlatılır (`current_byte - start_byte`). Devam ettirmede bu kritiktir:
    /// önceki çalışmadan kalan baytlar da toplama dahil edilmezse
    /// "İndirme eksik kaldı" hatası verilir.
    pub fn new(state: ChannelState) -> Self {
        let already = state.current_byte.saturating_sub(state.start_byte);
        let span = state
            .end_byte
            .saturating_sub(state.start_byte)
            .saturating_add(1);

        Self {
            state: Mutex::new(state),
            downloaded: AtomicU64::new(already.min(span)),
        }
    }

    /// Kanalın indirdiği toplam bayt.
    pub fn downloaded(&self) -> u64 {
        self.downloaded.load(Ordering::Relaxed)
    }

    /// Yazılan bayt miktarını ekler.
    pub fn add_downloaded(&self, n: u64) {
        self.downloaded.fetch_add(n, Ordering::Relaxed);
    }

    /// Kanalın anlık durumu.
    pub fn snapshot(&self) -> ChannelState {
        *lock(&self.state)
    }

    /// `(current_byte, end_byte, finished)`
    pub fn bounds(&self) -> (u64, u64, bool) {
        let st = lock(&self.state);
        (st.current_byte, st.end_byte, st.finished)
    }

    /// Kanalın kalan bayt sayısı (iş hırsızlığı planlamasında kullanılır).
    pub fn remaining(&self) -> u64 {
        self.snapshot().remaining()
    }

    /// Kanalı tamamlandı olarak işaretle.
    pub fn mark_finished(&self) {
        let mut st = lock(&self.state);
        st.current_byte = st.end_byte + 1;
        st.finished = true;
    }

    /// Yazma konumunu güncelle.
    pub fn set_current(&self, pos: u64) {
        lock(&self.state).current_byte = pos;
    }

    /// Kanalın aralık sonunu ayarlar.
    ///
    /// Boyut bilinmeyen indirmelerde kanal planı `end_byte = 0` ile kurulur;
    /// `mark_finished` bunu `1`'e çektiği için `total_from_channels` 1 döner
    /// ve kayıt "1 B" tamamlanmış görünür. Tamamlanma anında hem aralık
    /// sonu hem yazma konumu gerçek dosya boyutuna hizalanır; böylece
    /// `finalize` ve arayüzdeki kanal tablosu doğru değeri görür.
    ///
    /// Yalnızca **tek kanallı** bilinmeyen boyutlu indirmelerde çağrılır
    /// (`plan_channels(0, n)` her zaman tek kanal döner); bu yüzden "gerçek
    /// boyut" tüm aralığa uygulanabilir.
    pub fn align_to_total(&self, total: u64) {
        let mut st = lock(&self.state);
        st.end_byte = total.saturating_sub(1);
        st.current_byte = total;
        st.finished = true;
    }

    /// Aralıksız (tek akış) istek için kanalı başa alır.
    ///
    /// `ranged = false` istek `Range` başlığı taşımaz, sunucu dosyayı **0'dan
    /// baştan** gönderir. Yazma konumu ile "indirilmiş" sayacının da 0'dan
    /// başlaması gerekir; aksi halde veri ilerleme kadar kayar ve dosya
    /// bozulur.
    pub fn restart_from_zero(&self) {
        lock(&self.state).current_byte = 0;
        self.downloaded.store(0, Ordering::Relaxed);
    }

    /// Aralık başlangıcı değiştiğinde "indirilmiş" sayacını düzeltir.
    ///
    /// İş hırsızlığı ya da kanal yeniden planlaması sonrası aralık
    /// değişebilir. Yeni `start_byte`'a kadar olan kısım **indirilmemiş**
    /// olduğu için sayaca eklenmez; böylece toplam ilerleme şişmez.
    pub fn recalibrate(&self, new_start: u64) {
        let mut st = lock(&self.state);
        if new_start > st.start_byte {
            let skip = new_start - st.start_byte;
            // Düşüme `saturating_sub` uygulanır: sayaç atlanan baytlardan
            // azsa (örneğin kanal hızla bitmişken) alt taşmayı engeller.
            let _ = self
                .downloaded
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |v| {
                    Some(v.saturating_sub(skip))
                });
        } else if new_start < st.start_byte {
            self.downloaded
                .fetch_add(st.start_byte - new_start, Ordering::Relaxed);
        }
        st.start_byte = new_start;
    }
}

/// Kilit `expect` ile alınır; kilit bozulması yalnızca panic ile olabilir
/// (asla `await` sırasında tutulmaz).
fn lock(m: &Mutex<ChannelState>) -> std::sync::MutexGuard<'_, ChannelState> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Kanal durumlarını `ChannelStates` JSON sütununa yaz.
pub fn channel_states_to_json(states: &[ChannelState]) -> Option<String> {
    if states.is_empty() {
        return None;
    }
    serde_json::to_string(states).ok()
}

/// `ChannelStates` JSON sütunundan kanal durumlarını oku.
pub fn channel_states_from_json(raw: &str) -> Vec<ChannelState> {
    serde_json::from_str(raw).unwrap_or_default()
}

/// Bir indirme kaydının arayüze giden hâli.
///
/// Tüm alanlar `camelCase` olarak serileştirilir (SolidJS tarafıyla uyum).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadItem {
    pub id: i64,
    pub url: String,
    pub file_path: String,
    pub file_name: String,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub channel_count: u32,
    pub status: DownloadStatus,
    pub created_at: DateTime<Local>,
    pub completed_at: Option<DateTime<Local>>,
    pub last_updated: DateTime<Local>,
    pub speed_mbps: f64,
    pub error_message: Option<String>,
    /// Kanal başına indirilen bayt miktarları — ilerleme arayüzü için.
    pub channels: Vec<ChannelState>,
    // -----------------------------------------------------------------
    // MC portu (video / tarayıcı köprüsü) alanları
    // -----------------------------------------------------------------
    /// Dosya mı, yt-dlp videosu mu?
    pub kind: DownloadKind,
    /// Sunucu `Range` destekliyor mu? (detay penceresi "Resume capability")
    pub supports_ranges: bool,
    /// Uzantıdan gelen ek başlıklar (Referer, User-Agent, Cookie…).
    pub headers: Vec<(String, String)>,
    /// Çerez dosyası (uzantıdan gelen çerezler Netscape dosyasına yazılır).
    pub cookie_file: Option<String>,
    /// Tamamlandığında dosyanın nihai yolu.
    pub final_path: Option<String>,
    /// yt-dlp faz metni ("Video indiriliyor…").
    pub stage: String,
    /// yt-dlp ham çıktısı (son ~6000 karakter, detay penceresinde).
    pub log: String,
}

/// Varsayılan kayıt (yeni alanlar için boş değerler).
///
/// Kurulum noktalarında tüm alanları elle yazmak yerine
/// `..DownloadItem::default()` ile tamamlanır.
impl Default for DownloadItem {
    fn default() -> Self {
        let now = Local::now();
        Self {
            id: 0,
            url: String::new(),
            file_path: String::new(),
            file_name: String::new(),
            total_bytes: 0,
            downloaded_bytes: 0,
            channel_count: 1,
            status: DownloadStatus::Queued,
            created_at: now,
            completed_at: None,
            last_updated: now,
            speed_mbps: 0.0,
            error_message: None,
            channels: Vec::new(),
            kind: DownloadKind::File,
            supports_ranges: false,
            headers: Vec::new(),
            cookie_file: None,
            final_path: None,
            stage: String::new(),
            log: String::new(),
        }
    }
}

/// Raf ömrü boyunca tutulan çerez verisi (uzantıdan gelen).
///
/// `DownloadItem.headers` ile aynı biçimdedir; köprüden gelen istekleri
/// kayda dönüştürürken kullanılır.
pub type HeaderMap = Vec<(String, String)>;

/// Varsayılan dosya adı.
pub const DEFAULT_FILE_NAME: &str = "indirme.bin";

/// URL'den alan adını çıkarır (`https://a.b:8443/x` → `a.b`).
///
/// Köprüde çerez satırlarının alan adını doldurmak için kullanılır; harici
/// bir URL ayrıştırıcıya gerek bırakmaz. Şema yoksa giriş yolu olarak
/// değerlendirilir.
pub fn host_from_url(url: &str) -> Option<String> {
    let rest = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    // `kullanıcı:parola@alan` biçiminde kimlik bilgisi varsa atılır.
    let host_port = authority.rsplit('@').next().unwrap_or(authority);
    if host_port.is_empty() {
        return None;
    }
    // IPv6: `[::1]:48213` → `::1`
    if let Some(inner) = host_port.strip_prefix('[') {
        let host = inner.split(']').next()?;
        return (!host.is_empty()).then(|| host.to_ascii_lowercase());
    }
    let host = host_port.split(':').next().unwrap_or("");
    if host.is_empty() {
        None
    } else {
        Some(host.to_ascii_lowercase())
    }
}

/// Başlangıç URL'sine göre dosya adı türetir.
/// `https://x.com/a/b/file.bin?x=1` -> `file.bin`
pub fn file_name_from_url(url: &str) -> String {
    // Sorgu ve parça bilgisini at: dosya adında yer almazlar.
    let without_query = url.split(['?', '#']).next().unwrap_or(url);

    // Şema ve alan adını ayır; kalan yolun son segmenti dosya adıdır.
    let path = match without_query.split_once("://") {
        Some((_, rest)) => match rest.find('/') {
            Some(i) => &rest[i..],
            // `https://x.com` -> yol yok
            None => "",
        },
        // Şemasız adres: son segment doğrudan dosya adı olabilir.
        None => without_query,
    };

    // Sondaki eğik çizgiler klasör belirtir; dosya adı yok demektir.
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        return DEFAULT_FILE_NAME.to_string();
    }

    let last = trimmed.rsplit('/').find(|s| !s.is_empty()).unwrap_or("");

    // Dosya sistemine gösterge illegal karakterleri temizle.
    let cleaned: String = last
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();

    // `..`, `.` gibi yalnızca noktalardan oluşan adlar geçersizdir.
    let cleaned = cleaned.trim();
    if cleaned.is_empty() || cleaned.chars().all(|c| c == '.') {
        DEFAULT_FILE_NAME.to_string()
    } else {
        cleaned.to_string()
    }
}

/// Dosya adını defensif biçimde temizler (Windows yasak karakterleri, vb.).
pub fn sanitize_file_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if (c as u32) < 32 => '_',
            c => c,
        })
        .collect();

    let trimmed = cleaned.trim().trim_end_matches('.').trim();
    // Windows aygıt adlarına dokunma (CON, PRN…).
    if trimmed.is_empty() {
        "download".to_string()
    } else {
        trimmed.to_string()
    }
}

/// `Content-Disposition` / `Content-Type` başlıklarından dosya adı çıkarır.
///
/// Sıra: `filename*` (RFC 5987) → `filename` (tırnaklı) → düz `filename`
/// → URL'den türetilen ad (uzantısı varsa) → `Content-Type` uzantısıyla.
/// MC'nin `fileName(contentDisposition:url:)` portudur.
pub fn file_name_from_headers(
    content_disposition: Option<&str>,
    content_type: Option<&str>,
    url: &str,
) -> String {
    if let Some(cd) = content_disposition {
        // filename*=UTF-8''%41%42.zip  → AB.zip
        if let Some((_, value)) = cd.split_once("filename*=") {
            let value = value.split(';').next().unwrap_or(value).trim();
            // RFC 5987 biçimi: `charset'lang'<yüzde-kodlu ad>`. Ad, **ikinci**
            // tırnaktan sonrasıdır; yalnızca ilk tırnaktan sonrasını almak
            // adın başına kesme işareti bırakırdı.
            let encoded = value.rsplit_once('\'').map(|(_, v)| v).unwrap_or(value);
            let decoded = percent_decode(encoded);
            if !decoded.is_empty() {
                return sanitize_file_name(&decoded);
            }
        }
        // filename="..." veya filename=...
        if let Some((_, value)) = cd.split_once("filename=") {
            let value = value.split(';').next().unwrap_or(value).trim();
            let unquoted = value.trim_matches('"');
            if !unquoted.is_empty() {
                return sanitize_file_name(unquoted);
            }
        }
    }

    // URL'den türetilen ad: uzantı taşıyorsa kullan.
    let from_url = file_name_from_url(url);
    if from_url.contains('.') {
        return sanitize_file_name(&from_url);
    }

    // Content-Type'tan uzantı türet.
    if let Some(ct) = content_type {
        let ext = ext_for_content_type(ct);
        if !ext.is_empty() {
            return sanitize_file_name(&format!("{from_url}.{ext}"));
        }
    }

    sanitize_file_name(&from_url)
}

/// `Content-Type` değerine karşılık gelen dosya uzantısı.
fn ext_for_content_type(content_type: &str) -> &'static str {
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match mime.as_str() {
        "application/zip" | "application/x-zip-compressed" => "zip",
        "application/x-7z-compressed" | "application/7z" => "7z",
        "application/x-rar-compressed" | "application/vnd.rar" => "rar",
        "application/gzip" => "gz",
        "application/x-tar" => "tar",
        "application/pdf" => "pdf",
        "application/msword" => "doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => "docx",
        "application/vnd.ms-excel" => "xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => "xlsx",
        "application/vnd.ms-powerpoint" => "ppt",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => "pptx",
        "application/octet-stream" | "application/wasm" => "bin",
        "application/json" => "json",
        "application/xml" | "text/xml" => "xml",
        "application/javascript" | "text/javascript" => "js",
        "image/jpeg" => "jpg",
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/svg+xml" => "svg",
        "image/heic" => "heic",
        "image/avif" => "avif",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/mp4" | "audio/x-m4a" => "m4a",
        "audio/aac" => "aac",
        "audio/ogg" => "ogg",
        "audio/opus" => "opus",
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/flac" => "flac",
        "video/mp4" => "mp4",
        "video/x-matroska" => "mkv",
        "video/webm" => "webm",
        "video/quicktime" => "mov",
        "video/x-msvideo" => "avi",
        "video/mpeg" => "mpeg",
        "text/plain" => "txt",
        "text/html" => "html",
        "text/css" => "css",
        _ => "",
    }
}

/// Yüzde kodlamalı metni çözer (`%41` → `A`, `+` boşluk değildir).
pub fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Dosya geçmişi için yardımcı: dosya adını ve parça adını ayırır.
pub fn split_extension(file_name: &str) -> (String, Option<String>) {
    match file_name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem.to_string(), Some(ext.to_string())),
        _ => (file_name.to_string(), None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_roundtrips_through_db_string() {
        for s in [
            DownloadStatus::Queued,
            DownloadStatus::Downloading,
            DownloadStatus::Paused,
            DownloadStatus::Completed,
            DownloadStatus::Failed,
            DownloadStatus::Cancelled,
        ] {
            assert_eq!(DownloadStatus::from_db(s.as_str()), s);
        }
    }

    #[test]
    fn unknown_db_status_is_failed() {
        assert_eq!(DownloadStatus::from_db("Bogus"), DownloadStatus::Failed);
        assert_eq!(DownloadStatus::from_db(""), DownloadStatus::Failed);
    }

    #[test]
    fn channel_states_survive_json_roundtrip() {
        let states = vec![
            ChannelState {
                id: 0,
                start_byte: 0,
                end_byte: 99,
                current_byte: 100,
                finished: true,
            },
            ChannelState {
                id: 1,
                start_byte: 100,
                end_byte: 199,
                current_byte: 150,
                finished: false,
            },
        ];
        let json = channel_states_to_json(&states).unwrap();
        assert_eq!(channel_states_from_json(&json), states);
    }

    #[test]
    fn remaining_is_zero_when_finished() {
        let done = ChannelState {
            id: 0,
            start_byte: 0,
            end_byte: 99,
            current_byte: 100,
            finished: true,
        };
        assert_eq!(done.remaining(), 0);

        let fresh = ChannelState {
            id: 1,
            start_byte: 100,
            end_byte: 199,
            current_byte: 100,
            finished: false,
        };
        assert_eq!(fresh.remaining(), 100);
    }

    #[test]
    fn derives_file_name_from_url() {
        assert_eq!(
            file_name_from_url("https://host.tld/a/b/dosya.bin"),
            "dosya.bin"
        );
        assert_eq!(
            file_name_from_url("https://host.tld/a/b/dosya.bin?x=1&y=2"),
            "dosya.bin"
        );
        assert_eq!(file_name_from_url("https://host.tld/"), "indirme.bin");
        // Yalnızca alan adı olan adres: son segment `host.tld` görünür ama
        // bu bir dosya adı değildir, yedek ad kullanılır.
        assert_eq!(file_name_from_url("https://host.tld"), "indirme.bin");
    }

    #[test]
    fn sanitizes_illegal_file_name_characters() {
        // `?` dosya adının parçası değildir: yol `bad` olarak okunur.
        assert_eq!(
            file_name_from_url("https://host.tld/a/b/dosya.bin?x=1"),
            "dosya.bin"
        );
        // Gösterge illegal karakterler alt çizgiye çevrilir.
        assert_eq!(
            file_name_from_url("https://host.tld/a/b/a<b>c.bin"),
            "a_b_c.bin"
        );
        // Yalnızca nokta / boş segmentler geçersizdir.
        assert_eq!(
            file_name_from_url("https://host.tld/a/b/.."),
            DEFAULT_FILE_NAME
        );
        assert_eq!(
            file_name_from_url("https://host.tld/a/b/."),
            DEFAULT_FILE_NAME
        );
        // Sondaki eğik çizgiler yok sayılır: `/a/b///` -> `b`
        assert_eq!(file_name_from_url("https://host.tld/a/b///"), "b");
        // Klasör kökü dosya adı vermez.
        assert_eq!(file_name_from_url("https://host.tld/"), DEFAULT_FILE_NAME);
        assert_eq!(file_name_from_url("https://host.tld"), DEFAULT_FILE_NAME);
    }

    #[test]
    fn recalibrate_subtracts_skipped_bytes() {
        // Yeni kanal: `downloaded` sayaç `current_byte - start_byte` ile
        // başlatılır (devam ettirmede önceki çalışmanın baytları dahildir).
        let ch = SharedChannel::new(ChannelState {
            id: 0,
            start_byte: 0,
            end_byte: 999,
            current_byte: 600,
            finished: false,
        });
        assert_eq!(ch.downloaded(), 600);

        // Aralık 500'den başlıyor: 0..500 arası bu kanalın işi değil,
        // sayaçtan düşülür (600 - 500 = 100 kalır).
        ch.recalibrate(500);
        assert_eq!(ch.downloaded(), 100);
        assert_eq!(ch.snapshot().start_byte, 500);
    }

    #[test]
    fn new_seeds_counter_from_resume_position() {
        // Devam edilen bir kanal, aralığın ortasından başlar.
        let ch = SharedChannel::new(ChannelState {
            id: 1,
            start_byte: 1000,
            end_byte: 1999,
            current_byte: 1500,
            finished: false,
        });
        assert_eq!(ch.downloaded(), 500);
        assert_eq!(ch.remaining(), 500);
    }

    #[test]
    fn new_clamps_counter_to_channel_span() {
        // Bozuk durum: `current_byte` aralık dışına taşmış.
        let ch = SharedChannel::new(ChannelState {
            id: 0,
            start_byte: 0,
            end_byte: 99,
            current_byte: 999,
            finished: false,
        });
        assert_eq!(ch.downloaded(), 100, "sayaç aralık uzunluğunu aşamaz");
    }

    #[test]
    fn recalibrate_handles_backward_extension() {
        let ch = SharedChannel::new(ChannelState {
            id: 0,
            start_byte: 500,
            end_byte: 999,
            current_byte: 600,
            finished: false,
        });
        assert_eq!(ch.downloaded(), 100);

        // Aralık 0'a geri açıldı: 0..500 indirilmemiş, sayaç artmalı.
        ch.recalibrate(0);
        assert_eq!(ch.downloaded(), 600);
    }

    #[test]
    fn shared_channel_tracks_written_bytes() {
        let ch = SharedChannel::new(ChannelState {
            id: 0,
            start_byte: 0,
            end_byte: 999,
            current_byte: 0,
            finished: false,
        });

        // 256 bayt yazıldı: sayaç ve konum birlikte ilerler.
        ch.add_downloaded(256);
        ch.set_current(256);
        assert_eq!(ch.downloaded(), 256);
        assert_eq!(ch.remaining(), 1000 - 256);

        ch.mark_finished();
        assert!(ch.snapshot().finished);
        assert_eq!(ch.remaining(), 0);
    }

    /// Aralıksız (tek akış) yeniden denemenin sayaç temizliği.
    ///
    /// `fetch_range`, `ranged = false` olduğunda bu yöntemi çağırır. Aralıksız
    /// istek `Range` taşımaz, sunucu dosyayı 0'dan baştan gönderir; konumun da
    /// sayacın da sıfırdan başlaması gerekir. Sayacın sıfırlanmadığı bir
    /// yeniden denemede `downloaded_total`, yazılmayan baytları da sayıp
    /// indirmeyi erken "Tamamlandı" gösterir.
    #[test]
    fn tek_akis_yenidenim_sayaci_sifirlar() {
        let ch = SharedChannel::new(ChannelState {
            id: 0,
            start_byte: 0,
            end_byte: 0, // aralıksız modda sınır yoktur
            current_byte: 0,
            finished: false,
        });

        // İlk deneme 3 MB yazdı, sonra bağlantı koptu.
        ch.add_downloaded(3 * 1024 * 1024);
        ch.set_current(3 * 1024 * 1024);
        assert_eq!(ch.downloaded(), 3 * 1024 * 1024);

        ch.restart_from_zero();

        let st = ch.snapshot();
        assert_eq!(st.current_byte, 0, "yazma konumu başa dönmeli");
        assert_eq!(ch.downloaded(), 0, "sayaca eklenen baytlar da sıfırlanmalı");

        // Yeniden deneme baştan yazıyor: konum ve sayaç birlikte ilerliyor.
        ch.add_downloaded(1024);
        ch.set_current(1024);
        assert_eq!(ch.downloaded(), 1024);
        assert_eq!(ch.snapshot().current_byte, 1024);
    }

    #[test]
    fn recalibrate_does_not_underflow() {
        // Kanal çok hızlı bitmiş olabilir; sayaç atlanan baytlardan az
        // olabilir. Bu durumda alt taşma olmamalı.
        let ch = SharedChannel::new(ChannelState {
            id: 0,
            start_byte: 0,
            end_byte: 999,
            current_byte: 100,
            finished: false,
        });
        ch.add_downloaded(50);

        ch.recalibrate(500);
        assert_eq!(ch.downloaded(), 0);
        assert_eq!(ch.snapshot().start_byte, 500);
    }

    // -----------------------------------------------------------------
    // Başlıklardan dosya adı (MC `fileName` portu)
    // -----------------------------------------------------------------

    #[test]
    fn content_disposition_dosya_adi() {
        // RFC 5987 `filename*` öncelikli.
        assert_eq!(
            file_name_from_headers(
                Some("attachment; filename=\"bilinmeyen.bin\"; filename*=UTF-8''%C3%96rnek.zip"),
                None,
                "https://x.tld/download"
            ),
            "Örnek.zip"
        );
        // Tırnaklı.
        assert_eq!(
            file_name_from_headers(
                Some("attachment; filename=\"rapor.pdf\""),
                None,
                "https://x.tld/d"
            ),
            "rapor.pdf"
        );
        // Düz.
        assert_eq!(
            file_name_from_headers(
                Some("attachment; filename=resim.png"),
                None,
                "https://x.tld/d"
            ),
            "resim.png"
        );
    }

    #[test]
    fn uzanti_url_veya_icerik_turunden() {
        assert_eq!(
            file_name_from_headers(None, None, "https://x.tld/dosya/film.mp4"),
            "film.mp4"
        );
        assert_eq!(
            file_name_from_headers(None, Some("application/zip"), "https://x.tld/indir"),
            "indir.zip"
        );
        assert_eq!(
            file_name_from_headers(None, Some("image/jpeg"), "https://x.tld/indir"),
            "indir.jpg"
        );
    }

    #[test]
    fn dosya_adi_temizlenir() {
        assert_eq!(sanitize_file_name("a<b>c:d.zip"), "a_b_c_d.zip");
        assert_eq!(sanitize_file_name(""), "download");
        assert_eq!(sanitize_file_name("son."), "son");
    }

    #[test]
    fn uzanti_ayirma() {
        assert_eq!(
            split_extension("a.zip"),
            ("a".to_string(), Some("zip".to_string()))
        );
        assert_eq!(
            split_extension("uzantisiz"),
            ("uzantisiz".to_string(), None)
        );
    }

    #[test]
    fn alan_adi_url_den_cikarilir() {
        assert_eq!(
            host_from_url("https://www.youtube.com/watch?v=1"),
            Some("www.youtube.com".to_string())
        );
        assert_eq!(
            host_from_url("http://a.b:8443/x"),
            Some("a.b".to_string())
        );
        // Kimlik bilgisi ve IPv6 köşe durumları.
        assert_eq!(
            host_from_url("https://user:pw@x.tld/p"),
            Some("x.tld".to_string())
        );
        assert_eq!(host_from_url("http://[::1]:48213/p"), Some("::1".to_string()));
        // Şemasız giriş de kabul edilir; ayırt edilemeyen giriş `None`.
        assert_eq!(host_from_url("youtube.com"), Some("youtube.com".to_string()));
        assert_eq!(host_from_url(""), None);
    }
}
