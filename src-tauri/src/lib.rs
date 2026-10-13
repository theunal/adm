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
pub mod bridge;
pub mod capture;
pub mod categories;
pub mod clipboard;
pub mod commands;
pub mod db;
pub mod engine;
pub mod i18n;
pub mod manager;
pub mod models;
pub mod settings;
pub mod site_login;
pub mod tools;
pub mod update;
pub mod video;

use tauri::Manager;

/// Tauri uygulamasını kurar ve çalıştırır.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // MC `NotificationCenter`: tamamlanan indirmeler için sistem bildirimi.
        .plugin(tauri_plugin_notification::init())
        // MC `LaunchAtLogin`: "açılışta başlat" anahtarı.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            // 1) Veritabanı: `%LocalAppData%\ADM\downloads.db`
            let database = tauri::async_runtime::block_on(db::Database::connect())
                .map_err(|e| i18n::t("err.db_open", &[&format!("{e:#}")]))?;
            let manager = manager::DownloadManager::new(database);

            // 2) Kayıtlı dil uygulanır: ayarlar tek kaynaktan okunur, webview
            //    ilk boyamadan önce Rust tarafında hazır olsun.
            let settings = match tauri::async_runtime::block_on(manager.settings()) {
                Ok(settings) => {
                    i18n::set_lang(settings.lang);
                    settings
                }
                // Ayar okunamazsa varsayılan (TR) kalır; uygulama açılır.
                Err(_) => {
                    i18n::set_lang(i18n::Lang::Tr);
                    settings::Settings::default()
                }
            };

            // 3) Olay yayıncısı: manager olaylarını arayüze aktar.
            commands::forward_events(app.handle().clone(), manager.subscribe());

            // 4) Çökme kurtarma (MC `DownloadStore.load`): süreç yaşarken
            //    bitememiş indirmeler duraklatılır. Görev artık yok, ama
            //    satır hâlâ `Downloading` olduğu için arayüzde sonsuza dek
            //    "İndiriliyor" görünür ve kullanıcı devam ettiremezdi.
            //    `forward_events`'ten SONRA çalışmalı: kurtarma bir tazeleme
            //    olayı yayar, ondan önce yaysa olay alıcısız kalırdı.
            let _ = tauri::async_runtime::block_on(manager.recover_interrupted());

            // 5) Paylaşılan durumlar (köprü + pano) ve manager kaydı.
            app.manage(commands::BridgeState::default());
            let clipboard = std::sync::Arc::new(commands::RuntimeState::default());
            clipboard.apply(&settings);
            app.manage(clipboard.clone());
            app.manage(manager.clone());

            // 6) Tarayıcı köprüsü (MC `ServerController`).
            commands::start_bridge(app.handle().clone(), manager.clone(), settings.server_port);

            // 7) Pano izleyici (MC `ClipboardWatcher`).
            commands::start_clipboard(app.handle().clone(), clipboard);

            // 8) Tepsi simgesi + kapatınca arka planda kalma (MC `AppPresence`).
            //    Pencere `visible: false` ile doğduğu için tepsi kurulamazsa
            //    kullanıcı penceresiz kalırdı; bu yüzden hatadan önce yine de
            //    gösterilir, sonra hata yükseltilir.
            if let Err(e) = commands::install_tray(app.handle()) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                return Err(e);
            }

            // 9) Otomatik başlatma (MC `LaunchAtLogin`): ayar tek doğruluktur,
            //    açılışta bir kez yeniden uygulanır. Hata günlüğe düşer.
            commands::reconcile_autostart(app.handle(), &manager, settings.autostart);

            // 10) Ana pencere `visible: false` ile doğur (açılışta titreme olmasın
            //     diye). `start_in_tray` kapalıysa şimdi gösterilir; açıksa tepsi
            //     simgesinde kalır ve menüsünden açılır.
            //
            //     Değer çalışma zamanı kopyasından okunur: `RuntimeState` setup'ın
            //     5. adımında ayarlarla doldurulmuştu. Arama boşsa (olmamalı)
            //     pencere yine de gösterilir — kullanıcı penceresiz kalmasın.
            if !commands::starts_in_tray(app.handle())
                && let Some(window) = app.get_webview_window("main")
            {
                let _ = window.show();
                let _ = window.set_focus();
            }

            // 11) Tamamlanan indirmelerin sistem bildirimi (MC `NotificationCenter`).
            commands::start_notifications(app.handle().clone(), manager.subscribe());

            // 12) Açılışta güncelleme denetimi (ayar açıksa, sessizce).
            if settings.check_for_updates {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = commands::check_for_update(handle).await;
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Pencere kapatılırken aktif indirmeleri nazikçe iptal et.
            //
            // **Yalnızca ana pencere için.** IDM tarzı ayrıntı popup'ları da
            // `Destroyed` üretir; sınır konmasaydı bir popup'u kapatmak tüm
            // indirmeleri iptal edip uygulamayı kapatırdı.
            tauri::WindowEvent::Destroyed if window.label() == "main" => {
                let app = window.app_handle();
                if let Some(manager) = app.try_state::<manager::DownloadManager>() {
                    let manager = manager.inner().clone_for_shutdown();
                    tauri::async_runtime::spawn(async move {
                        manager.shutdown_all().await;
                    });
                }
            }
            // "Kapatınca tepsiye küçült" açıksa pencere gizlenir. Popup'lar
            // bu davranışı istemez: onlar gerçekten kapanmalı.
            tauri::WindowEvent::CloseRequested { api, .. }
                if window.label() == "main"
                    && commands::close_to_tray(window.app_handle()) =>
            {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
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
            commands::open_release_page,
            commands::minimize_window,
            commands::toggle_maximize_window,
            commands::close_window,
            commands::set_language,
            commands::get_settings,
            commands::save_settings,
            commands::resolve_target_path,
            commands::bridge_status,
            commands::tool_status,
            commands::install_tool,
            commands::site_login_status,
            commands::open_site_login,
            commands::open_detail_window,
            commands::close_detail_window,
            commands::save_site_login_cookies,
            commands::save_site_cookies,
            commands::clear_site_cookies,
            commands::check_for_update,
            commands::browser_list,
            commands::prepare_browser_files,
            commands::open_plugin_folder,
            commands::open_browser_extensions_page,
            commands::answer_clipboard_prompt,
            commands::paste_download,
            commands::tray_show,
        ])
        .run(tauri::generate_context!())
        .expect("ADM başlatılırken hata oluştu");
}
