/**
 * Alt dock — hız grafiği ve olay günlüğü.
 *
 * IDM'de bunlar ayrı pencerelerdir; burada tek bir dock panelinde sekme gibi
 * dururlar. Araç çubuğundaki düğmeler (veya menü: Seçenekler ▸ Hız Grafiği /
 * Olay Günlüğü) paneli açıp kapatır. İkisi de kapalıysa dock hiç çizilmez,
 * tablo tüm yüksekliği alır.
 *
 * Aynı anda ikisi açık olabilir; ancak tek gövde alanı paylaştıkları için
 * aktif sekme gövdeyi kaplar (sekmeye tıklamak etkinleştirir).
 */
import { For, Show } from "solid-js";
import { graphOpen, logOpen, setGraphOpen, setLogOpen } from "../lib/ui";
import { t } from "../lib/i18n";
import SpeedGraph from "./SpeedGraph";
import LogPanel from "./LogPanel";

type DockTab = "graph" | "log";

export default function BottomDock() {
  /** Etkin sekme: hangisi açıksa odur. */
  const active = (): DockTab | null => {
    if (graphOpen()) return "graph";
    if (logOpen()) return "log";
    return null;
  };

  return (
    <Show when={active() !== null}>
      <section class="dock" aria-label={t("graph.title")}>
        <header class="dock-head">
          <button
            type="button"
            role="tab"
            class={`dock-tab ${active() === "graph" ? "dock-tab-active" : ""}`}
            aria-selected={active() === "graph"}
            onClick={() => setGraphOpen(true)}
          >
            {t("graph.title")}
          </button>
          <button
            type="button"
            role="tab"
            class={`dock-tab ${active() === "log" ? "dock-tab-active" : ""}`}
            aria-selected={active() === "log"}
            onClick={() => setLogOpen(true)}
          >
            {t("log.title")}
          </button>

          <div class="dock-actions">
            <For each={["graph", "log"] as DockTab[]}>
              {(tab) => (
                <button
                  type="button"
                  class="dock-mini"
                  aria-pressed={tab === "graph" ? graphOpen() : logOpen()}
                  title={tab === "graph" ? t("tb.graph_title") : t("tb.log_title")}
                  onClick={() =>
                    tab === "graph"
                      ? setGraphOpen(!graphOpen())
                      : setLogOpen(!logOpen())
                  }
                >
                  {tab === "graph" ? t("tb.graph") : t("tb.log")}
                </button>
              )}
            </For>
          </div>
        </header>

        <div class="dock-body">
          <Show when={active() === "graph"}>
            <SpeedGraph />
          </Show>
          <Show when={active() === "log"}>
            <LogPanel />
          </Show>
        </div>
      </section>
    </Show>
  );
}