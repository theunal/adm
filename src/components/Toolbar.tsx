/**
 * Araç çubuğu.
 *
 * Soldaki büyük yeşil düğme IDM'in "Add URL" düğmesidir ve tek doğrudan
 * indirme başlatma girişidir: basıldığında kenar çubuğundaki URL alanına
 * odaklanır (form doldurulup gönderilir).
 *
 * Ortadaki üç düğme **tüm listeye** uygulanır (tek Rust komutu): duraklat,
 * sürdür, iptal. Sağdaki sil düğmesi yalnızca seçili satırlarda etkindir.
 */
import { Show, createMemo } from "solid-js";
import { confirm } from "../lib/api";
import { bulkCancel, bulkPause, bulkResume, bulkDelete } from "../lib/bulk";
import { hasSelection, selectedItems, taskCounts, totals } from "../lib/store";
import { errorText, pushLogSafe } from "../lib/useFeedback";
import {
  focusUrlInput,
  graphOpen,
  logOpen,
  setGraphOpen,
  setLogOpen,
} from "../lib/ui";
import { t } from "../lib/i18n";

export default function Toolbar() {
  const stats = createMemo(() => totals());

  /** Çalışan indirme var mı? (duraklat / iptal düğmelerini canlandırır) */
  const hasRunning = () => stats().activeCount > 0;

  /** Sürdürülebilir indirme var mı? (duraklatılan + başarısız + iptal) */
  const hasResumable = () => {
    const c = taskCounts();
    return c.paused + c.failed + c.cancelled > 0;
  };

  /** Seçili satır sayısı (sil düğmesi + sayaç etiketi). */
  const selectedCount = () => selectedItems().length;

  /** Seçili kayıtları onaylayarak siler. */
  async function onDelete() {
    const items = selectedItems();
    if (items.length === 0) return;

    const ok = await confirm(
      t("dialog.bulk_delete.body", { count: items.length }),
      t("dialog.bulk_delete.title"),
    );
    if (!ok) return;

    try {
      await bulkDelete(items, true);
    } catch (e) {
      pushLogSafe("error", t("act.failed", { action: t("act.delete"), error: errorText(e) }));
    }
  }

  return (
    <div class="toolbar" role="toolbar" aria-label={t("side.tasks")}>
      <button
        type="button"
        class="tb-btn-primary"
        title={t("tb.add_title")}
        onClick={() => focusUrlInput()}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path
            d="M8 2.5 L8 9.5 M8 9.5 L3.6 13.5 M8 9.5 L12.4 13.5 M3.6 13.5 L3.6 3.5 M3.6 3.5 L12.4 3.5 M12.4 3.5 L12.4 13.5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          />
        </svg>
        {t("tb.add")}
      </button>

      <span class="toolbar-sep" role="separator" />

      {/* Toplu indirme denetimi — tüm liste */}
      <div class="toolbar-group">
        <button
          type="button"
          class="tb-btn"
          title={t("tb.pause_all_title")}
          disabled={!hasRunning()}
          onClick={() => void bulkPause()}
        >
          <svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">
            <rect x="3" y="2.5" width="3" height="9" fill="currentColor" />
            <rect x="8" y="2.5" width="3" height="9" fill="currentColor" />
          </svg>
          {t("tb.pause_all")}
        </button>

        <button
          type="button"
          class="tb-btn"
          title={t("tb.resume_all_title")}
          disabled={!hasResumable()}
          onClick={() => void bulkResume()}
        >
          <svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">
            <path d="M4 2.5 L11 7 L4 11.5 Z" fill="currentColor" />
          </svg>
          {t("tb.resume_all")}
        </button>

        <button
          type="button"
          class="tb-btn tb-btn-danger"
          title={t("tb.cancel_all_title")}
          disabled={!hasRunning()}
          onClick={() => void bulkCancel()}
        >
          <svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">
            <rect x="3" y="3" width="8" height="8" fill="currentColor" />
          </svg>
          {t("tb.cancel_all")}
        </button>
      </div>

      <span class="toolbar-sep" role="separator" />

      {/* Seçime bağlı eylem */}
      <div class="toolbar-group">
        <button
          type="button"
          class="tb-btn tb-btn-danger"
          title={t("tb.delete_title")}
          disabled={!hasSelection()}
          onClick={() => void onDelete()}
        >
          <svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">
            <path
              d="M2.5 3.5 H11.5 M5.5 3.5 V2 H8.5 V3.5 M4 3.5 L4.6 12 H9.4 L10 3.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
            />
          </svg>
          {t("tb.delete")}
        </button>
      </div>

      <Show when={selectedCount() > 0}>
        <span
          class="tb-selection"
          title={t("row.selected", { count: selectedCount() })}
        >
          {selectedCount()} {t("tb.selection")}
        </span>
      </Show>

      <span class="toolbar-spacer" />

      {/* Panel açık/kapay düğmeleri */}
      <div class="toolbar-group">
        <button
          type="button"
          class={`tb-btn tb-btn-icon ${graphOpen() ? "tb-btn-toggled" : ""}`}
          title={t("tb.graph_title")}
          aria-pressed={graphOpen()}
          onClick={() => setGraphOpen(!graphOpen())}
        >
          <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
            <path
              d="M1.5 11.5 L4.5 6 L7 8.5 L9.5 3.5 L12.5 11.5 Z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linejoin="round"
            />
          </svg>
        </button>

        <button
          type="button"
          class={`tb-btn tb-btn-icon ${logOpen() ? "tb-btn-toggled" : ""}`}
          title={t("tb.log_title")}
          aria-pressed={logOpen()}
          onClick={() => setLogOpen(!logOpen())}
        >
          <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
            <path
              d="M2 2.5 H12 V11.5 H2 Z M4.5 5 H9.5 M4.5 7.5 H9.5 M4.5 10 H7"
              fill="none"
              stroke="currentColor"
              stroke-width="1.2"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}