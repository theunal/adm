/**
 * Yeni indirme formu.
 *
 * URL, hedef konum ve kanal sayısı alır; doğrulama Rust tarafında da
 * tekrarlanır (boş URL reddedilir).
 */
import { Show, createSignal, onMount } from "solid-js";
import {
  defaultDownloadDir,
  databasePath,
  pickSavePath,
  startDownload,
  suggestFileName,
} from "../lib/api";
import { errorText, pushLogSafe } from "../lib/useFeedback";
import { t } from "../lib/i18n";

/** Kanal sayısı aralığı (Rust tarafında da sınırlanır). */
const MIN_CHANNELS = 1;
const MAX_CHANNELS = 32;

export default function NewDownloadForm() {
  const [url, setUrl] = createSignal("");
  const [filePath, setFilePath] = createSignal("");
  const [channels, setChannels] = createSignal(8);
  const [submitting, setSubmitting] = createSignal(false);
  const [defaultDir, setDefaultDir] = createSignal("");
  const [dbPath, setDbPath] = createSignal("");

  onMount(async () => {
    try {
      const dir = await defaultDownloadDir();
      setDefaultDir(dir);
      setFilePath(dir);
    } catch (e) {
      pushLogSafe(
        "warn",
        t("form.err.default_dir", { error: errorText(e) }),
      );
    }
    try {
      setDbPath(await databasePath());
    } catch {
      // Tanı bilgisi opsiyoneldir.
    }
  });

  /** URL değiştikçe önerilen dosya adını tazeler. */
  async function refreshSuggestion() {
    const value = url().trim();
    if (!value) return;
    try {
      const name = await suggestFileName(value);
      setFilePath((prev) => {
        // Kullanıcı kendi konumunu seçtiyse dokunma.
        if (prev && !prev.endsWith("\\Downloads") && prev !== defaultDir()) return prev;
        return `${defaultDir()}\\${name}`;
      });
    } catch {
      // Öneri üretilemezse alan olduğu gibi kalır.
    }
  }

  /** Kayıt konumu için dosya diyaloğu açar. */
  async function browse() {
    try {
      let name = "indirme.bin";
      if (url().trim()) {
        name = await suggestFileName(url().trim());
      }
      const picked = await pickSavePath(name, defaultDir());
      if (picked) setFilePath(picked);
    } catch (e) {
      pushLogSafe("error", t("form.err.pick", { error: errorText(e) }));
    }
  }

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
      const count = Math.min(MAX_CHANNELS, Math.max(MIN_CHANNELS, channels()));
      await startDownload({
        url: value,
        filePath: filePath().trim() || null,
        channelCount: count,
      });

      setUrl("");
      // Alanı temizleyip varsayılan konuma dön.
      const dir = defaultDir();
      if (dir) {
        setFilePath(dir);
      }
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
          onInput={(e) => {
            setUrl(e.currentTarget.value);
            void refreshSuggestion();
          }}
        />
      </div>

      {/* Konum */}
      <div class="field">
        <label for="dl-path">{t("form.path_label")}</label>
        <div class="path-row">
          <input
            id="dl-path"
            type="text"
            class="input input-path"
            spellcheck={false}
            value={filePath()}
            onInput={(e) => setFilePath(e.currentTarget.value)}
          />
          <button type="button" class="btn btn-ghost" onClick={() => void browse()}>
            {t("form.browse")}
          </button>
        </div>
      </div>

      {/* Kanal sayısı */}
      <div class="field field-channels">
        <label for="dl-channels">
          {t("form.channels_label")}
          <span class="field-hint">
            {t("form.channels_hint", { count: channels() })}
          </span>
        </label>
        <div class="slider-row">
          <input
            id="dl-channels"
            type="range"
            class="slider"
            min={MIN_CHANNELS}
            max={MAX_CHANNELS}
            step="1"
            value={channels()}
            onInput={(e) => setChannels(Number(e.currentTarget.value))}
          />
          <div class="slider-presets">
            {[1, 4, 8, 16, 32].map((n) => (
              <button
                type="button"
                class={`preset ${channels() === n ? "preset-active" : ""}`}
                onClick={() => setChannels(n)}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
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