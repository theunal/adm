/**
 * İndirme ayrıntı penceresi — MC `DownloadDetailView` portu.
 *
 * `PropertiesDialog`'ın yerini alır ve salt okunur özellik listesinin
 * ötesine geçer:
 *
 * * **Bilgi** — ad, adres, hedef yol, tür, boyut, durum, tarihler, `Range`
 *   desteği.
 * * **İlerleme** — parça çubuğu (kanal bazlı), yüzde, hız, kalan süre.
 * * **Bağlantılar** — her kanal için `N. / İndirilen / Başlangıç / Bilgi`
 *   tablosu (MC'nin bağlantı listesi).
 * * **yt-dlp günlüğü** — yalnızca video indirmelerinde görünür.
 * * **Bitince kapat** — tamamlandığında pencere kendiliğinden kapanır.
 *
 * Pencere **canlı kaydı** okur (`itemById`), `propertiesItem()`'daki kopyayı
 * değil; ilerleme akarken ayrıntılar da güncellenir.
 */
import { Show, createEffect, createMemo, createSignal, For, onCleanup } from "solid-js";
import { itemById, itemSpeed } from "../lib/store";
import { openFolder, openPath } from "../lib/api";
import { settings } from "../lib/settings";
import { errorText, pushFeedback } from "../lib/useFeedback";
import { propertiesItem, setPropertiesItem } from "../lib/ui";
import {
  categoryLabel,
  categoryOf,
  formatBytes,
  formatDateTime,
  formatEta,
  formatNumber,
  formatSpeed,
  percentOf,
  statusLabel,
} from "../lib/format";
import { t } from "../lib/i18n";
import SegmentBar from "./SegmentBar";

/** Günlüğün gösterilen son satır sayısı (MC: son ~6000 karakter). */
const LOG_TAIL = 40;

export default function DownloadDetailDialog() {
  const open = createMemo(() => propertiesItem());
  /** Canlı kayıt; kayıt listeden düşerse `undefined` olur. */
  const item = createMemo(() => {
    const snapshot = open();
    return snapshot ? (itemById(snapshot.id) ?? snapshot) : null;
  });

  /**
   * Tamamlanınca pencereyi kapat.
   *
   * Başlangıç değeri ayarlardaki `autoCloseDetail`'dir (Ayarlar ▸ Genel);
   * kullanıcı bu pencere için kutuyu değiştirebilir.
   */
  const [closeOnFinish, setCloseOnFinish] = createSignal(settings.autoCloseDetail);
  /** Kullanıcı bu pencere için kapatmayı bir kez uyguladı mı? */
  const [autoClosed, setAutoClosed] = createSignal(false);

  // "Bitince kapat": kayıt tamamlandığı anda pencere kapanır (bir kez).
  createEffect(() => {
    const row = item();
    if (!row || !closeOnFinish() || autoClosed()) return;
    if (row.status === "Completed") {
      setAutoClosed(true);
      setPropertiesItem(null);
    }
  });

  // Pencere kapanınca seçenek ayardaki varsayılana döner: bir sonraki kayıt
  // için beklenen davranış geçerli olsun.
  createEffect(() => {
    if (!open()) {
      setCloseOnFinish(settings.autoCloseDetail);
      setAutoClosed(false);
    }
  });

  const percent = createMemo(() => {
    const row = item();
    return row ? percentOf(row.downloadedBytes, row.totalBytes) : 0;
  });

  const eta = createMemo(() => {
    const row = item();
    if (!row) return null;
    return formatEta(row.downloadedBytes, row.totalBytes, itemSpeed(row.id));
  });

  const done = createMemo(() => item()?.status === "Completed");

  /** yt-dlp günlüğünün son satırları. */
  const logTail = createMemo(() => {
    const text = item()?.log ?? "";
    if (!text.trim()) return [];
    return text.trimEnd().split("\n").slice(-LOG_TAIL);
  });

  async function onOpen() {
    const row = item();
    if (!row) return;
    try {
      await openPath(row.finalPath ?? row.filePath);
    } catch (e) {
      pushFeedback("error", t("act.failed", { action: t("act.open"), error: errorText(e) }), row.id);
    }
  }

  async function onShowFolder() {
    const row = item();
    if (!row) return;
    try {
      await openFolder(row.finalPath ?? row.filePath);
    } catch (e) {
      pushFeedback("error", t("act.failed", { action: t("act.folder"), error: errorText(e) }), row.id);
    }
  }

  onCleanup(() => {
    setCloseOnFinish(false);
    setAutoClosed(false);
  });

  return (
    <Show when={item()}>
      {(row) => (
        <div
          class="modal-backdrop"
          onClick={() => setPropertiesItem(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setPropertiesItem(null);
          }}
        >
          <div
            class="modal modal-detail"
            role="dialog"
            aria-modal="true"
            aria-label={t("detail.title")}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="modal-title">
              <span class="modal-title-text">{t("detail.title")}</span>
              <button
                type="button"
                class="dock-close"
                aria-label={t("title.win.close")}
                onClick={() => setPropertiesItem(null)}
              >
                ✕
              </button>
            </div>

            <div class="modal-body detail-body">
              {/* Başlık: ad + kategori + yol */}
              <div class="detail-head">
                <div class="modal-name" title={row().fileName}>
                  {row().fileName}
                </div>
                <div class="detail-tags">
                  <span class={`cat-tag cat-tag-${categoryOf(row().fileName)}`}>
                    {categoryLabel(categoryOf(row().fileName))}
                  </span>
                  <Show when={row().kind === "video"}>
                    <span class="kind-tag">{t("row.kind_video")}</span>
                  </Show>
                  <span class={`status-text status-${row().status.toLowerCase()}`}>
                    {statusLabel(row().status)}
                  </span>
                </div>
                <span class="modal-path" title={row().finalPath ?? row().filePath}>
                  {row().finalPath ?? row().filePath}
                </span>
              </div>

              {/* İlerleme */}
              <section class="detail-section">
                <h4>{t("detail.section.progress")}</h4>
                <SegmentBar
                  channels={row().channels}
                  totalBytes={row().totalBytes}
                  downloadedBytes={row().downloadedBytes}
                  done={done()}
                  failed={row().status === "Failed"}
                  paused={row().status === "Paused"}
                  height={10}
                  label={t("row.progress_aria")}
                />
                <div class="detail-progress-line">
                  <span class="detail-pct">{formatNumber(percent(), 1)}%</span>
                  <span>
                    {formatBytes(row().downloadedBytes)}
                    <Show when={row().totalBytes > 0}>
                      {" / "}
                      {formatBytes(row().totalBytes)}
                    </Show>
                  </span>
                  <span class="detail-spacer" />
                  <Show when={row().status === "Downloading"}>
                    <span>{formatSpeed(itemSpeed(row().id))}</span>
                  </Show>
                  <Show when={eta()}>
                    <span class="detail-muted">
                      {t("detail.eta")} {eta()}
                    </span>
                  </Show>
                </div>
                <Show when={row().stage}>
                  <div class="detail-stage">{row().stage}</div>
                </Show>
                <Show when={row().status === "Failed" && row().errorMessage}>
                  <div class="detail-error">{row().errorMessage}</div>
                </Show>
              </section>

              {/* Bilgi ızgarası */}
              <section class="detail-section">
                <h4>{t("detail.section.info")}</h4>
                <div class="detail-grid">
                  <span class="modal-meta-key">{t("detail.field.url")}</span>
                  <span class="modal-meta-value props-url" title={row().url}>
                    {row().url}
                  </span>

                  <span class="modal-meta-key">{t("detail.field.kind")}</span>
                  <span class="modal-meta-value">
                    {row().kind === "video"
                      ? t("detail.kind.video")
                      : t("detail.kind.file")}
                  </span>

                  <span class="modal-meta-key">{t("detail.field.ranges")}</span>
                  <span class="modal-meta-value">
                    {row().supportsRanges
                      ? t("detail.ranges.yes")
                      : t("detail.ranges.no")}
                  </span>

                  <span class="modal-meta-key">{t("detail.field.channels")}</span>
                  <span class="modal-meta-value">{row().channelCount}</span>

                  <span class="modal-meta-key">{t("detail.field.added")}</span>
                  <span class="modal-meta-value">
                    {formatDateTime(row().createdAt)}
                  </span>

                  <span class="modal-meta-key">{t("detail.field.finished")}</span>
                  <span class="modal-meta-value">
                    {formatDateTime(row().completedAt)}
                  </span>

                  <Show when={row().headers.length > 0}>
                    <span class="modal-meta-key">{t("detail.field.headers")}</span>
                    <span class="modal-meta-value detail-headers">
                      <For each={row().headers}>
                        {([name, value]) => (
                          <span class="detail-header-row" title={`${name}: ${value}`}>
                            <b>{name}</b>: {value}
                          </span>
                        )}
                      </For>
                    </span>
                  </Show>
                </div>
              </section>

              {/* Bağlantı tablosu (kanallar) */}
              <Show when={row().channels.length > 0}>
                <section class="detail-section">
                  <h4>{t("detail.section.connections")}</h4>
                  <div class="conn-table">
                    <div class="conn-head">
                      <span>{t("detail.conn.no")}</span>
                      <span>{t("detail.conn.downloaded")}</span>
                      <span>{t("detail.conn.start")}</span>
                      <span>{t("detail.conn.info")}</span>
                    </div>
                    <For each={row().channels}>
                      {(ch) => {
                        const span = () => ch.endByte - ch.startByte + 1;
                        const got = () =>
                          Math.max(0, Math.min(span(), ch.currentByte - ch.startByte));
                        return (
                          <div class="conn-row">
                            <span class="conn-no">{ch.id + 1}</span>
                            <span>{formatBytes(got())}</span>
                            <span>{formatBytes(ch.startByte)}</span>
                            <span class="conn-info">
                              {ch.finished
                                ? t("detail.conn.finished")
                                : t("detail.conn.percent", {
                                    percent: formatNumber(
                                      span() > 0 ? (100 * got()) / span() : 0,
                                      0,
                                    ),
                                  })}
                            </span>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </section>
              </Show>

              {/* yt-dlp günlüğü (yalnızca video) */}
              <Show when={row().kind === "video"}>
                <section class="detail-section">
                  <h4>{t("detail.section.log")}</h4>
                  <Show
                    when={logTail().length > 0}
                    fallback={<p class="detail-muted">{t("detail.log.empty")}</p>}
                  >
                    <pre class="detail-log">
                      <For each={logTail()}>{(line) => <div>{line}</div>}</For>
                    </pre>
                  </Show>
                </section>
              </Show>
            </div>

            <div class="modal-actions detail-actions">
              <label class="detail-check">
                <input
                  type="checkbox"
                  checked={closeOnFinish()}
                  onChange={(e) => {
                    setAutoClosed(false);
                    setCloseOnFinish(e.currentTarget.checked);
                  }}
                />
                {t("detail.close_on_finish")}
              </label>
              <span class="detail-spacer" />
              <Show when={done()}>
                <button type="button" class="btn" onClick={() => void onOpen()}>
                  {t("detail.open")}
                </button>
                <button type="button" class="btn" onClick={() => void onShowFolder()}>
                  {t("detail.show_in_folder")}
                </button>
              </Show>
              <button
                type="button"
                class="btn btn-primary"
                onClick={() => setPropertiesItem(null)}
              >
                {t("props.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}