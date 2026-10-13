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
  closeDetailWindow,
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

/**
 * Çalışan tüm indirmeleri duraklatır.
 *
 * Dönen sayı kullanıcıya gösterilir; 0 ise "durdurulacak çalışan indirme
 * yok" bilgisi verilir, aksi halde düğmeye basıldığında hiçbir iz kalmaz.
 */
export async function bulkPause(): Promise<void> {
  try {
    const count = await pauseAllDownloads();
    pushFeedback(
      count > 0 ? "success" : "info",
      t(count > 0 ? "bulk.done.paused" : "bulk.none.paused", { count }),
    );
  } catch (e) {
    pushFeedback("error", t("act.failed", { action: t("act.pause"), error: errorText(e) }));
  }
}

/** Sürdürülebilir tüm indirmeleri sürdürür. */
export async function bulkResume(): Promise<void> {
  try {
    const count = await resumeAllDownloads();
    pushFeedback(
      count > 0 ? "success" : "info",
      t(count > 0 ? "bulk.done.resumed" : "bulk.none.resumed", { count }),
    );
  } catch (e) {
    pushFeedback("error", t("act.failed", { action: t("act.resume"), error: errorText(e) }));
  }
}

/** Çalışan tüm indirmeleri iptal eder. */
export async function bulkCancel(): Promise<void> {
  try {
    const count = await cancelAllDownloads();
    pushFeedback(
      count > 0 ? "success" : "info",
      t(count > 0 ? "bulk.done.cancelled" : "bulk.none.cancelled", { count }),
    );
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
      await closeDetailWindow(item.id);
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
  const ok = await runOne(item.id, label, async () => {
    await deleteDownload(item.id, deleteFile);
  });
  // Kayıt gittiyse açık popup'un da gitmesi gerekir; aksi halde "kayıt yok"
  // diye boş bir pencere ekranda kalır.
  if (ok) await closeDetailWindow(item.id).catch(() => undefined);
}

/** Seçili kayıtları siler (araç çubuğu kısayolu). */
export function deleteSelected(deleteFile: boolean): Promise<void> {
  return bulkDelete(selectedItems(), deleteFile);
}