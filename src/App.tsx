/**
 * Uygulama kabuğu — MC (MC Download Manager) düzeni.
 *
 * Sütunlar (yukarıdan aşağı):
 *
 * ```text
 * TitleBar   logo · ADM · TR/EN · dişli ayarlar · pencere düğmeleri
 * ── app-body ────────────────────────────────────────────────
 * Menü düğmesi  kapalıyken sol üst köşede yüzen ☰
 * Sidebar    açılır-kapanır katman menü (☰ ile açılır)
 * content    Tablo  |  Ayarlar paneli
 * Toast      sağ altta köşe bildirimi (eylem sonucu / hata)
 * ────────────────────────────────────────────────────────────
 * ```
 *
 * Alt çubuk kaldırıldı: pencerenin dibinde hiçbir şey yok. Toplam hız ve
 * ana açık/kapalı anahtarı sol menüye, geçici mesajlar sağ alttaki köşe
 * bildirimine (`Toast.tsx`) taşındı.
 *
 * Üst çubuk (araç çubuğu) ve ≡ menüsü de kaldırıldı; taşıdıkları işlevlerin
 * tamamı **sol panele** taşındı (eylemler · filtreler · araçlar · alt
 * bölüm). Panel kapalıyken hiç çizilmez; açılınca içeriğin üzerinde katman
 * olarak görünür ve dış tıklama ile kapanır. Tüm durum `src/lib/store.ts`
 * üzerinden yönetilir; klavye kısayolları da burada toplanır.
 *
 * **Ayarlar tuzağı:** `settingsOpen` yalnızca `content` alanını değiştirir,
 * kenar çubuğu görünür kalır. Bu yüzden `selectTask` / `selectCategory`
 * (`store.ts`) ayarları kapatır; aksi halde kenar çubuğuna tıklamak yalnızca
 * görünmez bir filtre değiştirir ve kullanıcı liste dönemez.
 *
 * Ayrıntı penceresi **ayrı bir OS penceresidir** (`DetailWindow.tsx`, Rust
 * tarafında `detail-<id>` etiketiyle açılır); buradaki `DownloadDetailDialog`
 * ise satır bağlam menüsünden açılan uçtan uca modal hâlidir.
 */
import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { initStore, selectedItems, toggleSelectAll } from "./lib/store";
import { initSettings, settingsReady } from "./lib/settings";
import { errorText, pushFeedback } from "./lib/useFeedback";
import { t } from "./lib/i18n";
import {
  addDialogOpen,
  aboutOpen,
  contextMenu,
  propertiesItem,
  setAboutOpen,
  setAddDialogOpen,
  setContextMenu,
  setPropertiesItem,
  setSettingsOpen,
  setSideOpen,
  sideOpen,
  settingsOpen,
} from "./lib/ui";
import { bulkCancel, bulkPause, bulkResume, deleteSelected } from "./lib/bulk";
import { answerClipboardPrompt, confirm, pasteDownload } from "./lib/api";
import { clipboardPrompt, setClipboardPrompt } from "./lib/store";
import TitleBar from "./components/TitleBar";
import DownloadTable from "./components/DownloadTable";
import Sidebar from "./components/Sidebar";
import MenuToggle from "./components/MenuToggle";
import Toast from "./components/Toast";
import SettingsPanel from "./components/SettingsPanel";
import RowContextMenu from "./components/RowContextMenu";
import AboutDialog from "./components/AboutDialog";
import BrowserSetupDialog from "./components/BrowserSetupDialog";
import ClipboardPromptDialog from "./components/ClipboardPromptDialog";
import DownloadDetailDialog from "./components/DownloadDetailDialog";
import NewDownloadDialog from "./components/NewDownloadDialog";

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
          pushFeedback("error", t("app.init_failed", { error: errorText(e) }));
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

    /**
     * `Ctrl+V`: panodan bağlantı alıp sorma penceresini açar (MC
     * `ClipboardWatcher.handlePaste`).
     *
     * Pano okunamıyor ya da uygun bağlantı yoksa hata **durum şeridinde**
     * görünür: tuşa basıp hiçbir şey olmaması, tuşun işlemediği izlenimini
     * verirdi.
     */
    async function pasteFromClipboard() {
      try {
        await pasteDownload();
      } catch (e) {
        pushFeedback("warn", errorText(e));
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      // `Escape` her zaman çalışır: açık pencere / menüyü kapatır.
      if (event.key === "Escape") {
        if (clipboardPrompt()) {
          // Soru kapatılırken izleyiciye "yanıtlandı" bildirilir; aksi halde
          // Rust tarafı yeni kopyalamalar için susar.
          setClipboardPrompt(null);
          void answerClipboardPrompt().catch(() => undefined);
        } else if (contextMenu()) setContextMenu(null);
        else if (sideOpen()) setSideOpen(false);
        else if (addDialogOpen()) setAddDialogOpen(false);
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
            setAddDialogOpen(true);
            break;
          case "v":
            event.preventDefault();
            void pasteFromClipboard();
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
          case "s":
            event.preventDefault();
            setSettingsOpen(!settingsOpen());
            break;
          case "m":
            // Sol menüyü açar/kapatır (☰ düğmesinin klavye karşılığı).
            event.preventDefault();
            setSideOpen(!sideOpen());
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

        <div class="app-body">
          {/* Menü açma düğmesi: yalnızca panel kapalıyken, sol üst köşede.
              (Açıkken karşılığı panelin kendi başlık satırındaki ✕.) */}
          <Show when={!sideOpen()}>
            <MenuToggle />
          </Show>

          {/* Sol menü: açılır-kapanır katman. Kapalıyken hiç çizilmez; açılınca
              tablonun üzerinde durur (yanında yer kaplamaz). Dış tıklama
              aşağıdaki `onMouseDown` ile kapatılır; panelin kendi tıklamaları
              `.closest(".sidebar")` korumasıyla geçer. */}
          <Show when={sideOpen()}>
            <Sidebar />
          </Show>

          <main
            class="content"
            onMouseDown={(e) => {
              // Yalnızca panel açıkken ve panel dışına basıldığında kapat.
              if (!sideOpen()) return;
              const el = e.target as HTMLElement | null;
              if (el?.closest(".sidebar")) return;
              setSideOpen(false);
            }}
          >
            {/* Ayarlar menüsü tablonun yerini alır. */}
            <Show when={!settingsOpen()} fallback={<SettingsPanel />}>
              <DownloadTable />
            </Show>
          </main>
        </div>

        {/* Köşe bildirimi: eylem sonuçları ve hatalar. Alt çubuk kaldırıldığı
            için uygulamanın tek görünür geri bildirim kanalı burası. */}
        <Toast />

        {/* Katmanlar: bağlam menüsü ve pencereler kabuğun üstünde */}
        <RowContextMenu />
        <NewDownloadDialog />
        <AboutDialog />
        <BrowserSetupDialog />
        <ClipboardPromptDialog />
        <DownloadDetailDialog />
      </Show>
    </div>
  );
}