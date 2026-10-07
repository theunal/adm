/**
 * "ADM Hakkında" penceresi — menü: Yardım ▸ ADM Hakkında.
 *
 * Modal katmanı; `Escape` ve arka plana tıklama kapatır. Sürüm bilgisi
 * `package.json`'daki `version` alanından okunur.
 */
import { Show } from "solid-js";
import { aboutOpen, setAboutOpen } from "../lib/ui";
import { t } from "../lib/i18n";
import logoUrl from "../assets/adm-logo-128.png";

/** Uygulama sürümü (paket dosyasıyla eş tutulur). */
const VERSION = "0.2.0";

export default function AboutDialog() {
  return (
    <Show when={aboutOpen()}>
      <div
        class="modal-backdrop"
        onClick={() => setAboutOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setAboutOpen(false);
        }}
      >
        <div
          class="modal"
          role="dialog"
          aria-modal="true"
          aria-label={t("about.title")}
          onClick={(e) => e.stopPropagation()}
        >
          <div class="modal-title">
            <span class="modal-title-text">{t("about.title")}</span>
            <button
              type="button"
              class="dock-close"
              aria-label={t("title.win.close")}
              onClick={() => setAboutOpen(false)}
            >
              ✕
            </button>
          </div>

          <div class="modal-body">
            <div class="about-logo">
              <span class="brand-mark" aria-hidden="true">
                <img src={logoUrl} alt="" />
              </span>
              <div>
                <div class="modal-name">ADM</div>
                <div class="about-version">Sürüm {VERSION}</div>
              </div>
            </div>

            <div>{t("about.desc")}</div>
            <div class="about-note">{t("about.tech")}</div>
          </div>

          <div class="modal-actions">
            <button
              type="button"
              class="btn btn-primary"
              onClick={() => setAboutOpen(false)}
            >
              {t("about.ok")}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}