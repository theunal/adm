/**
 * İndirme tablosu — IDM'in ana grid listview'i.
 *
 * Sabit ızgaralı bir `<div>` tablosu: satır sayısı az olduğundan yarım bin
 * satırlık ölçek performansı gerekmiyor, ayrıca `<table>` ile klavye gezinme
 * ve ekran okuyucu başlık ilişkileri için ek iş gerekir. Sütun genişlikleri
 * `styles.css` içindeki `.dlg-head` / `.dlg-row` ızgarasında tanımlıdır; iki
 * sınıf aynı `grid-template-columns` değerini paylaşır.
 *
 * Satır kaynağı `store.visibleItems()`'tır; kenar çubuğundaki görev ya da
 * kategori filtresini yansıtır.
 */
import { For, Show, createMemo } from "solid-js";
import { clearFinished } from "../lib/api";
import {
  failedItems,
  ready,
  taskCounts,
  visibleItems,
} from "../lib/store";
import { errorText, pushLogSafe } from "../lib/useFeedback";
import { formatBytes, formatNumber } from "../lib/format";
import { t } from "../lib/i18n";
import DownloadRow from "./DownloadRow";

export default function DownloadTable() {
  const items = createMemo(() => visibleItems());
  const counts = createMemo(() => taskCounts());

  /** Başarısız kayıtların toplam indirilen miktarı (başlık çubuğu ipucu). */
  const failedBytes = createMemo(() =>
    failedItems().reduce((sum, i) => sum + i.downloadedBytes, 0),
  );

  /** Listede temizlenecek kayıt var mı? */
  const canClear = () => counts().completed + counts().failed + counts().cancelled > 0;

  async function onClear() {
    try {
      await clearFinished();
    } catch (e) {
      pushLogSafe("error", t("list.err.clear", { error: errorText(e) }));
    }
  }

  return (
    <div class="table-wrap">
      {/* Sütun başlıkları */}
      <div class="dlg-head" role="row">
        <div class="dlg-head-cell dlg-head-cell-center" title={t("col.idx")}>
          {t("col.idx")}
        </div>
        <div class="dlg-head-cell">{t("col.name")}</div>
        <div class="dlg-head-cell dlg-head-cell-right">{t("col.size")}</div>
        <div class="dlg-head-cell">{t("col.progress")}</div>
        <div class="dlg-head-cell dlg-head-cell-right">{t("col.speed")}</div>
        <div class="dlg-head-cell dlg-head-cell-right dlg-col-eta">
          {t("col.eta")}
        </div>
        <div class="dlg-head-cell dlg-head-cell-center dlg-col-ch">
          {t("col.channels")}
        </div>
        <div class="dlg-head-cell">{t("col.status")}</div>
        <div class="dlg-head-cell dlg-head-cell-right">{t("col.actions")}</div>
      </div>

      {/* Gövde */}
      <div
        class="dlg-body"
        role="rowgroup"
        aria-label={t("row.aria")}
        tabindex={0}
      >
        <Show
          when={ready()}
          fallback={
            <div class="loading-state">
              <span class="spinner" aria-hidden="true" />
              <p>{t("app.loading")}</p>
            </div>
          }
        >
          <Show
            when={items().length > 0}
            fallback={
              <div class="empty-state">
                <span class="empty-icon" aria-hidden="true">
                  ↓
                </span>
                <p class="empty-title">{t("list.empty_title")}</p>
                <p class="empty-hint">{t("list.empty_hint")}</p>
              </div>
            }
          >
            <For each={items()}>
              {(item, index) => <DownloadRow item={item} index={index()} />}
            </For>
          </Show>
        </Show>
      </div>

      {/* Alt bilgi çubuğu: başarısız uyarısı + temizle */}
      <Show when={failedBytes() > 0}>
        <div class="table-foot" title={t("list.failed_hint_title")}>
          {t("list.failed_hint", {
            count: formatNumber(counts().failed),
            bytes: formatBytes(failedBytes()),
          })}
        </div>
      </Show>

      <Show when={canClear()}>
        <div class="table-clear">
          <button
            type="button"
            class="btn"
            title={t("list.clear_title")}
            onClick={() => void onClear()}
          >
            {t("list.clear")}
          </button>
        </div>
      </Show>
    </div>
  );
}