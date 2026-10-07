/**
 * Özel başlık çubuğu.
 *
 * Pencere dekorasyonları kapatıldığı için küçültme / büyütme / kapatma
 * düğmeleri Tauri pencer API'si üzerinden burada sunulur. Çubuğun kendisi
 * sürüklenebilir alandır (`data-tauri-drag-region`).
 *
 * Sağdaki `TR | EN` dil anahtarı, `lib/i18n`'deki `setLocale()` çağrısını
 * tetikler: arayüz metinleri, belge/pencere başlığı ve Rust tarafındaki mesaj
 * dili birlikte değişir.
 */
import { For, Show } from "solid-js";
import {
  closeWindow,
  minimizeWindow,
  toggleMaximizeWindow,
} from "../lib/api";
import { activeCount, summary } from "../lib/store";
import { formatBytes, formatSpeed } from "../lib/format";
import { changeLang, settings } from "../lib/settings";
import { t, type Locale } from "../lib/i18n";

/** Dil anahtarındaki seçenekler. */
const LANGS: Locale[] = ["tr", "en"];

export default function TitleBar() {
  const totals = () => summary();

  return (
    <header class="titlebar" data-tauri-drag-region>
      {/* Sol: uygulama kimliği */}
      <div class="titlebar-brand" data-tauri-drag-region>
        <span class="brand-mark" aria-hidden="true">
          ADM
        </span>
        <div class="brand-text">
          <span class="brand-title">ADM</span>
          <span class="brand-sub">{t("title.brand_sub")}</span>
        </div>
      </div>

      {/* Orta: canlı özet (yalnızca sürüklenebilir alan) */}
      <div class="titlebar-summary" data-tauri-drag-region>
        <Show when={activeCount() > 0} fallback={<span class="summary-idle">{t("title.idle")}</span>}>
          <span class="summary-item">
            <span class="summary-value">{activeCount()}</span>
            <span class="summary-label">{t("title.summary.active")}</span>
          </span>
          <span class="summary-sep" aria-hidden="true">•</span>
          <span class="summary-item">
            <span class="summary-value">{formatSpeed(totals().totalSpeed)}</span>
            <span class="summary-label">{t("title.summary.speed")}</span>
          </span>
          <span class="summary-sep" aria-hidden="true">•</span>
          <span class="summary-item">
            <span class="summary-value">{formatBytes(totals().totalDownloaded)}</span>
            <span class="summary-label">{t("title.summary.downloaded")}</span>
          </span>
        </Show>
      </div>

      {/* Sağ: dil anahtarı + pencere düğmeleri */}
      <div class="titlebar-actions">
        <div
          class="lang-switch"
          role="group"
          aria-label={t("title.lang.label")}
          data-tauri-drag-region={false}
        >
          <For each={LANGS}>
            {(code) => (
              <button
                type="button"
                class={`lang-opt ${settings.lang === code ? "lang-opt-active" : ""}`}
                aria-pressed={settings.lang === code}
                onClick={() => void changeLang(code)}
              >
                {code.toUpperCase()}
              </button>
            )}
          </For>
        </div>

        <button
          type="button"
          class="win-btn"
          title={t("title.win.minimize")}
          aria-label={t("title.win.minimize")}
          onClick={() => void minimizeWindow()}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <rect x="2" y="5.5" width="8" height="1" fill="currentColor" />
          </svg>
        </button>

        <button
          type="button"
          class="win-btn"
          title={t("title.win.maximize")}
          aria-label={t("title.win.maximize_aria")}
          onClick={() => void toggleMaximizeWindow()}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <rect
              x="2.5"
              y="2.5"
              width="7"
              height="7"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
            />
          </svg>
        </button>

        <button
          type="button"
          class="win-btn win-btn-close"
          title={t("title.win.close")}
          aria-label={t("title.win.close")}
          onClick={() => void closeWindow()}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path
              d="M3 3 L9 9 M9 3 L3 9"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </div>
    </header>
  );
}