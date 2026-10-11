/**
 * Kenar çubuğu — MC `ContentView` sidebar portu.
 *
 * Üç bölüm:
 *
 * 1. **Tümü** — filtre yok.
 * 2. **Kategoriler** — MC'nin yedi kategorisi, her birinin yanında rozetli
 *    sayaç. Sayaçlar arama yazarken kaybolmaz (yalnızca veriye bakar).
 * 3. **Biten / Bitmeyen** — hızlı durum süzgeçleri.
 *
 * ADM'nin ayrıntılı durum filtreleri (İndiriliyor, Duraklatılan, Başarısız…)
 * kenar çubuğunu kalabalıklaştırmasın diye araç çubuğundaki açılır listede
 * ve ≡ menüsünde kalır; kenar çubuğu MC'nin sade düzenini korur.
 */
import { For, Show, createMemo } from "solid-js";
import {
  CATEGORY_FILTERS,
  categoryCounts,
  isCategoryActive,
  isTaskActive,
  selectCategory,
  selectTask,
  taskCounts,
} from "../lib/store";
import { categoryLabel } from "../lib/format";
import { t } from "../lib/i18n";

/** Kategori ikonları (24×24, `currentColor` ile çizilir). */
const CATEGORY_ICON: Record<string, string> = {
  image:
    "M4 5 h16 v14 h-16 z M4 15 l4.5-4.5 3.5 3.5 3-3 4 4 M15.5 8.5 a1.2 1.2 0 1 0 0.01 0",
  music: "M9 17 V6 l9-2 v11 M9 17 a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0 M18 15 a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0",
  video: "M3 6 h13 v12 h-13 z M16 10.5 l5-3 v9 l-5-3 z",
  apps: "M12 3 l3 5.5 6 1-4.5 4.2 1.2 6.3L12 17.2 6.3 20l1.2-6.3L3 9.5l6-1 z",
  document: "M6 3 h8 l4 4 v14 h-12 z M14 3 v4 h4 M8.5 12 h7 M8.5 15.5 h7",
  compressed:
    "M6 3 h12 v18 h-12 z M12 3 v3 M12 7.5 v3 M12 12 v3 M12 16.5 v3",
  other: "M4 6 h6 l2 2 h8 v11 h-16 z",
};

export default function Sidebar() {
  const counts = createMemo(() => categoryCounts());
  const tasks = createMemo(() => taskCounts());

  return (
    <nav class="sidebar" aria-label={t("side.nav_aria")}>
      <div class="side-group">
        <button
          type="button"
          class={`side-item${isTaskActive("all") ? " side-item-active" : ""}`}
          onClick={() => selectTask("all")}
        >
          <span class="side-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15">
              <path
                d="M4 6 h16 M4 12 h16 M4 18 h16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <span class="side-label">{t("side.all")}</span>
          <span class="side-count">{tasks().all}</span>
        </button>
      </div>

      <div class="side-head">{t("side.categories")}</div>
      <div class="side-group">
        <For each={CATEGORY_FILTERS}>
          {(cat) => (
            <button
              type="button"
              class={`side-item${isCategoryActive(cat) ? " side-item-active" : ""}`}
              onClick={() => selectCategory(cat)}
            >
              <span class={`side-icon side-icon-${cat}`} aria-hidden="true">
                <svg viewBox="0 0 24 24" width="15" height="15">
                  <path
                    d={CATEGORY_ICON[cat]}
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linejoin="round"
                    stroke-linecap="round"
                  />
                </svg>
              </span>
              <span class="side-label">{categoryLabel(cat)}</span>
              <Show when={counts()[cat] > 0}>
                <span class="side-count">{counts()[cat]}</span>
              </Show>
            </button>
          )}
        </For>
      </div>

      <div class="side-head">{t("side.state")}</div>
      <div class="side-group">
        <button
          type="button"
          class={`side-item${isTaskActive("completed") ? " side-item-active" : ""}`}
          onClick={() => selectTask("completed")}
        >
          <span class="side-icon side-icon-ok" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15">
              <path
                d="M5 12.5 l4.5 4.5 L19 7.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </span>
          <span class="side-label">{t("side.completed")}</span>
          <span class="side-count">{tasks().completed}</span>
        </button>

        <button
          type="button"
          class={`side-item${isTaskActive("unfinished") ? " side-item-active" : ""}`}
          onClick={() => selectTask("unfinished")}
        >
          <span class="side-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15">
              <circle
                cx="12"
                cy="12"
                r="8"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
              />
              <path
                d="M12 7.5 V12 l3.2 2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <span class="side-label">{t("side.unfinished")}</span>
          <span class="side-count">{tasks().unfinished}</span>
        </button>
      </div>
    </nav>
  );
}
