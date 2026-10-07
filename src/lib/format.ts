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

/** Bir indirme kaydı. */
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
}

/** Manager'ın arayüze yayınladığı olaylar. */
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
    }
  | { kind: "completed"; id: number; status: DownloadStatus }
  | { kind: "listChanged" }
  | {
      kind: "log";
      level: string;
      message: string;
      downloadId: number | null;
    };

/** Log satırı. */
export interface LogEntry {
  id: number;
  level: "info" | "success" | "warn" | "error";
  message: string;
  downloadId: number | null;
  time: string;
}

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
   Dosya sınıflandırması (kenar çubuğu kategorileri + tablo ikonu)
   ----------------------------------------------------------------- */

/** Kenar çubuğundaki kategori kutuları (IDM "Categories" bölümü). */
export type CategoryKey =
  | "video"
  | "audio"
  | "program"
  | "archive"
  | "document"
  | "other";

/**
 * Bir indirmenin uzantısına göre arayüz kategorisi.
 *
 * `settings.rs` yalnızca **hedef klasörü** çözer (Video / Ses / Diğer /
 * Genel); buradaki liste daha ayrıntılıdır ve yalnızca **görsel gruplama**
 * içindir. İki liste bağımsızdır: ayarlarda kategori klasörü değişse bile tablo
 * ikonu değişmez.
 */
const VIDEO_EXT = new Set([
  "mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg",
  "m2ts", "ts", "3gp", "rmvb", "ogv", "vob", "mts", "m2v", "divx", "mp4v",
]);

const AUDIO_EXT = new Set([
  "mp3", "flac", "wav", "aac", "ogg", "oga", "m4a", "wma", "opus", "alac",
  "aiff", "ape", "mid", "midi", "dsf", "dff", "amr", "mka",
]);

const PROGRAM_EXT = new Set([
  "exe", "msi", "apk", "dmg", "deb", "rpm", "appimage", "bat", "cmd", "com",
  "jar", "msu", "pkg", "run", "sh", "app",
]);

const ARCHIVE_EXT = new Set([
  "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz", "zst", "iso", "cbz",
  "cbr", "wim", "cab", "arj", "lzh", "z",
]);

const DOCUMENT_EXT = new Set([
  "pdf", "epub", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf",
  "odt", "ods", "csv", "md", "djvu", "mobi", "chm", "html", "htm",
]);

/** Dosya adındaki küçük harf uzantı (yoksa boş dize). */
export function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return "";
  return fileName.slice(dot + 1).toLowerCase();
}

/**
 * Dosya adını arayüz kategorisine eşler.
 *
 * Uzantı yoksa `other` döner; kısayol (`.bashrc`) ve uzantısız dosyalar
 * yanlışlıkla "gizli dosya uzantısı" sayılmaz.
 */
export function categoryOf(fileName: string): CategoryKey {
  const ext = fileExtension(fileName);
  if (!ext) return "other";

  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  if (PROGRAM_EXT.has(ext)) return "program";
  if (ARCHIVE_EXT.has(ext)) return "archive";
  if (DOCUMENT_EXT.has(ext)) return "document";
  return "other";
}

/** Tablo ikonunda gösterilecek kısaltma (en fazla 3 karakter, büyük harf). */
export function iconLabel(fileName: string): string {
  const ext = fileExtension(fileName);
  if (!ext) return "•";
  return ext.slice(0, 3).toUpperCase();
}