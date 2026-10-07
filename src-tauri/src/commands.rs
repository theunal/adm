//! Tauri komutları — SolidJS arayüzünün çağırdığı tüm API.
//!
//! Tüm mesajlar Türkçedir; durum enum'ları veritabanında İngilizce kalır
//! ve arayüzde `src/lib/format.ts` içindeki çeviri katmanıyla gösterilir.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::db_path;
use crate::manager::{DownloadManager, StartRequest};
use crate::models::{DownloadItem, file_name_from_url};

type Res<T> = Result<T, String>;

/// `anyhow` hatasını Türkçe, kullanıcıya gösterilebilir mesaja çevirir.
///
/// `anyhow::Error` `std::error::Error` implementasyonu taşımadığı için
/// bağlam zinciri elle gezilir.
fn tr(e: anyhow::Error) -> String {
    let mut parts: Vec<String> = Vec::new();
    for cause in e.chain() {
        let text = cause.to_string();
        if !text.is_empty() {
            parts.push(text);
        }
    }
    if parts.is_empty() {
        "Bilinmeyen bir hata oluştu".to_string()
    } else {
        parts.join(" — ")
    }
}

/// Yeni indirme başlatır.
///
/// * `url` — indirilecek adres
/// * `file_path` — hedef dosya (boşse İndirilenler klasörüne yazılır)
/// * `channel_count` — eşzamanlı kanal sayısı (1..=32)
#[tauri::command]
pub async fn start_download(
    manager: State<'_, DownloadManager>,
    url: String,
    file_path: Option<String>,
    channel_count: u32,
) -> Res<i64> {
    manager
        .start(StartRequest {
            url,
            file_path,
            channel_count,
        })
        .await
        .map_err(tr)
}

#[tauri::command]
pub async fn pause_download(manager: State<'_, DownloadManager>, id: i64) -> Res<()> {
    manager.pause(id).await.map_err(tr)
}

#[tauri::command]
pub async fn resume_download(manager: State<'_, DownloadManager>, id: i64) -> Res<()> {
    manager.resume(id).await.map_err(tr)
}

#[tauri::command]
pub async fn cancel_download(manager: State<'_, DownloadManager>, id: i64) -> Res<()> {
    manager.cancel(id).await.map_err(tr)
}

/// Kaydı siler; `delete_file` doğruysa diskteki dosyayı da kaldırır.
#[tauri::command]
pub async fn delete_download(
    manager: State<'_, DownloadManager>,
    id: i64,
    delete_file: Option<bool>,
) -> Res<()> {
    manager
        .delete(id, delete_file.unwrap_or(true))
        .await
        .map_err(tr)
}

/// Tamamlanmış / iptal edilmiş kayıtları temizler.
#[tauri::command]
pub async fn clear_finished(manager: State<'_, DownloadManager>) -> Res<()> {
    manager.clear_finished().await.map_err(tr)
}

/// Bir indirmenin kanal sayısını değiştirir.
#[tauri::command]
pub async fn change_channel_count(
    manager: State<'_, DownloadManager>,
    id: i64,
    count: u32,
) -> Res<()> {
    manager.change_channel_count(id, count).await.map_err(tr)
}

/// Tüm indirme kayıtları (geçmiş dahil).
#[tauri::command]
pub async fn list_downloads(manager: State<'_, DownloadManager>) -> Res<Vec<DownloadItem>> {
    manager.list_all().await.map_err(tr)
}

/// Yalnızca aktif ve duraklatılmış indirmeler.
#[tauri::command]
pub async fn list_active_downloads(manager: State<'_, DownloadManager>) -> Res<Vec<DownloadItem>> {
    manager.list_active().await.map_err(tr)
}

#[tauri::command]
pub async fn get_download(
    manager: State<'_, DownloadManager>,
    id: i64,
) -> Res<Option<DownloadItem>> {
    manager.get(id).await.map_err(tr)
}

/// URL'den önerilen dosya adını türetir (arayüzde önizleme için).
#[tauri::command]
pub fn suggest_file_name(url: String) -> Res<String> {
    Ok(file_name_from_url(&url))
}

/// Varsayılan indirme klasörü.
#[tauri::command]
pub fn default_download_dir() -> Res<String> {
    Ok(crate::manager::default_download_dir()
        .to_string_lossy()
        .to_string())
}

/// Veritabanı dosyasının konumu (tanı / hata ayıklama için).
#[tauri::command]
pub fn database_path() -> Res<String> {
    Ok(db_path().to_string_lossy().to_string())
}

/// Pencere referansını alır.
fn main_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Ana pencere bulunamadı".to_string())
}

/// Dosyayı sistemde açar (varsayılan uygulamayla).
#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Res<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| format!("Dosya açılamadı: {e}"))
}

/// Dosyanın bulunduğu klasörü açar (dosya adı verilmeden de çalışır).
#[tauri::command]
pub fn open_folder(app: AppHandle, path: String) -> Res<()> {
    use tauri_plugin_opener::OpenerExt;
    let folder = std::path::Path::new(&path)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from(&path));

    app.opener()
        .open_path(folder.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("Klasör açılamadı: {e}"))
}

/// Uygulama penceresini simge durumuna küçültür.
#[tauri::command]
pub fn minimize_window(app: AppHandle) -> Res<()> {
    main_window(&app)?
        .minimize()
        .map_err(|e| format!("Pencere küçültülemedi: {e}"))
}

/// Pencereyi büyütür / küçültür.
#[tauri::command]
pub fn toggle_maximize_window(app: AppHandle) -> Res<()> {
    let window = main_window(&app)?;
    let is_max = window
        .is_maximized()
        .map_err(|e| format!("Pencere durumu okunamadı: {e}"))?;

    if is_max {
        window
            .unmaximize()
            .map_err(|e| format!("Pencere küçültülemedi: {e}"))
    } else {
        window
            .maximize()
            .map_err(|e| format!("Pencere büyütülemedi: {e}"))
    }
}

/// Pencereyi kapatır (uygulama kapanışını tetikler).
#[tauri::command]
pub fn close_window(app: AppHandle) -> Res<()> {
    main_window(&app)?
        .close()
        .map_err(|e| format!("Pencere kapatılamadı: {e}"))
}

/// Manager olaylarını Tauri olay kanalına aktarır.
///
/// `tokio::sync::broadcast` ile alınan olaylar, arayüzün dinlediği
/// `download://event` olayına yeniden yayınlanır.
pub fn forward_events(
    app: AppHandle,
    mut rx: tokio::sync::broadcast::Receiver<crate::manager::DownloadEvent>,
) {
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(ev) => {
                    if app.emit("download://event", &ev).is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    // Arayüz yavaş kaldı; bilgilendir ve devam et.
                    let _ = app.emit(
                        "download://event",
                        &crate::manager::DownloadEvent::Log {
                            level: "warn".to_string(),
                            message: format!("{n} olay kaçırıldı, arayüz yeniden senkronlanıyor"),
                            download_id: None,
                        },
                    );
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}
