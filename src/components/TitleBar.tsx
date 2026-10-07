/**
 * Özel başlık çubuğu.
 *
 * Pencere dekorasyonları kapatıldığı için küçültme / büyütme / kapatma
 * düğmeleri Tauri pencer API'si üzerinden burada sunulur. Çubuğun kendisi
 * sürüklenebilir alandır (`data-tauri-drag-region`).
 */
import { Show } from "solid-js";
import {
  closeWindow,
  minimizeWindow,
  toggleMaximizeWindow,
} from "../lib/api";
import { activeCount, summary } from "../lib/store";
import { formatBytes, formatSpeed } from "../lib/format";

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
          <span class="brand-sub">Gelişmiş İndirme Yöneticisi</span>
        </div>
      </div>

      {/* Orta: canlı özet (yalnızca sürüklenebilir alan) */}
      <div class="titlebar-summary" data-tauri-drag-region>
        <Show when={activeCount() > 0} fallback={<span class="summary-idle">Boşta</span>}>
          <span class="summary-item">
            <span class="summary-value">{activeCount()}</span>
            <span class="summary-label">aktif</span>
          </span>
          <span class="summary-sep" aria-hidden="true">•</span>
          <span class="summary-item">
            <span class="summary-value">{formatSpeed(totals().totalSpeed)}</span>
            <span class="summary-label">hız</span>
          </span>
          <span class="summary-sep" aria-hidden="true">•</span>
          <span class="summary-item">
            <span class="summary-value">{formatBytes(totals().totalDownloaded)}</span>
            <span class="summary-label">indirildi</span>
          </span>
        </Show>
      </div>

      {/* Sağ: pencere düğmeleri */}
      <div class="titlebar-actions">
        <button
          type="button"
          class="win-btn"
          title="Küçült"
          aria-label="Küçült"
          onClick={() => void minimizeWindow()}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <rect x="2" y="5.5" width="8" height="1" fill="currentColor" />
          </svg>
        </button>

        <button
          type="button"
          class="win-btn"
          title="Büyüt / Küçült"
          aria-label="Büyüt veya küçült"
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
          title="Kapat"
          aria-label="Kapat"
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