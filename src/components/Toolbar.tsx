/**
 * Araç çubuğu.
 *
 * MC düzeni: solda açılır listeli filtre ve sıralama düğmeleri, ortada
 * **Kuyruğu Başlat · Tümünü Durdur · Bitenleri Temizle · Ayarlar**, sağda
 * mavi **İndirme ekle** düğmesi, arama kutusu ve ≡ menü düğmesi.
 *
 * Kenar çubuğu yalnızca MC'nin sade düzenini (Tümü · kategoriler · Biten /
 * Bitmeyen) taşıdığı için ADM'nin ayrıntılı görev filtreleri "Tüm dosyalar"
 * açılır listesinde; sıralama "En yeni" açılır listesinde. Toplu
 * duraklat/sürdür/iptal/sil eylemleri ≡ menüsünde ve satır bağlam
 * menüsündedir.
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import {
  CATEGORY_FILTERS,
  TASK_FILTERS,
  TASK_LABEL_KEY,
  categoryCounts,
  isCategoryActive,
  isTaskActive,
  search,
  selectCategory,
  selectTask,
  setSearch,
  setSort,
  sortKey,
  taskCounts,
  view,
  type SortKey,
} from "../lib/store";
import { setAddDialogOpen, setSettingsOpen, settingsOpen } from "../lib/ui";
import { t } from "../lib/i18n";
import MenuBar from "./MenuBar";
import Tip from "./Tip";
import { categoryLabel } from "../lib/format";
import { clearFinished, pauseAllDownloads, resumeAllDownloads } from "../lib/api";
import { errorText, pushFeedback } from "../lib/useFeedback";

/** Sıralama ölçütlerinin menü sırası. */
const SORTS: { key: SortKey; label: string }[] = [
  { key: "status", label: "sort.status" },
  { key: "newest", label: "sort.newest" },
  { key: "oldest", label: "sort.oldest" },
  { key: "name", label: "sort.name" },
  { key: "size", label: "sort.size" },
  { key: "progress", label: "sort.progress" },
];

/** Hangi açılır liste açık (`null` ise hiçbiri). */
type OpenList = "filter" | "sort" | null;

/** Toplu eylem → "N kayıt etkilendi" sözlük anahtarı. */
const BULK_DONE_KEY = {
  pause: "bulk.done.paused",
  resume: "bulk.done.resumed",
  clear: "bulk.done.cleared",
} as const;

/** Toplu eylem → "hiçbir şey etkilenmedi" sözlük anahtarı. */
const BULK_NONE_KEY = {
  pause: "bulk.none.paused",
  resume: "bulk.none.resumed",
  clear: "bulk.none.cleared",
} as const;

export default function Toolbar() {
  const [open, setOpen] = createSignal<OpenList>(null);

  /** "Bitenleri Temizle" düğmesi yalnızca temizlenecek kayıt varsa etkindir. */
  const canClear = createMemo(() => {
    const c = taskCounts();
    return c.completed + c.failed + c.cancelled > 0;
  });

  /**
   * Araç çubuğundan toplu eylem (≡ menüsüyle aynı yollar).
   *
   * Dönen sayı kullanıcıya gösterilir: `pause_all` / `resume_all` /
   * `clear_finished` hepsi etkilenen kayıt sayısını döner. Bu geri bildirim
   * olmadan "Kuyruğu Başlat"a basmak hiçbir şey olmadı gibi görünür — özellikle
   * `auto_start` kapalıyken ya da eşzamanlılık sınırı doluyken.
   */
  async function runBulk(action: "pause" | "resume" | "clear") {
    try {
      const count =
        action === "pause"
          ? await pauseAllDownloads()
          : action === "resume"
            ? await resumeAllDownloads()
            : await clearFinished();

      if (count > 0) {
        pushFeedback("success", t(BULK_DONE_KEY[action], { count }));
      } else {
        pushFeedback("info", t(BULK_NONE_KEY[action]));
      }
    } catch (e) {
      const key = action === "clear" ? "list.err.clear" : "bulk.err.action";
      pushFeedback("error", t(key, { error: errorText(e) }));
    }
  }

  /** Etkin filtrenin okunabilir adı ("Tüm dosyalar" düğmesinin etiketi). */
  const filterLabel = createMemo(() => {
    const v = view();
    return v.kind === "task" ? t(TASK_LABEL_KEY[v.value]) : categoryLabel(v.value);
  });

  /** Etkin sıralamanın okunabilir adı. */
  const sortLabel = createMemo(
    () => SORTS.find((s) => s.key === sortKey())?.label ?? "sort.status",
  );

  // Dış tıklama ve Escape açılır listeleri kapatır.
  createEffect(() => {
    if (!open()) return;

    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest(".dd-anchor, .menu-anchor")) return;
      setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };

    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    });
  });

  function toggle(which: Exclude<OpenList, null>) {
    setOpen((cur) => (cur === which ? null : which));
  }

  return (
    <div class="toolbar" role="toolbar">
      {/* Filtre — görevler ve kategoriler */}
      <div class="dd-anchor">
        <button
          type="button"
          class={`tb-dd ${open() === "filter" ? "tb-dd-open" : ""}`}
          aria-haspopup="true"
          aria-expanded={open() === "filter"}
          onClick={() => toggle("filter")}
        >
          <svg class="tb-dd-icon" viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
            <path
              d="M1.5 2.5 H12.5 L8.4 7.4 V11.5 L5.6 12.8 V7.4 Z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linejoin="round"
            />
          </svg>
          {filterLabel()}
          <svg class="tb-dd-caret" viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
            <path d="M2 4 L5 7 L8 4 Z" fill="currentColor" />
          </svg>
        </button>

        <Show when={open() === "filter"}>
          <div class="dd-pop">
            <div class="dd-head">{t("side.tasks")}</div>
            <For each={TASK_FILTERS}>
              {(filter) => (
                <button
                  type="button"
                  class={`dd-item ${isTaskActive(filter) ? "dd-item-active" : ""}`}
                  onClick={() => {
                    selectTask(filter);
                    setOpen(null);
                  }}
                >
                  <span class="dd-check" aria-hidden="true">
                    <Show when={isTaskActive(filter)}>✓</Show>
                  </span>
                  {t(TASK_LABEL_KEY[filter])}
                  <span class="dd-count">{taskCounts()[filter]}</span>
                </button>
              )}
            </For>

            <div class="dd-sep" />
            <div class="dd-head">{t("side.categories")}</div>
            <For each={CATEGORY_FILTERS}>
              {(cat) => (
                <button
                  type="button"
                  class={`dd-item ${isCategoryActive(cat) ? "dd-item-active" : ""}`}
                  onClick={() => {
                    selectCategory(cat);
                    setOpen(null);
                  }}
                >
                  <span class="dd-check" aria-hidden="true">
                    <Show when={isCategoryActive(cat)}>✓</Show>
                  </span>
                  {categoryLabel(cat)}
                  <span class="dd-count">{categoryCounts()[cat]}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Sıralama */}
      <div class="dd-anchor">
        <button
          type="button"
          class={`tb-dd ${open() === "sort" ? "tb-dd-open" : ""}`}
          aria-haspopup="true"
          aria-expanded={open() === "sort"}
          onClick={() => toggle("sort")}
        >
          <svg class="tb-dd-icon" viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
            <path
              d="M2 3 H12 M4 7 H10 M6.5 11 H7.5"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linecap="round"
            />
          </svg>
          {t(sortLabel())}
          <svg class="tb-dd-caret" viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
            <path d="M2 4 L5 7 L8 4 Z" fill="currentColor" />
          </svg>
        </button>

        <Show when={open() === "sort"}>
          <div class="dd-pop">
            <For each={SORTS}>
              {(s) => (
                <button
                  type="button"
                  class={`dd-item ${sortKey() === s.key ? "dd-item-active" : ""}`}
                  onClick={() => {
                    setSort(s.key);
                    setOpen(null);
                  }}
                >
                  <span class="dd-check" aria-hidden="true">
                    <Show when={sortKey() === s.key}>✓</Show>
                  </span>
                  {t(s.label)}
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>

      <span class="tb-spacer" />

      {/* MC eylem düğmeleri: Kuyruğu Başlat · Tümünü Durdur · Bitenleri
          Temizle. Toplu eylemler ≡ menüsünde ve bağlam menüsünde de var;
          buradakiler MC'nin araç çubuğu düzeniyle aynı yerde dursun.
          Kısayollar `App.tsx` içindeki işleyicide tanımlı. */}
      <Tip label={t("tb.start_queue_title")} keys="Ctrl+R" class="tb-btn"
        onClick={() => void runBulk("resume")}>
        <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
          <path d="M3 2 L12 7 L3 12 Z" fill="currentColor" />
        </svg>
        {t("tb.start_queue")}
      </Tip>

      <Tip label={t("tb.stop_all_title")} keys="Ctrl+P" class="tb-btn"
        onClick={() => void runBulk("pause")}>
        <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
          <path d="M3 2.5 h3 v9 h-3 z M8 2.5 h3 v9 h-3 z" fill="currentColor" />
        </svg>
        {t("tb.stop_all")}
      </Tip>

      <Tip label={t("tb.clear_done_title")} class="tb-btn" disabled={!canClear()}
        onClick={() => void runBulk("clear")}>
        <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
          <path
            d="M2.5 3.5 h9 M5.5 3.5 V2.2 h3 v1.3 M3.6 3.5 l0.6 8 h5.6 l0.6-8"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        {t("tb.clear_done")}
      </Tip>

      <Tip label={t("tb.settings_title")} keys="Ctrl+S"
        class={`tb-btn ${settingsOpen() ? "tb-btn-active" : ""}`}
        aria-pressed={settingsOpen()}
        onClick={() => setSettingsOpen(!settingsOpen())}>
        <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
          <circle cx="7" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3" />
          <path
            d="M7 1.4 v1.6 M7 11 v1.6 M1.4 7 h1.6 M11 7 h1.6 M3 3 l1.2 1.2 M9.8 9.8 L11 11 M11 3 L9.8 4.2 M4.2 9.8 L3 11"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
          />
        </svg>
        {t("tb.settings")}
      </Tip>

      <span class="tb-sep" aria-hidden="true" />

      <Tip label={t("tb.add_title")} keys="Ctrl+N" class="tb-add"
        onClick={() => setAddDialogOpen(true)}>
        <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
          <path d="M7 2.5 V11.5 M2.5 7 H11.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
        {t("tb.add")}
      </Tip>

      {/* Arama */}
      <div class="tb-search">
        <svg class="tb-search-icon" viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
          <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" stroke-width="1.3" />
          <path d="M9 9 L12.5 12.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
        </svg>
        <input
          type="search"
          value={search()}
          placeholder={t("tb.search")}
          aria-label={t("tb.search")}
          spellcheck={false}
          onInput={(e) => setSearch(e.currentTarget.value)}
        />
      </div>

      <MenuBar />
    </div>
  );
}
