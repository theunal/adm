/**
 * Kanal parça çubuğu — MC `SegmentBar` portu.
 *
 * Her kanalın kendi aralığı (`startByte..endByte`) ve yazdığı konum
 * (`currentByte`) oransal olarak çizilir; böylece çok kanallı indirmede
 * **hangi kanalın ne kadar ilerlediği** tek bakışta görünür. Sıradan bir
 * yüzde çubuğu bunu gizler.
 *
 * Çizim `<canvas>` ile yapılır: kanal sayısı 32'ye kadar çıkabildiği için
 * onlarca DOM düğümü yerine tek bir bitmap daha ucuz. Cihaz piksel oranı
 * hesaba katılır (Retina'da bulanıklaşmasın).
 *
 * Renkler `styles.css`'teki değişkenlerden okunur, böylece tema değişince
 * çubuk da uyum sağlar.
 */
import { createEffect, onCleanup, onMount } from "solid-js";
import type { ChannelState } from "../lib/format";

interface Props {
  /** Kanal durumları (boşsa düz bir arka plan çizilir). */
  channels: ChannelState[];
  /** Toplam boyut; `0` ise kanallar eşit kabul edilir. */
  totalBytes: number;
  /** İndirilen bayt (kanal bilgisi yoksa düz dolgu için). */
  downloadedBytes: number;
  /** Tamamlandı mı? (yeşil renk) */
  done?: boolean;
  /** Başarısız mı? (kırmızı renk) */
  failed?: boolean;
  /** Duraklatıldı mı? (sarı renk) */
  paused?: boolean;
  /** Çubuğun yüksekliği (px). */
  height?: number;
  /** Erişilebilirlik etiketi. */
  label?: string;
}

/** CSS değişkenini okur (tema uyumu için). */
function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return value.trim() || fallback;
}

export default function SegmentBar(props: Props) {
  let canvas: HTMLCanvasElement | undefined;
  let observer: ResizeObserver | undefined;

  /** Kanalların dolgu rengi. */
  function fillColor(): string {
    if (props.failed) return cssVar("--err", "#e05252");
    if (props.done) return cssVar("--ok", "#46d160");
    if (props.paused) return cssVar("--warn", "#e0a63c");
    return cssVar("--accent", "#4fc3f7");
  }

  /** Bir kez çizilir; yeniden boyutlanmada tekrar çağrılır. */
  function draw() {
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(parent.clientWidth));
    const height = Math.max(1, Math.floor(props.height ?? 6));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Arka plan
    ctx.fillStyle = cssVar("--border-mid", "#2e2e2e");
    ctx.fillRect(0, 0, width, height);

    const fill = fillColor();
    const channels = props.channels;
    const total = props.totalBytes;

    // Kanal bilgisi yoksa (tek akış, henüz yoklama bitmemiş) düz dolgu.
    if (channels.length === 0 || total <= 0) {
      if (total > 0 && props.downloadedBytes > 0) {
        const ratio = Math.min(1, props.downloadedBytes / total);
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, width * ratio, height);
      }
      return;
    }

    // Her kanal için: aralığın kendi ilerlemesi oransal olarak doldurulur.
    ctx.fillStyle = fill;
    for (const ch of channels) {
      const span = ch.endByte - ch.startByte + 1;
      if (span <= 0) continue;
      const done = Math.max(0, Math.min(span, ch.currentByte - ch.startByte));
      if (done <= 0) continue;

      const x0 = (ch.startByte / total) * width;
      const x1 = ((ch.startByte + done) / total) * width;
      // En az 1px genişlik: çok küçük ilerlemeler görünmez olmasın.
      const w = Math.max(1, x1 - x0);
      ctx.fillRect(x0, 0, w, height);
    }
  }

  onMount(() => {
    draw();
    // Konteyner genişliği değişince (pencere boyutu, kenar çubuğu) yeniden çiz.
    if (typeof ResizeObserver !== "undefined" && canvas?.parentElement) {
      observer = new ResizeObserver(() => draw());
      observer.observe(canvas.parentElement);
    }
  });

  // Kanal/ilerleme değişiminde yeniden çiz.
  createEffect(() => {
    // Bağımlılıkları açıkça oku: Solid yalnızca erişilen sinyalleri izler.
    void props.channels;
    void props.downloadedBytes;
    void props.totalBytes;
    void props.done;
    void props.failed;
    void props.paused;
    draw();
  });

  onCleanup(() => observer?.disconnect());

  return (
    <div
      class="segment-bar"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={
        props.totalBytes > 0
          ? Math.round((100 * props.downloadedBytes) / props.totalBytes)
          : 0
      }
      aria-label={props.label}
    >
      <canvas ref={canvas} aria-hidden="true" />
    </div>
  );
}
