/**
 * İndirme tablosunun tek satırı.
 *
 * MC düzeni: `#` · onay kutusu · Ad (+ kategori etiketi) · Boyut · Durum
 * (etiket + SegmentBar + alt metin) · `⋮` · Hız · Kalan · Ekleme. Satır içi
 * düğme yığını yok — tüm eylemler `⋮` menüsünde (ve çift tıkta) toplanır;
 * bu görseldeki sakin görünümü korur.
 *
 * İlerleme MC'nin kanal bazlı `SegmentBar`'ı ile çizilir; Durum sütununun
 * alt metni hatayı, yt-dlp fazını ya da yüzdeyi gösterir.
 *
 * Etkileşim:
 * * Sol tık — satırı seç · Ctrl/Cmd — çevir · Shift — aralık
 * * Çift tık — tamamlandıysa dosyayı aç, değilse sürdür
 * * Sağ tık / `⋮` — bağlam menüsü
 */
import { Show, createMemo } from "solid-js";
import { openPath } from "../lib/api";
import { resumeItem } from "../lib/bulk";
import { itemSpeed, selectRow, state } from "../lib/store";
import { errorText, pushFeedback } from "../lib/useFeedback";
import { setContextMenu } from "../lib/ui";
import {
  categoryLabel,
  categoryOf,
  formatBytes,
  formatEta,
  formatNumber,
  formatShortDate,
  formatSpeed,
  percentOf,
  statusLabel,
  type DownloadItem,
} from "../lib/format";
import { t } from "../lib/i18n";
import FileIcon from "./FileIcon";
import SegmentBar from "./SegmentBar";
import ChannelStrip from "./ChannelStrip";
import Tip from "./Tip";

interface Props {
  /** Görüntülenecek kayıt. */
  item: DownloadItem;
  /** Tablodaki sıra numarası (# sütunu). */
  index: number;
}

export default function DownloadRow(props: Props) {
  /* -----------------------------------------------------------------
     Türetilmiş değerler
     ----------------------------------------------------------------- */

  const percent = createMemo(() =>
    percentOf(props.item.downloadedBytes, props.item.totalBytes),
  );

  /** Anlık hız; duraklatılan kayıtta son bilinen değer gösterilir. */
  const speed = createMemo(() => itemSpeed(props.item.id));

  const eta = createMemo(() =>
    formatEta(props.item.downloadedBytes, props.item.totalBytes, speed()),
  );

  const running = createMemo(
    () => props.item.status === "Queued" || props.item.status === "Downloading",
  );
  const done = createMemo(() => props.item.status === "Completed");
  const resumable = createMemo(() => statusIsResumable(props.item));
  const sizeUnknown = createMemo(() => props.item.totalBytes === 0);
  const selected = () => state.selected[props.item.id] === true;

  /**
   * Kanal şeridi görünür mü?
   *
   * Yalnızca çok kanallı **ve hâlâ akan** kayıtlarda: duraklatılmış, bitmiş
   * ya da başarısız kayıtta kanal yüzdeleri değişmiyor, göstermek satırı
   * gereksiz uzatır. Tek akışlı (sunucu `Range` desteklemeyen) indirmelerde de
   * gösterilmez — `channels` tek dilimlidir ve anlam taşımaz.
   */
  const showChannels = createMemo(
    () => props.item.channelCount > 1 && running(),
  );

  /** Dosyanın kategorisi (ikon + alt metin). */
  const category = createMemo(() => categoryOf(props.item.fileName));

  /**
   * Durum sütununun alt satırı.
   *
   * Öncelik sırası MC'nin `StatusCell`'iyle aynıdır: hata → faz metni
   * (yt-dlp "Video indiriliyor…" gibi) → yüzde → kanal sayısı.
   */
  const subtitle = createMemo(() => {
    const item = props.item;
    if (item.status === "Failed" && item.errorMessage) return item.errorMessage;
    if (item.stage) return item.stage;
    if (item.status === "Completed") return t("row.completed_sub");
    if (sizeUnknown()) return t("row.size_unknown");
    const pct = `${formatNumber(percent(), 0)}%`;
    if (item.channelCount > 1) {
      return `${pct} · ${t("row.channels_title", { count: item.channelCount })}`;
    }
    return pct;
  });

  /** Onay kutusu işaretini çevirir (satır seçimini değiştirir). */
  function onCheck(e: MouseEvent) {
    e.stopPropagation();
    selectRow(props.item.id, "toggle");
  }

  /** Çift tık: tamamlanmışsa aç, değilse sürdür. */
  async function onDoubleClick() {
    if (done()) {
      try {
        await openPath(props.item.filePath);
      } catch (e) {
        pushFeedback(
          "error",
          t("act.failed", { action: t("act.open"), error: errorText(e) }),
          props.item.id,
        );
      }
      return;
    }
    if (resumable()) {
      try {
        await resumeItem(props.item);
      } catch (e) {
        pushFeedback(
          "error",
          t("act.failed", { action: t("act.resume"), error: errorText(e) }),
          props.item.id,
        );
      }
    }
  }

  /** Bağlam menüsünü açar (hem sağ tık hem `⋮` düğmesi). */
  function openMenu(x: number, y: number) {
    if (!selected()) selectRow(props.item.id, "single");
    setContextMenu({ x, y, item: props.item });
  }

  return (
    <div
      class={`dlg-row ${selected() ? "dlg-row-selected" : ""} ${
        props.item.status === "Failed" ? "dlg-row-failed" : ""
      }`}
      onClick={(e) => selectRow(props.item.id, modeOf(e))}
      onDblClick={() => void onDoubleClick()}
      onContextMenu={(e) => {
        e.preventDefault();
        openMenu(e.clientX, e.clientY);
      }}
    >
      {/* # */}
      <div class="dlg-cell col-idx">{props.index + 1}</div>

      {/* Onay kutusu */}
      <div class="dlg-cell col-check">
        <Tip
          label={t("row.select_title")}
          class={`cbx ${selected() ? "cbx-on" : ""}`}
          role="checkbox"
          aria-checked={selected()}
          aria-label={t("row.select_aria", { name: props.item.fileName })}
          onClick={onCheck}
        >
          {selected() ? "✓" : ""}
        </Tip>
      </div>

      {/* Dosya adı + kategori alt metni (MC düzeni) */}
      <div class="dlg-cell">
        <div class="file-cell">
          <FileIcon name={props.item.fileName} />
          <div class="file-meta">
            <Tip label={props.item.filePath} class="file-name" target="span">
              {props.item.fileName}
            </Tip>
            <Tip label={props.item.filePath} class="file-sub" target="span">
              <span class={`cat-tag cat-tag-${category()}`}>{categoryLabel(category())}</span>
              <Show when={props.item.kind === "video"}>
                <Tip target="span" class="kind-tag" label={t("row.kind_video_title")}>
                  {t("row.kind_video")}
                </Tip>
              </Show>
              <Show when={props.item.errorMessage}>
                <span class="file-error">{props.item.errorMessage}</span>
              </Show>
            </Tip>
          </div>
        </div>
      </div>

      {/* Boyut: indirilen / toplam. Tek satırda yalnızca toplam gösterilirken
          kullanıcı ilerlemeyi yalnızca yüzdeden görebiliyordu; indirilen miktar
          ayrıntı penceresinde kalıyordu. */}
      <div class="dlg-cell dlg-cell-right">
        <Tip
          label={sizeUnknown() ? t("row.size_unknown") : subtitle()}
          class="size-stack"
          target="div"
        >
          <span class="size-got">
            {formatBytes(props.item.downloadedBytes)}
          </span>
          <span class="size-total">
            {sizeUnknown() ? t("row.size_unknown") : formatBytes(props.item.totalBytes)}
          </span>
        </Tip>
      </div>

      {/* Durum: etiket + parça çubuğu + yüzde/faz metni (MC düzeni) */}
      <div class="dlg-cell">
        <div class="status-stack">
          <span class={`status-text status-${props.item.status.toLowerCase()}`}>
            {statusLabel(props.item.status)}
          </span>
          <SegmentBar
            channels={props.item.channels}
            totalBytes={props.item.totalBytes}
            downloadedBytes={props.item.downloadedBytes}
            done={done()}
            failed={props.item.status === "Failed"}
            paused={props.item.status === "Paused"}
            height={4}
            label={t("row.progress_aria")}
          />
          <Tip label={subtitle()} class="status-sub" target="span">
            {subtitle()}
          </Tip>
          {/* Kanal başına yüzde — yalnızca çok kanallı ve çalışan kayıtlarda.
              8 kanalda toplam yüzde hangi kanalın geride kaldığını göstermez. */}
          <Show when={showChannels()}>
            <ChannelStrip
              channels={props.item.channels}
              status={props.item.status}
            />
          </Show>
        </div>
      </div>

      {/* Satır menüsü */}
      <div class="dlg-cell dlg-cell-center">
        <Tip
          label={t("row.more_title")}
          class="row-more"
          aria-label={t("row.more_title")}
          aria-haspopup="menu"
          onClick={(e) => {
            e.stopPropagation();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            openMenu(r.left, r.bottom + 4);
          }}
        >
          <svg viewBox="0 0 12 16" width="12" height="16" aria-hidden="true">
            <circle cx="6" cy="3" r="1.4" fill="currentColor" />
            <circle cx="6" cy="8" r="1.4" fill="currentColor" />
            <circle cx="6" cy="13" r="1.4" fill="currentColor" />
          </svg>
        </Tip>
      </div>

      {/* Hız */}
      <div class="dlg-cell dlg-cell-right">
        {running() ? formatSpeed(speed()) : "—"}
      </div>

      {/* Kalan süre — dar ekranda başlıkla birlikte düşer */}
      <div class="dlg-cell dlg-cell-right dlg-col-eta">{eta() ?? "—"}</div>

      {/* Eklenme tarihi */}
      <div class="dlg-cell dlg-cell-right dlg-col-date">
        {formatShortDate(props.item.createdAt)}
      </div>
    </div>
  );
}

/* -----------------------------------------------------------------
   Yardımcılar
   ----------------------------------------------------------------- */

/** Tıklama modunu klavye durumuna göre belirler (Çoklu seçim). */
function modeOf(event: MouseEvent): "single" | "toggle" | "range" {
  if (event.shiftKey) return "range";
  if (event.ctrlKey || event.metaKey) return "toggle";
  return "single";
}

/** Bu durumda devam ettirme anlamlı mı? (Rust `is_resumable` ile aynı). */
function statusIsResumable(item: DownloadItem): boolean {
  return item.status === "Paused" || item.status === "Failed" || item.status === "Cancelled";
}
