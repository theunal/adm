/**
 * İndirme tablosunun tek satırı.
 *
 * IDM'in liste görünümü bir "grid listview"dir: her kayıt tek satırdır ve
 * sütunlar başlıktan gelen sabit ızgaraya oturur. Bu bileşen o satırın tamamını
 * çizer — dosya simgesi, ilerleme çubuğu + kanal segmentleri, hız (mini grafikle),
 * kalan süre, durum ve satır içi işlem düğmeleri.
 *
 * Etkileşim:
 * * Sol tık — satırı seç · Ctrl/Cmd — çevir · Shift — aralık
 * * Çift tık — tamamlandıysa dosyayı aç, değilse sürdür
 * * Sağ tık — bağlam menüsü
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import {
  changeChannelCount,
  confirm,
  openFolder,
  openPath,
} from "../lib/api";
import { cancelItem, deleteItem, pauseItem, resumeItem } from "../lib/bulk";
import {
  isBusy,
  itemHistory,
  itemSpeed,
  selectRow,
  state,
} from "../lib/store";
import { errorText, pushLogSafe } from "../lib/useFeedback";
import { setContextMenu } from "../lib/ui";
import {
  formatBytes,
  formatEta,
  formatNumber,
  formatSpeed,
  percentOf,
  statusLabel,
  type DownloadItem,
} from "../lib/format";
import { t } from "../lib/i18n";
import FileIcon from "./FileIcon";
import Sparkline from "./Sparkline";

interface Props {
  /** Görüntülenecek kayıt. */
  item: DownloadItem;
  /** Tablodaki sıra numarası (# sütunu). */
  index: number;
}

export default function DownloadRow(props: Props) {
  /** Kanal düzenleyicisi açık mı? */
  const [channelMode, setChannelMode] = createSignal(false);
  const [pendingChannels, setPendingChannels] = createSignal(props.item.channelCount);

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

  /** İlerleme çubuğunun dolgu sınıfı (duruma göre renk). */
  const fillClass = createMemo(() => {
    if (done()) return "prog-fill-done";
    if (props.item.status === "Failed") return "prog-fill-failed";
    if (props.item.status === "Paused") return "prog-fill-paused";
    if (running()) return "";
    return "prog-fill-idle";
  });

  /**
 * İlerleme çubuğundaki segmentler.
 *
 * Tek kanallı indirmelerde tek bir segment üretilir; çok kanallı olanlarda
 * her kanal kendi dilimini alır. Böylece kanal dağılımı ayrı bir satır
 * yerine çubuğun **içinde** görünür — IDM'in kompakt listesi gibi.
 */
  const segments = createMemo(() => {
    const list = props.item.channels;
    if (list.length > 1) {
      return list.map((c) => {
        const span = c.endByte - c.startByte + 1;
        const doneInChannel = Math.max(0, Math.min(span, c.currentByte - c.startByte));
        return {
          id: c.id,
          percent: span > 0 ? (doneInChannel / span) * 100 : 0,
          finished: c.finished,
        };
      });
    }
    return [{ id: 0, percent: percent(), finished: done() }];
  });

  /** Hız geçmişi (mini grafik; veri yoksa boş bırakılır). */
  const history = createMemo(() => itemHistory(props.item.id));

  /* -----------------------------------------------------------------
     Eylemler
     ----------------------------------------------------------------- */

  /** Ortak sarmalayıcı: hata mesajını log paneline yazar. */
  async function run(label: string, action: () => Promise<void>) {
    try {
      await action();
    } catch (e) {
      pushLogSafe("error", t("act.failed", { action: label, error: errorText(e) }), props.item.id);
    }
  }

  const onPause = () => run(t("act.pause"), async () => {
    await pauseItem(props.item);
  });
  const onResume = () => run(t("act.resume"), async () => {
    await resumeItem(props.item);
  });
  const onCancel = () => run(t("act.cancel"), async () => {
    await cancelItem(props.item);
  });

  async function onOpenFile() {
    await run(t("act.open"), async () => {
      await openPath(props.item.filePath);
    });
  }

  async function onOpenFolder() {
    await run(t("act.folder"), async () => {
      await openFolder(props.item.filePath);
    });
  }

  /** Kaydı siler; dosya korunur. */
  async function onDeleteRecord() {
    const ok = await confirm(
      t("dialog.delete_record.body", { name: props.item.fileName }),
      t("dialog.delete_record.title"),
    );
    if (ok) await deleteItem(props.item, false);
  }

  /** Kanal sayısı değişikliğini uygular. */
  async function onApplyChannels() {
    const count = pendingChannels();
    if (count === props.item.channelCount) {
      setChannelMode(false);
      return;
    }
    setChannelMode(false);
    await run(t("act.channels"), async () => {
      await changeChannelCount(props.item.id, count);
    });
  }

  /** Çift tık: tamamlanmışsa aç, değilse sürdür. */
  function onDoubleClick() {
    if (done()) void onOpenFile();
    else if (resumable()) void onResume();
  }

  /** Bağlam menüsünü açar. */
  function onContextMenu(event: MouseEvent) {
    event.preventDefault();
    if (!selected()) selectRow(props.item.id, "single");
    setContextMenu({ x: event.clientX, y: event.clientY, item: props.item });
  }

  return (
    <div
      class={`dlg-row ${selected() ? "dlg-row-selected" : ""} ${
        running() ? "dlg-row-running" : ""
      } ${props.item.status === "Failed" ? "dlg-row-failed" : ""}`}
      onClick={(e) => selectRow(props.item.id, modeOf(e))}
      onDblClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {/* # */}
      <div class="dlg-cell col-idx">{props.index + 1}</div>

      {/* Dosya adı */}
      <div class="dlg-cell">
        <div class="file-cell">
          <FileIcon name={props.item.fileName} />
          <div class="file-meta">
            <span class="file-name" title={props.item.filePath}>
              {props.item.fileName}
            </span>
            <Show
              when={props.item.errorMessage}
              fallback={
                <span class="file-url" title={props.item.url}>
                  {props.item.url}
                </span>
              }
            >
              <span class="file-error" title={props.item.errorMessage ?? undefined}>
                {props.item.errorMessage}
              </span>
            </Show>
          </div>
        </div>
      </div>

      {/* Boyut — bilinmiyorsa kısa bir işaret (tam metin başlık ipucunda) */}
      <div
        class="dlg-cell dlg-cell-right"
        title={sizeUnknown() ? t("row.size_unknown") : undefined}
      >
        {sizeUnknown() ? "—" : formatBytes(props.item.totalBytes)}
      </div>

      {/* İlerleme */}
      <div class="dlg-cell">
        <div class="prog-wrap">
          <div class="prog-line">
            <div
              class="prog-track"
              role="progressbar"
              aria-valuenow={Math.round(percent())}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t("row.progress_aria")}
              title={`${props.item.channelCount} ×`}
            >
              <For each={segments()}>
                {(seg) => (
                  <span class={`prog-seg ${seg.finished ? "prog-seg-done" : ""}`}>
                    <span
                      class={`prog-seg-fill ${seg.finished ? "" : fillClass()}`}
                      style={{ width: `${seg.percent}%` }}
                    />
                  </span>
                )}
              </For>
            </div>
            <span class="prog-label">
              {sizeUnknown() && running()
                ? "—"
                : `${formatNumber(percent(), percent() >= 99.95 ? 0 : 1)}%`}
            </span>
          </div>

          <Show when={!sizeUnknown()}>
            <div class="prog-bytes">
              {formatBytes(props.item.downloadedBytes)} / {formatBytes(props.item.totalBytes)}
            </div>
          </Show>
        </div>
      </div>

      {/* Hız (+ mini grafik) */}
      <div class="dlg-cell dlg-cell-right">
        <div class="speed-cell">
          <span>{running() ? formatSpeed(speed()) : "—"}</span>
          <Show when={running() && history().length > 1}>
            <Sparkline samples={history()} width={92} height={12} />
          </Show>
        </div>
      </div>

      {/* Kalan süre — dar ekranda başlıkla birlikte düşer */}
      <div class="dlg-cell dlg-cell-right dlg-col-eta">{eta() ?? "—"}</div>

      {/* Kanal sayısı — dar ekranda başlıkla birlikte düşer */}
      <div class="dlg-cell dlg-cell-center dlg-col-ch">{props.item.channelCount}</div>

      {/* Durum */}
      <div class="dlg-cell">
        <span class={`status-text status-${props.item.status.toLowerCase()}`}>
          {statusLabel(props.item.status)}
        </span>
      </div>

      {/* Satır içi işlemler */}
      <div class="dlg-cell">
        <div class="row-actions">
          <Show when={isBusy(props.item.id)}>
            <span class="busy-dot" title={t("act.busy_title")} />
          </Show>

          <Show when={running()}>
            <button
              type="button"
              class="icon-btn"
              title={t("act.pause_title")}
              aria-label={t("act.pause_title")}
              disabled={isBusy(props.item.id)}
              onClick={(e) => {
                e.stopPropagation();
                void onPause();
              }}
            >
              <PauseIcon />
            </button>
          </Show>

          <Show when={resumable()}>
            <button
              type="button"
              class="icon-btn"
              title={t("act.resume_title")}
              aria-label={t("act.resume_title")}
              disabled={isBusy(props.item.id)}
              onClick={(e) => {
                e.stopPropagation();
                void onResume();
              }}
            >
              <PlayIcon />
            </button>
          </Show>

          <Show when={running()}>
            <button
              type="button"
              class="icon-btn"
              title={t("act.cancel_title")}
              aria-label={t("act.cancel_title")}
              disabled={isBusy(props.item.id)}
              onClick={(e) => {
                e.stopPropagation();
                void onCancel();
              }}
            >
              <StopIcon />
            </button>
          </Show>

          <Show when={done()}>
            <button
              type="button"
              class="icon-btn"
              title={t("act.open_title")}
              aria-label={t("act.open_title")}
              disabled={isBusy(props.item.id)}
              onClick={(e) => {
                e.stopPropagation();
                void onOpenFile();
              }}
            >
              <OpenIcon />
            </button>
          </Show>

          <button
            type="button"
            class="icon-btn icon-btn-opt"
            title={t("act.channels_title")}
            aria-label={t("act.channels_title")}
            onClick={(e) => {
              e.stopPropagation();
              setPendingChannels(props.item.channelCount);
              setChannelMode((v) => !v);
            }}
          >
            <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
              <path
                d="M2 4 H12 M2 7 H12 M2 10 H12 M5 2.5 V5.5 M9 5.5 V8.5 M6 8.5 V11.5"
                stroke="currentColor"
                stroke-width="1.2"
                fill="none"
              />
            </svg>
          </button>

          <button
            type="button"
            class="icon-btn icon-btn-opt"
            title={t("act.folder_title")}
            aria-label={t("act.folder_title")}
            disabled={isBusy(props.item.id)}
            onClick={(e) => {
              e.stopPropagation();
              void onOpenFolder();
            }}
          >
            <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
              <path
                d="M1.5 3.5 H5.5 L6.8 5 H12.5 V11.5 H1.5 Z"
                stroke="currentColor"
                stroke-width="1.2"
                fill="none"
                stroke-linejoin="round"
              />
            </svg>
          </button>

          <button
            type="button"
            class="icon-btn icon-btn-danger"
            title={t("act.delete_record_title")}
            aria-label={t("act.delete_record_title")}
            disabled={isBusy(props.item.id)}
            onClick={(e) => {
              e.stopPropagation();
              void onDeleteRecord();
            }}
          >
            <TrashIcon />
          </button>
        </div>

        {/* Kanal düzenleyici — satırın altına açılan küçük panel */}
        <Show when={channelMode()}>
          <div class="channel-editor-pop" onClick={(e) => e.stopPropagation()}>
            <div class="channel-editor-head">
              {t("act.channels_label")} <strong>{pendingChannels()}</strong>
            </div>
            <input
              type="range"
              class="slider"
              min="1"
              max="32"
              step="1"
              value={pendingChannels()}
              aria-label={t("act.channels_label")}
              onInput={(e) => setPendingChannels(Number(e.currentTarget.value))}
            />
            <div class="channel-editor-actions">
              <button
                type="button"
                class="btn"
                onClick={() => void onApplyChannels()}
                disabled={isBusy(props.item.id)}
              >
                {t("act.channels_apply")}
              </button>
              <button
                type="button"
                class="btn"
                onClick={() => setChannelMode(false)}
              >
                {t("act.channels_cancel")}
              </button>
            </div>
            <p class="channel-editor-note">{t("act.channels_note")}</p>
          </div>
        </Show>
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

/* --- Satır içi ikonlar (tek yerden, boyut tutarlı) --- */

function PauseIcon() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
      <rect x="3.5" y="3" width="2.6" height="8" fill="currentColor" />
      <rect x="7.9" y="3" width="2.6" height="8" fill="currentColor" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
      <path d="M4.5 2.8 L11.2 7 L4.5 11.2 Z" fill="currentColor" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" fill="currentColor" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
      <path
        d="M8 2.5 H12 V6.5 M11.6 2.9 L6.5 8 M11 8.5 V11.5 H2.5 V3 H5.5"
        stroke="currentColor"
        stroke-width="1.2"
        fill="none"
        stroke-linecap="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
      <path
        d="M2.5 4 H11.5 M5.5 4 V2.5 H8.5 V4 M4 4 L4.6 11.5 H9.4 L10 4"
        stroke="currentColor"
        stroke-width="1.2"
        fill="none"
      />
    </svg>
  );
}