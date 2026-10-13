/**
 * Özel başlık çubuğu.
 *
 * Pencere dekorasyonları kapatıldığı için küçültme / büyütme / kapatma
 * düğmeleri Tauri pencer API'si üzerinden burada sunulur. Çubuğun kendisi
 * sürüklenebilir alandır (`data-tauri-drag-region`).
 *
 * Menü açma düğmesi (☰) buradan **çıkarıldı**: artık menü kapalıyken
 * gövdenin sol üst köşesinde yüzen bir düğme olarak duruyor
 * (`MenuToggle.tsx`), menü açıkken ise panelin kendi başlık satırındaki
 * ✕ düğmesi kapatıyor. Başlık çubuğunda yalnızca **dişli çark ayarlar**
 * düğmesi kaldı (`Ctrl+S` ile aynı).
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
import { setSettingsOpen, settingsOpen } from "../lib/ui";
import Tip from "./Tip";
import logoUrl from "../assets/adm-logo-128.png";

/** Dil anahtarındaki seçenekler. */
const LANGS: Locale[] = ["tr", "en"];

export default function TitleBar() {
  return (
    <header class="titlebar" data-tauri-drag-region>
      {/* Sol: uygulama kimliği (simge + ad) */}
      <div class="titlebar-brand" data-tauri-drag-region>
        <span class="brand-mark" aria-hidden="true">
          <img src={logoUrl} alt="" />
        </span>
        <span class="brand-title">ADM</span>
      </div>

      {/* Sağ: ayarlar (dişli çark) + dil anahtarı + pencere düğmeleri */}
      <div class="titlebar-actions">
        <Tip
          label={t("tb.settings")}
          keys="Ctrl+S"
          class={`tb-toggle ${settingsOpen() ? "tb-btn-active" : ""}`}
          aria-pressed={settingsOpen()}
          onClick={() => setSettingsOpen(!settingsOpen())}
        >
          {/* Dişli çark (Feather `settings`). Eski "güneş" görünümlü
              çember+çizgi ikonu ayarlar için yanıltıcıydı. */}
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none"
            stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
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