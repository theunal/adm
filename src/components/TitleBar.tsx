/**
 * Özel başlık çubuğu.
 *
 * Pencere dekorasyonları kapatıldığı için küçültme / büyütme / kapatma
 * düğmeleri Tauri pencer API'si üzerinden burada sunulur. Çubuğun kendisi
 * sürüklenebilir alandır (`data-tauri-drag-region`).
 *
 * Üst çubuk ve ≡ menüsü kaldırıldı; işlerinin tamamı sol panele taşındı.
 * Başlık çubuğunda iki yeni düğme var: **☰ sol menü** (paneli açar/kapatır)
 * ve **dişli ayarlar** (`Ctrl+S` ile aynı).
 *
 * Sağdaki `TR | EN` dil anahtarı, `lib/i18n`'deki `setLocale()` çağrısını
 * tetikler: arayüz metinleri, belge/pencere başlığı ve Rust tarafındaki mesaj
 * dili birlikte değişir.
 */
import { For } from "solid-js";
import {
  closeWindow,
  minimizeWindow,
  toggleMaximizeWindow,
} from "../lib/api";
import { changeLang, settings } from "../lib/settings";
import { t, type Locale } from "../lib/i18n";
import { setSettingsOpen, setSideOpen, settingsOpen, sideOpen } from "../lib/ui";
import Tip from "./Tip";
import logoUrl from "../assets/adm-logo-128.png";

/** Dil anahtarındaki seçenekler. */
const LANGS: Locale[] = ["tr", "en"];

export default function TitleBar() {
  return (
    <header class="titlebar" data-tauri-drag-region>
      {/* Sol: menü düğmesi + uygulama kimliği */}
      <div class="titlebar-brand" data-tauri-drag-region>
        {/* Sol menü (açılır-kapanır panel). İşaret `aria-expanded` taşır;
            açıkken `aria-pressed` da görünür ki dişli ile karışmasın. */}
        <Tip
          label={sideOpen() ? t("side.close") : t("side.open")}
          class="tb-toggle"
          aria-pressed={sideOpen()}
          onClick={() => setSideOpen(!sideOpen())}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path
              d="M2.5 4 h11 M2.5 8 h11 M2.5 12 h11"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
            />
          </svg>
        </Tip>
        <span class="brand-mark" aria-hidden="true">
          <img src={logoUrl} alt="" />
        </span>
        <span class="brand-title">ADM</span>
      </div>

      {/* Sağ: ayarlar + dil anahtarı + pencere düğmeleri */}
      <div class="titlebar-actions">
        <Tip
          label={t("tb.settings")}
          keys="Ctrl+S"
          class={`tb-toggle ${settingsOpen() ? "tb-btn-active" : ""}`}
          aria-pressed={settingsOpen()}
          onClick={() => setSettingsOpen(!settingsOpen())}
        >
          <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
            <circle cx="7" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3" />
            <path
              d="M7 1.4 v1.6 M7 11 v1.6 M1.4 7 h1.6 M11 7 h1.6 M3 3 l1.2 1.2 M9.8 9.8 L11 11 M11 3 L9.8 4.2 M4.2 9.8 L3 11"
              stroke="currentColor"
              stroke-width="1.2"
              stroke-linecap="round"
            />
          </svg>
        </Tip>

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

        <Tip label={t("title.win.minimize")} class="win-btn"
          aria-label={t("title.win.minimize")}
          onClick={() => void minimizeWindow()}>
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <rect x="2" y="5.5" width="8" height="1" fill="currentColor" />
          </svg>
        </Tip>

        <Tip label={t("title.win.maximize")} class="win-btn"
          aria-label={t("title.win.maximize_aria")}
          onClick={() => void toggleMaximizeWindow()}>
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
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
        </Tip>

        <Tip label={t("title.win.close")} class="win-btn win-btn-close"
          aria-label={t("title.win.close")}
          onClick={() => void closeWindow()}>
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <path
              d="M3 3 L9 9 M9 3 L3 9"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linecap="round"
            />
          </svg>
        </Tip>
      </div>
    </header>
  );
}