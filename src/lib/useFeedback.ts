/**
 * Geri bildirim yardımcıları — geçici mesaj gösterme ve hata metinleştirme.
 *
 * `store.ts` bu fonksiyonları dışa aktarır; ayrı bir dosyada tutulmasının
 * nedeni döngüsel bağımlılığı önlemek: bileşenler `store`'u doğrudan
 * değiştirmeden yalnızca bu katmanı kullanır.
 *
 * Log paneli ve alt durum çubuğu kaldırıldı; mesajlar artık sağ alttaki
 * **köşe bildiriminde** (toast) birkaç saniye görünür. Bu yüzden
 * `pushFeedback` **sessizce yutmaz**: çağıran bileşen ekranda hiçbir iz
 * görse bile mesaj en az bir kez basılır.
 */
import { errorText, markBusy } from "./store";
import { setStatusMessage } from "./ui";

export { errorText, markBusy };

/** Mesajın ekranda kalacağı süre (ms). */
const MESSAGE_MS = 4000;

/** Yeniden mesaj basılırsa eski zamanlayıcının iptali için. */
let timer: ReturnType<typeof setTimeout> | undefined;

/** Zamanlayıcı duraklatıldı mı? (fare toast üzerindeyken) */
let held = false;

/** Duraklatma sırasında geçen süre takibi için başlangıç damgası. */
let started_at = 0;

/** Zamanlayıcıyı (yeniden) kurar. */
function arm(delay: number) {
  if (timer !== undefined) clearTimeout(timer);
  started_at = Date.now();
  timer = setTimeout(() => {
    if (held) return;
    setStatusMessage(null);
    timer = undefined;
  }, delay);
}

/**
 * Köşe bildiriminde geçici mesaj gösterir.
 *
 * Önceki zamanlayıcı iptal edilir; art arda gelen mesajlar erken
 * silinmez.
 *
 * `id` is optional — it is accepted for backwards compatibility with
 * callers that pass it but is currently unused (the toast shows the
 * message text only, not a download id).
 */
export function pushFeedback(
  level: "info" | "success" | "warn" | "error",
  message: string,
  _id?: number | null,
): void {
  setStatusMessage({ level, text: message });
  arm(MESSAGE_MS);
}

/**
 * Zamanlayıcıyı duraklatır — fare bildirimin üzerindeyken metnin
 * okunabilir kalması için (Toast `onPointerEnter` çağırır).
 */
export function holdFeedback(): void {
  if (!held && timer !== undefined) {
    held = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }
}

/**
 * Duraklatmayı bırakır ve **kalan** süreyle devam eder (Toast
 * `onPointerLeave`). Böylece uzun süre üzerinde durmak mesajı
 * ömürsüzleştirmez.
 */
export function releaseFeedback(): void {
  if (!held) return;
  held = false;
  const elapsed = Date.now() - started_at;
  const remaining = MESSAGE_MS - elapsed;
  if (remaining <= 0) {
    setStatusMessage(null);
  } else {
    arm(remaining);
  }
}
