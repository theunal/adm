/**
 * İndirme özellikleri penceresi — satır bağlam menüsünden açılır.
 *
 * IDM'de `Properties…` tek bir "Özellikler" iletişim kutusu açar. Burada
 * yalnızca **salt okunur** bilgiler gösterilir; kanal sayısı gibi ayarlanabilir
 * alanlar tablodaki "Kanallar" düğmesinde kalır (böylece iki düzenleme yüzeyi
 * oluşmaz).
 */
import { Show, createMemo } from "solid-js";
import { propertiesItem, setPropertiesItem } from "../lib/ui";
import {
  formatBytes,
  formatDateTime,
  statusLabel,
} from "../lib/format";
import { t } from "../lib/i18n";

export default function PropertiesDialog() {
  const item = createMemo(() => propertiesItem());

  return (
    <Show when={item()}>
      {(row) => (
        <div
          class="modal-backdrop"
          onClick={() => setPropertiesItem(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setPropertiesItem(null);
          }}
        >
          <div
            class="modal modal-wide"
            role="dialog"
            aria-modal="true"
            aria-label={t("props.title")}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="modal-title">
              <span class="modal-title-text">{t("props.title")}</span>
              <button
                type="button"
                class="dock-close"
                aria-label={t("title.win.close")}
                onClick={() => setPropertiesItem(null)}
              >
                ✕
              </button>
            </div>

            <div class="modal-body">
              <div class="modal-name" title={row().fileName}>
                {row().fileName}
              </div>
              <span class="modal-path">{row().filePath}</span>

              <div class="modal-meta">
                <span class="modal-meta-key">{t("props.url")}</span>
                <span class="modal-meta-value props-url">{row().url}</span>

                <span class="modal-meta-key">{t("props.size")}</span>
                <span class="modal-meta-value">
                  {row().totalBytes > 0
                    ? `${formatBytes(row().downloadedBytes)} / ${formatBytes(row().totalBytes)}`
                    : formatBytes(row().downloadedBytes)}
                </span>

                <span class="modal-meta-key">{t("props.status")}</span>
                <span class="modal-meta-value">
                  {statusLabel(row().status)}
                </span>

                <span class="modal-meta-key">{t("props.channels")}</span>
                <span class="modal-meta-value">{row().channelCount}</span>

                <span class="modal-meta-key">{t("props.created")}</span>
                <span class="modal-meta-value">{formatDateTime(row().createdAt)}</span>

                <span class="modal-meta-key">{t("props.finished")}</span>
                <span class="modal-meta-value">{formatDateTime(row().completedAt)}</span>
              </div>
            </div>

            <div class="modal-actions">
              <button
                type="button"
                class="btn btn-primary"
                onClick={() => setPropertiesItem(null)}
              >
                {t("props.close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}