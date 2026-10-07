# ADM — Gelişmiş İndirme Yöneticisi

Çok kanallı indirme yapabilen masaüstü uygulaması.
**Rust + Tauri 2** arka plan, **SolidJS** arayüz.

WPF sürümünün (.NET 10) Rust/Tauri karşılığıdır. Taşıma sırasında WPF'teki
hatalar düzeltilmiş, arayüz yeniden tasarlanmıştır.

---

## Özellikler

- **Çok kanallı indirme** — 1–32 kanal, kanal başına en az 1 MB
- **Kanal bazlı devam** — duraklatıldığında kanal sınırları saklanır, kaldığı
  bayttan devam eder
- **İş hırsızlığı** — biten kanal, en çok işi kalan kanalın yarısını üstlenir
- **Gerçek zamanlı arayüz** — 500 ms'de bir olay; hız, kalan süre, kanal
  dağılımı ve hız grafiği (sparkline)
- **Kalıcı geçmiş** — SQLite (`%LocalAppData%\ADM\downloads.db`)
- **Graceful shutdown** — uygulama kapanırken aktif indirmeler iptal edilir,
  kanal durumları kaydedilir
- **Türkçe / İngilizce** — arayüz, loglar ve hata mesajları başlık çubuğundaki
  `TR | EN` anahtarından değiştirilir (`src/lib/i18n/`, `src-tauri/src/i18n.rs`);
  durum enum'ları veritabanında İngilizce kalır, arayüzde çeviri katmanından
  geçer. Kalıcı hata mesajları kanonik biçimde saklanır, okunurken seçili
  dile çevrilir.

## Düzeltilen hatalar (WPF sürümünden taşınırken)

| WPF hatası | Buradaki çözüm |
|---|---|
| TLS doğrulaması kapatılmıştı (`RemoteCertificateValidationCallback = true`) | `reqwest` + `rustls`; sertifika doğrulaması **açık**, `danger_accept_invalid_certs` hiç çağrılmıyor |
| `Range` isteğine `200 OK` dönünce tüm dosya aralık konumuna yazılıyordu (dosya sessizce bozuluyordu) | `206 Partial Content` **zorunlu**; ayrıca dönen `Content-Range` doğrulanır |
| Sonsuz yeniden deneme (`while` döngüsü, sayaç yok) | Kanal başına en fazla **3 deneme**, üstel geri çekilme, sonra `Failed` |
| `DownloadedBytes` tek sayıydı; kanal sınırları kayboluyordu, resume bozuktu | `ChannelStates` JSON sütununda **gerçekten yazılır**, kanaldan kanala devam sağlanır |
| Dosya önceden ayrılmıyordu; çok kanallı yazma bozuk veri üretiyordu | `set_len` ile ön ayrım; her kanal kendi aralığına konumlanıp yazar |
| `PauseDownloadAsync` yalnızca bayrak set ediyordu, görev çalışmaya devam ediyordu | Duraklatma `AbortSignal` ile görevi gerçekten durdurur |
| `DeleteDownloadAsync` dosyayı silmiyordu | `delete` komutu dosyayı da siler (`delete_file` seçeneği) |
| Kapanışta aktif indirmeler sahipsiz kalıyordu | `shutdown_all()` iptal eder ve görevlerin bitmesini bekler |
| Paylaşılan `DbContext` thread-safety sorunları | `SqlitePool` (`Send + Sync`), WAL modu |
| 500 ms'de bir tüm tabloyu `SELECT` ediyordu | Yalnızca değişen kayıt, Tauri olayı ile güncellenir |

---

## Gereksinimler

- Rust 1.98+ (edition 2024)
- Node.js 20+
- Windows 10/11 + WebView2 (Windows 11'de hazır gelir)

## Geliştirme

```bash
npm install
npm run tauri:dev      # uygulamayı çalıştır
npm run tauri:build    # kurulum paketi üret (NSIS / MSI)
```

## Testler

```bash
cd src-tauri
cargo test             # birim + entegrasyon testleri
cargo clippy --all-targets
```

Motor testleri yerel bir HTTP sunucusu kurar (ağ dışına çıkmaz), bu yüzden
çok kanallı yazma, `206` kontrolü, kanal bazlı devam ve iptal senaryoları
bayt bayt doğrulanır.

## İkon

`app-icon.svg` kaynak dosyasıdır; tüm platform boyutları bundan üretilir:

```bash
npm run tauri:icon
```

---

## Mimari

```text
src/                     SolidJS arayüzü
├── App.tsx              uygulama kabuğu (yerleşim, sekmeler)
├── components/
│   ├── TitleBar.tsx         özel başlık çubuğu (küçült/büyüt/kapat)
│   ├── NewDownloadForm.tsx  yeni indirme formu
│   ├── DownloadList.tsx     sekmeli liste
│   ├── DownloadCard.tsx     indirme kartı (ilerleme, kanal, eylemler)
│   ├── StatusBadge.tsx      durum rozeti
│   ├── Sparkline.tsx        hız grafiği
│   └── LogPanel.tsx         olay günlüğü
├── lib/
│   ├── api.ts            Tauri komutları ve olay aboneliği
│   ├── store.ts          sinyal tabanlı durum yönetimi
│   ├── format.ts         biçimlendirme + Türkçe çeviri katmanı
│   └── useFeedback.ts    log/hata yardımcıları
└── styles.css            tasarım sistemi (koyu tema, teal aksan)

src-tauri/src/
├── models.rs     DownloadStatus, ChannelState, DownloadItem
├── db.rs         sqlx/SQLite: havuz, şema, CRUD
├── engine.rs     çok kanallı indirme motoru
├── manager.rs    DashMap + broadcast: görev yönetimi
├── commands.rs   #[tauri::command] katmanı
└── lib.rs        uygulama kurulumu
```

### Veri akışı

```text
engine.rs  ──(500 ms EngineSnapshot)──►  manager.rs
                                              │
                    ┌─────────────────────────┴──────────────────────┐
                    │                                                │
            SqlitePool (2 sn'de bir)                    tokio broadcast
                    │                                                │
                    ▼                                                ▼
              downloads.db                          Tauri olayı ──► SolidJS store
```

## Veritabanı

`%LocalAppData%\ADM\downloads.db`

```sql
CREATE TABLE downloads (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    url              TEXT    NOT NULL,
    file_path        TEXT    NOT NULL,
    file_name        TEXT    NOT NULL,
    total_bytes      INTEGER NOT NULL DEFAULT 0,
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    channel_count    INTEGER NOT NULL DEFAULT 4,
    status           TEXT    NOT NULL,   -- Queued | Downloading | Paused
                                           -- | Completed | Failed | Cancelled
    created_at       TEXT    NOT NULL,
    completed_at     TEXT,
    last_updated     TEXT    NOT NULL,
    speed_mbps       REAL    NOT NULL DEFAULT 0,
    error_message    TEXT,
    channel_states   TEXT                 -- JSON: kanal bazlı devam
);
```

## Lisans

MIT