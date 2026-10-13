/**
 * Alt durum çubuğu.
 *
 * Soldan sağa: ana açık/kapalı anahtarı (tüm indirmeleri duraklatır ya da
 * sürdürür) · indirme hızı · **geçici mesaj** · boş alan · seçim özeti.
 *
 * **Mesaj yuvası önemlidir.** `pushFeedback()` hem eylem hatasını hem de
 * arka planda olmuş bitmişleri (indirme tamamlandı, yeni sürüm mevcut,
 * tarayıcı bağlandı, Rust uyarıları) buraya yazar. Alt dock kaldırıldığı için
 * bu alan uygulamanın tek bildirim kanalı.
 *
 * Kaldırılanlar: alt panel açma düğmesi (▾ — yalnızca hız grafiğini açıyordu),
 * boş disk alanı (30 saniyede bir `disk_free_space` IPC'si), köprü göstergesi
 * ve bitmeyen sayısı. Üçü de kenarda ya da ayarlarda görünür durumda.
 */
import { Show, createMemo } from "solid-js";
import { bulkPause, bulkResume } from "../lib/bulk";
import { selectedItems, totals } from "../lib/store";
import { formatSpeed } from "../lib/format";
import { errorText, pushFeedback } from "../lib/useFeedback";
import { statusMessage } from "../lib/ui";
import { t } from "../lib/i18n";
import Tip from "./Tip";

export default function StatusBar() {
  const stats = createMemo(() => totals());

  /** Seçili kayıt sayısı — mesaj yokken hatırlatma olarak gösterilir. */
  const selection = createMemo(() => selectedItems().length);

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

  return (
    <footer class="statusbar">
      {/* Ana açık/kapalı */}
      <Tip label={t("sb.master_title")} class={`sb-switch ${masterOn() ? "sb-switch-on" : ""}`}
        aria-pressed={masterOn()}
        onClick={() => void onToggleMaster()}>
        <span class="sb-led" aria-hidden="true" />
        {masterOn() ? t("sb.on") : t("sb.off")}
      </Tip>

      {/* Hız */}
      <Tip label={t("sb.speed")} class="sb-speeds" target="span">
        <span class="sb-speed-down">▼ {formatSpeed(stats().totalSpeed)}</span>
      </Tip>

      {/* Geçici mesaj (eylem sonucu / hata); yoksa seçim özeti */}
      <span class="sb-spacer" />
      <Show
        when={statusMessage()}
        fallback={
          <Show when={selection() > 0}>
            <Tip label={t("sb.selected_many", { count: selection() })} class="sb-current" target="span">
              {t("sb.selected_many", { count: selection() })}
            </Tip>
          </Show>
        }
      >
        {(msg) => (
          <Tip label={msg().text} class={`sb-message sb-message-${msg().level}`}
            role={msg().level === "error" ? "alert" : "status"}>
            {msg().text}
          </Tip>
        )}
      </Show>
    </footer>
  );
}
