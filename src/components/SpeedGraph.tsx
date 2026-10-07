/**
 * Hız grafiği — IDM'in "Speed graph" penceresinin dock hâli.
 *
 * Sol tarafta alan/çizgi grafiği, sağda istatistik listesi (tepe, ortalama,
 * anlık hız ve örnek sayısı). Grafik, Rust tarafından gelen `SpeedSample`
 * dizisinden kurulur; her satır kendi geçmişini taşır.
 *
 * Y ekseni otomatik ölçeklidir: en büyük örnek tepe hızdır ve tam grafik
 * yüksekliğini doldurur. Yatay ızgara çizgileri ekseni okunur kılar.
 */
import { For, Show, createMemo } from "solid-js";
import { allItems, itemHistory, itemSpeed } from "../lib/store";
import { formatDuration, formatNumber, formatSpeed } from "../lib/format";
import { t } from "../lib/i18n";

/** Grafik tuvali (SVG görünüm alanı). */
const W = 1000;
const H = 200;

/** Yatay ızgara bölmesi. */
const ROWS = 4;

export default function SpeedGraph() {
  /** Bütün kayıtların hız geçmişi birleştirilir (en yeni örnek sağda). */
  const samples = createMemo(() => {
    const all: { t: number; speedMbps: number }[] = [];
    for (const item of allItems()) {
      all.push(...itemHistory(item.id));
    }
    // Zaman damgasıyla sırala; aynı tik birden çok kayıttan gelmiş olabilir.
    return all.sort((a, b) => a.t - b.t).slice(-240);
  });

  /** Toplam anlık hız (birden çok indirme birlikte çalışabilir). */
  const current = createMemo(() =>
    allItems().reduce((sum, item) => {
      const s = itemSpeed(item.id);
      return item.status === "Downloading" || item.status === "Queued"
        ? sum + s
        : sum;
    }, 0),
  );

  const stats = createMemo(() => {
    const list = samples().map((s) => s.speedMbps);
    const peak = list.length > 0 ? Math.max(...list) : 0;
    const sum = list.reduce((a, b) => a + b, 0);

    // Yatay eksen: en eski ve en yeni örneğin zaman farkı (saniye).
    const stamps = samples().map((s) => s.t);
    const window =
      stamps.length >= 2 ? (Math.max(...stamps) - Math.min(...stamps)) / 1000 : 0;

    return {
      peak,
      average: list.length > 0 ? sum / list.length : 0,
      count: list.length,
      window: Number.isFinite(window) && window > 0 ? window : 0,
    };
  });

  /**
   * SVG yolu.
   *
   * Örnekler 1000×200 birimlik tuvale normalize edilir; `preserveAspectRatio`
   * yok dönüşümü ile gerçek genişliğe esner (çizgi kalınlığı sabit kalsın diye
   * `vector-effect: non-scaling-stroke` kullanılır).
   */
  const geometry = createMemo(() => {
    const list = samples();
    if (list.length < 2) return null;

    const max = Math.max(...list.map((s) => s.speedMbps), 0.0001);
    const stepX = W / (list.length - 1);

    const coords = list.map((s, i) => {
      const x = i * stepX;
      const y = H - (s.speedMbps / max) * (H - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return {
      line: coords.join(" "),
      area: `0,${H} ${coords.join(" ")} ${W},${H}`,
      max,
    };
  });

  /** Yatay ızgara çizgilerinin dikey konumları. */
  const gridLines = () =>
    Array.from({ length: ROWS + 1 }, (_, i) => (i / ROWS) * H);

  return (
    <div class="graph-wrap">
      <div class="graph-canvas">
        <Show
          when={geometry()}
          fallback={
            <div class="graph-empty">
              <div>
                <p>{t("graph.empty")}</p>
              </div>
            </div>
          }
        >
          {(geo) => (
            <svg
              class="graph-svg"
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="graphGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#2e73ce" stop-opacity="0.4" />
                  <stop offset="100%" stop-color="#2e73ce" stop-opacity="0.02" />
                </linearGradient>
              </defs>

              {/* Yatay ızgara */}
              <For each={gridLines()}>
                {(y) => <line class="graph-grid-line" x1="0" y1={y} x2={W} y2={y} />}
              </For>

              {/* Alan + çizgi */}
              <polygon class="graph-area" points={geo().area} />
              <polyline class="graph-line" points={geo().line} />

              {/* Dikey eksen */}
              <line class="graph-axis" x1="0" y1={0} x2="0" y2={H} />
              <line class="graph-axis" x1="0" y1={H} x2={W} y2={H} />
            </svg>
          )}
        </Show>
      </div>

      <div class="graph-side">
        <div class="graph-stat">
          <span class="graph-stat-label">{t("graph.now")}</span>
          <span class="graph-stat-value">{formatSpeed(current())}</span>
        </div>
        <div class="graph-stat">
          <span class="graph-stat-label">{t("graph.peak")}</span>
          <span class="graph-stat-value">
            {formatSpeed(geometry()?.max ?? stats().peak)}
          </span>
        </div>
        <div class="graph-stat">
          <span class="graph-stat-label">{t("graph.average")}</span>
          <span class="graph-stat-value">{formatSpeed(stats().average)}</span>
        </div>
        <div class="graph-stat">
          <span class="graph-stat-label">{t("graph.samples")}</span>
          <span class="graph-stat-value">{formatNumber(stats().count)}</span>
        </div>
        {/* Yatay eksenin kapsadığı süre: örnek penceresi ne kadar geriye
            bakıyor? `SpeedSample.t` epoch ms olduğu için fark doğrudan
            saniye cinsinden gelir. */}
        <div class="graph-stat">
          <span class="graph-stat-label">{t("graph.axis_time")}</span>
          <span class="graph-stat-value">{formatDuration(stats().window)}</span>
        </div>
      </div>
    </div>
  );
}