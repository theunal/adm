/**
 * İndirme listesi — sekmeye göre kayıtları gösterir.
 */
import { For, Show, createMemo } from "solid-js";
import { clearFinished } from "../lib/api";
import {
  activeTab,
  failedItems,
  historyCount,
  visibleItems,
} from "../lib/store";
import { errorText, pushLogSafe } from "../lib/useFeedback";
import { formatBytes, formatNumber } from "../lib/format";
import DownloadCard from "./DownloadCard";

export default function DownloadList() {
  const items = () => visibleItems();
  /** Aktif sekmede miyiz? Boş durumda da doğru başlık gösterilsin. */
  const isActiveTab = () => activeTab() === "active";

  /** Başarısız kayıtların toplam indirilen miktarı. */
  const failedBytes = createMemo(() =>
    failedItems().reduce((sum, i) => sum + i.downloadedBytes, 0),
  );

  /** Geçmiş sekmesinde temizleme düğmesi gösterilir mi? */
  const canClear = () => historyCount() > 0;

  async function onClear() {
    try {
      await clearFinished();
    } catch (e) {
      pushLogSafe("error", `Kayıtlar temizlenemedi: ${errorText(e)}`);
    }
  }

  return (
    <div class="download-list">
      <div class="list-head">
        <h2 class="section-title">
          {isActiveTab() ? "Aktif İndirmeler" : "Geçmiş"}
          <span class="count-pill">{items().length}</span>
        </h2>

        <Show when={failedBytes() > 0}>
          <span class="failed-hint" title="Başarısız kayıtların indirdiği miktar">
            {formatNumber(failedItems().length)} başarısız •{" "}
            {formatBytes(failedBytes())} yarım
          </span>
        </Show>

        <Show when={canClear()}>
          <button
            type="button"
            class="btn btn-xs btn-ghost"
            onClick={() => void onClear()}
            title="Tamamlanmış, başarısız ve iptal edilmiş kayıtları sil"
          >
            Geçmişi temizle
          </button>
        </Show>
      </div>

      <div class="list-body">
        <Show
          when={items().length > 0}
          fallback={
            <div class="empty-state">
              <span class="empty-icon" aria-hidden="true">
                ↓
              </span>
              <p class="empty-title">
                {isActiveTab() ? "Aktif indirme yok" : "Geçmiş boş"}
              </p>
              <p class="empty-hint">
                {isActiveTab()
                  ? "Soldaki formu doldurup yeni bir indirme başlatın."
                  : "Tamamlanan indirmeler burada listelenir."}
              </p>
            </div>
          }
        >
          <For each={items()}>
            {(item) => <DownloadCard item={item} live={isActiveTab()} />}
          </For>
        </Show>
      </div>
    </div>
  );
}