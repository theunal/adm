/**
 * Köşe bildirimi (toast) — alt durum çubuğunun yerini alan bildirim.
 *
 * `pushFeedback()` bir mesajı `ui.ts`'teki `statusMessage` sinyaline yazar;
 * bu bileşen onu sağ altta gösterir ve `useFeedback` içindeki zamanlayıcı
 * 4 saniye sonra kendiliğinden temizler.
 *
 * Tasarım noktaları:
 * - **Seviye rengi** sol kenardaki 3px çizgi + başlık rengiyle verilir
 *   (hata kırmızı, başarı yeşil, uyarı turuncu, bilgi gri).
 * - **Fareyla üzerine gelince** mesaj kaybolmaz (`holdFeedback` /`releaseFeedback`).
 * - `pointer-events: none` — tablo satırlarının tıklanabilirliğini kesmemesi
 *   için; hover CSS ile yine yakalanır (`pointer-events` yalnızca tıklamayı
 *   engeller, hover'ı engellemez).
 * - `role="alert"` (hata) / `role="status"` (diğer) ile ekran okuyucuya
 *   duyurulur.
 */
import { Show } from "solid-js";
import { statusMessage } from "../lib/ui";
import { holdFeedback, releaseFeedback } from "../lib/useFeedback";

export default function Toast() {
  return (
    <Show when={statusMessage()}>
      {(msg) => (
        <div
          class={`toast toast-${msg().level}`}
          role={msg().level === "error" ? "alert" : "status"}
          aria-live="polite"
          onPointerEnter={() => holdFeedback()}
          onPointerLeave={() => releaseFeedback()}
        >
          <span class="toast-dot" aria-hidden="true" />
          <span class="toast-text">{msg().text}</span>
        </div>
      )}
    </Show>
  );
}
