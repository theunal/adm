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
import { t } from "../lib/i18n";
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
      pushLogSafe("error", t("list.err.clear", { error: errorText(e) }));
    }
  }

  return (
    <div class="download-list">
      <div class="list-head">
        <h2 class="section-title">
          {isActiveTab() ? t("list.title.active") : t("list.title.history")}
          <span class="count-pill">{items().length}</span>
        </h2>

        <Show when={failedBytes() > 0}>
          <span class="failed-hint" title={t("list.failed_hint_title")}>
            {t("list.failed_hint", {
              count: formatNumber(failedItems().length),
              bytes: formatBytes(failedBytes()),
            })}
          </span>
        </Show>

        <Show when={canClear()}>
          <button
            type="button"
            class="btn btn-xs btn-ghost"
            onClick={() => void onClear()}
            title={t("list.clear_title")}
          >
            {t("list.clear")}
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
                {isActiveTab()
                  ? t("list.empty.active_title")
                  : t("list.empty.history_title")}
              </p>
              <p class="empty-hint">
                {isActiveTab()
                  ? t("list.empty.active_hint")
                  : t("list.empty.history_hint")}
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