/**
 * Sol menü paneli — açılır-kapanır katman (overlay).
 *
 * Üst çubuk (`Toolbar.tsx`) ve ≡ menüsü (`MenuBar.tsx`) kaldırıldı; onların
 * taşıdığı **her şey** bu panele taşındı. Panel kapalıyken hiç çizilmez;
 * açma düğmesi `TitleBar`'daki ☰ simgesidir (`sideOpen`). Açılınca içerik
 * alanının üzerinde katman olarak görünür, dış tıklama ve `Escape` kapatır.
 *
 * Bölümler (yukarıdan aşağı):
 *
 * 1. **Eylemler** — Yeni İndirme · Panodan Yapıştır · Tümünü Seç ·
 *    Kuyruğu Başlat · Tümünü Durdur · Tümünü İptal · Bittenleri Temizle.
 *    Seçime bağlı dosya eylemleri (aç, klasörü aç, adresi kopyala, sil)
 *    bilerek burada **değil**: satır bağlam menüsünde zaten var ve panelin
 *    her açılışta "konu" seçmesi gerekirdi.
 * 2. **Tümü + Görev filtreleri** — beş durum süzgeci, sayaçlı.
 * 3. **Kategoriler** — MC'nin yedi kategorisi, rozetli sayaçlarla.
 * 4. **Durum** — Biten / Bitmeyen.
 * 5. **Araçlar** — sıralama açılır listesi ve arama kutusu.
 * 6. **Alt bölüm** — Ayarlar · Tarayıcı Eklentisi · Hakkında.
 *
 * Filtre ve araç seçimleri paneli **açık tutar** (kullanıcı birkaç filtreyi
 * üst üste deneyebilir); Ayarlar/Hakkında gibi içerik değiştiren eylemler
 * kapatır.
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
  toggleSelectAll,
  type SortKey,
} from "../lib/store";
import {
  setAboutOpen,
  openBrowserSetup,
  setAddDialogOpen,
  setSettingsOpen,
  setSideOpen,
  settingsOpen,
} from "../lib/ui";
import { categoryLabel } from "../lib/format";
import { t } from "../lib/i18n";
import Tip from "./Tip";
import {
  clearFinished,
  pauseAllDownloads,
  pasteDownload,
  resumeAllDownloads,
} from "../lib/api";
import { bulkCancel } from "../lib/bulk";
import { errorText, pushFeedback } from "../lib/useFeedback";

/** Sıralama ölçütlerinin menü sırası (eski araç çubuğundan taşındı). */
const SORTS: { key: SortKey; label: string }[] = [
  { key: "status", label: "sort.status" },
  { key: "newest", label: "sort.newest" },
  { key: "oldest", label: "sort.oldest" },
  { key: "name", label: "sort.name" },
  { key: "size", label: "sort.size" },
  { key: "progress", label: "sort.progress" },
];

/** Hangi açılır liste açık (`null` ise hiçbiri). */
type OpenList = "sort" | null;

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
  const [open, setOpen] = createSignal<OpenList>(null);

  /** "Bittenleri Temizle" düğmesi yalnızca temizlenecek kayıt varsa etkindir. */
  const canClear = createMemo(() => {
    const c = taskCounts();
    return c.completed + c.failed + c.cancelled > 0;
  });

  /**
   * Toplu eylem (eski araç çubuğundan taşındı).
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

  /** Panodan yapıştır (MC `handlePaste`); hata durum şeridine düşer. */
  function pasteFromClipboard() {
    void pasteDownload().catch((e: unknown) =>
      pushFeedback("warn", errorText(e)),
    );
  }

  /** Etkin sıralamanın okunabilir adı. */
  const sortLabel = createMemo(
    () => SORTS.find((s) => s.key === sortKey())?.label ?? "sort.status",
  );

  // Dış tıklama ve Escape sıralama açılır listesini kapatır.
  createEffect(() => {
    if (!open()) return;

    const onDown = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest(".dd-anchor")) return;
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

  function toggleSort() {
    setOpen((cur) => (cur === "sort" ? null : "sort"));
  }

  /** Eylem çalıştıktan sonra paneli kapatır (içerik değiştiren eylemler). */
  function runAndClose(fn: () => void) {
    fn();
    setSideOpen(false);
  }

  return (
    <nav class="sidebar" aria-label={t("side.nav_aria")}>
      {/* 1) Eylemler */}
      <div class="side-head">{t("side.actions")}</div>
      <div class="side-group">
        <Tip
          label={t("tb.add")}
          keys="Ctrl+N"
          class="side-add"
          onClick={() => runAndClose(() => setAddDialogOpen(true))}
        >
          <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
            <path d="M7 2.5 V11.5 M2.5 7 H11.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
          {t("tb.add")}
        </Tip>

        <Tip label={t("menu.item.paste_url")} keys="Ctrl+V" class="side-item side-item-plain"
          onClick={pasteFromClipboard}>
          <span class="side-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15">
              <path
                d="M9 4 h6 v2 h-6 z M8 5 H6 v15 h12 V5 h-2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linejoin="round"
              />
            </svg>
          </span>
          <span class="side-label">{t("menu.item.paste_url")}</span>
        </Tip>

        <Tip label={t("menu.item.select_all")} keys="Ctrl+A" class="side-item side-item-plain"
          onClick={() => toggleSelectAll()}>
          <span class="side-icon" aria-hidden="true">
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
          <span class="side-label">{t("menu.item.select_all")}</span>
        </Tip>
      </div>

      <div class="side-group">
        <Tip label={t("tb.start_queue")} keys="Ctrl+R" class="side-item side-item-plain"
          onClick={() => void runBulk("resume")}>
          <span class="side-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15">
              <path d="M8 5 L19 12 L8 19 Z" fill="currentColor" />
            </svg>
          </span>
          <span class="side-label">{t("tb.start_queue")}</span>
        </Tip>

        <Tip label={t("tb.stop_all")} keys="Ctrl+P" class="side-item side-item-plain"
          onClick={() => void runBulk("pause")}>
          <span class="side-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15">
              <path d="M7 5 h3.5 v14 H7 z M13.5 5 H17 v14 h-3.5 z" fill="currentColor" />
            </svg>
          </span>
          <span class="side-label">{t("tb.stop_all")}</span>
        </Tip>

        <Tip label={t("menu.item.cancel_all")} keys="Ctrl+O" class="side-item side-item-plain"
          onClick={() => void bulkCancel()}>
          <span class="side-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15">
              <path
                d="M6 6 L18 18 M18 6 L6 18"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <span class="side-label">{t("menu.item.cancel_all")}</span>
        </Tip>

        <Tip
          label={t("tb.clear_done")}
          class="side-item side-item-plain"
          disabled={!canClear()}
          onClick={() => void runBulk("clear")}
        >
          <span class="side-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15">
              <path
                d="M5 7 h14 M9 7 V5 h6 v2 M7 7 l1 13 h8 l1-13"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linejoin="round"
              />
            </svg>
          </span>
          <span class="side-label">{t("tb.clear_done")}</span>
        </Tip>
      </div>

      {/* 2) Tümü + görev filtreleri */}
      <div class="side-head">{t("side.tasks")}</div>
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

        <For each={TASK_FILTERS.filter((f) => f !== "all")}>
          {(filter) => (
            <button
              type="button"
              class={`side-item${isTaskActive(filter) ? " side-item-active" : ""}`}
              onClick={() => selectTask(filter)}
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
                </svg>
              </span>
              <span class="side-label">{t(TASK_LABEL_KEY[filter])}</span>
              <span class="side-count">{tasks()[filter]}</span>
            </button>
          )}
        </For>
      </div>

      {/* 3) Kategoriler */}
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

      {/* 4) Durum */}
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

      {/* 5) Araçlar: sıralama + arama */}
      <div class="side-head">{t("side.tools")}</div>
      <div class="side-group side-tools">
        <div class="dd-anchor">
          <button
            type="button"
            class={`side-item side-dd ${open() === "sort" ? "side-dd-open" : ""}`}
            aria-haspopup="true"
            aria-expanded={open() === "sort"}
            onClick={toggleSort}
          >
            <span class="side-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="15" height="15">
                <path
                  d="M4 6 h16 M7 12 h10 M10 18 h4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linecap="round"
                />
              </svg>
            </span>
            <span class="side-label">{t(sortLabel())}</span>
            <span class="side-caret" aria-hidden="true">
              <svg viewBox="0 0 10 10" width="9" height="9">
                <path d="M2 4 L5 7 L8 4 Z" fill="currentColor" />
              </svg>
            </span>
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
      </div>

      {/* 6) Alt bölüm */}
      <div class="side-foot">
        <button
          type="button"
          class={`side-item${settingsOpen() ? " side-item-active" : ""}`}
          aria-pressed={settingsOpen()}
          onClick={() => runAndClose(() => setSettingsOpen(true))}
        >
          <span class="side-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15">
              <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6" />
              <path
                d="M12 3.5 v2.2 M12 18.3 v2.2 M3.5 12 h2.2 M18.3 12 h2.2 M6 6 l1.6 1.6 M16.4 16.4 L18 18 M18 6 l-1.6 1.6 M7.6 16.4 L6 18"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <span class="side-label">{t("tb.settings")}</span>
        </button>

        <button
          type="button"
          class="side-item"
          onClick={() => runAndClose(() => openBrowserSetup("chrome"))}
        >
          <span class="side-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15">
              <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.5" />
              <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.5" />
              <path d="M12 3.5 h8.5 M8.7 20.2 L14.5 11.6" stroke="currentColor" stroke-width="1.5" />
            </svg>
          </span>
          <span class="side-label">{t("menu.item.browser_setup")}</span>
        </button>

        <button
          type="button"
          class="side-item"
          onClick={() => runAndClose(() => setAboutOpen(true))}
        >
          <span class="side-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15">
              <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.5" />
              <path d="M12 11 v6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
              <circle cx="12" cy="7.8" r="1" fill="currentColor" />
            </svg>
          </span>
          <span class="side-label">{t("menu.item.about")}</span>
        </button>
      </div>
    </nav>
  );
}
