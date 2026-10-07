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
- **FDM düzeninde arayüz** — düz koyu tema, araç çubuğunda filtre ve sıralama
  açılır listeleri ile arama kutusu, ızgara tabloda sütunlu liste (Boyut ·
  Durum · Hız · Kalan · Ekleme), sürükle-bırak boş alanı, alt dock (hız grafiği
  / olay günlüğü) ve durum çubuğunda ana açık/kapalı anahtarı ile kalite
  rozeti
- **Arama ve sıralama** — liste dosya adı ve adres içinde süzülür; duruma,
  tarihe, ada, boyuta veya ilerlemeye göre sıralanır
- **Toplu işlemler** — duraklat / sürdür / iptal tüm listeye tek komutla
  uygulanır; silme seçili satırlarda çalışır
- **Çoklu seçim** — Ctrl/Shift ile satır seçimi, sağ tık bağlam menüsü,
  çift tıkla dosya açma
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

Arayüz Free Download Manager düzenini takip eder: başlık çubuğu → araç çubuğu
→ tablo → alt dock → durum çubuğu. Kenar çubuğu ve menü çubuğu satırı yoktur:
görev/kategori filtreleri araç çubuğundaki açılır listede, menüler ≡ panelinde
toplanmıştır.

```text
src/                     SolidJS arayüzü
├── App.tsx              uygulama kabuğu (yerleşim + klavye kısayolları)
├── components/
│   ├── TitleBar.tsx         pencere başlığı + dil anahtarı + pencere düğmeleri
│   ├── MenuBar.tsx          ≡ paneli: Dosya / İndirmeler / Görevler / Seçenekler / Yardım
│   ├── Toolbar.tsx          filtre ▾ · sıralama ▾ · "İndirme ekle" · arama · ≡
│   ├── NewDownloadDialog.tsx  URL alanı + doğrulama + hedef klasör önizlemesi
│   ├── DownloadTable.tsx    grid başlıkları + satırlar + sürükle-bırak boş alanı
│   ├── DownloadRow.tsx      tek satır (onay kutusu, ince ilerleme çizgisi, ⋮ menüsü)
│   ├── FileIcon.tsx         uzantıya göre dosya simgesi
│   ├── RowContextMenu.tsx   sağ tık menüsü (tek katmanda çizilir) + kanal düzenleyici
│   ├── PropertiesDialog.tsx indirme özellikleri penceresi
│   ├── AboutDialog.tsx      "ADM Hakkında" penceresi
│   ├── BottomDock.tsx       alt dock (hız grafiği / olay günlüğü sekmeleri)
│   ├── SpeedGraph.tsx       büyük dinamik hız grafiği + istatistikler
│   ├── LogPanel.tsx         olay günlüğü listesi
│   ├── SettingsPanel.tsx    ayarlar (≡ menüsünden açılır)
│   ├── Sparkline.tsx        satır içi mini hız grafiği
│   └── StatusBar.tsx        ana açık/kapalı · hız · kalite · boş alan · panel düğmesi
├── lib/
│   ├── api.ts            Tauri komutları ve olay aboneliği
│   ├── store.ts          sinyal tabanlı durum yönetimi (filtre, arama, sıralama, seçim)
│   ├── bulk.ts           toplu işlemler (tek komut ya da seçili satırlar)
│   ├── ui.ts             kabuk düzeyi arayüz durumu (pencere, panel, menü)
│   ├── settings.ts       ayarlar okuma/yazma
│   ├── format.ts         biçimlendirme + URL doğrulama + dosya kategorileri
│   └── i18n/             TR/EN sözlükleri
└── styles.css            tasarım sistemi (düz koyu tema, mavi aksan)

src-tauri/src/
├── models.rs     DownloadStatus, ChannelState, DownloadItem
├── db.rs         sqlx/SQLite: havuz, şema, CRUD
├── engine.rs     çok kanallı indirme motoru
├── manager.rs    DashMap + broadcast: görev yönetimi, toplu işlemler
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