/**
 * Kanal başına ilerleme şeridi.
 *
 * Çok kanallı bir indirmede (8 kanal tipik ayardır) toplam yüzde tek başına
 * yetersizdir: kanal B biterken kanal A yarıda kalmış olabilir. Bu bileşen her
 * kanal için ince bir çubuk ve yüzdesini gösterir — IDM'in "Connections"
 * listesinin satır listesine sığdırılmış hâli.
 *
 * Veri kaynağı `ChannelState`'tir; backend her 500 ms'de `startByte`,
 * `endByte` ve `currentByte` yayınladığı için hesaplama arayüzde yapılır:
 *
 * ```text
 * span = endByte - startByte + 1
 * got  = currentByte - startByte   (span ile sınırlı)
 * %    = 100 × got / span
 * ```
 *
 * `currentByte` mutlak dosya ofsetidir, bu yüzden **her zaman**
 * `currentByte - startByte` ile alınmalıdır; `currentByte` tek başına
 * kullanılırsa ikinci kanalın ilerlemesi toplamı şişirir.
 */
import { For, createMemo } from "solid-js";
import Tip from "./Tip";
import type { ChannelState, DownloadStatus } from "../lib/format";
import { t } from "../lib/i18n";

interface Props {
  /** Kanal durumları (motorun yayınladığı sıra korunur). */
  channels: ChannelState[];
  /** Satırın durumu (renk ve "biten" işareti için). */
  status: DownloadStatus;
}

interface Row {
  id: number;
  percent: number;
  done: boolean;
}

/** Bir kanalın yüzdesini ve bittiğini hesaplar. */
function toRow(ch: ChannelState): Row {
  const span = ch.endByte - ch.startByte + 1;
  const got = span > 0
    ? Math.max(0, Math.min(span, ch.currentByte - ch.startByte))
    : 0;
  return {
    id: ch.id,
    percent: span > 0 ? (100 * got) / span : 0,
    done: ch.finished || (span > 0 && got >= span),
  };
}

export default function ChannelStrip(props: Props) {
  const rows = createMemo(() =>
    props.channels.filter((ch) => ch.endByte > ch.startByte).map(toRow),
  );

  /** Satır durumuna göre vurgu rengi. */
  function tone(index: number): string {
    const row = rows()[index];
    if (row?.done) return "ch-done";
    switch (props.status) {
      case "Failed":
        return "ch-failed";
      case "Paused":
        return "ch-paused";
      case "Completed":
        return "ch-done";
      default:
        return "ch-active";
    }
  }

  /** Şeridin tamamı için tek zengin tooltip metni.
   *
   *  Her kanal için ayrı tooltip (8 küçük kutu) yerine tek bir kutu:
   *  `Kanal 1: 42% · Kanal 2: 100% …`. 32 kanala kadar sığdığı için
   *  `.tip` satır kaydırmalıdır (`tip-list` sınıfı). */
  const richLabel = createMemo(() => {
    const parts = rows().map(
      (row) => `${row.id + 1}: ${Math.round(row.percent)}%`,
    );
    return t("row.channels_rich", { list: parts.join(" · ") });
  });

  return (
    <Tip
      target="div"
      class="channel-strip"
      label={richLabel()}
      aria-label={t("row.channels_title", { count: rows().length })}
    >
      <For each={rows()}>
        {(row, index) => (
          <div class={`ch ${tone(index())}`}>
            <span class="ch-no">{row.id + 1}</span>
            <span class="ch-bar" role="img" aria-label={`${row.percent.toFixed(0)}%`}>
              <span class="ch-fill" style={{ width: `${row.percent}%` }} />
            </span>
            <span class="ch-pct">{Math.round(row.percent)}%</span>
          </div>
        )}
      </For>
    </Tip>
  );
}
