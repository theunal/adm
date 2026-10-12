# ADM — Gelişmiş İndirme Yöneticisi

Çok kanallı indirme yapabilen, tarayıcıyla bütünleşen masaüstü uygulaması.
**Rust + Tauri 2** arka plan, **SolidJS** arayüz.

WPF sürümünün (.NET 10) Rust/Tauri karşılığıdır; arayüz ve motor davranışları
macOS **MC Download Manager** (Swift/SwiftUI) uygulamasından birebir port
edilmiştir. Taşıma sırasında WPF'teki hatalar düzeltilmiş, arayüz MC düzenine
(kenar çubuğu + tablo + durum çubuğu + dosya bazlı detay penceresi) göre
yeniden kurulmuştur.

---

## Özellikler

### İndirme motoru

- **Çok kanallı indirme** — 1–32 kanal, kanal başına en az 1 MB
- **Kanal bazlı devam** — duraklatıldığında kanal sınırları saklanır, kaldığı
  bayttan devam eder
- **İş hırsızlığı** — biten kanal, en çok işi kalan kanalın yarısını üstlenir
- **Adaptif sınırlama** — sunucu `408 / 425 / 429 / 500 / 502 / 503 / 504`
  döndürdüğünde açık kanal sayısı bir azalır, başarılı istekte geri artar
  (MC `throttle` / `activeLimit`); geri çekilme eğrisi `min(15, 1.5 × deneme)`
  saniye, kanal başına en fazla 12 deneme
- **`200` → tek akış** — `Range` isteğine `206` yerine `200` gelirse tek akışa
  düşülür ve dosya bozulmaz
- **Kuyruk** — `max_concurrent` sınırı dolduğunda yeni indirmeler `Queued`
  kalır, bir indirme bitince kuyruk kendiliğinden pompalanır

### Tarayıcı bütünleşmesi

- **Tarayıcı uzantısı** (Chrome / Edge / Brave / Firefox) — indirmeleri
  yakalar, medyayı koklar, rozet üzerinde ilerleme gösterir, bağlam menüleri
  ve çerez aktarımı sunar
- **Yerel köprü** — `127.0.0.1:<port>` üzerinde yalnızca uzantı kaynaklı
  istekleri kabul eden HTTP sunucusu (`/ping`, `/downloads`, `/download`,
  `/action`); `Host` doğrulaması ve CORS kapsamı MC ile birebir
- **Kurulum sihirbazı** — tarayıcı başına adım adım yönlendirme; eklenti
  dosyaları `%LocalAppData%\ADM\Browser Plugins\<Tarayıcı>` altına kopyalanır
- **Pano izleyici** — panoya kopyalanan bağlantılar için sorar
  (video / dosya / yoksay); video sayfalarında önce "video" seçeneği sunulur

### Video (yt-dlp)

- **yt-dlp / ffmpeg / deno** çalışma anında GitHub'dan indirilip
  `%LocalAppData%\ADM\tools` altına kurulur
- **Site girişi** — uygulama içi giriş penceresi (Tauri + WebView2);
  çerezler Netscape biçiminde dışa aktarılır ve yt-dlp'ye verilir
- **Biçim seçicileri** — kap (mp4 / webm / mkv / özgün), azami yükseklik,
  özel `-f` ifadesi; etkin argümanlar ayarlarda canlı önizlenir
- **Faz takibi** — `MCFMT|` / `Destination:` / `[Merger]` / `[ExtractAudio]`
  satırları kullanıcıya okunur faz metnine çevrilir, günlük son 6000 karakter
  tutulur

### Arayüz

- **MC düzeni** — kenar çubuğu (Tümü · 7 kategori · Biten · Bitmeyen), ızgara
  tablo, durum çubuğu ve dosya bazlı detay penceresi
- **Tablo kolonları** — Ad (kategori simgesi + kategori alt metni) · Boyut ·
  Durum (% + faz metni + parça çubuğu) · Hız · Kalan · Ekleme
- **Detay penceresi** — bilgi ızgarası, ilerleme, bağlantı tablosu
  (N. / İndirilen / Başlangıç / Bilgi), video için yt-dlp günlüğü,
  tamamlandı görünümü (Aç / Klasörde Göster)
- **Sekmeli ayarlar** — Genel · Dosya Türleri · Tarayıcılar · Video · Arayüz
- **Toplu işlemler** — duraklat / sürdür / iptal / bittenleri temizle
- **Çoklu seçim** — Ctrl/Shift ile satır seçimi, sağ tık bağlam menüsü,
  çift tıkla dosya açma
- **Gerçek zamanlı arayüz** — 500 ms'de bir olay; hız, kalan süre, kanal
  dağılımı ve hız grafiği
- **Türkçe / İngilizce** — arayüz, loglar ve hata mesajları
  (`src/lib/i18n/`, `src-tauri/src/i18n.rs`); durum enum'ları veritabanında
  İngilizce kalır, okunurken seçili dile çevrilir
- **Tepsi simgesi** — Göster / Gizle · Tümünü Duraklat / Sürdür · Çık;
  "kapatınca tepsiye küçült" açıkken pencere kapanmaz, gizlenir
- **Kalıcı geçmiş** — SQLite (`%LocalAppData%\ADM\downloads.db`, WAL)
- **Graceful shutdown** — kapanırken aktif indirmeler iptal edilir, kanal
  durumları kaydedilir

> **Henüz bağlanmayan ayarlar.** `notify_on_complete` (tamamlanma bildirimi),
> `show_detail_on_start` (başlarken detayı aç), `autostart` (Windows açılışta
> başlat kaydı) ve `start_in_tray` (tepside gizli başlat) veritabanında
> saklanır ve arayüzde görünür, ancak davranışları henüz uygulanmamıştır.

## Düzeltilen hatalar (WPF sürümünden taşınırken)

| WPF hatası | Buradaki çözüm |
|---|---|
| TLS doğrulaması kapatılmıştı (`RemoteCertificateValidationCallback = true`) | `reqwest` + `rustls`; sertifika doğrulaması **açık**, `danger_accept_invalid_certs` hiç çağrılmıyor |
| `Range` isteğine `200 OK` dönünce tüm dosya aralık konumuna yazılıyordu (dosya sessizce bozuluyordu) | `206 Partial Content` **zorunlu**; ayrıca dönen `Content-Range` doğrulanır |
| Sonsuz yeniden deneme (`while` döngüsü, sayaç yok) | Kanal başına en fazla **12 deneme**, geri çekilme, sonra `Failed` |
| `DownloadedBytes` tek sayıydı; kanal sınırları kayboluyordu, resume bozuktu | `ChannelStates` JSON sütununda **gerçekten yazılır**, kanaldan kanala devam sağlanır |
| Dosya önceden ayrılmıyordu; çok kanallı yazma bozuk veri üretiyordu | `set_len` ile ön ayrım; her kanal kendi aralığına konumlanıp yazar |
| `PauseDownloadAsync` yalnızca bayrak set ediyordu, görev çalışmaya devam ediyordu | Duraklatma `AbortSignal` ile görevi gerçekten durdurur |
| `DeleteDownloadAsync` dosyayı silmiyordu | `delete` komutu dosyayı da siler (`delete_file` seçeneği) |
| Kapanışta aktif indirmeler sahipsiz kalıyordu | `shutdown_all()` iptal eder ve görevlerin bitmesini bekler |
| Paylaşılan `DbContext` thread-safety sorunları | `SqlitePool` (`Send + Sync`), WAL modu |
| 500 ms'de bir tüm tabloyu `SELECT` ediyordu | Yalnızca değişen kayıt, Tauri olayı ile güncellenir |

## MC portu sırasında bulunan hatalar

| Bulgu | Çözüm |
|---|---|
| `DownloadEvent::Tool` iç etiketi dış etiketle çakışıyordu; JSON'da `"kind"` anahtarı iki kez çıkıyor ve arayüz araç olaylarını hiç göremiyordu | İç etiket `event` olarak yeniden adlandırıldı + regresyon testi eklendi |
| Sınırlama kodları listesinde `504` eksikti; ağ geçidi zaman aşımı sert hata sayılıp kanal düşürülmüyordu | `THROTTLE_STATUSES` MC ile aynı yedi koda tamamlandı |
| yt-dlp başlatılamadığında hiçbir olay yayınlanmıyordu; olay kanalı sessizce kapandığı için indirme **"tamamlandı"** sayılıyordu | `run` başlatma hatasını `Finished(Err)` olarak yayınlar; yönetici de `Finished` görülmeden kapanan akışı hata sayar |
| Video indirmesi duraklatıldığında/iptal edildiğinde de **"tamamlandı"** sayılıyordu | Video akışı `paused` bayrağına göre `Paused` / `Cancelled` yazar (dosya yolundaki `finalize` ile aynı) |

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

## Tarayıcı uzantısı

`src-extension/` — Chrome / Edge / Brave / Firefox (MV3) köprü uzantısı.
Kaynaklar TypeScript ile yazılır (`src/`), `npm run extension:build` ile
derlenir. Çıktı `build/` altına yazılır: `background.js`, `content.js`,
`popup.js` betikleri `tsc` tarafından üretilir; `manifest.json`, `popup.html`,
`popup.css`, `icons/` ve `_locales/` ise
`scripts/copy-extension-assets.mjs` tarafından kopyalanır — `tsc` yalnızca
`.ts` girdileriyle çalışır.

```bash
npm run extension:build   # src/*.ts -> build/ (betikler + statik varlıklar)
npm run extension:watch   # önce tam derleme, sonra izleme modu
```

`build/` eklentinin tek çalışma anı biçimidir: Tauri paketi
(`tauri.conf.json` → `resources`) ve kurulum sihirbazı yalnızca bu klasörü
kopyalar; `src/*.ts` kaynakları pakete girmez. Depoda yalnızca kaynaklar
tutulur, `build/` `.gitignore`'dadır ve `npm run build` her çalıştığında
yeniden üretilir (bayat çıktı dağıtılmaz).

> `tauri dev` sırasında sihirbaz `src-extension/build/` klasörünü okur.
> Depoyu ilk kez klonladıktan sonra `npm run extension:build` bir kez
> çalıştırılmazsa kurulum sihirbazı "eklenti dosyaları bulunamadı" der.

`npm run typecheck` hem arayüzü hem uzantı tiplerini doğrular.

### Neden `background` iki alan içeriyor?

`manifest.json` içinde hem `service_worker` hem `scripts` aynı dosyayı
gösteriyor. Bu **bilinçli** bir tekrardır, temizlik yapılmamalıdır:

- **Chromium** (Chrome / Edge / Brave) MV3 arka planı yalnızca service
  worker olarak çalıştırır → `service_worker` alanını kullanır.
- **Firefox** `background.service_worker`'ı desteklemez**
  ([bug 1573659](https://bugzil.la/1573659)); MV3'te event page
  (`scripts`) kullanır. Yalnızca `service_worker` yazan bir manifest
  Firefox'ta **sessizce** arka plan betiğini başlatmaz — eklenti yüklenir
  ama indirme yakalama, medya koklama, sağ tık menüleri ve rozet hiç
  çalışmaz.

MDN'in önerdiği çapraz tarayıcı biçimi budur. **Not:** Chrome 121'den önce
MV3 manifestlerinde `scripts` bulunması yüklemeyi reddeder (Ocak 2024,
günümüzde güvenli alt sınır).

`browser_specific_settings.gecko.id` Firefox / addons.mozilla.org için
zorunludur; `strict_min_version: 109.0`, MV3'ün Firefox'ta genel kullanıma
girdiği sürümdür.

Uzantı, ADM'in yerel köprüsüne (`http://127.0.0.1:48213`) `X-ADM-Extension`
başlığıyla bağlanır; tarayıcı indirmelerini, sayfalarda yakalanan medyayı
(video/audio) ve bağlam menüsü isteklerini uygulamaya iletir, ilerleme durumunu
rozet ve popup üzerinden gösterir.

### Kurulum adımları

Uygulama, eklenti dosyalarını Ayarlar → **Tarayıcılar** sekmesinden hazırlar:

1. Tarayıcıyı seçip **"Dosyaları hazırla"** düğmesine basın — eklenti dosyaları
   `%LocalAppData%\ADM\Browser Plugins\<Tarayıcı>` altına kopyalanır ve yanına
   bir `README.txt` yazılır.
2. **"Uzantı sayfasını aç"** düğmesine basın (ör. `edge://extensions`).
3. Sağ üstten **Geliştirici modu**nu açın.
4. **Paketlenmemiş öğe yükle** deyin ve hazırlanan klasörü seçin.
5. Uzantı simgesine tıklayıp **"ADM'ye bağlan"** deyin; durum çubuğunda köprü
   noktası yeşile döner.

Firefox için `about:debugging#/runtime/this-firefox` sayfasında **Geçici
Eklenti Yükle** ile `manifest.json` dosyasını seçin (imzasız xpi).

**Köprü portu.** Varsayılan `48213`; Ayarlar → Tarayıcılar sekmesinden
değiştirilebilir. Port değişince köprü yeniden başlatılır ve uzantının yeniden
bağlanması gerekir. Windows güvenlik duvarı ilk çalıştırmada yerel bağlantı için
izin isteyebilir; Chrome'un Private Network Access preflight'i için gereken CORS
başlıkları sunucu tarafında verilir.

## Video indirme (yt-dlp)

Ayarlar → Video sekmesinden:

- **Site girişi** — "Giriş penceresini aç" ile oturum açın, sonra
  "Çerezleri kaydet"; çerezler yalnızca eşleşen alan adlarına gönderilir.
- **Araçlar** — yt-dlp / ffmpeg / deno satırlarından kurulum veya güncelleme.
  İlerleme olay olarak arayüze akar.
- **Biçim** — kap, azami yükseklik ve özel `-f` ifadesi; etkin yt-dlp
  argümanları kutunun altında canlı önizlenir.

> **Lisans notu.** ffmpeg ikilisi BtbN'nin Windows **GPL** derlemesinden
> indirilir. GPL koşulları bu ikilinin dağıtımı için geçerlidir; LGPL tercih
> ediliyorsa `src-tauri/src/tools.rs` içindeki `download_url` farklı bir
> kaynağa yönlendirilmelidir.

## Tepsi simgesi

Ayarlar → Genel sekmesinden:

- **"Kapatınca tepsiye küçült"** (varsayılan açık) — pencere kapatılmak
  istendiğinde gizlenir, uygulama arka planda çalışmaya devam eder.
- Tepsi menüsü: Göster · Gizle · Tümünü Duraklat · Tümünü Sürdür · Çık.
- **Çık** seçildiğinde aktif indirmeler iptal edilir ve kanal durumları
  kaydedilir (`shutdown_all`).

## Testler

```bash
cd src-tauri
cargo test             # birim + entegrasyon testleri
cargo clippy --all-targets
```

Ağa çıkmayan dört test grubu vardır:

- **Birim testleri** (`src/**/mod tests`) — kanal planlama,
  `Content-Disposition` ayrıştırma, kategori yönlendirme,
  `uniqueDestination`, yt-dlp satır ayrıştırma (`DMP` / `MCFMT` /
  `Destination` / `Merger` / `ERROR`), sürüm karşılaştırma, yakalama grubu
  eşleşmesi, adaptif sınırlama eğrisi
- **`tests/engine_integration.rs`** — yerel bir HTTP sunucusu kurar; çok
  kanallı yazma, `206` kontrolü, kanal bazlı devam, iş hırsızlığı ve iptal
  senaryoları bayt bayt doğrulanır
- **`tests/bridge_integration.rs`** — köprü geçici bir portta gerçek soketle
  çalıştırılır; `Host` reddi, CORS kapsamı, IPv6 yerel biçimi ve eşzamanlı
  istekler sınanır
- **`tests/manager_integration.rs`** — veritabanı, kuyruk sınırı
  (`max_concurrent`), olay yayını ve video hata yolları sınanır

### Elle duman testi

Arayüz ve tarayıcı bütünleşmesi otomatik test kapsamı dışındadır:

1. Edge'de uzantıyı yükle → bir dosya indirmesini yakala
2. Bir video sayfasından video indir → faz metni ve günlük görünmeli
3. Bir bağlantıyı panoya kopyala → sorma penceresi çıkmalı
4. Tepsi simgesinden Göster / Gizle / Tümünü Duraklat
5. Uygulamayı kapat/aç → kanal bazlı devam çalışmalı
6. Eski bir `downloads.db` ile aç → migration hatasız geçmeli

## İkon

`app-icon.svg` kaynak dosyasıdır; tüm platform boyutları bundan üretilir:

```bash
npm run tauri:icon
```

---

## Mimari

Arayüz MC düzenini izler: kenar çubuğu → araç çubuğu → tablo → alt dock →
durum çubuğu; detay bilgisi ayrı pencerede açılır.

```text
src/                     SolidJS arayüzü
├── App.tsx              uygulama kabuğu (yerleşim + klavye kısayolları)
├── components/
│   ├── TitleBar.tsx             pencere başlığı + dil anahtarı + pencere düğmeleri
│   ├── Sidebar.tsx              Tümü · 7 kategori (rozetli) · Biten · Bitmeyen
│   ├── Toolbar.tsx              URL ekle · kuyruğu başlat · tümünü durdur ·
│   │                            bittenleri temizle · ayarlar + arama/filtre/sıralama
│   ├── DownloadTable.tsx        ızgara başlıkları + satırlar + sürükle-bırak alanı
│   ├── DownloadRow.tsx          tek satır (onay kutusu, kategori, faz, ⋮ menüsü)
│   ├── SegmentBar.tsx           Canvas parça çubuğu (satır + detayda)
│   ├── DownloadDetailDialog.tsx detay penceresi (bilgi ızgarası, bağlantılar, günlük)
│   ├── NewDownloadDialog.tsx    tür seçimi (dosya/video) + hedef önizlemesi
│   ├── ClipboardPromptDialog.tsx panodan yakalanan bağlantılar için sorma
│   ├── BrowserSetupDialog.tsx   tarayıcı kurulum sihirbazı
│   ├── SettingsPanel.tsx        sekmeli ayarlar (Genel/Türler/Tarayıcılar/Video/Arayüz)
│   ├── MenuBar.tsx              ≡ paneli: Dosya / İndirmeler / Görevler / Seçenekler
│   ├── RowContextMenu.tsx       sağ tık menüsü + kanal düzenleyici
│   ├── FileIcon.tsx             uzantıya göre dosya simgesi
│   ├── BottomDock.tsx           alt dock (hız grafiği / olay günlüğü)
│   ├── StatusBar.tsx            köprü durumu · bitmeyen · hız · kalite · boş alan
│   └── AboutDialog.tsx          "ADM Hakkında" penceresi
├── lib/
│   ├── api.ts            Tauri komutları ve olay aboneliği
│   ├── store.ts          sinyal tabanlı durum (indirmeler, filtre, seçim, olaylar)
│   ├── settings.ts       ayarlar + yt-dlp biçim argümanları + yakalama grupları
│   ├── format.ts         biçimlendirme, URL doğrulama, kategori tablosu
│   ├── bulk.ts           toplu işlemler
│   ├── ui.ts             kabuk düzeyi arayüz durumu (pencere, panel, menü)
│   └── i18n/             TR/EN sözlükleri
└── styles.css            tasarım sistemi (düz koyu tema, mavi aksan)

src-extension/            tarayıcı uzantısı (TypeScript, MV3)
├── manifest.json         izinler: downloads, cookies, webRequest, contextMenus…
├── src/                  background / content / popup + types (tek doğruluk kaynağı)
│                         → build/ altına derlenir
├── _locales/{en,tr}      uzantı metinleri
├── icons/                uzantı simgeleri
└── build/                derlenmiş çıktı (üretilir, depoda tutulmaz) —
                          paketlenen ve sihirbazın kopyaladığı klasör

src-tauri/src/           Rust arka planı
├── lib.rs         uygulama kurulumu (tray, köprü, pano, güncelleme, yaşam döngüsü)
├── main.rs        giriş noktası
├── commands.rs    #[tauri::command] katmanı + köprü yönlendirmesi + tray
├── manager.rs     DashMap + broadcast: görev yönetimi, kuyruk, toplu işlemler
├── engine.rs      çok kanallı indirme motoru (adaptif sınırlama, 200→tek akış)
├── video.rs       yt-dlp sarmalayıcı (satır ayrıştırma, faz metinleri)
├── tools.rs       yt-dlp / ffmpeg / deno kurulumu ve doğrulaması
├── bridge.rs      yerel HTTP köprüsü (origin/Host doğrulaması, CORS)
├── clipboard.rs   pano izleyici (URL çıkarma, tekrar sormama)
├── capture.rs     yakalama grupları + uzantı eşleşmesi
├── categories.rs  7 kategorili taksonomi (klasör yönlendirmesi)
├── site_login.rs  Netscape çerez dosyası oku/yaz + durum
├── update.rs      GitHub Releases denetimi (semver karşılaştırma)
├── models.rs      DownloadItem, DownloadStatus, ChannelState, dosya adı kuralları
├── settings.rs    Settings + normalize + kategori klasörleme
├── db.rs          sqlx/SQLite: havuz, şema, migration, CRUD
└── i18n.rs        TR/EN metinleri (kanonik hata biçimi)
```

### Veri akışı

```text
engine.rs / video.rs  ──(500 ms EngineSnapshot / VideoEvent)──►  manager.rs
                                                                     │
                                       ┌─────────────────────────────┴──────────┐
                                       │                                        │
                               SqlitePool (2 sn'de bir)               tokio broadcast
                                       │                                        │
                                       ▼                                        ▼
                                 downloads.db                   Tauri olayı ──► SolidJS store
                                                                                    ▲
  tarayıcı uzantısı ──(HTTP)──► bridge.rs ──► commands.rs ──► manager.rs             │
  pano ──(arboard)──► clipboard.rs ──(olay)──────────────────────────────────────────┘
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
    channel_states   TEXT,                 -- JSON: kanal bazlı devam
    kind             TEXT    NOT NULL DEFAULT 'file',   -- file | video
    supports_ranges  INTEGER NOT NULL DEFAULT 0,
    headers          TEXT,                 -- JSON: uzantıdan gelen başlıklar
    cookie_file      TEXT,                 -- Netscape çerez dosyası yolu
    final_path       TEXT,                 -- video için yt-dlp'nin bildirdiği yol
    stage            TEXT    NOT NULL DEFAULT '',       -- faz metni
    log              TEXT    NOT NULL DEFAULT ''        -- son ~6000 karakter
);
```

Eski veritabanları açılışta `ALTER TABLE ... ADD COLUMN` ile yükseltilir
(kolon var mı diye `pragma table_info` ile bakılır); mevcut kayıtlar
`kind = 'file'` olarak doldurulur. `settings` tablosu tarayıcı köprüsü,
yakalama grupları, video ve tepsi ayarlarını da tutar.

## Lisans

MIT
