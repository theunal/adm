/**
 * Yeni indirme formu.
 *
 * Yalnızca URL alır; doğrulama Rust tarafında da tekrarlanır (boş URL
 * reddedilir). Hedef konum uzantıya göre ayarlardaki klasör kurallarıyla,
 * kanal sayısı ise Ayarlar'daki "Varsayılan kanal sayısı" ile belirlenir.
 */
import { Show, createSignal, onMount } from "solid-js";
import { databasePath, startDownload } from "../lib/api";
import { errorText, pushLogSafe } from "../lib/useFeedback";
import { MAX_CHANNELS, MIN_CHANNELS, settings } from "../lib/settings";
import { t } from "../lib/i18n";

export default function NewDownloadForm() {
  const [url, setUrl] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [dbPath, setDbPath] = createSignal("");

  onMount(async () => {
    try {
      setDbPath(await databasePath());
    } catch {
      // Tanı bilgisi opsiyoneldir.
    }
  });

  /** Formu gönderir. */
  async function submit(event: Event) {
    event.preventDefault();

    const value = url().trim();
    if (!value) {
      pushLogSafe("warn", t("form.warn.no_url"));
      return;
    }
    if (!/^https?:\/\//i.test(value)) {
      pushLogSafe("warn", t("form.warn.bad_scheme"));
      return;
    }

    setSubmitting(true);
    try {
      // Konum boş gönderiliyor: Rust, uzantıya göre ayarlardaki hedefi çözer.
      const count = Math.min(
        MAX_CHANNELS,
        Math.max(MIN_CHANNELS, settings.defaultChannelCount),
      );
      await startDownload({
        url: value,
        filePath: null,
        channelCount: count,
      });

      setUrl("");
    } catch (e) {
      pushLogSafe("error", t("form.err.start", { error: errorText(e) }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form class="new-download" onSubmit={submit}>
      <div class="new-download-head">
        <h2 class="section-title">{t("form.title")}</h2>
        <Show when={dbPath()}>
          <span class="db-hint" title={t("form.db_title", { path: dbPath() })}>
            {t("form.db_hint")}
          </span>
        </Show>
      </div>

      {/* URL */}
      <div class="field">
        <label for="dl-url">{t("form.url_label")}</label>
        <input
          id="dl-url"
          type="text"
          class="input"
          placeholder={t("form.url_placeholder")}
          autocomplete="off"
          spellcheck={false}
          value={url()}
          onInput={(e) => setUrl(e.currentTarget.value)}
        />
      </div>

      <button
        type="submit"
        class="btn btn-primary btn-block"
        disabled={submitting() || !url().trim()}
      >
        {submitting() ? t("form.submitting") : t("form.submit")}
      </button>
    </form>
  );
}
