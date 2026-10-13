/**
 * Sinyal tabanlı indirme deposu.
 *
 * WPF sürümünde 500 ms'de bir `SELECT *` ile tüm liste tazeleniyordu;
 * burada Rust tarafından yayınlanan gerçek zamanlı olaylar dinlenir ve
 * yalnızca değişen kayıt güncellenir.
 *
 * Görünüm MC düzenine göre kenar çubuğundan sürülür: `view` ya bir **görev**
 * filtresi (İndiriliyor / Tamamlandı / Bitmeyen / …) ya bir **kategori**
 * (Video / Ses / Resim / …) tutar. Aynı anda ikisinden biri etkindir —
 * MC'de de kategori seçimi görev seçiminin yerini alır.
 *
 * Köprü durumu, araç kurulumu, güncelleme ve pano sorması da burada tutulur:
 * hepsi `download://event` kanalından gelir ve birden fazla bileşen
 * (durum çubuğu, ayarlar sekmeleri, sorma penceresi) tarafından okunur.
 */
import { createStore, produce } from "solid-js/store";
import { createSignal } from "solid-js";
import {
  bridgeStatus as readBridgeStatus,
  listDownloads,
  onDownloadEvent,
} from "./api";
import { onLocaleChange, t } from "./i18n";
import {
  CATEGORY_ORDER,
  categoryOf,
  statusLabel,
  type BridgeStatus,
  type CategoryKey,
  type ClipboardPrompt,
  type DownloadEvent,
  type DownloadItem,
  type DownloadStatus,
  type LogEntry,
  type SpeedSample,
  type UpdateInfo,
} from "./format";
import { pushFeedback } from "./useFeedback";
import { settings } from "./settings";
import { setPropertiesItem } from "./ui";

/* -----------------------------------------------------------------
   Görünüm (kenar çubuğu filtreleri)
   ----------------------------------------------------------------- */

/**
 * Kenar çubuğundaki görev girdileri.
 *
 * `unfinished` MC'nin "Unfinished" filtresidir: tamamlanmayan her şey
 * (süren, kuyrukta, duraklatılmış, başarısız, iptal).
 */
export type TaskFilter =
  | "all"
  | "unfinished"
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

/**
 * Tüm görev filtreleri (sayaç sırasıyla).
 *
 * `all` ve `unfinished` kenar çubuğunda ayrı satırlardır; kalanlar
 * ADM'nin ek durum filtreleridir.
 */
export const TASK_FILTERS: TaskFilter[] = [
  "all",
  "unfinished",
  "downloading",
  "queued",
  "paused",
  "completed",
  "failed",
  "cancelled",
];

/** Tüm kategori filtreleri (sayaç sırasıyla) — `format.CATEGORY_ORDER`. */
export const CATEGORY_FILTERS: CategoryKey[] = CATEGORY_ORDER;

/**
 * Görev filtresi → sözlük anahtarı.
 *
 * Kenar çubuğu, araç çubuğu açılır listesi ve menü aynı haritayı kullanır;
 * yeni bir filtre eklemek tek yerden yeter.
 */
export const TASK_LABEL_KEY: Record<TaskFilter, string> = {
  all: "side.task.all",
  unfinished: "side.task.unfinished",
  downloading: "side.task.downloading",
  queued: "side.task.queued",
  paused: "side.task.paused",
  completed: "side.task.completed",
  failed: "side.task.failed",
  cancelled: "side.task.cancelled",
};

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
let logSeq = 0;

/**
 * Depoya bir log satırı ekler (bellek sınırlı kalsın).
 *
 * En eski satır silinir; `MAX_LOGS` üst sınır aşıldığında baştaki entries
 * çıkarılır.
 */
const MAX_LOGS = 300;
export function pushLog(
  level: "info" | "success" | "warn" | "error",
  message: string,
  downloadId: number | null = null,
) {
  const entry: LogEntry = {
    id: ++logSeq,
    level,
    message,
    downloadId,
    time: new Date().toLocaleTimeString(undefined, { hour12: false }),
  };
  setLogs("entries", (prev) => {
    const next = [...prev, entry];
    if (next.length > MAX_LOGS) next.splice(0, next.length - MAX_LOGS);
    return next;
  });
}
const [view, setView] = createSignal<View>({ kind: "task", value: "all" });
const [ready, setReady] = createSignal(false);

/** Liste sıralaması (araç çubuğundaki açılır listeden değişir). */
const [sortKey, setSortKey] = createSignal<SortKey>("status");

/** Arama kutusu metni; dosya adı ve adres içinde eşleşen kayıtları süzer. */
const [search, writeSearch] = createSignal("");

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

/* -----------------------------------------------------------------
   Kenar çubuğu görünümü
   ----------------------------------------------------------------- */

/** Etkin görünüm. */
export { view };

/** Etkin sıralama ölçütü. */
export { sortKey };

/** Arama metni. */
export { search };

/** Sıralama ölçütünü değiştirir. */
export function setSort(value: SortKey) {
  setSortKey(value);
}

/** Arama metnini değiştirir. */
export function setSearch(value: string) {
  writeSearch(value);
}

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

/**
 * Tek bir kaydı canlı durumdan okur.
 *
 * Detay penceresi `propertiesItem()`'daki **kopyayı** değil, buradan gelen
 * güncel kaydı gösterir; böylece ilerleme akarken pencere de yenilenir.
 */
export function itemById(id: number): DownloadItem | undefined {
  return state.byId[id];
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

/**
 * Liste sıralaması.
 *
 * `status` varsayılandır ve eski davranışı korur: önce durum sırası
 * (çalışanlar üstte), sonra en son güncellenen. Araç çubuğundaki sıralama
 * açılır listesi bu değeri değiştirir.
 */
export type SortKey = "status" | "newest" | "oldest" | "name" | "size" | "progress";

/** Tamamlanma oranı (0..1). Boyut bilinmiyorsa 0. */
function progressRatio(item: DownloadItem): number {
  return item.totalBytes > 0 ? item.downloadedBytes / item.totalBytes : 0;
}

/** Tüm kayıtlar, seçili ölçüte göre sıralanmış olarak. */
function sortedItems(): DownloadItem[] {
  const list = allItems();

  switch (sortKey()) {
    case "newest":
      return list.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
    case "oldest":
      return list.sort((a, b) => a.lastUpdated.localeCompare(b.lastUpdated));
    case "name":
      return list.sort((a, b) =>
        a.fileName.localeCompare(b.fileName, undefined, { numeric: true }),
      );
    case "size":
      return list.sort((a, b) => b.totalBytes - a.totalBytes);
    case "progress":
      return list.sort((a, b) => progressRatio(b) - progressRatio(a));
    case "status":
    default:
      // Durum sırası, sonra en son güncellenen üstte.
      return list.sort((a, b) => {
        const ra = STATUS_RANK[a.status];
        const rb = STATUS_RANK[b.status];
        if (ra !== rb) return ra - rb;
        return b.lastUpdated.localeCompare(a.lastUpdated);
      });
  }
}

/** Görev filtresi bir duruma eşleniyor mu? */
function matchesTask(item: DownloadItem, filter: TaskFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "unfinished":
      return item.status !== "Completed";
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
 * Görünüme, aramaya ve sıralamaya uyan kayıtlar.
 *
 * Sıra: durum/kategori filtresi → arama → sıralama. Arama **süzgeçtir**;
 * sayaçlar (`taskCounts` / `categoryCounts`) yalnızca durum filtresine bakar,
 * böylece kenar çubuğundaki sayılar arama yazarken kaybolmaz.
 */
export function visibleItems(): DownloadItem[] {
  const v = view();
  const needle = search().trim().toLowerCase();

  let items = sortedItems();
  if (v.kind === "task") {
    items = items.filter((i) => matchesTask(i, v.value));
  } else {
    items = items.filter((i) => categoryOf(i.fileName) === v.value);
  }

  if (needle) {
    items = items.filter(
      (i) =>
        i.fileName.toLowerCase().includes(needle) ||
        i.url.toLowerCase().includes(needle),
    );
  }

  return items;
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
    unfinished: 0,
    downloading: 0,
    queued: 0,
    paused: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  } satisfies CountMap<TaskFilter>;

  for (const item of allItems()) {
    counts.all += 1;
    if (item.status !== "Completed") counts.unfinished += 1;
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
  const counts = Object.fromEntries(
    CATEGORY_ORDER.map((c) => [c, 0]),
  ) as CountMap<CategoryKey>;

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

/**
 * Bir seçim kaydını **tamamen** kaldırır.
 *
 * SolidJS'te `undefined` yazmak anahtarı siler (`setProperty` → `delete`);
 * `false` yazmak ise anahtarı bırakır. Bu ayrım kritiktir: `false` ile
 * yazılan bir kayıt, `hasSelection()`'ı kalıcı olarak `true` yapar — yani
 * "hiç seçim yapıldı mı" sorusuna döner, "şu an bir şey seçili mi"
 * sorusuna değil. Sonuçta hiçbir şey seçilmediği hâlde menüdeki "Kayıt sil"
 * gibi seçim bağımlı öğeler etkin kalır ve hedefi, seçimsiz
 * `bulkTargets()`'in düştüğü görünür listedeki rastgele satır olur.
 *
 * TS, `Record<number, boolean>` yoluna `undefined` atamayı reddeder; bu
 * yüzden kod içi standart olan `undefined as unknown as T` kalıbı kullanılır
 * (aynı kalıp `speed` / `speedHistory` temizliğinde de var).
 */
function dropSelection(id: number) {
  setState("selected", id, undefined as unknown as boolean);
}

/** Seçim boş mu? */
export function hasSelection(): boolean {
  return Object.keys(state.selected).length > 0;
}

/** Seçimi temizler. */
export function clearSelection() {
  for (const id of Object.keys(state.selected)) {
    dropSelection(Number(id));
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
    if (next) {
      setState("selected", id, true);
    } else {
      // Bırakılan satırın kaydı `false` olarak yazılmamalı: anahtar kalırdı
      // ve `hasSelection()` hiçbir şey seçilmediğinde bile `true` olurdu.
      dropSelection(id);
    }
    // Son satır bırakıldıysa seçim çapası da sıfırlanır; boş bir seçimde
    // çapa, kullanıcının az önce bilinçli olarak bıraktiği satıra işaret
    // etmemelidir — Shift+tıklama o satırı yeniden seçerdi.
    if (!next && !hasSelection()) anchorId = null;
    else anchorId = id;
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
  const previous = state.byId[item.id]?.status;
  setState("byId", item.id, item);
  if (!state.order.includes(item.id)) {
    setState("order", (o) => [item.id, ...o]);
  }
  maybeOpenDetailOnStart(previous, item.status, item.id);
}

/**
 * `showDetailOnStart` (Ayarlar ▸ Genel): indirme **başlarken** ayrıntı
 * penceresini açar.
 *
 * Yalnızca durum `Downloading`'a *geçtiği* anda etkindir; ilerleme turları bu
 * fonksiyonu ~500 ms'de bir çağırsa da pencere bir kez açılır ve odağı
 * kullanıcıdan çalmaz. Kayıt henüz listeye düşmemişse (`itemById` boş dönerse)
 * sessizce geçilir — pencereyi bir sonraki geçiş açar.
 *
 * Durum `Paused`'dan `Downloading`'a geçerken de açılır: kullanıcı devam
 * ettirdiğinde ayrıntıyı görmek ister.
 */
function maybeOpenDetailOnStart(
  previous: DownloadStatus | undefined,
  next: DownloadStatus,
  id: number,
) {
  if (previous === next || next !== "Downloading") return;
  if (!settings.showDetailOnStart) return;
  const item = itemById(id);
  if (item) setPropertiesItem(item);
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

  const previous = existing.status;
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
  // Durum gerçekte ne olduysa ona bakılır: `Paused` iken `Downloading`
  // gelen turlarda kayıt hâlâ `Paused` sayılır ve pencere açılmaz.
  maybeOpenDetailOnStart(previous, state.byId[ev.id]?.status ?? previous, ev.id);
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

/* -----------------------------------------------------------------
   Köprü · araç kurulumu · güncelleme · pano (MC portu)
   ----------------------------------------------------------------- */

/**
 * Tarayıcı köprüsünün son bilinen durumu.
 *
 * `bridge` olayı her değişimde, `initStore` açılışta bir kez günceller.
 */
const [bridge, setBridge] = createSignal<BridgeStatus>({
  running: false,
  port: 0,
  browsers: [],
});
export { bridge };

/** Köprünün durumu (durum çubuğu göstergesi). */
export { bridge as bridgeStatus };

/** Köprü çalışıyor mu? */
export function bridgeRunning(): boolean {
  return bridge().running;
}

/**
 * Harici araç kurulum ilerlemesi (`ytdlp`/`ffmpeg`/`deno` → 0..1).
 *
 * `started` olayında `0`, `progress` olayında gelen kesir, `installed` ve
 * `failed` olaylarında kayıt silinir.
 */
const [toolProgress, setToolProgress] = createStore<Record<string, number>>({});
export { toolProgress };

/** Araç başına son bilgi satırı (kurulum günlüğü). */
const [toolMessage, setToolMessage] = createStore<Record<string, string>>({});
export { toolMessage };

/**
 * Araç durumu tazeleme sayacı.
 *
 * Ayarlar ▸ Video sekmesi `tool_status` kaynağını bu sinyale bağlar; bir
 * kurulum tamamlandığında sayaç artar ve tablo kendiliğinden yenilenir.
 */
const [toolRevision, setToolRevision] = createSignal(0);
export { toolRevision };

/** Güncelleme denetiminin sonucu (`null` = henüz denetlenmedi). */
const [updateInfo, setUpdateInfo] = createSignal<UpdateInfo | null>(null);
export { updateInfo };

/**
 * Panoda bulunan bağlantı sorusu (`null` = kapalı).
 *
 * `clipboard` olayı doldurur; `ClipboardPromptDialog` yanıt verince
 * `answerClipboardPrompt()` çağrılır ve sinyal temizlenir.
 */
const [clipboardPrompt, setClipboardPrompt] = createSignal<ClipboardPrompt | null>(
  null,
);
export { clipboardPrompt, setClipboardPrompt };

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
  } catch (e) {
    // Liste yüklenemezse uyar; uygulama yine de kullanılabilir (boş liste).
    pushFeedback("error", t("log.records_load_failed", { error: errorText(e) }));
  }

  // Köprü durumu olayla gelmeden önce bir kez okunur (durum çubuğu).
  try {
    setBridge(await readBridgeStatus());
  } catch {
    // Köprü kapalıysa da uygulama çalışır; gösterge "kapalı" kalır.
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
        pushLog(normalizeLevel(ev.level), ev.message, ev.downloadId);
        break;
      case "bridge":
        setBridge((prev) => ({
          running: ev.running,
          port: ev.port,
          browsers: prev.browsers,
        }));
        if (ev.error) pushLog("error", ev.error, null);
        break;
      case "bridgeConnection":
        setBridge((prev) =>
          prev.browsers.includes(ev.browser)
            ? prev
            : { ...prev, browsers: [...prev.browsers, ev.browser] },
        );
        pushLog("info", t("log.bridge_connection", { browser: ev.browser }), null);
        break;
      case "tool":
        applyToolEvent(ev);
        break;
      case "update":
        setUpdateInfo(ev);
        pushLog(
          ev.error ? "error" : ev.latest ? "info" : "success",
          ev.error
            ? t("log.update_failed", { error: ev.error })
            : ev.latest
              ? t("log.update_available", { version: ev.latest })
              : t("log.update_current", { version: ev.current }),
          null,
        );
        break;
      case "clipboard":
        // Rust tarafı `log.clipboard_detected` satırını zaten yazıyor;
        // burada yalnızca soru arayüze taşınır (çift log olmasın).
        setClipboardPrompt({
          urls: ev.urls,
          source: ev.source,
          preferVideo: ev.preferVideo,
        });
        break;
    }
  });

  setReady(true);
}

/** Araç kurulum olayını depoya uygular. */
function applyToolEvent(ev: Extract<DownloadEvent, { kind: "tool" }>) {
  switch (ev.event) {
    case "started":
      setToolProgress(ev.tool, 0);
      setToolMessage(ev.tool, t("tool.working"));
      break;
    case "progress":
      setToolProgress(ev.tool, ev.fraction);
      break;
    case "message":
      setToolMessage(ev.tool, ev.text);
      break;
    case "installed":
      setToolProgress(ev.tool, undefined as unknown as number);
      setToolMessage(ev.tool, t("tool.installed", { version: ev.version }));
      setToolRevision((n) => n + 1);
      pushLog("success", t("log.tool_installed", { tool: ev.tool, version: ev.version }), null);
      break;
    case "failed":
      setToolProgress(ev.tool, undefined as unknown as number);
      setToolMessage(ev.tool, ev.error);
      setToolRevision((n) => n + 1);
      pushLog("error", t("tool.failed", { error: ev.error }), null);
      break;
  }
}

/** Log seviyesini arayüzün dört seviyesine sıkıştırır. */
function normalizeLevel(level: string): "info" | "success" | "warn" | "error" {
  switch (level) {
    case "success":
    case "warn":
    case "error":
      return level;
    default:
      return "info";
  }
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
      }
    }
    // `selected` ayrıca taranmalı: bir kayıt hiç hız kaydı tutulmamış
    // olabilir; `speed` döngüsü onu görmezdi ve kalan anahtar
    // `hasSelection()`'ı sonsuza dek `true` bırakırdı.
    for (const id of Object.keys(state.selected)) {
      if (!seen.has(Number(id))) dropSelection(Number(id));
    }
  } catch (e) {
    pushFeedback("error", t("log.list_refresh_failed", { error: errorText(e) }));
  }
}

// Dil değiştikten sonra Rust'a bildirilmiş oluruz; kalıcı `error_message`
// kayıtları kanonik biçimde saklandığı için listeyi yeniden okumak onları
// yeni dilde çevirir.
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