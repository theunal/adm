/**
 * Sinyal tabanlı indirme deposu.
 *
 * WPF sürümünde 500 ms'de bir `SELECT *` ile tüm liste tazeleniyordu;
 * burada Rust tarafından yayınlanan gerçek zamanlı olaylar dinlenir ve
 * yalnızca değişen kayıt güncellenir.
 */
import { createStore, produce } from "solid-js/store";
import { createSignal } from "solid-js";
import {
  listDownloads,
  onDownloadEvent,
} from "./api";
import {
  nowStamp,
  percentOf,
  statusLabel,
  type DownloadEvent,
  type DownloadItem,
  type DownloadStatus,
  type LogEntry,
  type SpeedSample,
} from "./format";

/** Sekmeler. */
export type Tab = "active" | "history";

/** Maksimum log satırı (bellek sınırlı kalsın). */
const MAX_LOGS = 300;

interface DownloadState {
  /** Tüm kayıtlar (kimliğe göre indeksli). */
  byId: Record<number, DownloadItem>;
  /** Ekranda gösterilecek sıra. */
  order: number[];
  /** Canlı hız geçmişi (yalnızca bellekte tutulur). */
  speedHistory: Record<number, SpeedSample[]>;
  /** İlerleme olayından gelen anlık hız. */
  speed: Record<number, number>;
  /** Aynı id için işlem bekleyen mi? (çift tıklama koruması). */
  busy: Record<number, boolean>;
}

const [state, setState] = createStore<DownloadState>({
  byId: {},
  order: [],
  speedHistory: {},
  speed: {},
  busy: {},
});

const [logs, setLogs] = createStore<{ entries: LogEntry[] }>({ entries: [] });
const [activeTab, setActiveTab] = createSignal<Tab>("active");
const [ready, setReady] = createSignal(false);

let logSeq = 0;

/** Yeni log satırı ekler ve listeyi sınırlar. */
function pushLog(
  level: LogEntry["level"],
  message: string,
  downloadId: number | null,
) {
  logSeq += 1;
  const entry: LogEntry = {
    id: logSeq,
    level,
    message,
    downloadId,
    time: nowStamp(),
  };

  setLogs(
    "entries",
    produce((list) => {
      list.push(entry);
      if (list.length > MAX_LOGS) {
        list.splice(0, list.length - MAX_LOGS);
      }
    }),
  );
}

/** Log panelini temizler. */
export function clearLogs() {
  setLogs("entries", []);
}

/** Aktif sekmeyi değiştirir. */
export function selectTab(tab: Tab) {
  setActiveTab(tab);
}

/** İndirmenin şu an çalışıp çalışmadığını döner. */
function isRunning(item: DownloadItem): boolean {
  return item.status === "Queued" || item.status === "Downloading";
}

/** İlerleme yüzdesi. */
export function itemPercent(id: number): number {
  const item = state.byId[id];
  if (!item) return 0;
  return percentOf(item.downloadedBytes, item.totalBytes);
}

/** Anlık hız (MB/s). */
export function itemSpeed(id: number): number {
  return state.speed[id] ?? 0;
}

/** Hız geçmişi (sparkline). */
export function itemHistory(id: number): SpeedSample[] {
  return state.speedHistory[id] ?? [];
}

/** Bir kayıt şu an işlemde mi? */
export function isBusy(id: number): boolean {
  return state.busy[id] ?? false;
}

/** Başarısız indirmelerin listesi (geçmiş sekmesinde uyarı olarak). */
export function failedItems(): DownloadItem[] {
  return allItems().filter((i) => i.status === "Failed");
}

/** Tüm kayıtlar (sıralı). */
export function allItems(): DownloadItem[] {
  return state.order
    .map((id) => state.byId[id])
    .filter((i): i is DownloadItem => Boolean(i));
}

/**
 * Aktif sekmesindeki kayıtlar: çalışan ve duraklatılmış olanlar,
 * en son güncellenen üstte.
 */
export function activeItems(): DownloadItem[] {
  return allItems()
    .filter((i) => i.status === "Queued" || i.status === "Downloading" || i.status === "Paused")
    .sort((a, b) => {
      const ra = isRunning(a) ? 1 : 0;
      const rb = isRunning(b) ? 1 : 0;
      if (ra !== rb) return rb - ra;
      return b.lastUpdated.localeCompare(a.lastUpdated);
    });
}

/** Geçmiş sekmesindeki kayıtlar: tamamlanmış / başarısız / iptal. */
export function historyItems(): DownloadItem[] {
  return allItems()
    .filter((i) => i.status !== "Queued" && i.status !== "Downloading" && i.status !== "Paused")
    .sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
}

/** Sekmeye göre görünür liste. */
export function visibleItems(): DownloadItem[] {
  return activeTab() === "active" ? activeItems() : historyItems();
}

/** Sekmedeki kayıt sayısı. */
export function activeCount(): number {
  return allItems().filter(
    (i) => i.status === "Queued" || i.status === "Downloading" || i.status === "Paused",
  ).length;
}

export function historyCount(): number {
  return allItems().length - activeCount();
}

/** Genel özet: toplam indirilen bayt ve anlık toplam hız. */
export function summary(): { totalDownloaded: number; totalSpeed: number } {
  let totalDownloaded = 0;
  let totalSpeed = 0;

  for (const id of state.order) {
    const item = state.byId[id];
    if (!item) continue;
    if (item.status === "Completed") {
      totalDownloaded += item.downloadedBytes;
    } else if (isRunning(item)) {
      totalDownloaded += item.downloadedBytes;
      totalSpeed += state.speed[id] ?? 0;
    }
  }

  return { totalDownloaded, totalSpeed };
}

/** Bir kaydın durumunu işaretliyor. */
export function markBusy(id: number, busy: boolean) {
  setState("busy", id, busy);
}

/** Kaydı arayüz durumuna ekler/günceller. */
function upsert(item: DownloadItem) {
  setState("byId", item.id, item);
  if (!state.order.includes(item.id)) {
    setState("order", (o) => [item.id, ...o]);
  }
}

/** İlerleme olayını uygular. */
function applyProgress(ev: Extract<DownloadEvent, { kind: "progress" }>) {
  const existing = state.byId[ev.id];

  // Hız geçmişini güncelle (yalnızca bellekte).
  if (ev.speedHistory.length > 0) {
    setState("speedHistory", ev.id, [...ev.speedHistory]);
  }
  setState("speed", ev.id, ev.speedMbps);

  if (!existing) {
    // Kayıt henüz yüklenmediyse tam veri gelene kadar bekle.
    return;
  }

  setState(
    "byId",
    ev.id,
    produce((item) => {
      item.downloadedBytes = ev.downloadedBytes;
      if (ev.totalBytes > 0) item.totalBytes = ev.totalBytes;
      item.speedMbps = ev.speedMbps;
      item.channels = ev.channels;
      item.lastUpdated = new Date().toISOString();
      if (existing.status !== "Paused") {
        item.status = ev.status;
      }
    }),
  );
}

/** Tamamlanma olayını uygular. */
function applyCompleted(ev: Extract<DownloadEvent, { kind: "completed" }>) {
  const existing = state.byId[ev.id];
  setState("speed", ev.id, 0);

  // Görev bitti: bekleyen komut kilidi kalkmalı, aksi halde karttaki
  // düğmeler pasif kalır ve kullanıcı yeniden başlatamaz.
  setState("busy", ev.id, false);

  if (!existing) return;

  setState(
    "byId",
    ev.id,
    produce((item) => {
      item.status = ev.status;
      item.speedMbps = 0;
      item.lastUpdated = new Date().toISOString();
      if (ev.status === "Completed") {
        item.downloadedBytes = item.totalBytes;
        item.completedAt = new Date().toISOString();
        item.errorMessage = null;
      }
    }),
  );

  pushLog(
    ev.status === "Completed" ? "success" : "info",
    `${itemName(ev.id)}: ${statusLabel(ev.status)}`,
    ev.id,
  );
}

function itemName(id: number): string {
  return state.byId[id]?.fileName ?? `#${id}`;
}

/**
 * Log satırı ekler (bileşenler bu fonksiyonu kullanır).
 *
 * `useFeedback` modülü bu fonksiyona bağlanır; böylece bileşenlerin
 * `store` detaylarına (iç `pushLog` dahil) doğrudan erişmesi gerekmez.
 */
export function appendLog(
  level: LogEntry["level"],
  message: string,
  downloadId: number | null = null,
) {
  pushLog(level, message, downloadId);
}

/** Yükleme tamamlandı mı? */
export { ready, activeTab, logs, state };

/**
 * Depoyu başlatır: ilk veriyi yükler ve olaylara abone olur.
 *
 * Uygulama açılışında bir kez çağrılır.
 */
export async function initStore(): Promise<void> {
  try {
    const items = await listDownloads();
    setState("byId", {});
    setState("order", []);
    for (const item of items) {
      upsert(item);
    }
    pushLog("info", `${items.length} kayıt yüklendi`, null);
  } catch (e) {
    pushLog("error", `Kayıtlar yüklenemedi: ${errorText(e)}`, null);
  }

  await onDownloadEvent((ev) => {
    switch (ev.kind) {
      case "progress":
        applyProgress(ev);
        break;
      case "completed":
        applyCompleted(ev);
        break;
      case "listChanged":
        void reloadList();
        break;
      case "log":
        pushLog(
          (ev.level as LogEntry["level"]) ?? "info",
          ev.message,
          ev.downloadId ?? null,
        );
        break;
    }
  });

  setReady(true);
}

/** Listeyi veritabanından yeniden okur. */
async function reloadList(): Promise<void> {
  try {
    const items = await listDownloads();
    const seen = new Set<number>();

    setState("byId", {});
    setState("order", []);
    for (const item of items) {
      upsert(item);
      seen.add(item.id);
    }

    // Silinen kayıtların hız verisini temizle.
    for (const id of Object.keys(state.speed)) {
      if (!seen.has(Number(id))) {
        setState("speed", Number(id), undefined as unknown as number);
        setState("speedHistory", Number(id), undefined as unknown as SpeedSample[]);
      }
    }
  } catch (e) {
    pushLog("error", `Liste yenilenemedi: ${errorText(e)}`, null);
  }
}

/** Hata nesnesini Türkçe metne çevirir. */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return "Bilinmeyen hata";
}

/** Durumun Türkçe etiketi (şablonlarda kullanılır). */
export { statusLabel };
export type { DownloadItem, DownloadStatus, LogEntry };