/**
 * Uygulama kabuğu.
 *
 * Düzen: solda yeni indirme formu, sağda sekmeli liste, altta log paneli.
 * Tüm durum `src/lib/store.ts` üzerinden yönetilir; Rust tarafından
 * gelen gerçek zamanlı olaylar bu kabuğa bağlanır.
 */
import { Show, createSignal, onMount } from "solid-js";
import {
  activeCount,
  activeTab,
  historyCount,
  initStore,
  ready,
  selectTab,
  summary,
} from "./lib/store";
import { errorText, pushLogSafe } from "./lib/useFeedback";
import { formatBytes, formatSpeed } from "./lib/format";
import TitleBar from "./components/TitleBar";
import NewDownloadForm from "./components/NewDownloadForm";
import DownloadList from "./components/DownloadList";
import LogPanel from "./components/LogPanel";

/** Log paneli açık / kapalı. */
const [logOpen, setLogOpen] = createSignal(true);

export default function App() {
  onMount(() => {
    initStore().catch((e: unknown) => {
      pushLogSafe("error", `Uygulama başlatılamadı: ${errorText(e)}`);
    });
  });

  const totals = () => summary();

  return (
    <div class="app">
      <TitleBar />

      <main class="app-main">
        {/* Sol sütun: yeni indirme */}
        <aside class="sidebar">
          <NewDownloadForm />

          <div class="stat-block">
            <div class="stat">
              <span class="stat-value">{formatBytes(totals().totalDownloaded)}</span>
              <span class="stat-label">toplam indirildi</span>
            </div>
            <div class="stat">
              <span class="stat-value">{formatSpeed(totals().totalSpeed)}</span>
              <span class="stat-label">anlık hız</span>
            </div>
          </div>
        </aside>

        {/* Sağ sütun: sekmeli liste + log */}
        <section class="content">
          <nav class="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              class={`tab ${activeTab() === "active" ? "tab-active" : ""}`}
              aria-selected={activeTab() === "active"}
              onClick={() => selectTab("active")}
            >
              Aktif İndirmeler
              <Show when={activeCount() > 0}>
                <span class="tab-badge tab-badge-live">{activeCount()}</span>
              </Show>
            </button>

            <button
              type="button"
              role="tab"
              class={`tab ${activeTab() === "history" ? "tab-active" : ""}`}
              aria-selected={activeTab() === "history"}
              onClick={() => selectTab("history")}
            >
              Geçmiş
              <Show when={historyCount() > 0}>
                <span class="tab-badge">{historyCount()}</span>
              </Show>
            </button>

            <div class="tabs-spacer" />

            <button
              type="button"
              class="btn btn-xs btn-ghost"
              onClick={() => setLogOpen((v) => !v)}
              title={logOpen() ? "Günlüğü gizle" : "Günlüğü göster"}
            >
              {logOpen() ? "Günlüğü gizle" : "Günlüğü göster"}
            </button>
          </nav>

          <Show
            when={ready()}
            fallback={
              <div class="loading-state">
                <span class="spinner" aria-hidden="true" />
                <p>Kayıtlar yükleniyor…</p>
              </div>
            }
          >
            <DownloadList />
          </Show>

          <Show when={logOpen()}>
            <LogPanel />
          </Show>
        </section>
      </main>
    </div>
  );
}