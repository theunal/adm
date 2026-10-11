/**
 * Geri bildirim yardımcıları — geçici mesaj gösterme ve hata metinleştirme.
 *
 * `store.ts` bu fonksiyonları dışa aktarır; ayrı bir dosyada tutulmasının
 * nedeni döngüsel bağımlılığı önlemek: bileşenler `store`'u doğrudan
 * değiştirmeden yalnızca bu katmanı kullanır.
 *
 * Log paneli kaldırıldı; mesajlar artık durum çubuğunda birkaç saniye
 * görünür. Bu yüzden `pushFeedback` **sessizce yutmaz**: çağıran bileşen
 * ekranda hiçbir iz görse bile mesaj en az bir kez basılır.
 */
import { errorText, markBusy } from "./store";
import { setStatusMessage } from "./ui";

export { errorText, markBusy };

/** Mesajın ekranda kalacağı süre (ms). */
const MESSAGE_MS = 4000;

/** Yeniden mesaj basılırsa eski zamanlayıcının iptali için. */
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Durum çubuğunda geçici mesaj gösterir.
 *
 * Previous timer is cancelled; rapid successive messages don't get cleared
 * early.
 *
 * `id` is optional — it is accepted for backwards compatibility with
 * callers that pass it but is currently unused (the status bar shows the
 * message text only, not a download id).
 */
export function pushFeedback(
  level: "info" | "success" | "warn" | "error",
  message: string,
  _id?: number | null,
): void {
  setStatusMessage({ level, text: message });
  if (timer !== undefined) clearTimeout(timer);
  timer = setTimeout(() => {
    setStatusMessage(null);
    timer = undefined;
  }, MESSAGE_MS);
}