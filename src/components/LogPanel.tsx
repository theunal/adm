/**
 * Olay günlüğü — uygulama ve komut kaynaklı tüm mesajları zaman damgalı
 * biçimde listeler.
 *
 * Yeni mesaj geldiğinde otomatik kaydırılır; kullanıcı yukarı kaydırırsa
 * otomatik kaydırma durur (okunmamış mesajların gözden geçmesini önler).
 *
 * Panel başlığı alt dock'tadır (`BottomDock`), bu yüzden burada yalnızca liste
 * çizilir.
 */
import { For, Show, createEffect, createSignal } from "solid-js";
import { clearLogs, logs } from "../lib/store";
import { t } from "../lib/i18n";

export default function LogPanel() {
  const [autoScroll, setAutoScroll] = createSignal(true);
  let scroller: HTMLDivElement | undefined;
  let bottom: HTMLDivElement | undefined;

  /** Yeni mesaj geldiğinde en alta kaydır (kullanıcı takip ediyorsa). */
  createEffect(() => {
    // `logs.entries` dizisine bağlan: her değişimde efekt yeniden çalışır.
    logs.entries.length;
    if (autoScroll() && bottom) {
      bottom.scrollIntoView({ block: "end" });
    }
  });

  /** Kullanıcı kaydırdığında otomatik takibi güncelle. */
  function onScroll() {
    if (!scroller) return;
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    setAutoScroll(distance < 24);
  }

  const empty = () => logs.entries.length === 0;

  return (
    <div class="log-panel-inner">
      <div class="log-toolbar">
        <Show when={!autoScroll()}>
          <button
            type="button"
            class="btn"
            onClick={() => {
              setAutoScroll(true);
              bottom?.scrollIntoView({ block: "end" });
            }}
          >
            {t("log.to_bottom")}
          </button>
        </Show>

        <span class="log-count">{logs.entries.length}</span>

        <button
          type="button"
          class="btn"
          onClick={() => clearLogs()}
          disabled={empty()}
        >
          {t("log.clear")}
        </button>
      </div>

      <div class="log-list" ref={scroller} onScroll={onScroll} aria-label={t("log.aria")}>
        <Show
          when={!empty()}
          fallback={<p class="log-empty">{t("log.empty")}</p>}
        >
          <For each={logs.entries}>
            {(entry) => (
              <div class={`log-row log-${entry.level}`}>
                <span class="log-time">{entry.time}</span>
                <span class="log-message">{entry.message}</span>
              </div>
            )}
          </For>
        </Show>
        <div ref={bottom} />
      </div>
    </div>
  );
}