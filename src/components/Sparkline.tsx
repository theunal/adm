/**
 * Hız grafiği (sparkline).
 *
 * Rust tarafından gelen hız geçmişini küçük bir çizgi grafiğine çevirir.
 * Alan dolgusu degrade ile yumuşatılır; eksen etiketi yoktur (yalnızca
 * son değer kartta ayrı gösterilir).
 */
import { createMemo, Show } from "solid-js";
import type { SpeedSample } from "../lib/format";

interface Props {
  /** Hız geçmişi örnekleri. */
  samples: SpeedSample[];
  /** Genişlik (px). */
  width?: number;
  /** Yükseklik (px). */
  height?: number;
  /** Grafik çizgisi rengi (CSS). */
  stroke?: string;
  /** Alan dolgusu rengi (CSS). */
  fill?: string;
}

export default function Sparkline(props: Props) {
  const width = () => props.width ?? 120;
  const height = () => props.height ?? 32;

  /** Veri yoksa boş göster. */
  const hasData = createMemo(() => props.samples.length >= 2);

  /**
   * Örnekleri SVG poligonuna çevirir.
   *
   * Yükseklikler en büyük değere göre ölçeklenir; en büyük değer 0 ise
   * düz çizgi çizilir.
   */
  const points = createMemo(() => {
    const s = props.samples;
    if (s.length < 2) return { line: "", area: "", peak: 0 };

    const values = s.map((x) => x.speedMbps);
    const max = Math.max(...values, 0.0001);
    const w = width();
    const h = height();
    const step = w / (s.length - 1);

    const coords = values.map((v, i) => {
      const x = i * step;
      // Küçük bir taban payı bırak: sıfır hızlar tabana yapışmasın.
      const y = h - (v / max) * (h - 3) - 1.5;
      return { x, y };
    });

    const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    const area = `0,${h} ${line} ${w},${h}`;

    return { line, area, peak: max };
  });

  const gradientId = createMemo(() => `spark-${Math.random().toString(36).slice(2, 9)}`);

  return (
    <Show
      when={hasData()}
      fallback={<div class="sparkline-empty" title="Hız geçmişi oluşuyor" />}
    >
      <svg
        class="sparkline"
        width={width()}
        height={height()}
        viewBox={`0 0 ${width()} ${height()}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId()} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stop-color={props.fill ?? "rgba(45, 212, 191, 0.35)"}
            />
            <stop
              offset="100%"
              stop-color={props.fill ?? "rgba(45, 212, 191, 0)"}
            />
          </linearGradient>
        </defs>

        {/* Alan dolgusu */}
        <polygon points={points().area} fill={`url(#${gradientId()})`} />

        {/* Çizgi */}
        <polyline
          points={points().line}
          fill="none"
          stroke={props.stroke ?? "#2dd4bf"}
          stroke-width="1.6"
          stroke-linejoin="round"
          stroke-linecap="round"
          vector-effect="non-scaling-stroke"
        />
      </svg>
    </Show>
  );
}