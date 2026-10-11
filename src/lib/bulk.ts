/**
 * Toplu işlemler — araç çubuğu ve menü çubuğu eylemleri.
 *
 * İki yol vardır:
 *
 * * **Tüm liste** (Duraklat / Sürdür / İptal) tek bir Rust komutuyla yapılır:
 *   `pause_all_downloads` ve kardeşleri. Tek IPC mesajı, sunucu tarafında
 *   filtrelenir; arayüz binlerce satır için döngü kurmaz.
 * * **Seçili satırlar** (Sil) arayüzde tek tek çağrılır: Rust tarafında
 *   toplu silme komutu yoktur ve her kayıt için ayrı onay akışı gerekir.
 *
 * Başarı özeti Rust tarafında zaten log'a yazılır; burada yalnızca hatalar
 * arayüzden eklenir (böylece aynı mesaj iki kez görünmez).
 */
import {
  cancelAllDownloads,
  cancelDownload,
  deleteDownload,
  pauseAllDownloads,
  pauseDownload,
  resumeAllDownloads,
  resumeDownload,
} from "./api";
import { errorText, markBusy, pushFeedback } from "./useFeedback";
import { selectedItems } from "./store";
import { t } from "./i18n";
import type { DownloadItem } from "./format";

/** Tek bir kayda işlem uygular; hata durumunda log'a yazar. */
async function runOne(
  id: number,
  label: string,
  action: () => Promise<void>,
): Promise<boolean> {
  markBusy(id, true);
  try {
    await action();
    return true;
  } catch (e) {
    pushFeedback("error", t("act.failed", { action: label, error: errorText(e) }), id);
    return false;
  } finally {
    markBusy(id, false);
  }
}

/** Çalışan tüm indirmeleri duraklatır. */
export async function bulkPause(): Promise<void> {
  try {
    await pauseAllDownloads();
  } catch (e) {
    pushFeedback("error", t("act.failed", { action: t("act.pause"), error: errorText(e) }));
  }
}

/** Sürdürülebilir tüm indirmeleri sürdürür. */
export async function bulkResume(): Promise<void> {
  try {
    await resumeAllDownloads();
  } catch (e) {
    pushFeedback("error", t("act.failed", { action: t("act.resume"), error: errorText(e) }));
  }
}

/** Çalışan tüm indirmeleri iptal eder. */
export async function bulkCancel(): Promise<void> {
  try {
    await cancelAllDownloads();
  } catch (e) {
    pushFeedback("error", t("act.failed", { action: t("act.cancel"), error: errorText(e) }));
  }
}

/**
 * Seçili kayıtları siler.
 *
 * `deleteFile` doğruysa indirilen dosya da kaldırılır. Silinen kayıtların
 * Rust tarafındaki log satırları gürültü yaratabileceği için sonuç tek bir
 * özet satırı olarak da yazılır.
 */
export async function bulkDelete(
  items: DownloadItem[],
  deleteFile: boolean,
): Promise<void> {
  if (items.length === 0) return;

  const label = deleteFile ? t("act.delete") : t("act.delete_record");
  let removed = 0;

  for (const item of items) {
    const ok = await runOne(item.id, label, async () => {
      await deleteDownload(item.id, deleteFile);
    });
    if (ok) removed += 1;
  }

  if (removed > 1) {
    pushFeedback("info", t("bulk.deleted", { count: removed }), null);
  }
}

/** Seçili kaydı duraklatır (bağlam menüsü / satır düğmesi). */
export async function pauseItem(item: DownloadItem): Promise<void> {
  await runOne(item.id, t("act.pause"), async () => {
    await pauseDownload(item.id);
  });
}

/** Seçili kaydı sürdürür. */
export async function resumeItem(item: DownloadItem): Promise<void> {
  await runOne(item.id, t("act.resume"), async () => {
    await resumeDownload(item.id);
  });
}

/** Seçili kaydı iptal eder. */
export async function cancelItem(item: DownloadItem): Promise<void> {
  await runOne(item.id, t("act.cancel"), async () => {
    await cancelDownload(item.id);
  });
}

/** Seçili kaydı siler (dosya korunur / silinir). */
export async function deleteItem(
  item: DownloadItem,
  deleteFile: boolean,
): Promise<void> {
  const label = deleteFile ? t("act.delete") : t("act.delete_record");
  await runOne(item.id, label, async () => {
    await deleteDownload(item.id, deleteFile);
  });
}

/** Seçili kayıtları siler (araç çubuğu kısayolu). */
export function deleteSelected(deleteFile: boolean): Promise<void> {
  return bulkDelete(selectedItems(), deleteFile);
}