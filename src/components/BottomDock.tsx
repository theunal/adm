/**
 * Alt dock — hız grafiği / olayaily sekmeleri.
 *
 * Durum çubuğundaki ▾ düğmesi ya da ≡ menüsündeki "Hız Grafiği" /
 * "Olay Günlüğü" girdileri bu paneli açar. İkisi de kapalıysa panel
 * çizilmez (`App.tsx` içindeki `Show` bunu管理ir).
 *
 * Sekmeler tek bir konteyner içinde: sol tarafta hız grafiği, sağ tarafta
 * olayaily. Her ikisi de `store` ve `useFeedback` verilerini okur; ayrı
 * bileşenlere ayırmak yerine burada tutulmasının nedeni paylaşılan
 * panel yapısı (kapama düğmesi, yükseklik) olur.
 */
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { logs, itemHistory, itemSpeed, selectedItems } from "../lib/store";
import { formatSpeed } from "../lib/format";
import { t } from "../lib/i18n";

/** Grafik çizgisi için minimum genişlik (px). */
const MIN_W = 80;
/** Grafik yüksekliği (px). */
const H = 48;

/** Seçili kaydın speed history'sinden sparkline verisi çıkarır. */
function sparkPoints(samples: { t: number; speedMbps: number }[]): string {
  if (samples.length < 2) return "";
  const max = Math.max(...samples.map((s) => s.speedMbps), 0.001);
  const w = Math.max(MIN_W, samples.length * 4);
  const step = w / (samples.length - 1);
  return samples
    .map((s, i) => {
      const x = i * step;
      const y = H - (s.speedMbps / max) * (H - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function BottomDock() {
  const [tab, setTab] = createSignal<"graph" | "log">("graph");
  const [autoScroll, setAutoScroll] = createSignal(true);
  let logEnd: HTMLDivElement | undefined;

  const sel = createMemo(() => selectedItems());
  const id = createMemo(() => (sel().length === 1 ? sel()[0].id : null));
  const history = createMemo(() => (id() !== null ? itemHistory(id()!) : []));
  const speed = createMemo(() => (id() !== null ? itemSpeed(id()!) : 0));

  const peak = createMemo(() =>
    history().length > 0 ? Math.max(...history().map((s) => s.speedMbps)) : 0,
  );
  const avg = createMemo(() =>
    history().length > 0
      ? history().reduce((a, b) => a + b.speedMbps, 0) / history().length
      : 0,
  );

  // Olayaily sonuna otomatik kaydır.
  createMemo(() => {
    if (tab() === "log" && autoScroll() && logEnd) {
      logEnd.scrollIntoView({ behavior: "smooth" });
    }
  });

  onCleanup(() => {
    // Temizlik gerekmez; bileşen kapandığında kaynaklar salınır.
  });

  return (
    <div class="bottom-dock">
      <div class="dock-tabs">
        <button
          type="button"
          class={`dock-tab ${tab() === "graph" ? "dock-tab-active" : ""}`}
          onClick={() => setTab("graph")}
          aria-pressed={tab() === "graph"}
        >
          {t("graph.title")}
        </button>
        <button
          type="button"
          class={`dock-tab ${tab() === "log" ? "dock-tab-active" : ""}`}
          onClick={() => setTab("log")}
          aria-pressed={tab() === "log"}
        >
          {t("log.title")}
        </button>
        <button
          type="button"
          class="dock-tab dock-tab-auto"
          title={
            tab() === "log"
              ? autoScroll()
                ? t("log.to_bottom")
                : t("log.to_bottom")
              : ""
          }
          aria-label={t("log.to_bottom")}
          onClick={() => {
            if (tab() === "log") setAutoScroll(!autoScroll());
          }}
        >
          {tab() === "log" ? (autoScroll() ? "↓" : "↑") : ""}
        </button>
      </div>

      <div class="dock-body">
        <Show when={tab() === "graph"}>
          <Show
            when={id() !== null && history().length > 0}
            fallback={<p class="dock-empty">{t("graph.empty")}</p>}
          >
            <svg class="spark" viewBox={`0 0 ${Math.max(MIN_W, history().length * 4)} ${H}`} preserveAspectRatio="none">
              <polyline
                fill="none"
                stroke="var(--accent)"
                stroke-width="1.5"
                points={sparkPoints(history())}
              />
            </svg>
            <div class="graph-stats">
              <span class="graph-stat">
                <span class="graph-stat-key">{t("graph.now")}</span>
                <span class="graph-stat-value">{formatSpeed(speed())}</span>
              </span>
              <span class="graph-stat">
                <span class="graph-stat-key">{t("graph.peak")}</span>
                <span class="graph-stat-value">{formatSpeed(peak())}</span>
              </span>
              <span class="graph-stat">
                <span class="graph-stat-key">{t("graph.average")}</span>
                <span class="graph-stat-value">{formatSpeed(avg())}</span>
              </span>
              <span class="graph-stat">
                <span class="graph-stat-key">{t("graph.samples")}</span>
                <span class="graph-stat-value">{history().length}</span>
              </span>
            </div>
          </Show>
        </Show>

        <Show when={tab() === "log"}>
<Show
          when={logs.entries.length > 0}
          fallback={<p class="dock-empty">{t("log.empty")}</p>}
        >
          <ul class="log-list">
            <For each={logs.entries}>
              {(entry) => (
                <li class={`log-line log-${entry.level}`}>
                  <span class="log-time">{entry.time}</span>
                  <span class="log-msg">{entry.message}</span>
                </li>
              )}
            </For>
            <div ref={logEnd} />
          </ul>
        </Show>
        </Show>
      </div>
    </div>
  );
}