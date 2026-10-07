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
import { initSettings, settingsReady } from "./lib/settings";
import { t } from "./lib/i18n";
import TitleBar from "./components/TitleBar";
import NewDownloadForm from "./components/NewDownloadForm";
import DownloadList from "./components/DownloadList";
import LogPanel from "./components/LogPanel";
import SettingsPanel from "./components/SettingsPanel";

/** Log paneli açık / kapalı. */
const [logOpen, setLogOpen] = createSignal(true);

export default function App() {
  onMount(() => {
    // Ayarlar önce yüklenir: dil ve varsayılan kanal sayısı ilk boyamadan
    // hazır olsun, aksi halde içerik Türkçe/İngilizce arasında bir kez titrer.
    void initSettings().then(() =>
      initStore().catch((e: unknown) => {
        pushLogSafe("error", t("app.init_failed", { error: errorText(e) }));
      }),
    );
  });

  const totals = () => summary();
  const isSettings = () => activeTab() === "settings";

  return (
    <div class="app">
      {/* Ayarlar okunana kadar kabuk çizilmez; aksi halde içerik sistem
          dilinde bir an görünüp kayıtlı dile geçerdi (titreme). */}
      <Show
        when={settingsReady()}
        fallback={
          <div class="loading-state loading-state-boot">
            <span class="spinner" aria-hidden="true" />
          </div>
        }
      >
        <TitleBar />

        <main class="app-main">
          {/* Sol sütun: yeni indirme */}
          <aside class="sidebar">
            <NewDownloadForm />

            <div class="stat-block">
              <div class="stat">
                <span class="stat-value">{formatBytes(totals().totalDownloaded)}</span>
                <span class="stat-label">{t("app.stat.total_downloaded")}</span>
              </div>
              <div class="stat">
                <span class="stat-value">{formatSpeed(totals().totalSpeed)}</span>
                <span class="stat-label">{t("app.stat.speed")}</span>
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
                {t("app.tab.active")}
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
                {t("app.tab.history")}
                <Show when={historyCount() > 0}>
                  <span class="tab-badge">{historyCount()}</span>
                </Show>
              </button>

              <button
                type="button"
                role="tab"
                class={`tab ${isSettings() ? "tab-active" : ""}`}
                aria-selected={isSettings()}
                onClick={() => selectTab("settings")}
              >
                {t("app.tab.settings")}
              </button>

              <div class="tabs-spacer" />

              <Show when={!isSettings()}>
                <button
                  type="button"
                  class="btn btn-xs btn-ghost"
                  onClick={() => setLogOpen((v) => !v)}
                  title={logOpen() ? t("app.log.hide") : t("app.log.show")}
                >
                  {logOpen() ? t("app.log.hide") : t("app.log.show")}
                </button>
              </Show>
            </nav>

            {/* Ayarlar sekmesi listeyi ve günlüğü gizler. */}
            <Show
              when={!isSettings()}
              fallback={<SettingsPanel />}
            >
              <Show
                when={ready()}
                fallback={
                  <div class="loading-state">
                    <span class="spinner" aria-hidden="true" />
                    <p>{t("app.loading")}</p>
                  </div>
                }
              >
                <DownloadList />
              </Show>
            </Show>

            <Show when={logOpen() && !isSettings()}>
              <LogPanel />
            </Show>
          </section>
        </main>
      </Show>
    </div>
  );
}