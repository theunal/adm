/**
 * Biçimlendirme yardımcıları.
 *
 * Durum enum'ları Rust tarafında **İngilizce** saklanır (`Queued`,
 * `Downloading`, ...); bu dosya arayüzde bunları etkin dile çevirir.
 *
 * Etiketler `lib/i18n` sözlüğünde, sayı/zaman biçimleri `localeTag()` ile
 * `Intl` üzerinden üretilir.
 */
import { localeTag, t } from "./i18n";

/** Rust tarafındaki durum değerleri (birebir eşleşme). */
export type DownloadStatus =
  | "Queued"
  | "Downloading"
  | "Paused"
  | "Completed"
  | "Failed"
  | "Cancelled";

/** Tek bir kanalın aralık ve ilerleme durumu. */
export interface ChannelState {
  id: number;
  startByte: number;
  endByte: number;
  currentByte: number;
  finished: boolean;
}

/** Hız geçmiği örneği (sparkline grafiği için). */
export interface SpeedSample {
  t: number;
  speedMbps: number;
}

/** Bir indirmenin türü — MC `DownloadKind` portu. */
export type DownloadKind = "file" | "video";

/**
 * Bir indirme kaydı.
 *
 * `kind`, `stage`, `log`… alanları MC portuyla eklendi: `video` türündeki
 * kayıtlar motor yerine yt-dlp ile indirilir ve detay penceresi ham günlüğü
 * gösterir.
 */
export interface DownloadItem {
  id: number;
  url: string;
  filePath: string;
  fileName: string;
  totalBytes: number;
  downloadedBytes: number;
  channelCount: number;
  status: DownloadStatus;
  createdAt: string;
  completedAt: string | null;
  lastUpdated: string;
  speedMbps: number;
  errorMessage: string | null;
  channels: ChannelState[];

  /** Dosya mı, yt-dlp videosu mu? */
  kind: DownloadKind;
  /** Sunucu `Range` destekliyor mu (detay penceresi). */
  supportsRanges: boolean;
  /** Uzantıdan gelen ek başlıklar (`[ad, değer]` çiftleri). */
  headers: [string, string][];
  /** Uzantıdan gelen çerezlerin yazıldığı Netscape dosyası. */
  cookieFile: string | null;
  /** Tamamlandığında dosyanın nihai yolu (kategori klasörü dahil). */
  finalPath: string | null;
  /** yt-dlp faz metni ("Video indiriliyor…"). */
  stage: string;
  /** yt-dlp ham çıktısı (detay penceresindeki günlük). */
  log: string;
}

/** Harici araç kimlikleri (`tools::Tool::as_str` ile birebir). */
export type ToolId = "ytdlp" | "ffmpeg" | "deno";

/**
 * Harici araç kurulum olayı.
 *
 * Ayırt edici alan `event`'tir, `kind` **değil**: Rust tarafında bu olay
 * `DownloadEvent::Tool` içinde iç içe serileştirilir ve dış enum zaten
 * `kind` etiketini yazar (bkz. `tools::ToolEvent`).
 */
export type ToolEvent =
  | { event: "started"; tool: string }
  | { event: "progress"; tool: string; fraction: number }
  | { event: "message"; tool: string; text: string }
  | { event: "installed"; tool: string; version: string }
  | { event: "failed"; tool: string; error: string };

/**
 * Tarayıcı köprüsünün çalışma durumu (durum çubuğu göstergesi).
 *
 * `bridge` olayı ve `bridge_status` komutu aynı biçimi paylaşır.
 */
export interface BridgeStatus {
  running: boolean;
  port: number;
  /** Köprüye bağlanmış tarayıcılar (son görülme sırasıyla). */
  browsers: string[];
}

/** Güncelleme denetiminin sonucu (`update` olayı). */
export interface UpdateInfo {
  /** Kurulu sürüm. */
  current: string;
  /** Yeni sürüm (yoksa güncel). */
  latest: string | null;
  /** Sürüm notları sayfası. */
  pageUrl: string | null;
  /** Sürüm notları (varsa). */
  notes: string | null;
  /** İndirme adresi (ADM kendi indirmesiyle indirir). */
  dmgUrl: string | null;
  /** Denetim hatası (yoksa `null`). */
  error: string | null;
}

/** Panoda bulunan bağlantılar için sorulan soru. */
export interface ClipboardPrompt {
  urls: string[];
  /** Kaynak: pano izleme mi, yapıştırma mı? */
  source: string;
  /** Tümü video sayfası gibi görünüyorsa önce "video" seçeneği sunulur. */
  preferVideo: boolean;
}

/**
 * Manager'ın arayüze yayınladığı olaylar.
 *
 * Her varyant Rust `DownloadEvent`'iyle birebir eşleşir (`kind` etiketi
 * `serde(tag = "kind", rename_all = "camelCase")` ile üretilir).
 */
export type DownloadEvent =
  | {
      kind: "progress";
      id: number;
      downloadedBytes: number;
      totalBytes: number;
      speedMbps: number;
      status: DownloadStatus;
      channels: ChannelState[];
      speedHistory: SpeedSample[];
      errorMessage: string | null;
      phase: string;
      stage: string;
      log: string | null;
    }
  | { kind: "completed"; id: number; status: DownloadStatus }
  | { kind: "listChanged" }
  | {
      kind: "log";
      level: string;
      message: string;
      downloadId: number | null;
    }
  | { kind: "bridge"; running: boolean; port: number; error: string | null }
  | { kind: "bridgeConnection"; browser: string }
  | ({ kind: "tool" } & ToolEvent)
  | {
      kind: "update";
      current: string;
      latest: string | null;
      pageUrl: string | null;
      notes: string | null;
      dmgUrl: string | null;
      error: string | null;
    }
  | ({ kind: "clipboard" } & ClipboardPrompt);

/**
 * Durumun etkin dildeki etiketini döner.
 *
 * Sözlük anahtarları `status.<Rust değeri>` biçimindedir; tanımsız bir durum
 * için `t()` anahtarı kendini döner, böylece sessizce boş metne düşülmez.
 */
export function statusLabel(status: DownloadStatus): string {
  return t(`status.${status}`);
}

/** Durumun CSS sınıfı (renk paleti için). */
export function statusClass(status: DownloadStatus): string {
  return `status-${status.toLowerCase()}`;
}

/** Yüzde 0..=100 tamamlanma oranı. */
export function percentOf(downloaded: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (downloaded / total) * 100));
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/**
 * Bayt değerini okunabilir biçime çevirir.
 * `formatBytes(1536)` -> TR `"1,5 KB"` / EN `"1.5 KB"`
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  // Bayt dışındaki birimlerde bir ondalık yeterli.
  const decimals = unit === 0 || value >= 100 ? 0 : 1;
  return `${formatNumber(value, decimals)} ${BYTE_UNITS[unit]}`;
}

/**
 * Hız değerini okunabilir biçime çevirir.
 * `formatSpeed(2.5)` -> TR `"2,5 MB/s"` / EN `"2.5 MB/s"`
 */
export function formatSpeed(mbps: number): string {
  if (!Number.isFinite(mbps) || mbps <= 0) return "—";
  return `${formatBytes(mbps * 1024 * 1024)}/s`;
}

/** Geri kalan süreyi tahmin eder (`null` ise hesaplanamaz). */
export function formatEta(
  downloaded: number,
  total: number,
  mbps: number,
): string | null {
  if (total <= 0 || mbps <= 0.01 || downloaded >= total) return null;
  const remaining = (total - downloaded) / (mbps * 1024 * 1024);
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  return formatDuration(remaining);
}

/**
 * Saniye değerini okunabilir biçime çevirir.
 *
 * TR: `1sn`, `25dk 05sn`, `3s 12dk`, `2g 4s`
 * EN: `1s`, `25m 05s`, `3h 12m`, `2d 4h`
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 1) return t("dur.one_second");

  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (days > 0) return t("dur.days_hours", { days, hours });
  if (hours > 0) return t("dur.hours_minutes", { hours, minutes });
  if (minutes > 0) return t("dur.minutes_seconds", { minutes, seconds: secs });
  return t("dur.seconds_only", { seconds: secs });
}

/** ISO zaman damgasını `14:32:05` biçimine çevirir. */
export function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(localeTag(), { hour12: false });
}

/** ISO zaman damgasını `07.10.2026 14:32` biçimine çevirir. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(localeTag(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * ISO zaman damgasını kısa biçime çevirir: bu yıl ise `07 Ağu`,
 * farklı yıl ise `07.08.2025`.
 *
 * Listede "Ekleme" sütunu için; yılı her satırda tekrarlamak gürültü yaratır.
 */
export function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";

  const opts: Intl.DateTimeFormatOptions =
    date.getFullYear() === new Date().getFullYear()
      ? { day: "2-digit", month: "short" }
      : { day: "2-digit", month: "2-digit", year: "2-digit" };

  return date.toLocaleDateString(localeTag(), opts);
}

/** Sayıyı etkin dilin biçiminde yazar (TR'de ondalık ayırıcı virgül). */
export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString(localeTag(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** URL'den okunabilir bir etiket üretir (kart başlığı için). */
export function urlLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return host;
    return `${host}/${segments[segments.length - 1]}`;
  } catch {
    return url;
  }
}

/** Log zaman damgası (saniye çözünürlüğü). */
export function nowStamp(): string {
  return new Date().toLocaleTimeString(localeTag(), { hour12: false });
}

/* -----------------------------------------------------------------
   URL doğrulama (yeni indirme penceresi)
   ----------------------------------------------------------------- */

/** Adres denetiminin sonucu; `reason` i18n anahtarına çevrilir. */
export type UrlCheck =
  | { ok: true }
  | { ok: false; reason: "empty" | "syntax" | "scheme" };

/**
 * İndirilecek adresi doğrular.
 *
 * Sırayla üç soru: adres var mı, `new URL` ayrıştırabiliyor mu, protokol
 * http/https mi.
 *
 * * `trim()` yalnızca boş girdiyi "boş" saymak için gerekli: URL ayrıştırıcı
 *   dış boşlukları kendisi attığı için `"   "` da parse hatası verirdi ve
 *   kullanıcı "geçersiz adres" yerine "adres girin" mesajını görmeli.
 * * `javascript:` gibi şemalar "scheme" olarak elenir — motor yalnızca
 *   http/https indirir, diğerleri sessizce takılı kalmasın.
 *
 * Şema denetimi sona bırakıldı çünkü `htp:/a.com` gibi yanlış yazılmış bir şema
 * ayrıştırılabilir (`protocol=htp:`) ve "yalnızca http/https" mesajı "geçersiz
 * adres"den daha doğru bir ipucu verir. Ayrıştırılmış bir http/https adresinin
 * ana makinesi zaten boş olamaz (`new URL("http://")` hata verir), bu yüzden
 * ayrıca denetlenmez.
 */
export function checkDownloadUrl(raw: string): UrlCheck {
  const value = raw.trim();
  if (!value) return { ok: false, reason: "empty" };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "syntax" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "scheme" };
  }

  return { ok: true };
}

/* -----------------------------------------------------------------
   Dosya sınıflandırması (kenar çubuğu kategorileri + tablo ikonu)
   ----------------------------------------------------------------- */

/**
 * MC'nin yedi kategorisi (`categories::Category` ile birebir).
 *
 * Kenar çubuğu filtreleri, tablodaki kategori alt metni ve ayarlardaki
 * yakalama grupları bu taksonomiyi paylaşır.
 */
export type CategoryKey =
  | "image"
  | "music"
  | "video"
  | "apps"
  | "document"
  | "compressed"
  | "other";

/** Kenar çubuğu ve tablo sırası (Rust `Category::all()` ile aynı). */
export const CATEGORY_ORDER: CategoryKey[] = [
  "image",
  "music",
  "video",
  "apps",
  "document",
  "compressed",
  "other",
];

/**
 * Uzantı tablosu — Rust `categories::TABLE` portu.
 *
 * Sıra önemlidir: ilk eşleşen kategori kazanır, `other` tabloda yoktur ve
 * hiçbir gruba girmeyen uzantılar oraya düşer.
 */
const CATEGORY_TABLE: [CategoryKey, Set<string>][] = [
  [
    "image",
    new Set([
      "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tiff", "tif",
      "svg", "psd", "ai", "raw", "cr2", "nef", "ico",
    ]),
  ],
  [
    "music",
    new Set([
      "mp3", "m4a", "aac", "flac", "wav", "ogg", "opus", "wma", "aiff", "alac",
    ]),
  ],
  [
    "video",
    new Set([
      "mp4", "m4v", "mkv", "webm", "mov", "avi", "flv", "wmv", "mpg", "mpeg",
      "ts", "m3u8", "3gp",
    ]),
  ],
  [
    "apps",
    new Set([
      "dmg", "pkg", "app", "exe", "msi", "apk", "ipa", "deb", "rpm", "appimage",
      "jar", "xpi", "crx",
    ]),
  ],
  [
    "document",
    new Set([
      "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "odt",
      "ods", "odp", "epub", "mobi", "csv", "md", "pages", "numbers", "key",
    ]),
  ],
  [
    "compressed",
    new Set([
      "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst", "iso", "img",
      "cab",
    ]),
  ],
];

/** Dosya adındaki küçük harf uzantı (yoksa boş dize). */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return "";
  return fileName.slice(dot + 1).toLowerCase();
}

/**
 * Dosya adını kategoriye eşler.
 *
 * Uzantı yoksa `other` döner; kısayol (`.bashrc`) ve uzantısız dosyalar
 * yanlışlıkla "gizli dosya uzantısı" sayılmaz.
 */
export function categoryOf(fileName: string): CategoryKey {
  const ext = fileExtension(fileName);
  if (!ext) return "other";
  for (const [category, extensions] of CATEGORY_TABLE) {
    if (extensions.has(ext)) return category;
  }
  return "other";
}

/** Kategorinin etkin dildeki adı. */
export function categoryLabel(category: CategoryKey): string {
  return t(`cat.${category}`);
}

/** Tablo ikonunda gösterilecek kısaltma (en fazla 3 karakter, büyük harf). */
export function iconLabel(fileName: string): string {
  const ext = fileExtension(fileName);
  if (!ext) return "•";
  return ext.slice(0, 3).toUpperCase();
}