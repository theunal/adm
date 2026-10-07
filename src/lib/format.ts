/**
 * Biçimlendirme yardımcıları — tüm metinler Türkçe.
 *
 * Durum enum'ları Rust tarafında **İngilizce** saklanır (`Queued`,
 * `Downloading`, ...); bu dosya arayüzde bunları Türkçeye çevirir.
 */

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

/** Durum -> Türkçe etiket. */
const STATUS_LABELS: Record<DownloadStatus, string> = {
  Queued: "Sırada",
  Downloading: "İndiriliyor",
  Paused: "Duraklatıldı",
  Completed: "Tamamlandı",
  Failed: "Başarısız",
  Cancelled: "İptal Edildi",
};

/** Durumun Türkçe etiketini döner. */
export function statusLabel(status: DownloadStatus): string {
  return STATUS_LABELS[status] ?? status;
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
 * `formatBytes(1536)` -> `"1,5 KB"`
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
 * `formatSpeed(2.5)` -> `"2,5 MB/s"`
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

/** Saniye değerini `1s 25dk` gibi okunabilir biçime çevirir. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 1) return "1sn";

  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (days > 0) return `${days}g ${hours}s`;
  if (hours > 0) return `${hours}s ${minutes}dk`;
  if (minutes > 0) return `${minutes}dk ${secs}sn`;
  return `${secs}sn`;
}

/** ISO zaman damgasını `14:32:05` biçimine çevirir. */
export function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("tr-TR", { hour12: false });
}

/** ISO zaman damgasını `07.10.2026 14:32` biçimine çevirir. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Sayıyı Türkçe biçimde yazar (ondalık ayırıcı virgül). */
export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString("tr-TR", {
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
  return new Date().toLocaleTimeString("tr-TR", { hour12: false });
}