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
/// * `kind` — `"file"` (varsayılan) veya `"video"` (yt-dlp ile indirilir)
#[tauri::command]
pub async fn start_download(
    manager: State<'_, DownloadManager>,
    url: String,
    file_path: Option<String>,
    channel_count: u32,
    kind: Option<String>,
) -> Res<i64> {
    let mut req = StartRequest::simple(url, file_path, channel_count);
    if let Some(kind) = kind {
        req.kind = crate::models::DownloadKind::from_db(&kind);
    }
    manager.start(req).await.map_err(tr)
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

/// Tamamlanmış / iptal edilmiş kayıtları temizler; silinen sayıyı döner.
///
/// Dönen sayı araç çubuğunda kullanıcıya gösterilir: `Res<()>` olsaydı
/// düğmeye basıldığında hiçbir görünür geri bildirim kalmazdı.
#[tauri::command]
pub async fn clear_finished(manager: State<'_, DownloadManager>) -> Res<usize> {
    manager.clear_finished().await.map_err(tr)
}

/// Çalışan tüm indirmeleri duraklatır; etkilenen sayıyı döner.
#[tauri::command]
pub async fn pause_all_downloads(manager: State<'_, DownloadManager>) -> Res<usize> {
    manager.pause_all().await.map_err(tr)
}

/// Sürdürülebilir tüm indirmeleri sürdürür; etkilenen sayıyı döner.
#[tauri::command]
pub async fn resume_all_downloads(manager: State<'_, DownloadManager>) -> Res<usize> {
    manager.resume_all().await.map_err(tr)
}

/// Çalışan tüm indirmeleri iptal eder; etkilenen sayıyı döner.
#[tauri::command]
pub async fn cancel_all_downloads(manager: State<'_, DownloadManager>) -> Res<usize> {
    manager.cancel_all().await.map_err(tr)
}

/// Bir yolun bulunduğu birimde kalan bayt sayısı (durum çubuğu için).
///
/// Yol bir dosyaya da işaret edebilir: `sysinfo` verilen yolun kendisini değil,
/// bulunduğu dosya sistemini sorgular. Sürücü, bağlantı noktası yolun bir
/// üst yolu olan ilk disk olarak seçilir.
#[tauri::command]
pub fn disk_free_space(path: String) -> Res<u64> {
    let disks = sysinfo::Disks::new_with_refreshed_list();

    let mut dir = std::path::Path::new(&path);
    while !dir.exists() {
        match dir.parent() {
            Some(parent) => dir = parent,
            None => break,
        }
    }

    let dir_key = dir
        .to_string_lossy()
        .trim_end_matches(['\\', '/'])
        .to_ascii_uppercase();

    // Uzunluğu en büyük eşleşme kazanır: iç içe bağlı noktalarda en derin
    // bağlantı noktası doğru olan olur.
    let best = disks
        .list()
        .iter()
        .filter_map(|d| {
            let mount = d
                .mount_point()
                .to_string_lossy()
                .trim_end_matches(['\\', '/'])
                .to_ascii_uppercase();
            (dir_key == mount || dir_key.starts_with(&format!("{mount}\\")))
                .then_some((mount.len(), d.available_space()))
        })
        .max_by_key(|(len, _)| *len);

    Ok(best.map(|(_, free)| free).unwrap_or(0))
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

/* -----------------------------------------------------------------
   İndirme ayrıntı penceresi (IDM tarzı küçük popup)
   ----------------------------------------------------------------- */

/// Ayrıntı pencerelerinin etiket öneki (`detail-<id>`).
const DETAIL_LABEL_PREFIX: &str = "detail-";

/// Bir indirme için ayrıntı penceresinin etiketi.
fn detail_label(id: i64) -> String {
    format!("{DETAIL_LABEL_PREFIX}{id}")
}

/// Açık ayrıntı pencerelerinin etiketlerini döndürür.
fn open_detail_labels(app: &AppHandle) -> Vec<String> {
    app.webview_windows()
        .keys()
        .filter(|label| label.starts_with(DETAIL_LABEL_PREFIX))
        .cloned()
        .collect()
}

/**
 * IDM tarzı ayrıntı penceresini açar (yoksa) ya da öne getirir.
 *
 * Pencere aynı arayüzü (`index.html`) yükler; konusunu **etiketinden** okur
 * (`detail-42` → 42), böylece sorgu dizesi taşımaya gerek kalmaz ve pencere
 * adresi platforma göre değişmez. `src/index.tsx` etiketi okuyup tam ekran
 * yerine kompakt popup kabuğunu çizer.
 *
 * Aynı indirme için ikinci bir pencere açılmaz — yeniden tıklamak mevcut
 * pencereyi öne getirir.
 *
 * **Neden senkron komut?** `open_site_login` ile aynı gerekçe: Tauri'de
 * `async` olmayan komutlar IPC işleyicisinde, yani ana iş parçacığında
 * çalışır ve pencere oluşturmak da ana iş parçacığını ister.
 */
#[tauri::command]
pub fn open_detail_window(app: AppHandle, id: i64, file_name: String) -> Res<()> {
    let label = detail_label(id);
    let title = format!("{} — {}", file_name, i18n::t("detail.title", &[]));

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    // Pencereler üst üste binmesin: açık son pencerenin sağına kaydır.
    let (x, y) = next_detail_position(&app);

    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::default())
        .title(title)
        .inner_size(380.0, 132.0)
        .min_inner_size(320.0, 108.0)
        .position(x, y)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(true)
        .build()
        .map(|_| ())
        .map_err(|e| i18n::t("err.detail_open", &[&e.to_string()]))
}

/**
 * Bir indirmenin ayrıntı penceresini kapatır.
 *
 * Görev bittiğinde `auto_close_detail` ayarına uyarak çağrılır. Pencere
 * zaten kapanmışsa hata değildir.
 */
#[tauri::command]
pub fn close_detail_window(app: AppHandle, id: i64) -> Res<()> {
    if let Some(window) = app.get_webview_window(&detail_label(id)) {
        let _ = window.close();
    }
    Ok(())
}

/**
 * Yeni ayrıntı penceresinin sol üst köşesini hesaplar.
 *
 * Açık son pencere bulunamazsa ekranın sağ altına yaslanır; bulunursa 24 px
 * sağa kaydırılır. Sağ kenar taşarsa sıfırlanır, böylece çok sayıda eşzamanlı
 * indirmede pencereler ekran dışına kaymaz.
 */
fn next_detail_position(app: &AppHandle) -> (f64, f64) {
    const STEP: f64 = 24.0;
    const WIDTH: f64 = 380.0;
    const MARGIN: f64 = 24.0;

    let monitor = app.primary_monitor().ok().flatten();
    let (screen_w, screen_h) = monitor
        .as_ref()
        .map(|m| (m.size().width as f64, m.size().height as f64))
        .unwrap_or((1920.0, 1080.0));

    // `Iterator::max` `Ord` ister; `f64` yalnız `PartialOrd` uygular, bu
    // yüzden katlama ile en büyük konum aranır.
    let last_x = open_detail_labels(app)
        .iter()
        .filter_map(|label| app.get_webview_window(label))
        .filter_map(|w| w.outer_position().ok())
        .map(|p| p.x as f64)
        .fold(None, |acc: Option<f64>, x| Some(acc.map_or(x, |a| a.max(x))));

    let base_x = screen_w - WIDTH - MARGIN;
    let base_y = MARGIN;

    let Some(last_x) = last_x else {
        return (base_x, base_y);
    };

    let next = last_x + STEP;
    if next + WIDTH + MARGIN > screen_w {
        (base_x, base_y)
    } else {
        (next, base_y.min((screen_h - 132.0 - MARGIN).max(MARGIN)))
    }
}

/// Dosyayı sistemde açar (varsayılan uygulamayla).
#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Res<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| i18n::t("err.open_file", &[&e.to_string()]))
}

/// Dosyayı sistemde açar — `AppHandle` olmadan.
///
/// Köprü (`bridge.rs`) katmanından çağrılır; orada Tauri durumu yoktur, bu
/// yüzden platform kabuğu üzerinden açılır.
pub fn open_path_internal(path: &str) -> anyhow::Result<()> {
    #[cfg(target_os = "windows")]
    let (program, args): (&str, Vec<&str>) = ("cmd", vec!["/C", "start", "", path]);
    #[cfg(target_os = "macos")]
    let (program, args): (&str, Vec<&str>) = ("open", vec![path]);
    #[cfg(all(unix, not(target_os = "macos")))]
    let (program, args): (&str, Vec<&str>) = ("xdg-open", vec![path]);

    let status = std::process::Command::new(program)
        .args(&args)
        .status()
        .map_err(|e| anyhow::anyhow!(i18n::t("err.open_file", &[&e.to_string()])))?;

    if status.success() {
        Ok(())
    } else {
        anyhow::bail!(i18n::t("err.open_file", &[path]));
    }
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

/// Sürüm sayfasını tarayıcıda açar.
///
/// Adres Rust tarafında sabittir (`update::release_page`); arayüzün rastgele
/// bir adresi açabilmesi için `opener:allow-open-url` yetkisi gerekmez.
///
/// Safari uzantısı uygulamayla birlikte gelmez, sürüm sayfasındaki
/// `safari-unsigned-macos.zip` dosyasından indirilir — sihirbaz oraya
/// yönlendirir.
#[tauri::command]
pub fn open_release_page(app: AppHandle) -> Res<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(crate::update::release_page(), None::<&str>)
        .map_err(|e| i18n::t("err.open_url", &[&e.to_string()]))
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
/// Gelen nesne **kısmi** olabilir: yalnızca gönderilen alanlar değişir,
/// geri kalanı kayıtlı değerde kalır. Arayüz sekmeleri her seferinde yalnızca
/// kendi alanlarını gönderdiği için bu gereklidir; aksi hâlde bir sekmeyi
/// kaydetmek diğer sekmelerin ayarlarını varsayılana döndürürdü.
///
/// Kaydedilen dil hemen etkinleşir; arayüzün ayrıca `set_language`
/// çağırmasına gerek yoktur.
#[tauri::command]
pub async fn save_settings(
    app: AppHandle,
    manager: State<'_, DownloadManager>,
    state: State<'_, SharedState>,
    settings: serde_json::Value,
) -> Res<()> {
    let current = manager.settings().await.map_err(tr)?;
    let merged = merge_settings(&current, &settings)?;
    manager.save_settings(&merged).await.map_err(tr)?;
    // Arka plan görevleri (pano izleyici, pencere davranışları) yeni
    // değerleri bir sonraki turda görsün.
    state.apply(&merged);
    // Otomatik başlatma sistemde ayrı tutulur; ayar yazıldıktan hemen sonra
    // uygulanır ki paneldeki anahtar ile kayıt asla ayrışmasın.
    reconcile_autostart(&app, &manager, merged.autostart);
    Ok(())
}

/// Kayıtlı ayarların üzerine gelen kısmi JSON yamasını uygular.
///
/// Yalnızca üst düzey anahtarlar birleştirilir; bilinmeyen anahtarlar
/// yok sayılır (ileri sürüm uyumluluğu).
fn merge_settings(current: &Settings, patch: &serde_json::Value) -> Res<Settings> {
    let value = serde_json::to_value(current).map_err(|e| tr(e.into()))?;
    let mut base = match value {
        serde_json::Value::Object(map) => map,
        // Nesne olmayan bir kayıt beklenmez; yama uygulanamaz.
        _ => return Ok(current.clone()),
    };
    let Some(patch) = patch.as_object() else {
        // Nesne olmayan gövde: yama uygulanamaz, kayıtlı ayarlar korunur.
        return Ok(current.clone());
    };
    for (key, value) in patch {
        if base.contains_key(key) {
            base.insert(key.clone(), value.clone());
        }
    }
    serde_json::from_value(serde_json::Value::Object(base))
        .map_err(|e| i18n::t("err.db_settings_save", &[&e.to_string()]))
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

// ---------------------------------------------------------------------
// Tarayıcı köprüsü
// ---------------------------------------------------------------------

/// Köprünün çalışma durumu (durum çubuğu göstergesi).
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStatus {
    pub running: bool,
    pub port: u16,
    /// Köprüye bağlanmış tarayıcılar (son görülme sırasıyla).
    pub browsers: Vec<String>,
}

/// Köprü durumunu komutlar ve köprü döngüsü arasında paylaşan kutu.
#[derive(Default)]
pub struct BridgeState(std::sync::Mutex<BridgeStatus>);

impl BridgeState {
    fn set(&self, status: BridgeStatus) {
        if let Ok(mut slot) = self.0.lock() {
            *slot = status;
        }
    }

    fn snapshot(&self) -> BridgeStatus {
        self.0.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// Tarayıcı bağlantısını kaydeder ve arayüze bildirir.
    ///
    /// Uzantı `/ping` adresini saniyede birkaç kez yoklar; olay **yalnızca**
    /// tarayıcı ilk kez görüldüğünde yayınlanır, aksi hâlde olay kanalı
    /// gereksiz yere dolardı.
    fn note_browser(&self, app: &AppHandle, browser: &str) {
        let is_new = match self.0.lock() {
            Ok(mut slot) => {
                if slot.browsers.iter().any(|b| b == browser) {
                    false
                } else {
                    slot.browsers.push(browser.to_string());
                    true
                }
            }
            Err(_) => false,
        };
        if is_new {
            let _ = app.emit(
                "download://event",
                &crate::manager::DownloadEvent::BridgeConnection {
                    browser: browser.to_string(),
                },
            );
        }
    }
}

/// Köprünün durumunu döner (arayüz açılışta bir kez sorar).
#[tauri::command]
pub fn bridge_status(state: State<'_, BridgeState>) -> Res<BridgeStatus> {
    Ok(state.snapshot())
}

/// Olayı hem `download://event` kanalına hem de kayıt günlüğüne yazar.
fn emit_log(app: &AppHandle, level: &str, message: String) {
    let _ = app.emit(
        "download://event",
        &crate::manager::DownloadEvent::Log {
            level: level.to_string(),
            message,
            download_id: None,
        },
    );
}

/// Köprü sunucusunu başlatır (MC `ServerController`).
///
/// Yönlendirme ve güvenlik kuralları uygulama katmanında kurulur; köprü
/// modülü yalnızca HTTP ayrıştırma ve soket döngüsünü üstlenir.
pub fn start_bridge(app: AppHandle, manager: DownloadManager, port: u16) {
    let handler: std::sync::Arc<crate::bridge::RouteHandler> = std::sync::Arc::new(Box::new({
        let app = app.clone();
        move |req: crate::bridge::HttpRequest| {
            let app = app.clone();
            let manager = manager.clone();
            let fut: std::pin::Pin<
                Box<dyn std::future::Future<Output = crate::bridge::HttpResponse> + Send>,
            > = Box::pin(async move { route(&app, &manager, req).await });
            fut
        }
    }));

    tauri::async_runtime::spawn(async move {
        let state = app.state::<BridgeState>();
        match crate::bridge::start(port, handler).await {
            Ok(bridge) => {
                state.set(BridgeStatus {
                    running: true,
                    port,
                    browsers: Vec::new(),
                });
                let _ = app.emit(
                    "download://event",
                    &crate::manager::DownloadEvent::Bridge {
                        running: true,
                        port,
                        error: None,
                    },
                );
                emit_log(
                    &app,
                    "info",
                    i18n::t("log.bridge_started", &[&port.to_string()]),
                );
                bridge.serve().await;
                state.set(BridgeStatus {
                    running: false,
                    port,
                    browsers: Vec::new(),
                });
                emit_log(&app, "info", i18n::t("log.bridge_stopped", &[]));
            }
            Err(e) => {
                state.set(BridgeStatus {
                    running: false,
                    port,
                    browsers: Vec::new(),
                });
                let _ = app.emit(
                    "download://event",
                    &crate::manager::DownloadEvent::Bridge {
                        running: false,
                        port,
                        error: Some(e.to_string()),
                    },
                );
                emit_log(
                    &app,
                    "error",
                    i18n::t("log.bridge_failed", &[&e.to_string()]),
                );
            }
        }
    });
}

/// Köprüden gelen indirme isteği gövdesi.
///
/// Alan adları MC uzantısının gönderdiği gövdeyle birebir aynıdır
/// (`background.js` → `sendToApp`).
#[derive(Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct BridgeDownloadBody {
    url: String,
    /// Tarayıcının önerdiği dosya adı (kategori klasörüyle birleştirilir).
    filename: String,
    /// Sayfanın adresi; indirme isteklerinde `Referer` başlığı olur.
    referer: String,
    /// `file` | `video`.
    kind: Option<String>,
    user_agent: String,
    /// `Cookie:` başlığı metni.
    cookie_header: String,
    /// Yapılandırılmış çerezler (alan adı bilgisiyle).
    cookies: Vec<crate::site_login::CookieRow>,
    channel_count: Option<u32>,
}

/// Köprüden gelen eylem isteği gövdesi.
#[derive(Debug, serde::Deserialize)]
struct BridgeActionBody {
    id: i64,
    action: String,
}

/// Köprü yönlendirmesi (MC `LocalServer.route`).
async fn route(
    app: &AppHandle,
    manager: &DownloadManager,
    req: crate::bridge::HttpRequest,
) -> crate::bridge::HttpResponse {
    use crate::bridge::HttpResponse;
    use serde_json::json;

    let forbidden =
        |key: &str| HttpResponse::json(json!({ "ok": false, "error": i18n::t(key, &[]) }), 403);
    let bad_request =
        |message: String| HttpResponse::json(json!({ "ok": false, "error": message }), 400);

    // Yalnızca tarayıcı uzantısı kaynaklı istekler kabul edilir.
    if !crate::bridge::extension_request(&req) {
        return forbidden("err.bridge_origin");
    }

    // Bağlantı kurmuş tarayıcıyı durum çubuğunda göster.
    app.state::<BridgeState>()
        .note_browser(app, &crate::bridge::browser_of(&req));

    // CORS ön kontrolü.
    if req.method == "OPTIONS" {
        return HttpResponse::ok(json!({ "ok": true }));
    }

    let path = req.path.split('?').next().unwrap_or("/");
    match (req.method.as_str(), path) {
        // Uzantı `/ping` yanıtından `active` (rozet) ve `captureExtensions`
        // (yakalama filtresi) okur.
        ("GET", "/ping") => {
            let active = manager.active_count().await;
            HttpResponse::ok(json!({
                "ok": true,
                "app": "ADM",
                "version": crate::update::current_version(),
                "active": active,
                "captureExtensions": app.state::<SharedState>().extensions(),
            }))
        }
        ("GET", "/downloads") => {
            let items = manager.bridge_downloads().await;
            HttpResponse::ok(json!({ "ok": true, "items": items }))
        }
        ("POST", "/download") => {
            let Ok(body) = serde_json::from_str::<BridgeDownloadBody>(&req.body) else {
                return bad_request(i18n::t("err.bridge_bad_json", &[]));
            };
            if body.url.trim().is_empty() {
                return bad_request(i18n::t("err.bridge_empty_url", &[]));
            }

            let kind = body
                .kind
                .as_deref()
                .map(crate::models::DownloadKind::from_db)
                .unwrap_or(crate::models::DownloadKind::File);

            // Referer ve User-Agent, indirme isteğine başlık olarak eklenir.
            let mut headers: Vec<(String, String)> = Vec::new();
            if !body.referer.trim().is_empty() {
                headers.push(("Referer".to_string(), body.referer.trim().to_string()));
            }
            if !body.user_agent.trim().is_empty() {
                headers.push(("User-Agent".to_string(), body.user_agent.trim().to_string()));
            }

            let channels = match body.channel_count {
                Some(n) if n > 0 => n,
                _ => manager
                    .settings()
                    .await
                    .map(|s| s.default_channel_count)
                    .unwrap_or(8),
            };

            let cookie_header = Some(body.cookie_header)
                .filter(|c| !c.trim().is_empty());

            match manager
                .bridge_add(
                    body.url,
                    Some(body.filename).filter(|f| !f.trim().is_empty()),
                    headers,
                    cookie_header,
                    body.cookies,
                    kind,
                    channels,
                )
                .await
            {
                Ok(id) => HttpResponse::ok(json!({ "ok": true, "id": id })),
                Err(e) => bad_request(tr(e)),
            }
        }
        ("POST", "/action") => {
            let Ok(body) = serde_json::from_str::<BridgeActionBody>(&req.body) else {
                return bad_request(i18n::t("err.bridge_bad_json", &[]));
            };
            match manager.bridge_action(body.id, &body.action).await {
                Ok(()) => HttpResponse::ok(json!({ "ok": true })),
                Err(e) => bad_request(tr(e)),
            }
        }
        _ => HttpResponse::json(json!({ "ok": false, "error": "not found" }), 404),
    }
}

// ---------------------------------------------------------------------
// Harici araçlar (yt-dlp / ffmpeg / deno)
// ---------------------------------------------------------------------

/// Bir aracın kurulum durumu.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub tool: String,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

/// Kurulu araçların durumu (Ayarlar > Video sekmesi).
#[tauri::command]
pub async fn tool_status(manager: State<'_, DownloadManager>) -> Res<Vec<ToolStatus>> {
    let settings = manager.settings().await.map_err(tr)?;
    let mut out = Vec::new();
    for tool in [
        crate::tools::Tool::YtDlp,
        crate::tools::Tool::Ffmpeg,
        crate::tools::Tool::Deno,
    ] {
        let path = crate::tools::locate(tool, &settings.ytdlp_path);
        let version = match &path {
            Some(p) => crate::tools::version_of(p).await,
            None => None,
        };
        out.push(ToolStatus {
            tool: tool.as_str().to_string(),
            installed: path.is_some(),
            path: path.map(|p| p.to_string_lossy().to_string()),
            version,
        });
    }
    Ok(out)
}

/// Aracı indirip kurar; ilerleme `download://event` olayıyla yayınlanır.
#[tauri::command]
pub async fn install_tool(
    app: AppHandle,
    manager: State<'_, DownloadManager>,
    tool: String,
) -> Res<String> {
    let Some(tool) = crate::tools::Tool::parse(&tool) else {
        return Err(i18n::t("err.unknown", &[]));
    };
    let settings = manager.settings().await.map_err(tr)?;

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    let events = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            let _ = events.emit("download://event", &crate::manager::DownloadEvent::Tool(ev));
        }
    });

    crate::tools::install(tool, &settings.ytdlp_path, tx)
        .await
        .map_err(tr)
}

// ---------------------------------------------------------------------
// Site girişi (çerezler)
// ---------------------------------------------------------------------

/// Kayıtlı site girişi çerezlerinin durumu.
#[tauri::command]
pub fn site_login_status() -> Res<crate::site_login::LoginStatus> {
    Ok(crate::site_login::status())
}

/// Giriş penceresinden toplanan çerezleri Netscape dosyasına yazar.
#[tauri::command]
pub fn save_site_cookies(app: AppHandle, cookies: Vec<crate::site_login::CookieRow>) -> Res<usize> {
    if cookies.is_empty() {
        return Err(i18n::t("err.site_cookies_empty", &[]));
    }

    let count = cookies.len();
    crate::site_login::write_cookies(&cookies)
        .map_err(|e| i18n::t("err.open_file", &[&e.to_string()]))?;

    emit_log(
        &app,
        "info",
        i18n::t("log.cookie_written", &[&count.to_string()]),
    );
    Ok(count)
}

/// Kayıtlı site girişi çerezlerini siler.
#[tauri::command]
pub fn clear_site_cookies(app: AppHandle) -> Res<()> {
    crate::site_login::clear();
    emit_log(&app, "info", i18n::t("log.cookie_cleared", &[]));
    Ok(())
}

/// Uygulama içi giriş penceresinin etiketi (tek örnek).
const SITE_LOGIN_LABEL: &str = "site-login";

/// MC `SiteLoginManager.openLogin` varsayılanı: Google hesabı → YouTube.
const SITE_LOGIN_URL: &str =
    "https://accounts.google.com/ServiceLogin?continue=https://www.youtube.com/";

/// Uygulama içi site girişi penceresini açar (MC `SiteLoginManager` portu).
///
/// Pencere zaten açıksa öne getirilir ve verilen adrese yönlendirilir.
///
/// **Neden senkron komut?** Tauri'de `async` olmayan komutlar IPC işleyicisi
/// içinde, yani ana iş parçacığında çalışır; pencere oluşturmak da ana iş
/// parçacığı ister. Çerezler ise burada **okunmaz** — WebView2'de ana iş
/// parçacığından `cookies()` çağrısı kilitlenir (tauri-apps/wry#583), bu
/// yüzden okuma ayrı bir `async` komuta (`save_site_login_cookies`) bırakıldı.
#[tauri::command]
pub fn open_site_login(app: AppHandle, url: Option<String>) -> Res<()> {
    let target = url.unwrap_or_else(|| SITE_LOGIN_URL.to_string());
    let parsed = target
        .parse::<tauri::Url>()
        .map_err(|e| i18n::t("err.site_login_open", &[&e.to_string()]))?;

    if let Some(window) = app.get_webview_window(SITE_LOGIN_LABEL) {
        let _ = window.navigate(parsed);
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        SITE_LOGIN_LABEL,
        tauri::WebviewUrl::External(parsed),
    )
    .title(i18n::t("site_login.title", &[]))
    .inner_size(960.0, 700.0)
    .build()
    .map_err(|e| i18n::t("err.site_login_open", &[&e.to_string()]))?;

    Ok(())
}

/// Giriş penceresinin çerezlerini Netscape dosyasına yazar, pencereyi kapatır.
///
/// WebView2 çerez deposu tüm pencerelerce paylaşıldığı için çerezler giriş
/// penceresinin kendi bağlamından okunur. Chromium alan adı çerezlerini
/// `.youtube.com` gibi noktalı tutar, ancak `cookie` sandığının `domain()`
/// erişicisi bu noktayı **kaldırır**; hangi çerezlerin alt alan adlarına da
/// geçerli olduğu pencere adresiyle karşılaştırılarak geri kazanılır
/// (bkz. `cookie_row`).
#[tauri::command]
pub async fn save_site_login_cookies(app: AppHandle) -> Res<usize> {
    let window = app
        .get_webview_window(SITE_LOGIN_LABEL)
        .ok_or_else(|| i18n::t("err.site_login_missing", &[]))?;

    // Pencerenin son adresi: "host-only" çerezleri ayırt etmek için.
    let host = window
        .url()
        .ok()
        .and_then(|u| u.host_str().map(str::to_ascii_lowercase));

    let cookies = window
        .cookies()
        .map_err(|e| i18n::t("err.site_login_cookies", &[&e.to_string()]))?;

    let rows: Vec<crate::site_login::CookieRow> = cookies
        .iter()
        .filter_map(|c| cookie_row(c, host.as_deref()))
        .collect();

    if rows.is_empty() {
        return Err(i18n::t("err.site_cookies_empty", &[]));
    }

    let count = rows.len();
    crate::site_login::write_cookies(&rows)
        .map_err(|e| i18n::t("err.open_file", &[&e.to_string()]))?;

    // Çerezler yazıldıktan sonra pencere kapanır (MC'deki "Save Cookies").
    let _ = window.close();

    emit_log(
        &app,
        "info",
        i18n::t("log.cookie_written", &[&count.to_string()]),
    );
    Ok(count)
}

/// WebView2 çerezini Netscape satırına çevirir.
///
/// Alan adı çerezleri alt alan adlarına da geçerli olduğu için Netscape
/// biçiminde noktayla (`.youtube.com`) ve `TRUE` bayrağıyla yazılmalıdır.
/// `cookie` sandığı noktayı attığı için karar pencere adresine göre verilir:
/// alan adı pencere adresinden **farklıysa** çerez alan adı geneli içindir.
/// Adres okunamazsa noktasız yazılır — yt-dlp yine de tam adla eşleştirir.
fn cookie_row(
    cookie: &tauri::webview::Cookie<'static>,
    host: Option<&str>,
) -> Option<crate::site_login::CookieRow> {
    let domain = cookie.domain()?;
    let is_domain_cookie = host.is_some_and(|h| !h.eq_ignore_ascii_case(domain));

    Some(crate::site_login::CookieRow {
        domain: if is_domain_cookie {
            format!(".{domain}")
        } else {
            domain.to_string()
        },
        path: cookie.path().unwrap_or("/").to_string(),
        secure: cookie.secure().unwrap_or(false),
        expiration_date: cookie
            .expires_datetime()
            .map(|t| t.unix_timestamp())
            .unwrap_or(0),
        name: cookie.name().to_string(),
        value: cookie.value().to_string(),
    })
}

// ---------------------------------------------------------------------
// Güncelleme
// ---------------------------------------------------------------------

/// Güncellemeyi denetler ve sonucu `download://event` ile yayınlar.
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Res<()> {
    let current = crate::update::current_version();
    let outcome = crate::update::check_latest().await;

    let event = match outcome {
        Ok(info) => {
            // Yeni sürüm varsa kullanıcıya gösterilir; atlama kararı
            // ayarlarda saklanır (`skippedUpdateVersion`).
            let newer = crate::update::is_newer(&info.version, &current);
            crate::manager::DownloadEvent::Update {
                current: current.clone(),
                latest: newer.then(|| info.version.clone()),
                page_url: newer.then(|| info.page_url.clone()),
                notes: newer.then(|| info.notes.clone()),
                dmg_url: newer.then(|| info.dmg_url.clone()).flatten(),
                error: None,
            }
        }
        Err(e) => crate::manager::DownloadEvent::Update {
            current: current.clone(),
            latest: None,
            page_url: None,
            notes: None,
            dmg_url: None,
            error: Some(e.to_string()),
        },
    };

    let _ = app.emit("download://event", &event);
    Ok(())
}

// ---------------------------------------------------------------------
// Tarayıcı eklenti dosyaları
// ---------------------------------------------------------------------

/// Desteklenen tarayıcılar ve uzantı sayfası adresleri.
const BROWSERS: &[(&str, &str)] = &[
    ("chrome", "chrome://extensions"),
    ("edge", "edge://extensions"),
    ("brave", "brave://extensions"),
    ("firefox", "about:debugging#/runtime/this-firefox"),
];

/// Eklenti dosyalarının kopyalandığı klasör: `%LOCALAPPDATA%\ADM\Browser Plugins`.
fn browser_plugins_dir() -> PathBuf {
    crate::db::db_dir().join("Browser Plugins")
}

/// Tarayıcı adı → klasör adı (marka yazımıyla).
fn browser_label(browser: &str) -> Option<&'static str> {
    match browser {
        "chrome" => Some("Chrome"),
        "edge" => Some("Edge"),
        "brave" => Some("Brave"),
        "firefox" => Some("Firefox"),
        _ => None,
    }
}

/// Kaynak eklenti klasörü.
///
/// Yalnızca derlenmiş çıktı kullanılır: `build/` altında `manifest.json`,
/// `background.js`, `content.js`, `popup.js`, `popup.html`, `popup.css`,
/// `icons/` ve `_locales/` bulunur. `src/*.ts` kaynakları pakete girmez.
///
/// Önce paketlenmiş kaynaklar (`<resource>/extension`) denenir; `tauri dev`
/// sırasında kaynaklar kopyalanmadığı için derleme zamanındaki proje köküne
/// (`../src-extension/build`) düşülür. Bu klasör `npm run extension:build`
/// ile üretilir; yoksa kurulum sihirbazı "dosyalar bulunamadı" der.
fn extension_source(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("extension");
        if bundled.is_dir() {
            return Some(bundled);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()?
        .join("src-extension")
        .join("build");
    dev.is_dir().then_some(dev)
}

/// Desteklenen tarayıcıların listesi (sihirbaz için).
///
/// `BROWSERS` dosya kopyalanan paketlerdir ve her platformda listelenir.
/// Safari **yalnızca macOS'ta** eklenir: uzantı `.appex` olduğu için dosya
/// kopyalanarak kurulamaz, indirilen ayrı bir `.app` içinde gelir. Bu yüzden
/// `prepare_browser_files` / `open_plugin_folder` Safari'yi tanımaz ve
/// `err.unknown` döner — sihirbaz onları çağırmaz.
#[tauri::command]
pub fn browser_list() -> Res<Vec<String>> {
    let mut names: Vec<String> = BROWSERS
        .iter()
        .map(|(name, _)| (*name).to_string())
        .collect();
    if cfg!(target_os = "macos") {
        names.push("safari".to_string());
    }
    Ok(names)
}

/// Eklenti dosyalarını tarayıcı klasörüne kopyalar ve `README.txt` yazar.
///
/// Arayüzdeki kurulum sihirbazı bu klasörü "paketlenmemiş öğe" olarak
/// yükletir.
#[tauri::command]
pub fn prepare_browser_files(app: AppHandle, browser: String) -> Res<String> {
    let Some(label) = browser_label(&browser) else {
        return Err(i18n::t("err.unknown", &[]));
    };
    let Some(source) = extension_source(&app) else {
        return Err(i18n::t("err.browser_plugin_missing", &[]));
    };

    let target = browser_plugins_dir().join(label);
    copy_dir(&source, &target).map_err(|e| i18n::t("err.open_file", &[&e.to_string()]))?;

    let readme = i18n::t("browser.readme", &[label]);
    std::fs::write(target.join("README.txt"), readme)
        .map_err(|e| i18n::t("err.open_file", &[&e.to_string()]))?;

    let path = target.to_string_lossy().to_string();
    emit_log(&app, "info", i18n::t("log.browser_files_ready", &[&path]));
    Ok(path)
}

/// Eklenti klasörünü dosya yöneticisinde açar.
#[tauri::command]
pub fn open_plugin_folder(browser: String) -> Res<()> {
    let label = browser_label(&browser).unwrap_or("Chrome");
    let path = browser_plugins_dir().join(label);
    std::fs::create_dir_all(&path).map_err(|e| i18n::t("err.open_file", &[&e.to_string()]))?;
    open_path_internal(&path.to_string_lossy()).map_err(tr)
}

/// Tarayıcının uzantı yönetimi sayfasını açar.
///
/// Tarayıcı adı bilinmiyorsa varsayılan tarayıcıda açılır.
#[tauri::command]
pub fn open_browser_extensions_page(browser: String) -> Res<()> {
    let url = BROWSERS
        .iter()
        .find(|(name, _)| *name == browser)
        .map(|(_, url)| *url)
        .unwrap_or("chrome://extensions");
    open_path_internal(url).map_err(tr)
}

/// Klasörü (alt klasörleriyle) hedefe kopyalar; hedef varsa üzerine yazar.
fn copy_dir(source: &std::path::Path, target: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(target)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        if from.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------
// Çalışma zamanı durumu (pano izleyici + pencere davranışları)
// ---------------------------------------------------------------------

/// Pano sorusunun yayıldığı kanalın tipi.
type PromptTx = tokio::sync::mpsc::UnboundedSender<crate::clipboard::ClipboardPrompt>;

/// Ayarlardan türetilen paylaşılan durum.
///
/// Arka plan görevleri (pano izleyici, pencere olayları) her seferinde
/// veritabanına gitmesin diye güncel ayarlar burada tutulur; ayar
/// kaydedildiğinde `apply` ile yenilenir.
pub struct RuntimeState {
    watch_clipboard: std::sync::atomic::AtomicBool,
    close_to_tray: std::sync::atomic::AtomicBool,
    start_in_tray: std::sync::atomic::AtomicBool,
    capture_extensions: std::sync::Mutex<Vec<String>>,
    /// Panoda sorulan bağlantı yanıtlanmayı bekliyor mu?
    prompting: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// Sorunun yayıldığı kanal.
    ///
    /// `start_clipboard` kanalı kurunca buraya yazılır. `Ctrl+V` de aynı
    /// kanalı kullanır; boşken (`None`) yapıştırma sorusu çıkmaz — izleyici
    /// henüz başlamamış olabilir.
    prompt_tx: std::sync::Mutex<Option<PromptTx>>,
}

impl Default for RuntimeState {
    fn default() -> Self {
        use std::sync::atomic::AtomicBool;
        Self {
            watch_clipboard: AtomicBool::new(true),
            close_to_tray: AtomicBool::new(true),
            start_in_tray: AtomicBool::new(false),
            capture_extensions: std::sync::Mutex::new(Vec::new()),
            prompting: std::sync::Arc::new(AtomicBool::new(false)),
            prompt_tx: std::sync::Mutex::new(None),
        }
    }
}

impl RuntimeState {
    /// Ayarları çalışma zamanı durumuna yansıtır.
    pub fn apply(&self, settings: &Settings) {
        use std::sync::atomic::Ordering::SeqCst;
        self.watch_clipboard.store(settings.watch_clipboard, SeqCst);
        self.close_to_tray.store(settings.close_to_tray, SeqCst);
        self.start_in_tray.store(settings.start_in_tray, SeqCst);
        if let Ok(mut slot) = self.capture_extensions.lock() {
            *slot = crate::capture::extensions(
                &settings.capture_group_ids,
                &settings.custom_extensions,
            );
        }
    }

    fn watch_enabled(&self) -> bool {
        self.watch_clipboard.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// Arayüz ve köprü için etkin yakalama uzantısı listesi.
    pub fn extensions(&self) -> Vec<String> {
        self.capture_extensions
            .lock()
            .map(|e| e.clone())
            .unwrap_or_default()
    }
}

/// Paylaşılan çalışma durumunun Tauri'de saklandığı tip.
///
/// `lib.rs` bunu `app.manage(...)` ile kaydeder, komutlar da aynı tipi ister.
/// İki yerde elle yazılsa birbirinden kolayca sapar: `Arc` olarak yönetilip
/// `RuntimeState` istenirse Tauri `TypeId` eşleşmesi bulamaz ve komut çağırmadan
/// önce hata döner. Bu yüzden **her zaman bu takma adı kullanın.**
pub type SharedState = std::sync::Arc<RuntimeState>;

/// Pano izleyiciyi başlatır (MC `ClipboardWatcher`).
///
/// Bulunan bağlantılar `download://event` üzerinden `clipboard` olayıyla
/// arayüze gider; arayüz yanıtlayınca `answer_clipboard_prompt` çağrılır.
pub fn start_clipboard(app: AppHandle, state: SharedState) {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();

    // `Ctrl+V` de aynı kanalı kullanır; kanalı duruma bırak.
    if let Ok(mut slot) = state.prompt_tx.lock() {
        *slot = Some(tx.clone());
    }

    let enabled = state.clone();
    let extensions = state.clone();
    crate::clipboard::spawn_watcher(
        tx,
        std::sync::Arc::new(move || enabled.watch_enabled()),
        std::sync::Arc::new(move || extensions.extensions()),
        state.prompting.clone(),
    );

    tauri::async_runtime::spawn(async move {
        while let Some(prompt) = rx.recv().await {
            emit_log(
                &app,
                "info",
                i18n::t("log.clipboard_detected", &[&prompt.urls.len().to_string()]),
            );
            let _ = app.emit(
                "download://event",
                &crate::manager::DownloadEvent::Clipboard(prompt),
            );
        }
    });
}

/// Arayüz panodaki bağlantı sorusunu yanıtladı (indir / yoksay).
#[tauri::command]
pub fn answer_clipboard_prompt(state: State<'_, SharedState>) {
    state
        .prompting
        .store(false, std::sync::atomic::Ordering::SeqCst);
}

/// `Ctrl+V`: panodaki metinden bağlantı alıp kullanıcıya sorar.
///
/// MC `ClipboardWatcher.handlePaste`'in karşılığı. İzleyiciden farkı: burada
/// **her** http(s) bağlantı kabul edilir; dosya türü ve yakalama grubu
/// süzgeci uygulanmaz (kullanıcı açıkça eylemde bulunuyor).
///
/// Sorma akışı ortaktır: `ClipboardPrompt` olayı yayılır, arayüz
/// `ClipboardPromptDialog` ile yanıtlar. Kural izleyiciyle aynıdır —
/// yanıtsız bir soru varken yenisi sorulmaz, aksi halde ikinci soru ilkinin
/// yerini alırdı.
///
/// Pano bir bloklayıcı iş parçacığından okunur: `arboard` Windows'ta COM
/// gerektirir ve ana iş parçacığından çağırmak WebView2 ile kilitlenebilir.
#[tauri::command]
pub async fn paste_download(state: State<'_, SharedState>) -> Res<()> {
    use crate::clipboard::ClipboardPrompt;
    use std::sync::atomic::Ordering::SeqCst;

    let text = tauri::async_runtime::spawn_blocking(|| {
        let mut clipboard = arboard::Clipboard::new().ok()?;
        clipboard.get_text().ok()
    })
    .await
    .map_err(|_| i18n::t("err.clipboard_unavailable", &[]))?;

    let Some(text) = text else {
        return Err(i18n::t("err.clipboard_unavailable", &[]));
    };

    let urls = crate::clipboard::extract_urls(&text);
    if urls.is_empty() {
        return Err(i18n::t("err.clipboard_empty", &[]));
    }

    if state.prompting.load(SeqCst) {
        return Err(i18n::t("err.clipboard_busy", &[]));
    }

    let Some(tx) = state
        .prompt_tx
        .lock()
        .ok()
        .and_then(|slot| slot.clone())
    else {
        // İzleyici henüz başlamamış; soru çıkarılsa bile yanıtı iletilemezdi.
        return Err(i18n::t("err.clipboard_unavailable", &[]));
    };

    state.prompting.store(true, SeqCst);
    let _ = tx.send(ClipboardPrompt {
        prefer_video: urls.iter().all(|u| crate::capture::looks_like_video_page(u)),
        urls,
        source: "paste".to_string(),
    });
    Ok(())
}

// ---------------------------------------------------------------------
// Tepsi simgesi ve pencere davranışları
// ---------------------------------------------------------------------

/// Kapatma isteği "tepsiye gizle"ye mi dönüşecek?
pub fn close_to_tray(app: &AppHandle) -> bool {
    app.try_state::<SharedState>()
        .map(|s| s.close_to_tray.load(std::sync::atomic::Ordering::SeqCst))
        .unwrap_or(false)
}

/// Uygulama tepsi simgesinde (pencere açılmadan) mı başlamalı?
pub fn starts_in_tray(app: &AppHandle) -> bool {
    app.try_state::<SharedState>()
        .map(|s| s.start_in_tray.load(std::sync::atomic::Ordering::SeqCst))
        .unwrap_or(false)
}

/// Ana pencereyi gösterir, simge durumundan çıkarır ve öne getirir.
fn show_main_window(app: &AppHandle) -> Res<()> {
    let window = main_window(app)?;
    let _ = window.show();
    let _ = window.unminimize();
    window
        .set_focus()
        .map_err(|e| i18n::t("err.win_state", &[&e.to_string()]))
}

/// Ana pencereyi gösterir (tepsi menüsü ve arayüz kullanır).
#[tauri::command]
pub fn tray_show(app: AppHandle) -> Res<()> {
    show_main_window(&app)
}

/// Tepsi simgesini kurar: Göster/Gizle, Tümünü Duraklat, Tümünü Sürdür, Çık.
pub fn install_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::TrayIconBuilder;

    let show = MenuItem::with_id(app, "show", i18n::t("tray.show", &[]), true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", i18n::t("tray.hide", &[]), true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let pause = MenuItem::with_id(
        app,
        "pause_all",
        i18n::t("tray.pause_all", &[]),
        true,
        None::<&str>,
    )?;
    let resume = MenuItem::with_id(
        app,
        "resume_all",
        i18n::t("tray.resume_all", &[]),
        true,
        None::<&str>,
    )?;
    let separator2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", i18n::t("tray.quit", &[]), true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&show, &hide, &separator, &pause, &resume, &separator2, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id("adm-tray")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("ADM")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                let _ = show_main_window(app);
            }
            "hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "pause_all" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(manager) = app.try_state::<DownloadManager>() {
                        let _ = manager.pause_all().await;
                    }
                });
            }
            "resume_all" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(manager) = app.try_state::<DownloadManager>() {
                        let _ = manager.resume_all().await;
                    }
                });
            }
            "quit" => app.exit(0),
            _ => {}
        });

    // Simge: uygulamanın pencere simgesi kullanılır.
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

// ---------------------------------------------------------------------
// Ayarların davranışa bağlanması (MC `LaunchAtLogin` + `NotificationCenter`)
// ---------------------------------------------------------------------

/// Otomatik başlatma kaydını ayarlar.
///
/// Ayar tek doğruluktur: açılışta bir kez, ayar değişiminde de yeniden
/// uygulanır. Böylece kayıt silinse ya da elle eklense bile paneldeki anahtar
/// ile sistemdeki gerçek durum ayrışmaz.
///
/// Hata **yükseltilmez**, günlüğe yazılır: kaydın yazılamaması uygulamanın
/// açılmasını ya da diğer ayarların kaydedilmesini engellememeli.
pub fn reconcile_autostart(app: &AppHandle, manager: &DownloadManager, enabled: bool) {
    use tauri_plugin_autostart::ManagerExt;

    let result = if enabled {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    };

    if let Err(e) = result {
        manager.log("error", i18n::t("err.autostart", &[&e.to_string()]), None);
    }
}

/// Tamamlanan indirmeler için sistem bildirimi.
///
/// `notify_on_complete` **her bitişte veritabanından okunur**: anahtarın etkisi
/// anında görünsün diye ayrı bir çalışma zamanı kopyası tutulmaz. Kapalıysa
/// bildirim gönderilmez; abonelik sürer çünkü anahtar sonradan açılabilir.
///
/// Yalnızca `Completed` olayı **`Completed` durumuyla** geldiğinde bildirilir:
/// duraklatma, iptal ve hata da aynı olayı taşır, bunlar kullanıcıya "bitti"
/// diye duyurulmaz.
///
/// Görev kapanma anında sessizce biter: yayın kapanınca `RecvError::Closed`
/// alınır ve döngüden çıkılır.
pub fn start_notifications(
    app: AppHandle,
    mut rx: tokio::sync::broadcast::Receiver<crate::manager::DownloadEvent>,
) {
    use crate::manager::DownloadEvent;
    use crate::models::DownloadStatus;
    use tauri_plugin_notification::NotificationExt;

    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(DownloadEvent::Completed { id, status }) => {
                    if status != DownloadStatus::Completed {
                        continue;
                    }
                    let Some(manager) = app.try_state::<DownloadManager>() else {
                        continue;
                    };
                    let Ok(true) = manager.settings().await.map(|s| s.notify_on_complete) else {
                        continue;
                    };
                    // Kayıt silinmiş ya da yeniden adlandırılmış olabilir; o
                    // durumda bildirim gönderilmez (yol taşıyan bir uyarı
                    // anlamsız olurdu).
                    let Ok(Some(item)) = manager.get(id).await else {
                        continue;
                    };
                    let _ = app
                        .notification()
                        .builder()
                        .title(i18n::t("notify.completed_title", &[]))
                        .body(item.file_name)
                        .show();
                }
                Ok(_) => {}
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn kismi_ayar_yamasi_diger_alanlari_korur() {
        let current = Settings {
            server_port: 49000,
            max_concurrent: 5,
            start_in_tray: true,
            ..Settings::default()
        };

        // Arayüzün eski "Genel" sekmesi yalnızca iki alanı gönderir.
        let patch = json!({ "defaultChannelCount": 16, "lang": "en" });
        let merged = merge_settings(&current, &patch).expect("yama uygulanamadı");

        assert_eq!(merged.default_channel_count, 16);
        assert_eq!(merged.lang, i18n::Lang::En);
        // Gönderilmeyen alanlar kayıtlı değerde kalır.
        assert_eq!(merged.server_port, 49000);
        assert_eq!(merged.max_concurrent, 5);
        assert!(merged.start_in_tray);
    }

    #[test]
    fn bilinmeyen_anahtar_yok_sayilir() {
        let current = Settings::default();
        let patch = json!({ "gelecekBirAlan": 1, "maxConcurrent": 4 });
        let merged = merge_settings(&current, &patch).expect("yama uygulanamadı");
        assert_eq!(merged.max_concurrent, 4);
    }

    #[test]
    fn nesne_olmayan_govde_kayitli_ayarlari_dondurur() {
        let current = Settings {
            server_port: 49001,
            ..Settings::default()
        };
        let merged = merge_settings(&current, &json!("bozuk")).expect("yama uygulanamadı");
        assert_eq!(merged.server_port, 49001);
    }
}
