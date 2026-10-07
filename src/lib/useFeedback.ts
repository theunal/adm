/**
 * Geri bildirim yardımcıları — log satırı ekleme ve hata metinleştirme.
 *
 * `store.ts` bu fonksiyonları dışa aktarır; ayrı bir dosyada tutulmasının
 * nedeni döngüsel bağımlılığı önlemek: bileşenler `store`'u doğrudan
 * değiştirmeden yalnızca bu katmanı kullanır.
 */
import { appendLog, errorText, markBusy } from "./store";
import type { LogEntry } from "./format";

export { errorText, markBusy };

/**
 * Log satırı ekler.
 *
 * Rust tarafından gelen log satırlarıyla aynı listeye yazılır, böylece
 * kullanıcı hem uygulama hem de komut kaynaklı mesajları tek yerden görür.
 */
export function pushLogSafe(
  level: LogEntry["level"],
  message: string,
  id: number | null = null,
) {
  appendLog(level, message, id);
}