/**
 * Kenar çubuğu — IDM'in sol paneli.
 *
 * İki bloktan oluşur:
 *
 * 1. **Görevler** — durum filtresi; her satırda canlı sayaç.
 * 2. **Kategoriler** — uzantıya göre gruplama; her satırda sayaç.
 *
 * Yeni indirme başlatma burada **değildir**: yeşil **URL Ekle** düğmesi
 * (`Toolbar`) bir pencere açar (`NewDownloadDialog`).
 *
 * Görev ve kategori listeleri birbirini dışlar: birine tıklamak diğerini
 * seçimsiz bırakır (IDM'de de aynı). Seçim durumu `store.view` içindedir,
 * sayılar `taskCounts()` / `categoryCounts()` tarafından canlı hesaplanır.
 */
import { For, Show, createMemo } from "solid-js";
import {
  CATEGORY_FILTERS,
  TASK_FILTERS,
  categoryCounts,
  isCategoryActive,
  isTaskActive,
  selectCategory,
  selectTask,
  taskCounts,
  type TaskFilter,
} from "../lib/store";
import { t } from "../lib/i18n";
import type { CategoryKey } from "../lib/format";

/** Görev filtresine karşık başlık anahtarı. */
const TASK_LABEL: Record<TaskFilter, string> = {
  all: "side.task.all",
  downloading: "side.task.downloading",
  queued: "side.task.queued",
  paused: "side.task.paused",
  completed: "side.task.completed",
  failed: "side.task.failed",
  cancelled: "side.task.cancelled",
};

/** Kategoriye karşık başlık anahtarı. */
const CATEGORY_LABEL: Record<CategoryKey, string> = {
  video: "side.cat.video",
  audio: "side.cat.audio",
  program: "side.cat.program",
  archive: "side.cat.archive",
  document: "side.cat.document",
  other: "side.cat.other",
};

/** Kategori simgesi (kenar çubuğundaki küçük işaret). */
function categoryGlyph(cat: CategoryKey): string {
  switch (cat) {
    case "video":
      return "▶";
    case "audio":
      return "♪";
    case "program":
      return "⚙";
    case "archive":
      return "▣";
    case "document":
      return "▤";
    case "other":
      return "○";
  }
}

export default function Sidebar() {
  const tasks = createMemo(() => taskCounts());
  const categories = createMemo(() => categoryCounts());

  return (
    <aside class="sidebar">
      {/* --- Görevler --- */}
      <div class="side-block">
        <div class="side-title">{t("side.tasks")}</div>
        <For each={TASK_FILTERS}>
          {(filter) => (
            <button
              type="button"
              class={`side-row ${isTaskActive(filter) ? "side-row-active" : ""} ${
                filter === "downloading" ? "side-row-live" : ""
              }`}
              aria-pressed={isTaskActive(filter)}
              onClick={() => selectTask(filter)}
            >
              <span class="side-row-label">{t(TASK_LABEL[filter])}</span>
              <span class="side-row-count">{tasks()[filter]}</span>
            </button>
          )}
        </For>
      </div>

      {/* --- Kategoriler --- */}
      <div class="side-block">
        <div class="side-title">{t("side.categories")}</div>
        <For each={CATEGORY_FILTERS}>
          {(cat) => (
            <button
              type="button"
              class={`side-row ${isCategoryActive(cat) ? "side-row-active" : ""}`}
              aria-pressed={isCategoryActive(cat)}
              onClick={() => selectCategory(cat)}
            >
              <span class="side-row-icon" aria-hidden="true">
                {categoryGlyph(cat)}
              </span>
              <span class="side-row-label">{t(CATEGORY_LABEL[cat])}</span>
              <Show when={categories()[cat] > 0}>
                <span class="side-row-count">{categories()[cat]}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
    </aside>
  );
}