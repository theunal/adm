//! ADM — Advanced Download Manager
//!
//! Rust + Tauri 2 arka plan uygulaması. Mimari:
//!
//! ```text
//! SolidJS (src/)  <-- Tauri olayları + komutlar -->  commands.rs
//!                                                       |
//!                                                    manager.rs   (DashMap + broadcast)
//!                                                       |
//!                                    +------------------+------------------+
//!                                    |                                     |
//!                                 db.rs                                  engine.rs
//!                             (sqlx / SQLite)                 (çok kanallı indirme)
//! ```

// Modüller `pub` olarak dışa açılır: entegrasyon testleri (tests/)
// kütüphaneyi doğrudan kullanır.
pub mod commands;
pub mod db;
pub mod engine;
pub mod i18n;
pub mod manager;
pub mod models;
pub mod settings;

use tauri::Manager;

/// Tauri uygulamasını kurar ve çalıştırır.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // 1) Veritabanı: `%LocalAppData%\ADM\downloads.db`
            let database = tauri::async_runtime::block_on(db::Database::connect())
                .map_err(|e| i18n::t("err.db_open", &[&format!("{e:#}")]))?;
            let manager = manager::DownloadManager::new(database);

            // 2) Kayıtlı dili uygula: ayarlar tek kaynaktan okunur, webview
            //    ilk boyamadan önce Rust tarafında hazır olsun.
            match tauri::async_runtime::block_on(manager.settings()) {
                Ok(settings) => i18n::set_lang(settings.lang),
                // Ayar okunamazsa varsayılan (TR) kalır; uygulama açılır.
                Err(_) => i18n::set_lang(i18n::Lang::Tr),
            }

            // 3) Olay yayıncısı: manager olaylarını arayüze aktar.
            commands::forward_events(app.handle().clone(), manager.subscribe());

            // 4) Manager'ı Tauri durumuna ekle (komutlar buradan erişir).
            app.manage(manager);

            Ok(())
        })
        .on_window_event(|window, event| {
            // Pencere kapatılırken aktif indirmeleri nazikçe iptal et.
            if let tauri::WindowEvent::Destroyed = event {
                let app = window.app_handle();
                if let Some(manager) = app.try_state::<manager::DownloadManager>() {
                    let manager = manager.inner().clone_for_shutdown();
                    tauri::async_runtime::spawn(async move {
                        manager.shutdown_all().await;
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_download,
            commands::pause_download,
            commands::resume_download,
            commands::cancel_download,
            commands::delete_download,
            commands::clear_finished,
            commands::pause_all_downloads,
            commands::resume_all_downloads,
            commands::cancel_all_downloads,
            commands::disk_free_space,
            commands::change_channel_count,
            commands::list_downloads,
            commands::list_active_downloads,
            commands::get_download,
            commands::suggest_file_name,
            commands::default_download_dir,
            commands::database_path,
            commands::open_path,
            commands::open_folder,
            commands::minimize_window,
            commands::toggle_maximize_window,
            commands::close_window,
            commands::set_language,
            commands::get_settings,
            commands::save_settings,
            commands::resolve_target_path,
        ])
        .run(tauri::generate_context!())
        .expect("ADM başlatılırken hata oluştu");
}
