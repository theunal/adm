/**
 * Ayarlar ekranı — dil, varsayılan kanal sayısı ve indirme konumları.
 *
 * Konum kuralları: video / ses / diğer uzantıları ayrı klasörlere gider;
 * eşleşmeyen dosyalar ve **boş bırakılan** kategoriler genel hedefe düşer.
 * Uzantı listeleri Rust tarafında sabittir (`settings.rs`), burada yalnızca
 * hedef klasörler seçilir.
 */
import { For, Show, createSignal } from "solid-js";
import { pickFolder } from "../lib/api";
import {
  CHANNEL_PRESETS,
  MAX_CHANNELS,
  MIN_CHANNELS,
  changeLang,
  settings,
  setDefaultChannels,
  updateSettings,
} from "../lib/settings";
import { errorText, pushLogSafe } from "../lib/useFeedback";
import { t, type Locale } from "../lib/i18n";

/** Dil anahtarındaki seçenekler. */
const LANGS: Locale[] = ["tr", "en"];

/** Konum satırları: sözlük anahtarı ve `Settings` alanı. */
type DirField = "videoDir" | "audioDir" | "otherDir";

interface DirRow {
  key: DirField;
  label: string;
  hint: string;
  /** Bu satır sıfırlanabilir mi? (genel hedef sıfırlanamaz) */
  optional: boolean;
}

export default function SettingsPanel() {
  /** Ayar yazımı sırasında düğmeleri kilitler. */
  const [saving, setSaving] = createSignal(false);

  /** Yazma hatasını yalnızca ilgili işlem gösterir. */
  async function guard(action: () => Promise<void>, failKey: string) {
    setSaving(true);
    try {
      await action();
    } catch (e) {
      pushLogSafe("error", t(failKey, { error: errorText(e) }));
    } finally {
      setSaving(false);
    }
  }

  const onLang = (code: Locale) =>
    guard(() => changeLang(code), "settings.err.lang");

  const onChannels = (count: number) =>
    guard(() => setDefaultChannels(count), "settings.err.channels");

  /** Ayar alanını yol metnine çevirir (boşsa ""). */
  const dirValue = (field: DirField) => settings[field] ?? "";

  /** Kategori satırı için hedef klasör seçtirir. */
  async function chooseDir(row: DirRow) {
    const current = dirValue(row.key);
    await guard(async () => {
      const picked = await pickFolder(
        t("settings.pick_folder", { target: t(row.label) }),
        current || settings.defaultDir || undefined,
      );
      if (picked) await updateSettings({ [row.key]: picked });
    }, "settings.err.pick");
  }

  /** Kategori satırını sıfırlar; dosyalar genel hedefe düşer. */
  function resetDir(row: DirRow) {
    void guard(() => updateSettings({ [row.key]: null }), "settings.err.save");
  }

  function setDefaultDir(path: string) {
    void guard(
      () => updateSettings({ defaultDir: path }),
      "settings.err.save",
    );
  }

  /** Genel hedef zorunludur: sıfırlamak yerine İndirilenler'e döner. */
  async function chooseDefaultDir() {
    await guard(async () => {
      const picked = await pickFolder(
        t("settings.pick_folder", { target: t("settings.dir.default") }),
        settings.defaultDir || undefined,
      );
      if (picked) setDefaultDir(picked);
    }, "settings.err.pick");
  }

  const rows: DirRow[] = [
    {
      key: "videoDir",
      label: "settings.dir.video",
      hint: "settings.dir.video_hint",
      optional: true,
    },
    {
      key: "audioDir",
      label: "settings.dir.audio",
      hint: "settings.dir.audio_hint",
      optional: true,
    },
    {
      key: "otherDir",
      label: "settings.dir.other",
      hint: "settings.dir.other_hint",
      optional: true,
    },
  ];

  return (
    <div class="settings-panel">
      {/* -------------------------------------------------------------
          Dil
      ------------------------------------------------------------- */}
      <section class="settings-section">
        <h2 class="section-title">{t("settings.section.language")}</h2>
        <div class="settings-row">
          <div class="lang-switch lang-switch-lg" role="group" aria-label={t("title.lang.label")}>
            <For each={LANGS}>
              {(code) => (
                <button
                  type="button"
                  class={`lang-opt ${settings.lang === code ? "lang-opt-active" : ""}`}
                  aria-pressed={settings.lang === code}
                  disabled={saving()}
                  onClick={() => void onLang(code)}
                >
                  {code.toUpperCase()}
                </button>
              )}
            </For>
          </div>
          <p class="settings-hint">{t("settings.lang_hint")}</p>
        </div>
      </section>

      {/* -------------------------------------------------------------
          Kanallar
      ------------------------------------------------------------- */}
      <section class="settings-section">
        <h2 class="section-title">{t("settings.section.channels")}</h2>
        {/* Sol menüdeki kanal alanının birebir aynısı: `.field` sınıfı
            önayarların kaydırıcıyla sol hizalı kalmasını sağlar. */}
        <div class="field field-channels">
          <label for="set-channels">
            {t("settings.channels_label")}
            <span class="field-hint">
              {t("form.channels_hint", { count: settings.defaultChannelCount })}
            </span>
          </label>
          <div class="slider-row">
            <input
              id="set-channels"
              type="range"
              class="slider"
              min={MIN_CHANNELS}
              max={MAX_CHANNELS}
              step="1"
              value={settings.defaultChannelCount}
              disabled={saving()}
              onInput={(e) => void onChannels(Number(e.currentTarget.value))}
            />
            <div class="slider-presets">
              <For each={CHANNEL_PRESETS}>
                {(n) => (
                  <button
                    type="button"
                    class={`preset ${settings.defaultChannelCount === n ? "preset-active" : ""}`}
                    disabled={saving()}
                    onClick={() => void onChannels(n)}
                  >
                    {n}
                  </button>
                )}
              </For>
            </div>
          </div>
          <p class="settings-hint">{t("settings.channels_hint")}</p>
        </div>
      </section>

      {/* -------------------------------------------------------------
          Konumlar
      ------------------------------------------------------------- */}
      <section class="settings-section">
        <h2 class="section-title">{t("settings.section.folders")}</h2>
        <p class="settings-hint">{t("settings.folders_intro")}</p>

        {/* Genel hedef — zorunlu */}
        <div class="settings-field">
          <label for="set-dir-default">{t("settings.dir.default")}</label>
          <div class="path-row">
            <input
              id="set-dir-default"
              type="text"
              class="input input-path"
              spellcheck={false}
              value={settings.defaultDir}
              disabled={saving()}
              onInput={(e) => setDefaultDir(e.currentTarget.value)}
            />
            <button
              type="button"
              class="btn btn-ghost"
              disabled={saving()}
              onClick={() => void chooseDefaultDir()}
            >
              {t("form.browse")}
            </button>
          </div>
          <p class="settings-hint">{t("settings.dir.default_hint")}</p>
        </div>

        {/* Kategori hedefleri */}
        <For each={rows}>
          {(row) => (
            <div class="settings-field">
              <label for={`set-${row.key}`}>{t(row.label)}</label>
              <div class="path-row">
                <input
                  id={`set-${row.key}`}
                  type="text"
                  class="input input-path"
                  spellcheck={false}
                  placeholder={t("settings.dir.inherit")}
                  value={dirValue(row.key)}
                  disabled={saving()}
                  onInput={(e) =>
                    void guard(
                      () => updateSettings({ [row.key]: e.currentTarget.value }),
                      "settings.err.save",
                    )
                  }
                />
                <button
                  type="button"
                  class="btn btn-ghost"
                  disabled={saving()}
                  onClick={() => void chooseDir(row)}
                >
                  {t("form.browse")}
                </button>
                <Show when={row.optional && settings[row.key]}>
                  <button
                    type="button"
                    class="btn btn-ghost btn-icon"
                    title={t("settings.dir.reset")}
                    aria-label={t("settings.dir.reset")}
                    disabled={saving()}
                    onClick={() => resetDir(row)}
                  >
                    ↺
                  </button>
                </Show>
              </div>
              <p class="settings-hint">{t(row.hint)}</p>
            </div>
          )}
        </For>
      </section>
    </div>
  );
}