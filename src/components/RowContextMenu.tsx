/**
 * Satır bağlam menüsü.
 *
 * Tablo satırına sağ tıklandığında `lib/ui`'deki `contextMenu` sinyali dolar;
 * bu bileşen onu okuyup ekran konumunda IDM tarzı bir açılır menü çizer.
 * Dışarı tıklama, `Escape` veya bir öğe seçimi menüyü kapatır.
 *
 * Menü tek bir katmanda (`ctx-layer`) çizilir; tablo gövdesinin kaydırma
 * konteynerinin `overflow` değeri onu kırpamaz.
 */
import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { changeChannelCount, confirm, openFolder, openPath } from "../lib/api";
import {
  cancelItem,
  deleteItem,
  pauseItem,
  resumeItem,
} from "../lib/bulk";
import { MAX_CHANNELS, MIN_CHANNELS } from "../lib/settings";
import { errorText, pushLogSafe } from "../lib/useFeedback";
import { contextMenu, setContextMenu, setPropertiesItem } from "../lib/ui";
import { t } from "../lib/i18n";
import type { DownloadItem } from "../lib/format";

/** Menü genişliği (kenar boşluğu için ekran kenarına yaslanır). */
const MENU_W = 210;
/** Tahmini menü yüksekliği — ekranın altına taşmayı önler. */
const MENU_H = 430;

export default function RowContextMenu() {
  /** Kaydırıcının anlık değeri (menü kapanana kadar Rust'a gitmez). */
  const [channelDraft, setChannelDraft] = createSignal(0);

  // Menü her açıldığında kaydırıcıyı kaydın gerçek kanal sayısına getir.
  createEffect(() => {
    const item = contextMenu()?.item;
    if (item) setChannelDraft(item.channelCount);
  });

  /**
   * Menü açıkken çalışan yön tuşları ve `Escape`.
   *
   * `window` dinleyicisi bileşen ömrü boyunca kalır; menü kapalıyken de
   * tuşları yutar (menü açıksa) böylece kaydırma çubuğu zıplamaz.
   */
  createEffect(() => {
    if (!contextMenu()) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setContextMenu(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    onCleanup(() => window.removeEventListener("keydown", onKey, true));
  });

  /** Ekrana sığmayan konumu düzeltir. */
  const position = () => {
    const state = contextMenu();
    if (!state) return { left: "0px", top: "0px" };
    const left = Math.min(state.x, window.innerWidth - MENU_W - 6);
    const top = Math.min(state.y, window.innerHeight - MENU_H - 6);
    return { left: `${Math.max(4, left)}px`, top: `${Math.max(4, top)}px` };
  };

  /** Ortak sarmalayıcı: menüyü kapat, hatayı log'a yaz. */
  async function run(label: string, action: () => Promise<void>) {
    setContextMenu(null);
    try {
      await action();
    } catch (e) {
      pushLogSafe("error", t("act.failed", { action: label, error: errorText(e) }));
    }
  }

  /** Kaydı (ve istenirse dosyasını) onaylayarak siler. */
  async function onDeleteRecord(item: DownloadItem, withFile: boolean) {
    const ok = await confirm(
      withFile
        ? t("dialog.delete_file.body", { name: item.fileName })
        : t("dialog.delete_record.body", { name: item.fileName }),
      withFile ? t("dialog.delete_file.title") : t("dialog.delete_record.title"),
    );
    if (!ok) return;
    await run(withFile ? t("act.delete") : t("act.delete_record"), async () => {
      await deleteItem(item, withFile);
    });
  }

  /** Adresi panoya kopyalar. */
  async function onCopy(item: DownloadItem) {
    await run(t("menu.item.copy_url"), async () => {
      await navigator.clipboard.writeText(item.url);
      pushLogSafe("info", t("dialog.copied"), item.id);
    });
  }

  /** Kanal sayısı değişikliğini uygular (menüyü açık tutar). */
  async function onChannels(count: number) {
    const item = contextMenu()?.item;
    if (!item || count === item.channelCount) return;
    try {
      await changeChannelCount(item.id, count);
      pushLogSafe("info", t("log.channels_changed", {
        name: item.fileName,
        count: count.toString(),
      }), item.id);
    } catch (e) {
      pushLogSafe(
        "error",
        t("act.failed", { action: t("act.channels"), error: errorText(e) }),
        item.id,
      );
    }
  }

  return (
    <Show when={contextMenu()}>
      {(state) => (
        <div class="ctx-layer">
          {/* Tıklama katmanı + menü aynı sabit kutu içinde: mutlak
              konumlandırma ekran koordinatlarıyla birebir örtüşür. */}
          <div
            class="ctx-scrim"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />

          <div
            class="ctx-pop"
            style={position()}
            role="menu"
            onClick={(e) => e.stopPropagation()}
          >
            <Show when={state().item.status === "Completed"}>
              <button
                type="button"
                class="menu-item"
                onClick={() => void run(t("act.open"), async () => {
                  await openPath(state().item.filePath);
                })}
              >
                {t("menu.item.open_file")}
              </button>
            </Show>

            <button
              type="button"
              class="menu-item"
              onClick={() => void run(t("act.folder"), async () => {
                await openFolder(state().item.filePath);
              })}
            >
              {t("menu.item.open_folder")}
            </button>

            <button
              type="button"
              class="menu-item"
              onClick={() => void onCopy(state().item)}
            >
              {t("menu.item.copy_url")}
            </button>

            <div class="menu-sep" role="separator" />

            <Show when={state().item.status === "Paused" ||
              state().item.status === "Failed" ||
              state().item.status === "Cancelled"}>
              <button
                type="button"
                class="menu-item"
                onClick={() => void run(t("act.resume"), async () => {
                  await resumeItem(state().item);
                })}
              >
                {t("act.resume")}
              </button>
            </Show>

            <Show when={state().item.status === "Downloading" ||
              state().item.status === "Queued"}>
              <button
                type="button"
                class="menu-item"
                onClick={() => void run(t("act.pause"), async () => {
                  await pauseItem(state().item);
                })}
              >
                {t("act.pause")}
              </button>
              <button
                type="button"
                class="menu-item"
                onClick={() => void run(t("act.cancel"), async () => {
                  await cancelItem(state().item);
                })}
              >
                {t("act.cancel")}
              </button>
            </Show>

            <div class="menu-sep" role="separator" />

            <button
              type="button"
              class="menu-item"
              onClick={() => void onDeleteRecord(state().item, false)}
            >
              {t("menu.item.delete_record")}
            </button>
            <button
              type="button"
              class="menu-item"
              onClick={() => void onDeleteRecord(state().item, true)}
            >
              {t("menu.item.delete_download")}
            </button>

            <div class="menu-sep" role="separator" />

            {/* Kanal sayısı düzenleyicisi. Satır içi düğmeler kaldırıldığı
                için buraya taşındı. Değer `change` (fare bırakılınca) uygulanır;
                `input` sırasında her adımda komut göndermemek için. */}
            <div class="ctx-channels">
              <div class="ctx-channels-head">
                {t("act.channels_label")} <strong>{channelDraft()}</strong>
              </div>
              <input
                type="range"
                class="slider"
                min={MIN_CHANNELS}
                max={MAX_CHANNELS}
                step={1}
                value={channelDraft()}
                aria-label={t("act.channels_label")}
                onClick={(e) => e.stopPropagation()}
                onInput={(e) => setChannelDraft(Number(e.currentTarget.value))}
                onChange={(e) => void onChannels(Number(e.currentTarget.value))}
              />
              <p class="ctx-channels-note">{t("act.channels_note")}</p>
            </div>

            <div class="menu-sep" role="separator" />

            <button
              type="button"
              class="menu-item"
              onClick={() => {
                setPropertiesItem(state().item);
                setContextMenu(null);
              }}
            >
              {t("menu.item.properties")}
            </button>
          </div>
        </div>
      )}
    </Show>
  );
}