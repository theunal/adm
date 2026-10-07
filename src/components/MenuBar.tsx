/**
 * Menü çubuğu — IDM'in üst menü şeridi.
 *
 * Beş kök menü: Dosya · İndirmeler · Görevler · Seçenekler · Yardım.
 *
 * Menüler **tıklamayla** açılır; imleç üzerine geldiğinde açılmaz.
 * Açıkken şeridin dışına tıklamak ya da `Escape` kapatır, başka bir kök
 * menüye tıklamak o menüyü açar. Alt menülerde kısayol ipuçları
 * (`Ctrl+N`, `Del` …) sağda gösterilir; kısayolların kendisi `App.tsx`
 * içindeki genel klavye işleyicisi tarafından gerçeklenir.
 */
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import {
  clearFinished,
  closeWindow,
  confirm,
  openFolder,
  openPath,
} from "../lib/api";
import {
  bulkCancel,
  bulkPause,
  bulkResume,
  deleteItem,
} from "../lib/bulk";
import {
  bulkTargets,
  hasSelection,
  isCategoryActive,
  isTaskActive,
  selectCategory,
  selectTask,
  toggleSelectAll,
  type TaskFilter,
} from "../lib/store";
import { errorText, pushLogSafe } from "../lib/useFeedback";
import {
  focusUrlInput,
  graphOpen,
  logOpen,
  setAboutOpen,
  setGraphOpen,
  setLogOpen,
  setSettingsOpen,
  settingsOpen,
} from "../lib/ui";
import { t } from "../lib/i18n";
import type { CategoryKey, DownloadItem } from "../lib/format";

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

/** "Görevler" menüsündeki filtre sırası (kenar çubuğuyla aynı). */
const TASK_ITEMS: { filter: TaskFilter; key: string }[] = [
  { filter: "downloading", key: "side.task.downloading" },
  { filter: "queued", key: "side.task.queued" },
  { filter: "paused", key: "side.task.paused" },
  { filter: "completed", key: "side.task.completed" },
  { filter: "failed", key: "side.task.failed" },
  { filter: "cancelled", key: "side.task.cancelled" },
  { filter: "all", key: "side.task.all" },
];

/** Kategori menüsü sırası (kenar çubuğuyla aynı). */
const CATEGORY_ITEMS: { cat: CategoryKey; key: string }[] = [
  { cat: "video", key: "side.cat.video" },
  { cat: "audio", key: "side.cat.audio" },
  { cat: "program", key: "side.cat.program" },
  { cat: "archive", key: "side.cat.archive" },
  { cat: "document", key: "side.cat.document" },
  { cat: "other", key: "side.cat.other" },
];

/** Seçili ya da görünür ilk kayıt (menü eylemlerinin konusu). */
function primaryItem(): DownloadItem | null {
  const targets = bulkTargets();
  return targets.length > 0 ? targets[0] : null;
}

/** Dosyayı açar; hata olursa log'a yazar. */
function openSelectedFile(item: DownloadItem | null) {
  if (!item) return;
  void openPath(item.filePath).catch((e: unknown) =>
    pushLogSafe(
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
    pushLogSafe(
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
    pushLogSafe("info", t("dialog.copied"), item.id);
  } catch (e) {
    pushLogSafe(
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
    pushLogSafe("error", t("list.err.clear", { error: errorText(e) }));
  }
}

const MENUS: MenuRoot[] = [
  {
    id: "file",
    key: "menu.file",
    entries: () => {
      const item = primaryItem();
      return [
        { kind: "item", key: "menu.item.add_url", accel: "Ctrl+N", run: focusUrlInput },
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

export default function MenuBar() {
  /** Açık kök menü (`null` ise hiçbiri açık değil). */
  const [openId, setOpenId] = createSignal<string | null>(null);
  /** Menü şeridinin DOM referansı (dış tıklama denetimi için). */
  let bar: HTMLElement | undefined;

  const isOpen = (id: string) => openId() === id;

  /** Menü etiketine tıklanınca açar / kapatır. */
  function toggle(id: string) {
    setOpenId((cur) => (cur === id ? null : id));
  }

  /** Girdi seçildi: eylemi çalıştır ve menüyü kapat. */
  function activate(entry: Extract<MenuEntry, { kind: "item" }>) {
    entry.run?.();
    setOpenId(null);
  }

  /**
   * Menü **yalnızca tıklayınca** açılır (üzerine gelince değil).
   *
   * Açıkken iki davranış gerekiyor:
   *
   * * Şeridin dışına tıklama kapatır. Dinleyici `capture` aşamasında
   *   çalışır; aksi halde kabuktaki (App) genel tıklama işleyicisi önce
   *   çalışıp menüyü kapatabilirdi.
   * * `Escape` kapatır (klavye odağı menüde olduğunda `window` hedefi
   *   yakalanmaz).
   *
   * İmleç, etiketten açılır listeye (`.menu-pop`) inerken `mouseleave`
   * tetiklenmez: liste `.menu-root`un bir **çocuğu** olduğu için imleç
   * hâlâ menünün üzerindedir.
   */
  createEffect(() => {
    if (!openId()) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!bar?.contains(event.target as Node)) setOpenId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenId(null);
    };

    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    onCleanup(() => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    });
  });

  return (
    <nav class="menubar" role="menubar" ref={bar}>
      <For each={MENUS}>
        {(menu) => (
          <div class="menu-root" role="none">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isOpen(menu.id)}
              class={`menu-label ${isOpen(menu.id) ? "menu-label-open" : ""}`}
              onClick={() => toggle(menu.id)}
            >
              {t(menu.key)}
            </button>

            <Show when={isOpen(menu.id)}>
              <div class="menu-pop" role="menu">
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
                        <Show when={entry.checked?.()}>
                          <span class="menu-check" aria-hidden="true">
                            ✓
                          </span>
                        </Show>
                        {t(entry.key)}
                        <Show when={entry.accel}>
                          <span class="menu-accel">{entry.accel}</span>
                        </Show>
                      </button>
                    )
                  }
                </For>
              </div>
            </Show>
          </div>
        )}
      </For>
    </nav>
  );
}