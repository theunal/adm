//! Tauri komutları — SolidJS arayüzünün çağırdığı tüm API.
//!
//! Mesajlar `i18n` sözlüğünden seçili dilde üretilir; durum enum'ları
//! veritabanında İngilizce kalır ve arayüzde `src/lib/format.ts` içindeki
//! çeviri katmanıyla gösterilir.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::db_path;
use crate::i18n;
use crate::manager::{DownloadManager, StartRequest};
use crate::models::{DownloadItem, file_name_from_url};
use crate::settings::Settings;

type Res<T> = Result<T, String>;

/// `anyhow` hatasını, kullanıcıya gösterilebilir dile çevirir.
///
/// `anyhow::Error` `std::error::Error` implementasyonu taşımadığı için
/// bağlam zinciri elle gezilir. Zincirin her halkası kanonik olabilir
/// (`i18n::canon`), bu yüzden önce seçili dile çevrilir.
fn tr(e: anyhow::Error) -> String {
    let mut parts: Vec<String> = Vec::new();
    for cause in e.chain() {
        let text = i18n::render(&cause.to_string());
        if !text.is_empty() {
            parts.push(text);
        }
    }
    if parts.is_empty() {
        i18n::t("err.unknown", &[])
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
        .ok_or_else(|| i18n::t("err.main_window", &[]))
}

/// Dosyayı sistemde açar (varsayılan uygulamayla).
#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Res<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| i18n::t("err.open_file", &[&e.to_string()]))
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
        .map_err(|e| i18n::t("err.open_folder", &[&e.to_string()]))
}

/// Uygulama penceresini simge durumuna küçültür.
#[tauri::command]
pub fn minimize_window(app: AppHandle) -> Res<()> {
    main_window(&app)?
        .minimize()
        .map_err(|e| i18n::t("err.win_minimize", &[&e.to_string()]))
}

/// Pencereyi büyütür / küçültür.
#[tauri::command]
pub fn toggle_maximize_window(app: AppHandle) -> Res<()> {
    let window = main_window(&app)?;
    let is_max = window
        .is_maximized()
        .map_err(|e| i18n::t("err.win_state", &[&e.to_string()]))?;

    if is_max {
        window
            .unmaximize()
            .map_err(|e| i18n::t("err.win_minimize", &[&e.to_string()]))
    } else {
        window
            .maximize()
            .map_err(|e| i18n::t("err.win_maximize", &[&e.to_string()]))
    }
}

/// Pencereyi kapatır (uygulama kapanışını tetikler).
#[tauri::command]
pub fn close_window(app: AppHandle) -> Res<()> {
    main_window(&app)?
        .close()
        .map_err(|e| i18n::t("err.win_close", &[&e.to_string()]))
}

/// Arayüzün seçtiği dili uygular.
///
/// Dil artık `settings` tablosunda saklanır; bu komut yalnızca bellekteki
/// dili günceller (kaydetme `save_settings` içinde yapılır).
#[tauri::command]
pub fn set_language(lang: String) {
    i18n::set_lang(i18n::Lang::parse(&lang));
}

/// Uygulama ayarlarını döner.
#[tauri::command]
pub async fn get_settings(manager: State<'_, DownloadManager>) -> Res<Settings> {
    manager.settings().await.map_err(tr)
}

/// Uygulama ayarlarını kaydeder.
///
/// Kaydedilen dil hemen etkinleşir; arayüzün ayrıca `set_language`
/// çağırmasına gerek yoktur.
#[tauri::command]
pub async fn save_settings(manager: State<'_, DownloadManager>, settings: Settings) -> Res<()> {
    manager.save_settings(&settings).await.map_err(tr)
}

/// Bir URL için ayarlara göre çözümlenen tam hedef yol.
///
/// Yeni indirme formu bu değeri önizleme olarak gösterir; kullanıcı
/// "Gözat" ile değiştirebilir.
#[tauri::command]
pub async fn resolve_target_path(manager: State<'_, DownloadManager>, url: String) -> Res<String> {
    let settings = manager.settings().await.map_err(tr)?;
    let file_name = file_name_from_url(&url);
    Ok(settings
        .resolve_target(&file_name)
        .to_string_lossy()
        .to_string())
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
                            message: i18n::t("log.events_dropped", &[&n.to_string()]),
                            download_id: None,
                        },
                    );
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}
