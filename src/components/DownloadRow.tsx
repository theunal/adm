/**
 * İndirme tablosunun tek satırı.
 *
 * FDM düzeni: `#` · onay kutusu · Ad · Boyut · Durum · `⋮` · İndirme ·
 * Kalan · Ekleme. Satır içi düğme yığını yok — tüm eylemler `⋮` menüsünde
 * (ve çift tıkta) toplanır; bu görseldeki sakin görünümü korur.
 *
 * İlerleme ayrı bir sütun değil, dosya adının altında 2px'lik ince bir
 * çizgi olarak gösterilir: satır yüksekliği sabit kalır, kanal dağılımı
 * gösterilemese de yüzde her zaman okunur.
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
import { errorText, pushLogSafe } from "../lib/useFeedback";
import { setContextMenu } from "../lib/ui";
import {
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

  /** İnce ilerleme çizgisinin dolgu sınıfı (duruma göre renk). */
  const barClass = createMemo(() => {
    if (done()) return "prog-inline-done";
    if (props.item.status === "Failed") return "prog-inline-failed";
    if (props.item.status === "Paused") return "prog-inline-paused";
    return "";
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
        pushLogSafe(
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
        pushLogSafe(
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
        <button
          type="button"
          class={`cbx ${selected() ? "cbx-on" : ""}`}
          role="checkbox"
          aria-checked={selected()}
          aria-label={t("row.select_aria", { name: props.item.fileName })}
          title={t("row.select_title")}
          onClick={onCheck}
        >
          {selected() ? "✓" : ""}
        </button>
      </div>

      {/* Dosya adı + ince ilerleme çizgisi */}
      <div class="dlg-cell">
        <div class="file-cell">
          <FileIcon name={props.item.fileName} />
          <div class="file-meta">
            <span class="file-name" title={props.item.filePath}>
              {props.item.fileName}
            </span>

            {/* İlerleme çizgisi yalnızca süren işlerde anlamlıdır; tamamlanan
                satırda %100 çizgi gürültüden başka bir bilgi vermez. */}
            <Show
              when={!done() && !sizeUnknown()}
              fallback={
                <Show when={props.item.errorMessage}>
                  <span class="file-error" title={props.item.errorMessage ?? undefined}>
                    {props.item.errorMessage}
                  </span>
                </Show>
              }
            >
              <div
                class={`prog-inline ${barClass()}`}
                role="progressbar"
                aria-valuenow={Math.round(percent())}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("row.progress_aria")}
                title={t("row.channels_title", {
                  count: props.item.channelCount,
                })}
              >
                <i style={{ width: `${percent()}%` }} />
              </div>
            </Show>
          </div>
        </div>
      </div>

      {/* Boyut */}
      <div
        class="dlg-cell dlg-cell-right"
        title={sizeUnknown() ? t("row.size_unknown") : undefined}
      >
        {sizeUnknown() ? "—" : formatBytes(props.item.totalBytes)}
      </div>

      {/* Durum + yüzde */}
      <div class="dlg-cell">
        <div class="status-stack">
          <span class={`status-text status-${props.item.status.toLowerCase()}`}>
            {statusLabel(props.item.status)}
          </span>
          <Show when={!done() && !sizeUnknown()}>
            <span class="status-pct">{formatNumber(percent(), 0)}%</span>
          </Show>
        </div>
      </div>

      {/* Satır menüsü */}
      <div class="dlg-cell dlg-cell-center">
        <button
          type="button"
          class="row-more"
          title={t("row.more_title")}
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
        </button>
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
