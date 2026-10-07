/**
 * Yeni indirme formu — kenar çubuğunun üst bloğu.
 *
 * IDM'in "Add URL" kutusu: tek satırlık adres alanı + yeşil `Ekle` düğmesi,
 * altında hedef klasör ("Kayıt") ve bağlantı sayısı özeti.
 *
 * Yalnızca URL alınır; doğrulama Rust tarafında da tekrarlanır (boş URL
 * reddedilir). Hedef konum uzantıya göre ayarlardaki klasör kurallarıyla,
 * kanal sayısı ise Ayarlar'daki "Varsayılan kanal sayısı" ile belirlenir.
 */
import { Show, createEffect, createSignal, onMount } from "solid-js";
import { databasePath, resolveTargetPath, startDownload } from "../lib/api";
import { errorText, pushLogSafe } from "../lib/useFeedback";
import { MAX_CHANNELS, MIN_CHANNELS, settings } from "../lib/settings";
import { urlFocusTokenValue } from "../lib/ui";
import { t } from "../lib/i18n";

export default function NewDownloadForm() {
  const [url, setUrl] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [dbPath, setDbPath] = createSignal("");
  /** Yazılan adrese göre çözümlenen hedef klasör önizlemesi. */
  const [target, setTarget] = createSignal("");

  let input: HTMLInputElement | undefined;

  onMount(async () => {
    try {
      setDbPath(await databasePath());
    } catch {
      // Tanı bilgisi opsiyoneldir.
    }
  });

  /** Menüden / kısayoldan "URL Ekle" çağrıldığında girdiye odaklan. */
  createEffect(() => {
    urlFocusTokenValue();
    input?.focus();
    input?.select();
  });

  // Adre yazıldıkça hedef klasörü Rust tarafında çözdür (yalnızca düzenli
  // URL'lerde; her tuşta IPC gitmesin diye boş/geçersiz girdi atlanır).
  createEffect(() => {
    const value = url().trim();
    if (!/^https?:\/\/\S+$/i.test(value)) {
      setTarget("");
      return;
    }
    let cancelled = false;
    void resolveTargetPath(value)
      .then((path) => {
        if (!cancelled) setTarget(path);
      })
      .catch(() => {
        if (!cancelled) setTarget("");
      });
    return () => {
      cancelled = true;
    };
  });

  /** Formu gönderir. */
  async function submit(event: Event) {
    event.preventDefault();

    const value = url().trim();
    if (!value) {
      pushLogSafe("warn", t("form.warn.no_url"));
      input?.focus();
      return;
    }
    if (!/^https?:\/\//i.test(value)) {
      pushLogSafe("warn", t("form.warn.bad_scheme"));
      input?.focus();
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
      setTarget("");
    } catch (e) {
      pushLogSafe("error", t("form.err.start", { error: errorText(e) }));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form class="add-form" onSubmit={submit}>
      <div class="add-input-row">
        <input
          ref={input}
          id="dl-url"
          type="text"
          class="input"
          placeholder={t("form.url_placeholder")}
          title={t("add.url_title")}
          aria-label={t("add.url_title")}
          autocomplete="off"
          spellcheck={false}
          value={url()}
          disabled={submitting()}
          onInput={(e) => setUrl(e.currentTarget.value)}
        />
        <button
          type="submit"
          class="btn btn-primary"
          disabled={submitting() || !url().trim()}
          title={t("tb.add_title")}
        >
          {submitting() ? t("form.submitting") : t("form.submit")}
        </button>
      </div>

      <div class="add-meta">
        <Show when={target()}>
          <div class="add-meta-row">
            <span class="add-meta-key">{t("add.save_to")}</span>
            <span class="add-meta-value" title={target()}>
              {target()}
            </span>
          </div>
        </Show>

        <div class="add-meta-row">
          <span class="add-meta-key">{t("add.channels")}</span>
          <span class="add-meta-value">
            {t("form.channels_hint", { count: settings.defaultChannelCount })}
          </span>
        </div>

        <Show when={dbPath()}>
          <div class="add-meta-row">
            <span class="add-meta-value" title={t("form.db_title", { path: dbPath() })}>
              {t("form.db_hint")}
            </span>
          </div>
        </Show>
      </div>
    </form>
  );
}