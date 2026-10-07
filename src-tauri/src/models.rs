//! Uygulama genelinde kullanılan veri modelleri.
//!
//! Not: `DownloadStatus` veritabanında **İngilizce** metin olarak saklanır
//! (`Queued`, `Downloading`, ...) ve arayüzde Türkçe karşılıklarına
//! çevrilir. Bu katman hem API hem de kalıcı kayıt için kullanılır.

use chrono::{DateTime, Local};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

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
}

/// Varsayılan dosya adı.
pub const DEFAULT_FILE_NAME: &str = "indirme.bin";

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
}
