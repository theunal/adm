/**
 * Uygulama kabuğu — klasik IDM yerleşimi.
 *
 * Sütunlar (yukarıdan aşağı):
 *
 * ```text
 * TitleBar   pencere başlığı + TR/EN + pencere düğmeleri
 * MenuBar    Dosya ▾ İndirmeler ▾ Görevler ▾ Seçenekler ▾ Yardım ▾
 * Toolbar    yeşil "URL Ekle" + toplu duraklat/sürdür/iptal/sil + panel düğmeleri
 * ┌──────────┬───────────────────────────────────┐
 * │ Sidebar  │ DownloadTable  (veya SettingsPanel)│
 * │ görevler │ BottomDock      (grafik / günlük)  │
 * │ kategor. │                                   │
 * └──────────┴───────────────────────────────────┘
 * StatusBar  boş alan · hız · aktif · indirilen · süre
 * ```
 *
 * Tüm durum `src/lib/store.ts` üzerinden yönetilir; Rust tarafından gelen
 * gerçek zamanlı olaylar bu kabuğa bağlanır. Klavye kısayolları da burada
 * toplanır (menüde yalnızca ipuçları görünür).
 */
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { initStore, selectedItems, toggleSelectAll } from "./lib/store";
import { initSettings, settingsReady } from "./lib/settings";
import { errorText, pushLogSafe } from "./lib/useFeedback";
import { t } from "./lib/i18n";
import {
  aboutOpen,
  contextMenu,
  focusUrlInput,
  graphOpen,
  logOpen,
  propertiesItem,
  setAboutOpen,
  setContextMenu,
  setGraphOpen,
  setLogOpen,
  setPropertiesItem,
  setSettingsOpen,
  settingsOpen,
} from "./lib/ui";
import { bulkCancel, bulkPause, bulkResume, deleteSelected } from "./lib/bulk";
import { confirm } from "./lib/api";
import TitleBar from "./components/TitleBar";
import MenuBar from "./components/MenuBar";
import Toolbar from "./components/Toolbar";
import Sidebar from "./components/Sidebar";
import DownloadTable from "./components/DownloadTable";
import BottomDock from "./components/BottomDock";
import StatusBar from "./components/StatusBar";
import SettingsPanel from "./components/SettingsPanel";
import RowContextMenu from "./components/RowContextMenu";
import AboutDialog from "./components/AboutDialog";
import PropertiesDialog from "./components/PropertiesDialog";

/** `mount` sonrası ayarlar hazır mı? (kabuk, o ana kadar çizilmez) */
const [booted, setBooted] = createSignal(false);

/** Kullanıcı bir metin kutusuna yazıyor mu? (kısayolları devre dışı bırakır) */
function inTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

export default function App() {
  onMount(() => {
    // Ayarlar önce yüklenir: dil ve varsayılan kanal sayısı ilk boyamadan
    // hazır olsun, aksi halde içerik Türkçe/İngilizce arasında bir kez titrer.
    void initSettings().then(() =>
      initStore()
        .catch((e: unknown) => {
          pushLogSafe("error", t("app.init_failed", { error: errorText(e) }));
        })
        .finally(() => setBooted(true)),
    );
  });

  /* -----------------------------------------------------------------
     Klavye kısayolları
     ----------------------------------------------------------------- */

  onMount(() => {
    /** `Del` ile seçili kayıtları siler (dosya korunur, onay ister). */
    async function deleteSelection() {
      const count = selectedItems().length;
      if (count === 0) return;

      const ok = await confirm(
        t("dialog.bulk_delete.body", { count }),
        t("dialog.bulk_delete.title"),
      );
      if (ok) await deleteSelected(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      // `Escape` her zaman çalışır: açık pencere / menüyü kapatır.
      if (event.key === "Escape") {
        if (contextMenu()) setContextMenu(null);
        else if (aboutOpen()) setAboutOpen(false);
        else if (propertiesItem()) setPropertiesItem(null);
        else if (settingsOpen()) setSettingsOpen(false);
        return;
      }

      if (inTextField(event.target)) return;

      // `Ctrl` (macOS'ta `Cmd`) kombinasyonları.
      if (event.ctrlKey || event.metaKey) {
        switch (event.key.toLowerCase()) {
          case "n":
            event.preventDefault();
            focusUrlInput();
            break;
          case "p":
            event.preventDefault();
            void bulkPause();
            break;
          case "r":
            event.preventDefault();
            void bulkResume();
            break;
          case "o":
            event.preventDefault();
            void bulkCancel();
            break;
          case "a":
            event.preventDefault();
            toggleSelectAll();
            break;
          case "g":
            event.preventDefault();
            setGraphOpen(!graphOpen());
            break;
          case "l":
            event.preventDefault();
            setLogOpen(!logOpen());
            break;
          case "s":
            event.preventDefault();
            setSettingsOpen(!settingsOpen());
            break;
          default:
            break;
        }
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        void deleteSelection();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  return (
    <div class="app">
      {/* Ayarlar okunana kadar kabuk çizilmez; aksi halde içerik sistem
          dilinde bir an görünüp kayıtlı dile geçerdi (titreme). */}
      <Show
        when={booted() && settingsReady()}
        fallback={
          <div class="loading-state loading-state-boot">
            <span class="spinner" aria-hidden="true" />
          </div>
        }
      >
        <TitleBar />
        <MenuBar />
        <Toolbar />

        <div class="app-body">
          <Sidebar />

          <main class="content">
            {/* Ayarlar menüsü tablonun yerini alır. */}
            <Show when={!settingsOpen()} fallback={<SettingsPanel />}>
              <DownloadTable />

              <Show when={graphOpen() || logOpen()}>
                <BottomDock />
              </Show>
            </Show>
          </main>
        </div>

        <StatusBar />

        {/* Katmanlar: bağlam menüsü ve pencereler kabuğun üstünde */}
        <RowContextMenu />
        <AboutDialog />
        <PropertiesDialog />
      </Show>
    </div>
  );
}