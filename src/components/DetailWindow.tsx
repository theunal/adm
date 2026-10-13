/**
 * IDM tarzı ayrıntı penceresi (küçük, sürekli üstte popup).
 *
 * Rust tarafı `detail-<id>` etiketiyle bir pencere açar ve `open_detail_window`
 * komutu bu pencereyi oluşturur. `src/index.tsx` etiketten indirme kimliğini
 * okuyup tam ekran yerine bu bileşeni çizer.
 *
 * Pencere kendi kaydını `download://event` kanalından dinler; ana pencereyle
 * paylaşılan bir depo yoktur (her iki webview de Rust'a bağlıdır), böylece iki
 * pencere birbirinden bağımsız güncellenir.
 *
 * Düzen (380×132): ad + durum · yüzde + indirilen/toplam · çubuk · hız/süre ·
 * kanal tablosu · eylem düğmeleri.
 */
import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getDownload,
  onDownloadEvent,
  openPath,
  pauseDownload,
  resumeDownload,
} from "../lib/api";
import { errorText, pushFeedback } from "../lib/useFeedback";
import { statusMessage } from "../lib/ui";
import { settings } from "../lib/settings";
import { locale, t } from "../lib/i18n";
import {
  formatBytes,
  formatEta,
  formatNumber,
  formatSpeed,
  percentOf,
  statusLabel,
  type ChannelState,
  type DownloadItem,
} from "../lib/format";
import Tip from "./Tip";

interface Props {
  /** Bu pencerenin gösterdiği indirme kimliği (`detail-42` → 42). */
  id: number;
}

/** Kanal satırı: yüzde + indirilen miktar. */
interface ChannelRow {
  id: number;
  span: number;
  got: number;
  percent: number;
  finished: boolean;
}

/** Tek bir kanalın ilerlemesini arayüz biçimine çevirir. */
function toChannelRow(ch: ChannelState): ChannelRow {
  const span = ch.endByte - ch.startByte + 1;
  // `currentByte` mutlak ofset; ilerleme her zaman `startByte` farkıdır.
  const got = span > 0
    ? Math.max(0, Math.min(span, ch.currentByte - ch.startByte))
    : 0;
  return {
    id: ch.id,
    span,
    got,
    percent: span > 0 ? (100 * got) / span : 0,
    finished: ch.finished || (span > 0 && got >= span),
  };
}

export default function DetailWindow(props: Props) {
  const [item, setItem] = createSignal<DownloadItem | null>(null);
  /** Duraklatma beklemede (düğmeyi kilitlemek için). */
  const [busy, setBusy] = createSignal(false);
  /** Dosya adı (pencere başlığında; tam yol ipucu olarak). */
  const [name, setName] = createSignal("");

  onMount(() => {
    let alive = true;

    void getDownload(props.id)
      .then((row) => {
        if (!alive || !row) return;
        setItem(row);
        setName(row.fileName);
      })
      .catch(() => undefined);

    const unlisten = onDownloadEvent((ev) => {
      if (ev.kind === "progress" && ev.id === props.id) {
        setItem((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            downloadedBytes: ev.downloadedBytes,
            totalBytes: ev.totalBytes > 0 ? ev.totalBytes : prev.totalBytes,
            speedMbps: ev.speedMbps,
            channels: ev.channels,
            status: prev.status === "Paused" ? "Paused" : ev.status,
          };
        });
        return;
      }

      if (ev.kind === "completed" && ev.id === props.id) {
        setItem((prev) =>
          prev
            ? {
                ...prev,
                status: ev.status,
                speedMbps: 0,
                downloadedBytes:
                  ev.status === "Completed" ? prev.totalBytes : prev.downloadedBytes,
              }
            : prev,
        );
        if (ev.status === "Completed" && settings.autoCloseDetail) {
          void getCurrentWindow().close();
        }
        return;
      }

      // "Bitenleri Temizle" kaydı sildiğinde açık popup'un sahipsiz kalmaması
      // için kayıt hâlâ var mı diye bakılır.
      if (ev.kind === "listChanged") {
        void getDownload(props.id)
          .then((row) => {
            if (alive && row === null) void getCurrentWindow().close();
          })
          .catch(() => undefined);
      }
    });

    onCleanup(() => {
      alive = false;
      unlisten.then((fn) => fn()).catch(() => undefined);
    });
  });

  const percent = createMemo(() => {
    const row = item();
    return row ? percentOf(row.downloadedBytes, row.totalBytes) : 0;
  });

  const sizeUnknown = createMemo(() => (item()?.totalBytes ?? 0) === 0);

  const speed = createMemo(() => {
    const row = item();
    if (!row) return 0;
    return row.status === "Paused" ? 0 : row.speedMbps;
  });

  const eta = createMemo(() => {
    const row = item();
    if (!row) return null;
    return formatEta(row.downloadedBytes, row.totalBytes, speed());
  });

  const running = createMemo(() => {
    const status = item()?.status;
    return status === "Queued" || status === "Downloading";
  });

  const done = createMemo(() => item()?.status === "Completed");

  const channels = createMemo(() =>
    (item()?.channels ?? [])
      .filter((ch) => ch.endByte > ch.startByte)
      .map(toChannelRow),
  );

  /** Yalnız eşzamanlı kanal varsa tabloyu göster (tek akışta anlamsız). */
  const showChannels = createMemo(() => channels().length > 1);

  async function toggle() {
    const row = item();
    if (!row || busy()) return;
    setBusy(true);
    try {
      if (row.status === "Paused" || row.status === "Failed" || row.status === "Cancelled") {
        await resumeDownload(row.id);
      } else {
        await pauseDownload(row.id);
      }
    } catch (e) {
      pushFeedback("error", errorText(e), row.id);
    } finally {
      setBusy(false);
    }
  }

  async function onClose() {
    await getCurrentWindow().close();
  }

  /** İndirilen dosyayı sistemde açar (yalnızca tamamlanınca). */
  async function onOpen() {
    const row = item();
    if (!row) return;
    try {
      await openPath(row.finalPath ?? row.filePath);
    } catch (e) {
      pushFeedback("error", t("act.failed", {
        action: t("act.open"),
        error: errorText(e),
      }), row.id);
    }
  }

  return (
    <div class="dw" data-tauri-drag-region>
      <header class="dw-head" data-tauri-drag-region>
        <Tip target="span" class="dw-name" label={item()?.filePath ?? ""}>
          {name() || t("detail.title")}
        </Tip>
        <Show when={item()}>
          {(row) => (
            <span class={`dw-status status-${row().status.toLowerCase()}`}>
              {statusLabel(row().status)}
            </span>
          )}
        </Show>
        <Tip
          class="dw-close"
          aria-label={t("title.win.close")}
          label={t("title.win.close")}
          onClick={() => void onClose()}
        >
          ✕
        </Tip>
      </header>

      <div class="dw-body">
        <div class="dw-line">
          <span class="dw-pct">
            {sizeUnknown() ? t("row.size_unknown") : `${formatNumber(percent(), 1)}%`}
          </span>
          <span class="dw-size">
            {formatBytes(item()?.downloadedBytes ?? 0)}
            <span class="dw-sep"> / </span>
            {sizeUnknown() ? "?" : formatBytes(item()?.totalBytes ?? 0)}
          </span>
          <span class="dw-speed">{formatSpeed(speed())}</span>
          <span class="dw-eta">{eta() ?? ""}</span>
        </div>

        <div class="dw-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100}
             aria-valuenow={sizeUnknown() ? 0 : Math.round(percent())}
             aria-label={t("row.progress_aria")}>
          <div
            class={`dw-fill ${done() ? "dw-fill-done" : ""}`}
            style={{ width: `${sizeUnknown() ? 0 : percent()}%` }}
          />
        </div>

        <Show when={showChannels()}>
          <div class="dw-channels" aria-label={t("detail.section.channels")}>
            <For each={channels()}>
              {(ch) => (
                <Tip
                  target="span"
                  class={`dw-ch ${ch.finished ? "dw-ch-done" : ""}`}
                  label={t("detail.conn.percent", { percent: formatNumber(ch.percent, 0) })}
                >
                  <span class="dw-ch-no">{ch.id + 1}</span>
                  <span class="dw-ch-bar">
                    <span class="dw-ch-fill" style={{ width: `${ch.percent}%` }} />
                  </span>
                  <span class="dw-ch-pct">{formatNumber(ch.percent, 0)}%</span>
                </Tip>
              )}
            </For>
          </div>
        </Show>
      </div>

      <footer class="dw-foot">
        {/* Popup'ın kendi durum çubuğu yok; `pushFeedback` sinyalini burada
            okuyoruz, aksi halde eylem hataları görünmez olurdu. */}
        <Show
          when={statusMessage()}
          fallback={<span class="dw-locale">{locale()}</span>}
        >
          {(msg) => (
            <Tip target="span" class={`dw-msg dw-msg-${msg().level}`} label={msg().text}>
              {msg().text}
            </Tip>
          )}
        </Show>
        <Show when={!done()}>
          <button
            type="button"
            class="dw-btn"
            disabled={busy()}
            onClick={() => void toggle()}
          >
            {running() ? t("act.pause") : t("act.resume")}
          </button>
        </Show>
        <Tip
          class="dw-btn dw-btn-primary"
          disabled={!done()}
          label={item()?.filePath ?? ""}
          onClick={() => void onOpen()}
        >
          {t("act.open")}
        </Tip>
      </footer>
    </div>
  );
}
