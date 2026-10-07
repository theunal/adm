/**
 * İndirme kartı.
 *
 * Aktif ve geçmiş listelerinin ortak gövdesi: ilerleme çubuğu, kanal
 * dağılımı, hız grafiği ve eylem düğmeleri.
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import {
  cancelDownload,
  changeChannelCount,
  confirm,
  deleteDownload,
  openFolder,
  openPath,
  pauseDownload,
  resumeDownload,
} from "../lib/api";
import {
  formatBytes,
  formatDateTime,
  formatEta,
  formatNumber,
  formatSpeed,
  formatTime,
  percentOf,
  urlLabel,
  type DownloadItem,
} from "../lib/format";
import { itemHistory, itemSpeed, isBusy, markBusy } from "../lib/store";
import { errorText, pushLogSafe } from "../lib/useFeedback";
import { t } from "../lib/i18n";
import Sparkline from "./Sparkline";
import StatusBadge from "./StatusBadge";

interface Props {
  item: DownloadItem;
  /** Aktif listede mi? */
  live?: boolean;
}

export default function DownloadCard(props: Props) {
  const [channelMode, setChannelMode] = createSignal(false);
  const [pendingChannels, setPendingChannels] = createSignal(props.item.channelCount);

  /** Tamamlanma yüzdesi. */
  const percent = createMemo(() =>
    percentOf(props.item.downloadedBytes, props.item.totalBytes),
  );

  /** Anlık hız (olaylardan gelir, DB'den değil). */
  const speed = createMemo(() => itemSpeed(props.item.id));

  /** Kalan süre tahmini. */
  const eta = createMemo(() =>
    formatEta(props.item.downloadedBytes, props.item.totalBytes, speed()),
  );

  /** Çalışıyor mu? */
  const running = createMemo(
    () => props.item.status === "Queued" || props.item.status === "Downloading",
  );

  /** Duraklatılabilir mi? */
  const pausable = createMemo(() => running());

  /** Sürdürülebilir mi? */
  const resumable = createMemo(
    () => props.item.status === "Paused" || props.item.status === "Failed" || props.item.status === "Cancelled",
  );

  /** Bitti mi? */
  const done = createMemo(() => props.item.status === "Completed");

  /** Toplam boyut bilinmiyor mu? */
  const sizeUnknown = createMemo(() => props.item.totalBytes === 0);

  /** Hız geçmişi (sparkline için). */
  const history = createMemo(() => itemHistory(props.item.id));

  /**
   * Kanal dağılımı: her kanalın indirdiği yüzde.
   *
   * Kanal durumu boşsa (yeni indirme veya tek kanal modu) boş liste döner.
   */
  const channelBars = createMemo(() => {
    const channels = props.item.channels;
    if (channels.length === 0) return [];

    return channels.map((c) => {
      const span = c.endByte - c.startByte + 1;
      const doneInChannel = Math.max(0, Math.min(span, c.currentByte - c.startByte));
      return {
        id: c.id,
        percent: span > 0 ? (doneInChannel / span) * 100 : 0,
        finished: c.finished,
        bytes: doneInChannel,
      };
    });
  });

  /** Ortak bir işlem sarmalayıcı: hata mesajını log paneline yazar. */
  async function run(label: string, action: () => Promise<void>) {
    const id = props.item.id;
    if (isBusy(id)) return;

    markBusy(id, true);
    try {
      await action();
    } catch (e) {
      pushLogSafe(
        "error",
        t("card.action.failed", { action: label, error: errorText(e) }),
        id,
      );
    } finally {
      markBusy(id, false);
    }
  }

  const onPause = () => run(t("card.action.pause"), () => pauseDownload(props.item.id));
  const onResume = () => run(t("card.action.resume"), () => resumeDownload(props.item.id));
  const onCancel = () => run(t("card.action.cancel"), () => cancelDownload(props.item.id));

  /** Silme onayı ister; dosya da silinir. */
  async function onDelete() {
    const ok = await confirm(
      t("dialog.delete_file.body", { name: props.item.fileName }),
      t("dialog.delete_file.title"),
    );
    if (!ok) return;
    await run(t("card.action.delete"), () => deleteDownload(props.item.id, true));
  }

  /** Yalnızca kaydı siler, dosya kalır. */
  async function onDeleteRecord() {
    const ok = await confirm(
      t("dialog.delete_record.body", { name: props.item.fileName }),
      t("dialog.delete_record.title"),
    );
    if (!ok) return;
    await run(t("card.action.delete_record"), () => deleteDownload(props.item.id, false));
  }

  /** Kanal sayısını değiştirir. */
  async function onApplyChannels() {
    setChannelMode(false);
    const count = pendingChannels();
    if (count === props.item.channelCount) return;
    await run(t("card.action.channel_change"), () =>
      changeChannelCount(props.item.id, count),
    );
  }

  /** Dosyayı / klasörü açar. */
  async function onOpenFile() {
    await run(t("card.action.open_file"), () => openPath(props.item.filePath));
  }

  async function onOpenFolder() {
    await run(t("card.action.open_folder"), () => openFolder(props.item.filePath));
  }

  return (
    <article class={`card ${running() ? "card-running" : ""} ${done() ? "card-done" : ""}`}>
      {/* Üst satır: ad + durum */}
      <header class="card-head">
        <div class="card-title-block">
          <h3 class="card-name" title={props.item.filePath}>
            {props.item.fileName}
          </h3>
          <span class="card-host" title={props.item.url}>
            {urlLabel(props.item.url)}
          </span>
        </div>

        <div class="card-head-right">
          <StatusBadge status={props.item.status} />
          <Show when={isBusy(props.item.id)}>
            <span class="busy-dot" title={t("card.busy_title")} />
          </Show>
        </div>
      </header>

      {/* İlerleme çubuğu */}
      <div class="progress-wrap">
        <div
          class="progress-track"
          role="progressbar"
          aria-valuenow={Math.round(percent())}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t("card.progress_aria")}
        >
          <div
            class={`progress-fill ${running() ? "progress-animated" : ""}`}
            style={{ width: `${sizeUnknown() && running() ? 100 : percent()}%` }}
          />
        </div>
        <div class="progress-meta">
          <span class="progress-percent">
            {sizeUnknown() && running()
              ? t("card.size_unknown")
              : `${formatNumber(percent(), 1)}%`}
          </span>
          <span class="progress-bytes">
            {formatBytes(props.item.downloadedBytes)}
            <Show when={!sizeUnknown()}>
              {" / "}
              {formatBytes(props.item.totalBytes)}
            </Show>
          </span>
        </div>
      </div>

      {/* Kanal dağılımı (yalnızca çok kanallı) */}
      <Show when={channelBars().length > 1}>
        <div class="channels" title={t("card.channels_title")}>
          <For each={channelBars()}>
            {(c) => (
              <div class="channel">
                <div class="channel-track">
                  <div
                    class={`channel-fill ${c.finished ? "channel-done" : ""}`}
                    style={{ width: `${c.percent}%` }}
                  />
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Metrik satırı */}
      <div class="card-metrics">
        <Show when={running()}>
          <div class="metric">
            <span class="metric-value speed">{formatSpeed(speed())}</span>
            <span class="metric-label">{t("card.metric.speed")}</span>
          </div>
          <Show when={eta()}>
            <div class="metric">
              <span class="metric-value">{eta()}</span>
              <span class="metric-label">{t("card.metric.eta")}</span>
            </div>
          </Show>
          <div class="metric">
            <span class="metric-value">{props.item.channelCount}</span>
            <span class="metric-label">{t("card.metric.channels")}</span>
          </div>
          <Show when={history().length > 1}>
            <div class="metric metric-spark">
              <Sparkline samples={history()} />
            </div>
          </Show>
        </Show>

        <Show when={!running()}>
          <div class="metric">
            <span class="metric-value">
              {formatBytes(props.item.downloadedBytes)}
            </span>
            <span class="metric-label">
              {done()
                ? t("card.metric.downloaded")
                : t("card.metric.in_status")}
            </span>
          </div>
          <Show when={done() && props.item.completedAt}>
            <div class="metric">
              <span class="metric-value">
                {formatTime(props.item.completedAt)}
              </span>
              <span class="metric-label">{t("card.metric.finished_at")}</span>
            </div>
          </Show>
          <div class="metric">
            <span class="metric-value">
              {formatDateTime(props.item.createdAt)}
            </span>
            <span class="metric-label">{t("card.metric.added_at")}</span>
          </div>
        </Show>
      </div>

      {/* Hata mesajı */}
      <Show when={props.item.errorMessage}>
        <p class="card-error" role="alert">
          {props.item.errorMessage}
        </p>
      </Show>

      {/* Eylemler */}
      <footer class="card-actions">
        <Show when={pausable()}>
          <button
            type="button"
            class="btn btn-sm"
            onClick={() => void onPause()}
            disabled={isBusy(props.item.id)}
            title={t("card.btn.pause_title")}
          >
            {t("card.btn.pause")}
          </button>
        </Show>

        <Show when={resumable()}>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            onClick={() => void onResume()}
            disabled={isBusy(props.item.id)}
            title={t("card.btn.resume_title")}
          >
            {t("card.btn.resume")}
          </button>
        </Show>

        <Show when={running()}>
          <button
            type="button"
            class="btn btn-sm btn-danger"
            onClick={() => void onCancel()}
            disabled={isBusy(props.item.id)}
            title={t("card.btn.cancel_title")}
          >
            {t("card.btn.cancel")}
          </button>
        </Show>

        <button
          type="button"
          class="btn btn-sm btn-ghost"
          onClick={() => {
            setPendingChannels(props.item.channelCount);
            setChannelMode((v) => !v);
          }}
          title={t("card.btn.channels_title")}
        >
          {t("card.btn.channels")}
        </button>

        <Show when={done()}>
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            onClick={() => void onOpenFile()}
            disabled={isBusy(props.item.id)}
            title={t("card.btn.open_title")}
          >
            {t("card.btn.open")}
          </button>
        </Show>

        <button
          type="button"
          class="btn btn-sm btn-ghost"
          onClick={() => void onOpenFolder()}
          disabled={isBusy(props.item.id)}
          title={t("card.btn.folder_title")}
        >
          {t("card.btn.folder")}
        </button>

        <button
          type="button"
          class="btn btn-sm btn-ghost"
          onClick={() => void onDeleteRecord()}
          disabled={isBusy(props.item.id)}
          title={t("card.btn.del_record_title")}
        >
          {t("card.btn.del_record")}
        </button>

        <button
          type="button"
          class="btn btn-sm btn-danger-ghost"
          onClick={() => void onDelete()}
          disabled={isBusy(props.item.id)}
          title={t("card.btn.delete_title")}
        >
          {t("card.btn.delete")}
        </button>
      </footer>

      {/* Kanal sayısı seçici */}
      <Show when={channelMode()}>
        <div class="channel-editor">
          <label for={`ch-${props.item.id}`}>
            {t("card.channels.label")} <strong>{pendingChannels()}</strong>
          </label>
          <input
            id={`ch-${props.item.id}`}
            type="range"
            class="slider"
            min="1"
            max="32"
            step="1"
            value={pendingChannels()}
            onInput={(e) => setPendingChannels(Number(e.currentTarget.value))}
          />
          <div class="channel-editor-actions">
            <button
              type="button"
              class="btn btn-sm btn-primary"
              onClick={() => void onApplyChannels()}
              disabled={isBusy(props.item.id)}
            >
              {t("card.channels.apply")}
            </button>
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              onClick={() => setChannelMode(false)}
            >
              {t("card.channels.cancel")}
            </button>
          </div>
          <p class="channel-editor-note">{t("card.channels.note")}</p>
        </div>
      </Show>
    </article>
  );
}