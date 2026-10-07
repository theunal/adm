/**
 * Alt durum çubuğu — IDM'in pencere alt şeridi.
 *
 * Soldan sağa: boş disk alanı · anlık hız · aktif görev · indirilen toplam ·
 * toplam süre. Disk alanı Rust tarafından okunur (`disk_free_space`) ve
 * ayarlardaki genel konuma göre hesaplanır.
 */
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { diskFreeSpace } from "../lib/api";
import { totals } from "../lib/store";
import { settings } from "../lib/settings";
import { formatBytes, formatDuration, formatNumber, formatSpeed } from "../lib/format";
import { t } from "../lib/i18n";

/** Boş alanın yenilenme aralığı (ms). */
const REFRESH_MS = 30_000;

export default function StatusBar() {
  const stats = createMemo(() => totals());
  /** `0` henüz okunmadı / okunamadı anlamına gelir. */
  const [freeSpace, setFreeSpace] = createSignal(0);

  // Disk alanı ayar konumuna göre okunur; ayar değişirse yeniden okunur.
  createEffect(() => {
    const dir = settings.defaultDir;
    if (!dir) {
      setFreeSpace(0);
      return;
    }

    let cancelled = false;
    const read = async () => {
      try {
        const value = await diskFreeSpace(dir);
        if (!cancelled) setFreeSpace(value);
      } catch {
        // Disk bilgisi opsiyoneldir; alan "—" olarak kalır.
      }
    };

    void read();
    const timer = setInterval(() => void read(), REFRESH_MS);
    onCleanup(() => {
      cancelled = true;
      clearInterval(timer);
    });
  });

  return (
    <footer class="statusbar">
      <div class="status-cell">
        <span class="status-key">{t("sb.disk_free")}</span>
        <span class="status-val">
          <Show when={freeSpace() > 0} fallback="—">
            {formatBytes(freeSpace())}
          </Show>
        </span>
      </div>

      <div class="status-cell">
        <span class="status-key">{t("sb.speed")}</span>
        <span class="status-val">{formatSpeed(stats().totalSpeed)}</span>
      </div>

      <div class="status-cell">
        <span class="status-key">{t("sb.active")}</span>
        <span class="status-val">{formatNumber(stats().activeCount)}</span>
      </div>

      <div class="status-cell">
        <span class="status-key">{t("sb.downloaded")}</span>
        <span class="status-val">{formatBytes(stats().totalDownloaded)}</span>
      </div>

      <div class="status-cell">
        <span class="status-key">{t("sb.time")}</span>
        <span class="status-val">{formatDuration(stats().totalSeconds)}</span>
      </div>

      <div class="status-cell status-cell-push">
        <span class="status-key">{t("sb.ready")}</span>
      </div>
    </footer>
  );
}