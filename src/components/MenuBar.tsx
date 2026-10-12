/**
 * Menü tanımı ve ≡ paneli.
 *
 * Beş bölüm: Dosya · İndirmeler · Görevler · Seçenekler · Yardım.
 *
 * Menü çubuğu ayrı bir satır olmaktan çıkarıldı; menüler araç çubuğundaki
 * **≡** düğmesinden açılan panelde gösterilir. Tanım (`MENUS`) canlı duruma
 * bağlı olduğu için girdiler üretici olarak yazıldı: sayaçlar, etkin filtre
 * ve açık/kapalı paneller anında doğru görünür.
 *
 * Alt menülerde kısayol ipuçları (`Ctrl+N`, `Del` …) sağda görünür;
 * kısayolların kendisi `App.tsx` içindeki genel klavye işleyicisinde
 * gerçeklenir.
 */
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import {
  clearFinished,
  closeWindow,
  confirm,
  openFolder,
  openPath,
  pasteDownload,
} from "../lib/api";
import {
  bulkCancel,
  bulkPause,
  bulkResume,
  deleteItem,
} from "../lib/bulk";
import {
  TASK_FILTERS,
  TASK_LABEL_KEY,
  bulkTargets,
  hasSelection,
  isCategoryActive,
  isTaskActive,
  selectCategory,
  selectTask,
  toggleSelectAll,
  type TaskFilter,
} from "../lib/store";
import { errorText, pushFeedback } from "../lib/useFeedback";
import {
  addDialogOpen,
  graphOpen,
  logOpen,
  setAboutOpen,
  openBrowserSetup,
  setAddDialogOpen,
  setGraphOpen,
  setLogOpen,
  setSettingsOpen,
  settingsOpen,
} from "../lib/ui";
import { t } from "../lib/i18n";
import { CATEGORY_ORDER, type CategoryKey, type DownloadItem } from "../lib/format";

/**
 * Alt menü girdisi.
 *
 * `kind` ayrımı iki nedenle ayrık birleşim (union) olarak modellendi:
 * ayırıcının çeviri anahtarı yoktur ve filtre girdileri menü seçildikten
 * sonra menüyü kapatmak zorundadır (aks halde "Görevler" menüsü açık kalır).
 */
type MenuEntry =
  | { kind: "sep" }
  | {
    kind: "item";
    /** `t()` anahtarı. */
    key: string;
    /** Sağda gösterilen kısayol ipucu. */
    accel?: string;
    /** Tıklanınca çalışacak eylem. */
    run?: () => void;
    /** Devre dışı bırakılabilir mi? (yoksa her zaman etkin). */
    enabled?: () => boolean;
    /** Onay işareti gösterilsin mi? */
    checked?: () => boolean;
  };

interface MenuRoot {
  id: string;
  /** Menü etiketi (`t()` anahtarı). */
  key: string;
  /** Girdiler canlı duruma bağlı olduğu için üretici olarak tanımlanır. */
  entries: () => MenuEntry[];
}

/**
 * "Görevler" menüsündeki filtre sırası (kenar çubuğuyla aynı).
 *
 * `TASK_FILTERS` tek kaynaktır; etiketler `TASK_LABEL_KEY` üzerinden gelir.
 */
const TASK_ITEMS: { filter: TaskFilter; key: string }[] = TASK_FILTERS.map(
  (filter) => ({ filter, key: TASK_LABEL_KEY[filter] }),
);

/** Kategori menüsü sırası (kenar çubuğuyla aynı). */
const CATEGORY_ITEMS: { cat: CategoryKey; key: string }[] = CATEGORY_ORDER.map(
  (cat) => ({ cat, key: `cat.${cat}` }),
);

/** Seçili ya da görünür ilk kayıt (menü eylemlerinin konusu). */
function primaryItem(): DownloadItem | null {
  const targets = bulkTargets();
  return targets.length > 0 ? targets[0] : null;
}

/** Dosyayı açar; hata olursa log'a yazar. */
function openSelectedFile(item: DownloadItem | null) {
  if (!item) return;
  void openPath(item.filePath).catch((e: unknown) =>
    pushFeedback(
      "error",
      t("act.failed", { action: t("act.open"), error: errorText(e) }),
      item.id,
    ),
  );
}

/** Klasörü açar. */
function openSelectedFolder(item: DownloadItem | null) {
  if (!item) return;
  void openFolder(item.filePath).catch((e: unknown) =>
    pushFeedback(
      "error",
      t("act.failed", { action: t("act.folder"), error: errorText(e) }),
      item.id,
    ),
  );
}

/** Seçili kaydın adresini panoya kopyalar. */
async function copySelectedUrl(item: DownloadItem | null) {
  if (!item) return;
  try {
    await navigator.clipboard.writeText(item.url);
    pushFeedback("info", t("dialog.copied"));
  } catch (e) {
    pushFeedback(
      "error",
      t("act.failed", { action: t("menu.item.copy_url"), error: errorText(e) }),
      item.id,
    );
  }
}

/** Seçili kaydı (ve istenirse dosyasını) onaylayarak siler. */
async function deleteWithConfirm(item: DownloadItem | null, withFile: boolean) {
  if (!item) return;
  const ok = await confirm(
    withFile
      ? t("dialog.delete_file.body", { name: item.fileName })
      : t("dialog.delete_record.body", { name: item.fileName }),
    withFile ? t("dialog.delete_file.title") : t("dialog.delete_record.title"),
  );
  if (ok) await deleteItem(item, withFile);
}

/** Geçmiş kayıtlarını temizler. */
async function clearList() {
  try {
    await clearFinished();
  } catch (e) {
    pushFeedback("error", t("list.err.clear", { error: errorText(e) }));
  }
}

const MENUS: MenuRoot[] = [
  {
    id: "file",
    key: "menu.file",
    entries: () => {
      const item = primaryItem();
      return [
        {
        kind: "item",
        key: "menu.item.add_url",
        accel: "Ctrl+N",
        checked: () => addDialogOpen(),
        run: () => setAddDialogOpen(true),
      },
        {
          kind: "item",
          key: "menu.item.paste_url",
          accel: "Ctrl+V",
          // Hata durum şeridine düşer: panoda uygun bağlantı yoksa tuşun
          // işlemediği anlaşılmalı.
          run: () => {
            void pasteDownload().catch((e: unknown) =>
              pushFeedback("warn", errorText(e)),
            );
          },
        },
        {
          kind: "item",
          key: "menu.item.open_file",
          enabled: () => item !== null,
          run: () => openSelectedFile(item),
        },
        {
          kind: "item",
          key: "menu.item.open_folder",
          enabled: () => item !== null,
          run: () => openSelectedFolder(item),
        },
        { kind: "item", key: "menu.item.copy_url", enabled: () => item !== null, run: () => void copySelectedUrl(item) },
        { kind: "sep" },
        { kind: "item", key: "menu.item.exit", accel: "Alt+F4", run: () => void closeWindow() },
      ];
    },
  },
  {
    id: "downloads",
    key: "menu.downloads",
    entries: () => {
      const item = primaryItem();
      const has = hasSelection();
      return [
        { kind: "item", key: "menu.item.pause_all", accel: "Ctrl+P", run: () => void bulkPause() },
        { kind: "item", key: "menu.item.resume_all", accel: "Ctrl+R", run: () => void bulkResume() },
        { kind: "item", key: "menu.item.cancel_all", accel: "Ctrl+O", run: () => void bulkCancel() },
        { kind: "sep" },
        { kind: "item", key: "menu.item.select_all", accel: "Ctrl+A", run: toggleSelectAll },
        {
          kind: "item",
          key: "menu.item.clear_history",
          enabled: () => bulkTargets().length > 0,
          run: () => void clearList(),
        },
        { kind: "sep" },
        {
          kind: "item",
          key: "menu.item.delete_record",
          accel: "Del",
          enabled: () => has,
          run: () => void deleteWithConfirm(item, false),
        },
        {
          kind: "item",
          key: "menu.item.delete_download",
          enabled: () => has,
          run: () => void deleteWithConfirm(item, true),
        },
      ];
    },
  },
  {
    id: "tasks",
    key: "menu.tasks",
    entries: () => [
      ...TASK_ITEMS.map<MenuEntry>(({ filter, key }) => ({
        kind: "item",
        key,
        checked: () => isTaskActive(filter),
        run: () => selectTask(filter),
      })),
      { kind: "sep" },
      ...CATEGORY_ITEMS.map<MenuEntry>(({ cat, key }) => ({
        kind: "item",
        key,
        checked: () => isCategoryActive(cat),
        run: () => selectCategory(cat),
      })),
    ],
  },
  {
    id: "options",
    key: "menu.options",
    entries: () => [
      {
        kind: "item",
        key: "menu.item.settings",
        accel: "Ctrl+S",
        checked: () => settingsOpen(),
        run: () => setSettingsOpen(!settingsOpen()),
      },
      {
        kind: "item",
        key: "menu.item.browser_setup",
        run: () => openBrowserSetup("chrome"),
      },
      { kind: "sep" },
      {
        kind: "item",
        key: "menu.item.speed_graph",
        accel: "Ctrl+G",
        checked: () => graphOpen(),
        run: () => setGraphOpen(!graphOpen()),
      },
      {
        kind: "item",
        key: "menu.item.event_log",
        accel: "Ctrl+L",
        checked: () => logOpen(),
        run: () => setLogOpen(!logOpen()),
      },
    ],
  },
  {
    id: "help",
    key: "menu.help",
    entries: () => [{ kind: "item", key: "menu.item.about", run: () => setAboutOpen(true) }],
  },
];


/**
 * ≡ menü paneli.
 *
 * Menü çubuğu satırı kaldırıldı; tüm menüler araç çubuğundaki **≡**
 * düğmesinden açılan tek panelde, beş sütun hâlinde gösterilir. Sütun
 * düzeni eski menü çubuğuyla aynıdır, yalnızca yerleşimi yatay.
 *
 * Menü **yalnızca tıklamayla** açılır (üzerine gelince değil). Açıkken
 * dışarıya tıklamak ya da `Escape` kapatır. Dış tıklama dinleyicisi
 * `capture` aşamasında çalışır; aksi halde kabuktaki genel tıklama
 * işleyicisi önce çalışıp paneli kapatabilirdi.
 */
export default function MenuBar() {
  /** Panel açık mı? */
  const [open, setOpen] = createSignal(false);
  /** Panelin DOM referansı (dış tıklama denetimi için). */
  let bar: HTMLDivElement | undefined;

  /** Girdi seçildi: eylemi çalıştır ve paneli kapat. */
  function activate(entry: Extract<MenuEntry, { kind: "item" }>) {
    entry.run?.();
    setOpen(false);
  }

  createEffect(() => {
    if (!open()) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!bar?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    });
  });

  return (
    <div class="menu-anchor" ref={bar}>
      <button
        type="button"
        class={`tb-icon ${open() ? "tb-icon-open" : ""}`}
        title={t("menu.file")}
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-label={t("menu.file")}
        onClick={() => setOpen(!open())}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path
            d="M2 4 H13 M2 8 H10 M2 12 H13"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
          />
          <path d="M11.6 6.4 L14.2 8 L11.6 9.6 Z" fill="currentColor" />
        </svg>
      </button>

      <Show when={open()}>
        <div class="menu-panel" role="menu">
          <For each={MENUS}>
            {(menu) => (
              <div class="menu-col">
                <div class="menu-col-title">{t(menu.key)}</div>
                <For each={menu.entries()}>
                  {(entry) =>
                    entry.kind === "sep" ? (
                      <div class="menu-sep" role="separator" />
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        class="menu-item"
                        disabled={entry.enabled ? !entry.enabled() : false}
                        onClick={() => activate(entry)}
                      >
                        <span class="menu-check" aria-hidden="true">
                          <Show when={entry.checked?.()}>✓</Show>
                        </span>
                        {t(entry.key)}
                        <Show when={entry.accel}>
                          <span class="menu-accel">{entry.accel}</span>
                        </Show>
                      </button>
                    )
                  }
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}