/**
 * Alt durum çubuğu.
 *
 * Soldan sağa: ana açık/kapalı anahtarı (tüm indirmeleri duraklatır ya da
 * sürdürür) · indirme hızı · bağlantı kalitesi rozeti · boş alan ·
 * seçili kaydın adı · alt panel açma düğmesi.
 *
 * "YÜKSEK" rozeti FDM'deki bağlantı kalitesi göstergesinin karşılığıdır;
 * burada **ölçülen** anlık hıza göre üç kademe belirlenir. Sahte bir değer
 * göstermektense hız gerçeğini yansıtmak daha doğrudur.
 */
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { diskFreeSpace } from "../lib/api";
import { bulkPause, bulkResume } from "../lib/bulk";
import { selectedItems, totals } from "../lib/store";
import { settings } from "../lib/settings";
import { formatBytes, formatSpeed } from "../lib/format";
import { errorText, pushFeedback } from "../lib/useFeedback";
import {
  graphOpen,
  logOpen,
  setGraphOpen,
  setLogOpen,
} from "../lib/ui";
import { t } from "../lib/i18n";

/** Boş alanın yenilenme aralığı (ms). */
const REFRESH_MS = 30_000;

/** Hız kademesi eşikleri (MB/s). */
const QUALITY_HIGH = 2.0;
const QUALITY_MEDIUM = 0.5;

export default function StatusBar() {
  const stats = createMemo(() => totals());
  const [freeSpace, setFreeSpace] = createSignal(0);

  /** Alt panel (grafik / günlük) açık mı? */
  const dockOpen = () => graphOpen() || logOpen();

  /** Bağlantı kalitesi kademesi: `idle` | `warn` | `ok`. */
  const quality = createMemo<"idle" | "warn" | "ok">(() => {
    const mbps = stats().totalSpeed;
    if (mbps >= QUALITY_HIGH) return "ok";
    if (mbps >= QUALITY_MEDIUM) return "warn";
    return "idle";
  });

  const qualityLabel = createMemo(() => t(`sb.quality.${quality()}`));

  /** Seçili kaydın adı (yoksa liste durumu). */
  const current = createMemo(() => {
    const sel = selectedItems();
    if (sel.length === 1) return sel[0].fileName;
    if (sel.length > 1) return t("sb.selected_many", { count: sel.length });
    return "";
  });

  /** Anahtar: çalışan indirme varsa "ON" (duraklatılabilir), yoksa "OFF". */
  const masterOn = createMemo(() => stats().activeCount > 0);

  async function onToggleMaster() {
    try {
      if (masterOn()) await bulkPause();
      else await bulkResume();
    } catch (e) {
      pushFeedback("error", t("act.failed", {
        action: masterOn() ? t("act.pause") : t("act.resume"),
        error: errorText(e),
      }));
    }
  }

  function onToggleDock() {
    if (dockOpen()) {
      setGraphOpen(false);
      setLogOpen(false);
    } else {
      setGraphOpen(true);
    }
  }

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
      {/* Ana açık/kapalı */}
      <button
        type="button"
        class={`sb-switch ${masterOn() ? "sb-switch-on" : ""}`}
        title={t("sb.master_title")}
        aria-pressed={masterOn()}
        onClick={() => void onToggleMaster()}
      >
        <span class="sb-led" aria-hidden="true" />
        {masterOn() ? t("sb.on") : t("sb.off")}
      </button>

      {/* Hız */}
      <span class="sb-speeds" title={t("sb.speed")}>
        <span class="sb-speed-down">▼ {formatSpeed(stats().totalSpeed)}</span>
      </span>

      {/* Kalite rozeti */}
      <span class={`sb-badge sb-badge-${quality()}`} title={t("sb.quality_title")}>
        {qualityLabel()}
      </span>

      {/* Boş alan */}
      <Show when={freeSpace() > 0}>
        <span class="sb-speeds" title={t("sb.disk_free")}>
          {formatBytes(freeSpace())} {t("sb.free")}
        </span>
      </Show>

      <span class="sb-spacer" />

      <Show when={current()}>
        <span class="sb-current" title={current()}>
          {current()}
        </span>
      </Show>

      <button
        type="button"
        class="sb-collapse"
        title={dockOpen() ? t("sb.dock_hide") : t("sb.dock_show")}
        aria-label={dockOpen() ? t("sb.dock_hide") : t("sb.dock_show")}
        aria-pressed={dockOpen()}
        onClick={onToggleDock}
      >
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
          <path
            d={dockOpen() ? "M2 8 L6 4 L10 8" : "M2 4 L6 8 L10 4"}
            stroke="currentColor"
            stroke-width="1.4"
            fill="none"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </footer>
  );
}
