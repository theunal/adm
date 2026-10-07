/**
 * Tauri köprüsü — komut çağrıları ve olay aboneliği.
 *
 * Hata mesajları Rust tarafında `i18n.rs` sözlüğünden seçili dilde üretilir;
 * burada yalnızca taşınır. Diyalog başlıkları arayüzde üretildiği için
 * `lib/i18n` sözlüğünden gelir.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { DownloadEvent, DownloadItem } from "./format";
import { t } from "./i18n";

/** Tauri olayının adı. */
export const DOWNLOAD_EVENT = "download://event";

/** Yeni indirme başlatır. */
export function startDownload(args: {
  url: string;
  filePath?: string | null;
  channelCount: number;
}): Promise<number> {
  return invoke<number>("start_download", args);
}

/** İndirmeyi duraklatır. */
export function pauseDownload(id: number): Promise<void> {
  return invoke<void>("pause_download", { id });
}

/** Duraklatılmış indirmeyi kanal bazlı sürdürür. */
export function resumeDownload(id: number): Promise<void> {
  return invoke<void>("resume_download", { id });
}

/** İndirmeyi iptal eder. */
export function cancelDownload(id: number): Promise<void> {
  return invoke<void>("cancel_download", { id });
}

/** Kaydı (ve istenirse dosyayı) siler. */
export function deleteDownload(
  id: number,
  deleteFile: boolean,
): Promise<void> {
  return invoke<void>("delete_download", { id, deleteFile });
}

/** Tamamlanmış / iptal edilmiş kayıtları temizler. */
export function clearFinished(): Promise<void> {
  return invoke<void>("clear_finished");
}

/** Bir indirmenin kanal sayısını değiştirir. */
export function changeChannelCount(
  id: number,
  count: number,
): Promise<void> {
  return invoke<void>("change_channel_count", { id, count });
}

/** Tüm kayıtları (geçmiş dahil) getirir. */
export function listDownloads(): Promise<DownloadItem[]> {
  return invoke<DownloadItem[]>("list_downloads");
}

/** Yalnızca aktif ve duraklatılmış indirmeleri getirir. */
export function listActiveDownloads(): Promise<DownloadItem[]> {
  return invoke<DownloadItem[]>("list_active_downloads");
}

/** Tek bir kaydı getirir. */
export function getDownload(id: number): Promise<DownloadItem | null> {
  return invoke<DownloadItem | null>("get_download", { id });
}

/** URL'den önerilen dosya adı. */
export function suggestFileName(url: string): Promise<string> {
  return invoke<string>("suggest_file_name", { url });
}

/** Varsayılan indirme klasörü. */
export function defaultDownloadDir(): Promise<string> {
  return invoke<string>("default_download_dir");
}

/** Veritabanı dosyasının yolu. */
export function databasePath(): Promise<string> {
  return invoke<string>("database_path");
}

/** Dosyayı sistemde açar. */
export function openPath(path: string): Promise<void> {
  return invoke<void>("open_path", { path });
}

/** Dosyanın bulunduğu klasörü açar. */
export function openFolder(path: string): Promise<void> {
  return invoke<void>("open_folder", { path });
}

/** Pencereyi küçültür. */
export function minimizeWindow(): Promise<void> {
  return invoke<void>("minimize_window");
}

/** Pencereyi büyütür / küçültür. */
export function toggleMaximizeWindow(): Promise<void> {
  return invoke<void>("toggle_maximize_window");
}

/** Pencereyi kapatır. */
export function closeWindow(): Promise<void> {
  return invoke<void>("close_window");
}

/** Manager olaylarına abone olur; iptal fonksiyonu döner. */
export function onDownloadEvent(
  handler: (event: DownloadEvent) => void,
): Promise<UnlistenFn> {
  return listen<DownloadEvent>(DOWNLOAD_EVENT, (e) => handler(e.payload));
}

/**
 * Dosya kaydetme diyaloğunu açar.
 *
 * Rust tarafındaki `dialog:allow-save` yetkisi sayesinde çalışır.
 */
export async function pickSavePath(
  suggestedName: string,
  defaultDir: string,
): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const picked = await save({
    defaultPath: `${defaultDir}\\${suggestedName}`,
    title: t("dialog.save_title"),
  });
  return typeof picked === "string" ? picked : null;
}

/** Kullanıcıya onay diyaloğu gösterir. */
export async function confirm(
  message: string,
  title = t("dialog.confirm_title"),
): Promise<boolean> {
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(message, { title, kind: "warning" });
}