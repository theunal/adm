/**
 * Pano sorması — MC `ClipboardWatcher` soru akışının arayüzü.
 *
 * Rust tarafındaki izleyici, panoya kopyalanan uygun bağlantıları bulunca
 * `clipboard` olayını yayınlar ve **soru yanıtlanana kadar** yeni soru
 * sormaz (`RuntimeState::prompting`). Bu pencere üç yol sunar:
 *
 * * **Videoyu İndir** — yt-dlp ile (video sayfaları için doğru yol).
 * * **Dosya Olarak İndir** — çok kanallı motorla.
 * * **Yoksay** — soru kapatılır, izleyici sonraki kopyalamada yeniden sorar.
 *
 * Ayrıca **"bir daha sorma"**: bu durumda `answerClipboardPrompt()` çağrılmaz
 * ve Rust tarafındaki bayrak kapalı kalır — izleyici oturum boyunca sessiz
 * olur. MC'deki "Ignore + bir daha sorma" davranışının karşılığıdır.
 *
 * `preferVideo` doğruysa (bağlantıların tümü video sayfası gibi görünüyorsa)
 * birincil düğme video indirmesidir.
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { answerClipboardPrompt, startDownload } from "../lib/api";
import { MAX_CHANNELS, MIN_CHANNELS, settings } from "../lib/settings";
import { clipboardPrompt, setClipboardPrompt } from "../lib/store";
import { errorText, pushFeedback } from "../lib/useFeedback";
import type { DownloadKind } from "../lib/format";
import { t } from "../lib/i18n";

/** Pencerede gösterilen en fazla bağlantı sayısı. */
const MAX_SHOWN = 4;

export default function ClipboardPromptDialog() {
  const [busy, setBusy] = createSignal(false);
  /** "Bir daha sorma" — yanıtlanınca izleyici bayrağı sıfırlanmaz. */
  const [mute, setMute] = createSignal(false);

  const prompt = createMemo(() => clipboardPrompt());

  /** Gösterilecek bağlantılar (kalanı sayaçla özetlenir). */
  const shown = createMemo(() => (prompt()?.urls ?? []).slice(0, MAX_SHOWN));

  /** Gösterilmeyen bağlantı sayısı. */
  const hidden = createMemo(() => Math.max(0, (prompt()?.urls.length ?? 0) - MAX_SHOWN));

  /** Soru metni (tek/çok bağlantı ayrımı). */
  const body = createMemo(() => {
    const count = prompt()?.urls.length ?? 0;
    return count > 1 ? t("clip.body", { count }) : t("clip.body_one");
  });

  /** Pencereyi kapatır; `answer` doğruysa izleyici bayrağı sıfırlanır. */
  async function dismiss(answer: boolean) {
    setBusy(false);
    setMute(false);
    setClipboardPrompt(null);
    if (answer) {
      try {
        await answerClipboardPrompt();
      } catch {
        // Bayrak sıfırlanamazsa izleyici sessiz kalır; kullanıcıya
        // gösterilecek bir eylem yok.
      }
    }
  }

  /** Seçilen türle tüm bağlantıları indirir. */
  async function download(kind: DownloadKind) {
    const urls = prompt()?.urls ?? [];
    if (urls.length === 0) return;

    setBusy(true);
    const count = Math.min(MAX_CHANNELS, Math.max(MIN_CHANNELS, settings.defaultChannelCount));
    try {
      for (const url of urls) {
        await startDownload({ url, filePath: null, channelCount: count, kind });
      }
      await dismiss(true);
    } catch (e) {
      pushFeedback("error", t("form.err.start", { error: errorText(e) }));
      setBusy(false);
    }
  }

  return (
    <Show when={prompt()}>
      {(value) => (
        <div
          class="modal-backdrop"
          onClick={() => void dismiss(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") void dismiss(true);
          }}
        >
          <div
            class="modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("clip.title")}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="modal-title">
              <span class="modal-title-text">{t("clip.title")}</span>
              <button
                type="button"
                class="dock-close"
                aria-label={t("title.win.close")}
                onClick={() => void dismiss(true)}
              >
                ✕
              </button>
            </div>

            <div class="modal-body">
              <p class="clip-body">{body()}</p>

              <ul class="clip-list">
                <For each={shown()}>
                  {(url) => (
                    <li class="clip-item" title={url}>
                      {t("clip.url_hint", { url })}
                    </li>
                  )}
                </For>
                <Show when={hidden() > 0}>
                  <li class="clip-item clip-more">+{hidden()}</li>
                </Show>
              </ul>

              <label class="detail-check">
                <input
                  type="checkbox"
                  checked={mute()}
                  disabled={busy()}
                  onChange={(e) => setMute(e.currentTarget.checked)}
                />
                {t("clip.remember")}
              </label>
            </div>

            <div class="modal-actions">
              <button
                type="button"
                class="btn"
                disabled={busy()}
                onClick={() => void dismiss(!mute())}
              >
                {t("clip.ignore")}
              </button>
              <span class="detail-spacer" />
              <button
                type="button"
                class={value().preferVideo ? "btn btn-primary" : "btn"}
                disabled={busy()}
                onClick={() => void download("file")}
              >
                {t("clip.download_file")}
              </button>
              <button
                type="button"
                class={value().preferVideo ? "btn" : "btn btn-primary"}
                disabled={busy()}
                onClick={() => void download("video")}
              >
                {t("clip.download_video")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
