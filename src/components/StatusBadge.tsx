/**
 * Durum rozeti — durumun Türkçe etiketini renkli bir etiket olarak gösterir.
 */
import { statusClass, statusLabel, type DownloadStatus } from "../lib/format";

interface Props {
  status: DownloadStatus;
  /** Küçük boy (geçmiş listesinde). */
  compact?: boolean;
}

export default function StatusBadge(props: Props) {
  return (
    <span
      class={`badge ${statusClass(props.status)} ${props.compact ? "badge-compact" : ""}`}
      title={statusLabel(props.status)}
    >
      <span class="badge-dot" aria-hidden="true" />
      {statusLabel(props.status)}
    </span>
  );
}