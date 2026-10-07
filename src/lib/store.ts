/**
 * Sinyal tabanlı indirme deposu.
 *
 * WPF sürümünde 500 ms'de bir `SELECT *` ile tüm liste tazeleniyordu;
 * burada Rust tarafından yayınlanan gerçek zamanlı olaylar dinlenir ve
 * yalnızca değişen kayıt güncellenir.
 *
 * Görünüm IDM düzenine göre kenar çubuğundan sürülür: `view` ya bir **görev**
 * filtresi (İndiriliyor / Tamamlandı / …) ya bir **kategori** (Video / Ses /
 * …) tutar. Aynı anda ikisinden biri etkindir — IDM'de de kategori seçimi
 * görev seçiminin yerini alır.
 */
import { createStore, produce } from "solid-js/store";
import { createSignal } from "solid-js";
import {
  listDownloads,
  onDownloadEvent,
} from "./api";
import { onLocaleChange, t } from "./i18n";
import {
  categoryOf,
  nowStamp,
  statusLabel,
  type CategoryKey,
  type DownloadEvent,
  type DownloadItem,
  type DownloadStatus,
  type LogEntry,
  type SpeedSample,
} from "./format";

/** Maksimum log satırı (bellek sınırlı kalsın). */
const MAX_LOGS = 300;

/* -----------------------------------------------------------------
   Görünüm (kenar çubuğu filtreleri)
   ----------------------------------------------------------------- */

/** Kenar çubuğundaki "Görevler" girdileri. */
export type TaskFilter =
  | "all"
  | "downloading"
  | "queued"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/** Etkin kenar çubuğu seçimi. */
export type View =
  | { kind: "task"; value: TaskFilter }
  | { kind: "category"; value: CategoryKey };

/** Tüm görev filtreleri (sayaç sırasıyla). */
export const TASK_FILTERS: TaskFilter[] = [
  "downloading",
  "queued",
  "paused",
  "completed",
  "failed",
  "cancelled",
  "all",
];

/** Tüm kategori filtreleri (sayaç sırasıyla). */
export const CATEGORY_FILTERS: CategoryKey[] = [
  "video",
  "audio",
  "program",
  "archive",
  "document",
  "other",
];

/* -----------------------------------------------------------------
   Durum
   ----------------------------------------------------------------- */

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
  /** Tabloda seçili satırlar. */
  selected: Record<number, boolean>;
}

const [state, setState] = createStore<DownloadState>({
  byId: {},
  order: [],
  speedHistory: {},
  speed: {},
  busy: {},
  selected: {},
});

const [logs, setLogs] = createStore<{ entries: LogEntry[] }>({ entries: [] });
const [view, setView] = createSignal<View>({ kind: "task", value: "all" });
const [ready, setReady] = createSignal(false);

/**
 * "Şimdi" damgası (epoch ms).
 *
 * Çalışan indirmelerin geçen süresi ve toplam süre bu değerden hesaplanır.
 * İlerleme olayları ~500 ms'de bir geldiği için bu sinyal doğal bir saat
 * görevi görür; ayrı bir `setInterval` kurmaya gerek yoktur.
 */
const [clock, setClock] = createSignal(Date.now());

/**
 * Shift+Click aralığı için son tıklanan satır.
 */
let anchorId: number | null = null;

let logSeq = 0;

/* -----------------------------------------------------------------
   Günlük
   ----------------------------------------------------------------- */

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

/* -----------------------------------------------------------------
   Kenar çubuğu görünümü
   ----------------------------------------------------------------- */

/** Etkin görünüm. */
export { view };

/** Görev filtresini seçer (kategori seçimini de değiştirir). */
export function selectTask(value: TaskFilter) {
  setView({ kind: "task", value });
  clearSelection();
}

/** Kategori filtresini seçer (görev seçimini de değiştirir). */
export function selectCategory(value: CategoryKey) {
  setView({ kind: "category", value });
  clearSelection();
}

/** Bu görev filtresi etkin mi? */
export function isTaskActive(value: TaskFilter): boolean {
  const v = view();
  return v.kind === "task" && v.value === value;
}

/** Bu kategori filtresi etkin mi? */
export function isCategoryActive(value: CategoryKey): boolean {
  const v = view();
  return v.kind === "category" && v.value === value;
}

/* -----------------------------------------------------------------
   Kayıt erişimi
   ----------------------------------------------------------------- */

/** İndirmenin şu an çalışıp çalışmadığını döner. */
function isRunning(item: DownloadItem): boolean {
  return item.status === "Queued" || item.status === "Downloading";
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

/** Tüm kayıtlar (sırasız). */
export function allItems(): DownloadItem[] {
  return state.order
    .map((id) => state.byId[id])
    .filter((i): i is DownloadItem => Boolean(i));
}

/** Başarısız indirmelerin listesi (uyarı olarak). */
export function failedItems(): DownloadItem[] {
  return allItems().filter((i) => i.status === "Failed");
}

/** Sıralama ağırlığı: çalışanlar üstte, tamamlananlar altta. */
const STATUS_RANK: Record<DownloadStatus, number> = {
  Downloading: 0,
  Queued: 1,
  Paused: 2,
  Failed: 3,
  Cancelled: 4,
  Completed: 5,
};

/** Tüm kayıtlar: durum sırası, sonra en son güncellenen üstte. */
function sortedItems(): DownloadItem[] {
  return allItems().sort((a, b) => {
    const ra = STATUS_RANK[a.status];
    const rb = STATUS_RANK[b.status];
    if (ra !== rb) return ra - rb;
    return b.lastUpdated.localeCompare(a.lastUpdated);
  });
}

/** Görev filtresi bir duruma eşleniyor mu? */
function matchesTask(item: DownloadItem, filter: TaskFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "downloading":
      return item.status === "Downloading";
    case "queued":
      return item.status === "Queued";
    case "paused":
      return item.status === "Paused";
    case "completed":
      return item.status === "Completed";
    case "failed":
      return item.status === "Failed";
    case "cancelled":
      return item.status === "Cancelled";
  }
}

/**
 * Kenar çubuğundaki etkin görünüme uyan kayıtlar.
 *
 * Bu liste tablonun satır kaynağıdır; araç çubuğundaki toplu işlemler de
 * seçim boşken bu listeyi hedefler.
 */
export function visibleItems(): DownloadItem[] {
  const v = view();
  const items = sortedItems();
  if (v.kind === "task") {
    return items.filter((i) => matchesTask(i, v.value));
  }
  return items.filter((i) => categoryOf(i.fileName) === v.value);
}

/** Görünüm başlığı çubuğunda gösterilecek etiket sayısı. */
export function visibleCount(): number {
  return visibleItems().length;
}

/* -----------------------------------------------------------------
   Sayaçlar (kenar çubuğu)
   ----------------------------------------------------------------- */

export type CountMap<T extends string> = Record<T, number>;

/** Her görev filtresi için kayıt sayısı. */
export function taskCounts(): CountMap<TaskFilter> {
  const counts = {
    all: 0,
    downloading: 0,
    queued: 0,
    paused: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  } satisfies CountMap<TaskFilter>;

  for (const item of allItems()) {
    counts.all += 1;
    switch (item.status) {
      case "Downloading":
        counts.downloading += 1;
        break;
      case "Queued":
        counts.queued += 1;
        break;
      case "Paused":
        counts.paused += 1;
        break;
      case "Completed":
        counts.completed += 1;
        break;
      case "Failed":
        counts.failed += 1;
        break;
      case "Cancelled":
        counts.cancelled += 1;
        break;
    }
  }
  return counts;
}

/** Her kategori için kayıt sayısı. */
export function categoryCounts(): CountMap<CategoryKey> {
  const counts = {
    video: 0,
    audio: 0,
    program: 0,
    archive: 0,
    document: 0,
    other: 0,
  } satisfies CountMap<CategoryKey>;

  for (const item of allItems()) {
    counts[categoryOf(item.fileName)] += 1;
  }
  return counts;
}

/* -----------------------------------------------------------------
   Seçim
   ----------------------------------------------------------------- */

/** Seçili kayıtlar. */
export function selectedItems(): DownloadItem[] {
  return allItems().filter((i) => state.selected[i.id]);
}

/** Seçim boş mu? */
export function hasSelection(): boolean {
  return Object.keys(state.selected).length > 0;
}

/** Seçimi temizler. */
export function clearSelection() {
  for (const id of Object.keys(state.selected)) {
    setState("selected", Number(id), false);
  }
  anchorId = null;
}

/**
 * Bir satırı seçim durumuna göre değiştirir.
 *
 * * `single` — yalnızca bu satır seçilir (yeni çapa).
 * * `toggle`  — Ctrl/Cmd: satırın durumunu çevirir, diğerleri korunur.
 * * `range`   — Shift: görünür listede çapaya kadar aralık seçilir.
 */
export function selectRow(
  id: number,
  mode: "single" | "toggle" | "range",
) {
  if (mode === "range" && anchorId !== null) {
    const ids = visibleItems().map((i) => i.id);
    const from = ids.indexOf(anchorId);
    const to = ids.indexOf(id);
    if (from >= 0 && to >= 0) {
      if (!hasSelection()) clearSelection();
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      for (let i = lo; i <= hi; i += 1) {
        setState("selected", ids[i], true);
      }
      return;
    }
  }

  if (mode === "toggle") {
    const next = !state.selected[id];
    setState("selected", id, next);
    anchorId = id;
    // Son satırı bırakıldıysa seçim bayraçlarını da temizle.
    if (!next && !hasSelection()) anchorId = id;
    return;
  }

  clearSelection();
  setState("selected", id, true);
  anchorId = id;
}

/** Tüm görünür satırları seçer / seçimi kaldırır. */
export function toggleSelectAll() {
  const ids = visibleItems().map((i) => i.id);
  const allSelected = ids.length > 0 && ids.every((id) => state.selected[id]);

  if (allSelected) {
    clearSelection();
    return;
  }
  clearSelection();
  for (const id of ids) setState("selected", id, true);
}

/**
 * Toplu işlemlerin hedefi.
 *
 * Seçim varsa yalnızca seçili kayıtlar, yoksa görünür listenin tamamı.
 * Silme gibi "yoksa hiçbir şey yapma" işlemlerinde bu varsayılan kullanılır;
 * tüm listeyi duraklat/sürdür/iptal eylemleri ise her zaman tüm kayıtları
 * hedefler (Rust tarafında tek komut).
 */
export function bulkTargets(): DownloadItem[] {
  const selected = selectedItems();
  return selected.length > 0 ? selected : visibleItems();
}

/* -----------------------------------------------------------------
   Özet (durum çubuğu)
   ----------------------------------------------------------------- */

/** Bir kaydın geçen süresi (saniye). */
export function itemElapsed(item: DownloadItem): number {
  const start = new Date(item.createdAt).getTime();
  if (Number.isNaN(start)) return 0;
  const end = item.completedAt
    ? new Date(item.completedAt).getTime()
    : clock();
  if (Number.isNaN(end) || end <= start) return 0;
  return (end - start) / 1000;
}

export interface Totals {
  /** Tamamlanan + süren kayıtların indirdiği toplam bayt. */
  totalDownloaded: number;
  /** Çalışan kayıtların anlık toplam hızı (MB/s). */
  totalSpeed: number;
  /** Çalışan kayıt sayısı (sırada + indiriliyor). */
  activeCount: number;
  /** Tamamlanan kayıt sayısı. */
  completedCount: number;
  /** Tüm kayıtların geçen süre toplamı (saniye). */
  totalSeconds: number;
}

/** Genel özet: toplam indirilen bayt, anlık toplam hız ve süreler. */
export function totals(): Totals {
  let totalDownloaded = 0;
  let totalSpeed = 0;
  let activeCount = 0;
  let completedCount = 0;
  let totalSeconds = 0;

  for (const id of state.order) {
    const item = state.byId[id];
    if (!item) continue;

    if (item.status === "Completed") {
      completedCount += 1;
    }
    if (isRunning(item)) {
      activeCount += 1;
      totalSpeed += state.speed[id] ?? 0;
    }
    totalDownloaded += item.downloadedBytes;
    totalSeconds += itemElapsed(item);
  }

  return {
    totalDownloaded,
    totalSpeed,
    activeCount,
    completedCount,
    totalSeconds,
  };
}

/* -----------------------------------------------------------------
   Kayıt yaşam döngüsü
   ----------------------------------------------------------------- */

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

  // Saat her ilerleme turunda ilerler (süre metinleri canlı kalsın).
  setClock(Date.now());

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
  setClock(Date.now());

  // Görev bitti: bekleyen komut kilidi kalkmalı, aksi halde satırdaki
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
    t("log.status_line", {
      name: itemName(ev.id),
      status: statusLabel(ev.status),
    }),
    ev.id,
  );
}

function itemName(id: number): string {
  return state.byId[id]?.fileName ?? `#${id}`;
}

/** Yükleme tamamlandı mı? */
export { ready, logs, state };

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
    pushLog("info", t("log.records_loaded", { count: items.length }), null);
  } catch (e) {
    pushLog(
      "error",
      t("log.records_load_failed", { error: errorText(e) }),
      null,
    );
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

    // Silinen kayıtların hız ve seçim verisini temizle.
    for (const id of Object.keys(state.speed)) {
      if (!seen.has(Number(id))) {
        setState("speed", Number(id), undefined as unknown as number);
        setState("speedHistory", Number(id), undefined as unknown as SpeedSample[]);
        setState("selected", Number(id), false);
      }
    }
  } catch (e) {
    pushLog("error", t("log.list_refresh_failed", { error: errorText(e) }), null);
  }
}

// Dil değiştikten sonra Rust'a bildirilmiş oluruz; kalıcı `error_message`
// kayıtları kanonik biçimde saklandığı için listeyi yeniden okumak onları
// yeni dilde çevirir. Bu, bellek içi log satırları için geçerli değildir:
// onlar yazıldıkları dilde kalır.
onLocaleChange(() => {
  void reloadList();
});

/** Hata nesnesini okunabilir metne çevirir. */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return t("error.unknown");
}

/** Durumun etkin dildeki etiketi (şablonlarda kullanılır). */
export { statusLabel };
export type { DownloadItem, DownloadStatus, LogEntry };