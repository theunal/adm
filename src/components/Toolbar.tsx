/**
 * Araç çubuğu.
 *
 * FDM düzeni: solda açılır listeli filtre ve sıralama düğmeleri, sağda
 * mavi **İndirme ekle** düğmesi, arama kutusu ve ≡ menü düğmesi.
 *
 * Kenar çubuğu kaldırıldığı için görev ve kategori filtreleri artık
 * "Tüm dosyalar" açılır listesinde; sıralama "En yeni" açılır listesinde.
 * Toplu duraklat/sürdür/iptal/sil eylemleri ≡ menüsünde ve satır
 * bağlam menüsündedir.
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import {
  CATEGORY_FILTERS,
  TASK_FILTERS,
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
  type TaskFilter,
} from "../lib/store";
import { setAddDialogOpen } from "../lib/ui";
import { t } from "../lib/i18n";
import MenuBar from "./MenuBar";
import type { CategoryKey } from "../lib/format";

/** Görev filtresine karşık etiket anahtarı. */
const TASK_LABEL: Record<TaskFilter, string> = {
  all: "side.task.all",
  downloading: "side.task.downloading",
  queued: "side.task.queued",
  paused: "side.task.paused",
  completed: "side.task.completed",
  failed: "side.task.failed",
  cancelled: "side.task.cancelled",
};

/** Kategoriye karşık etiket anahtarı. */
const CATEGORY_LABEL: Record<CategoryKey, string> = {
  video: "side.cat.video",
  audio: "side.cat.audio",
  program: "side.cat.program",
  archive: "side.cat.archive",
  document: "side.cat.document",
  other: "side.cat.other",
};

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

export default function Toolbar() {
  const [open, setOpen] = createSignal<OpenList>(null);

  /** Etkin filtrenin okunabilir adı ("Tüm dosyalar" düğmesinin etiketi). */
  const filterLabel = createMemo(() => {
    const v = view();
    return t(v.kind === "task" ? TASK_LABEL[v.value] : CATEGORY_LABEL[v.value]);
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
                  {t(TASK_LABEL[filter])}
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
                  {t(CATEGORY_LABEL[cat])}
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

      <button
        type="button"
        class="tb-add"
        title={t("tb.add_title")}
        onClick={() => setAddDialogOpen(true)}
      >
        <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
          <path d="M7 2.5 V11.5 M2.5 7 H11.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
        {t("tb.add")}
      </button>

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
