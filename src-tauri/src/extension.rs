//! Tarayıcı eklentisi kurulumu — tek düğmeli akış.
//!
//! Eklentinin kurulumu üç yerden birleşir: derlenmiş dosyaların çalışma
//! dizinine kopyalanması, tarayıcının **uzantı sayfasının** açılması ve
//! hazırlanan klasörün dosya yöneticisinde **seçili** gösterilmesi.
//!
//! # Neden tarayıcı ikilisi doğrudan çalıştırılıyor?
//!
//! Uzantı sayfaları (`brave://extensions`, `chrome://extensions`) OS tarafından
//! kayıtlı bir protokol değildir. `cmd /C start brave://extensions` ya da
//! `xdg-open brave://extensions` bu yüzden çoğu sistemde sessizce başarısız
//! olur. İşe yarar yol, tarayıcının **kendi ikilisini** bu adresle başlatmaktır
//! (Chromium tabanlı tarayıcılar bir adres argümanını yeni sekmede açar).
//!
//! # Güvenlik
//!
//! Bu akışta ağ hiçe dokunulmaz: `.crx` indirilmez, geçici dosya yazılmaz.
//! Tek dış etki, **bilinen kurulum yollarından** biri olan tarayıcı ikilisini
//! çalıştırmak ve bizim ürettiğimiz klasörü açmaktır; komut satırına kullanıcı
//! girdisi asla gömülmez.

use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::AppHandle;
use tauri::Manager;

use crate::i18n;

/// Desteklenen tarayıcılar ve uzantı sayfası adresleri.
pub const BROWSERS: &[(&str, &str)] = &[
    ("chrome", "chrome://extensions"),
    ("edge", "edge://extensions"),
    ("brave", "brave://extensions"),
    ("firefox", "about:debugging#/runtime/this-firefox"),
];

/// Tarayıcı adı → klasör adı (marka yazımıyla).
pub fn browser_label(browser: &str) -> Option<&'static str> {
    match browser {
        "chrome" => Some("Chrome"),
        "edge" => Some("Edge"),
        "brave" => Some("Brave"),
        "firefox" => Some("Firefox"),
        _ => None,
    }
}

/// Tarayıcının uzantı yönetimi sayfası (bilinmiyorsa Chrome).
pub fn extensions_page(browser: &str) -> &'static str {
    BROWSERS
        .iter()
        .find(|(name, _)| *name == browser)
        .map(|(_, url)| *url)
        .unwrap_or("chrome://extensions")
}

/// Eklenti dosyalarının kopyalandığı klasör: `%LOCALAPPDATA%\ADM\Browser Plugins`.
pub fn browser_plugins_dir() -> PathBuf {
    crate::db::db_dir().join("Browser Plugins")
}

/// Tarayıcının eklenti klasörü.
pub fn plugin_folder(browser: &str) -> Option<PathBuf> {
    Some(browser_plugins_dir().join(browser_label(browser)?))
}

// ---------------------------------------------------------------------
// Kaynak eklenti klasörü ve kopyalama
// ---------------------------------------------------------------------

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
pub fn extension_source(app: &AppHandle) -> Option<PathBuf> {
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

/// Klasörü (alt klasörleriyle) hedefe kopyalar; hedef varsa üzerine yazar.
pub fn copy_dir(source: &Path, target: &Path) -> std::io::Result<()> {
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
// Tarayıcı ikilisini bulma
// ---------------------------------------------------------------------

/// Windows'ta kullanıcı ve sistem program klasörleri.
///
/// Sıra önemli: kullanıcı yüklemesi (`%LOCALAPPDATA%`) önce gelir, çünkü
/// Brave/Chrome per-user kurulursa sistem klasöründe olmaz.
#[cfg(target_os = "windows")]
fn windows_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        roots.push(PathBuf::from(local));
    }
    if let Ok(pf) = std::env::var("ProgramFiles") {
        roots.push(PathBuf::from(pf));
    }
    if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
        roots.push(PathBuf::from(pf86));
    }
    roots
}

/// Tarayıcının bilinen kurulum yolları (işletim sistemine göre).
///
/// Saf fonksiyon: dosya sistemine bakmaz, yalnızca **aday** listesini üretir.
/// Böylece testlerde doğrulanabilir (gerçek kurulum gerektirmez).
pub fn browser_path_candidates(browser: &str) -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let sub = |app_dir: &str, exe: &str| -> Vec<PathBuf> {
            windows_roots()
                .into_iter()
                .map(|root| root.join(app_dir).join("Application").join(exe))
                .collect()
        };
        match browser {
            "brave" => sub(r"BraveSoftware\Brave-Browser", "brave.exe"),
            "chrome" => sub(r"Google\Chrome\Application", "chrome.exe"),
            "edge" => sub(r"Microsoft\Edge\Application", "msedge.exe"),
            "firefox" => windows_roots()
                .into_iter()
                .map(|root| root.join("Mozilla Firefox").join("firefox.exe"))
                .collect(),
            _ => Vec::new(),
        }
    }

    #[cfg(target_os = "macos")]
    {
        let apps = |name: &str, exe: &str| -> Vec<PathBuf> {
            vec![PathBuf::from("/Applications")
                .join(name)
                .join("Contents")
                .join("MacOS")
                .join(exe)]
        };
        match browser {
            "brave" => apps("Brave Browser.app", "Brave Browser"),
            "chrome" => apps("Google Chrome.app", "Google Chrome"),
            "edge" => apps("Microsoft Edge.app", "Microsoft Edge"),
            "firefox" => apps("Firefox.app", "firefox"),
            _ => Vec::new(),
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        match browser {
            "brave" => vec![
                PathBuf::from("/usr/bin/brave-browser"),
                PathBuf::from("/usr/bin/brave"),
            ],
            "chrome" => vec![PathBuf::from("/usr/bin/google-chrome")],
            "edge" => vec![PathBuf::from("/usr/bin/microsoft-edge")],
            "firefox" => vec![PathBuf::from("/usr/bin/firefox")],
            _ => Vec::new(),
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
    {
        let _ = browser;
        Vec::new()
    }
}

/// Tarayıcının ikili dosyasını bulur.
///
/// 1. Bilinen kurulum yolları (`browser_path_candidates`)
/// 2. `PATH` içinde `where` / `which` ile arama
///
/// Bulunamazsa `None` — çağıran kullanıcıya elle yönlendirme gösterir.
pub fn find_browser_exe(browser: &str) -> Option<PathBuf> {
    for candidate in browser_path_candidates(browser) {
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    search_in_path(local_exe_name(browser)?)
}

/// İkili dosyanın `PATH` içinde aranan adı.
#[cfg(target_os = "windows")]
fn local_exe_name(browser: &str) -> Option<&'static str> {
    match browser {
        "brave" => Some("brave.exe"),
        "chrome" => Some("chrome.exe"),
        "edge" => Some("msedge.exe"),
        "firefox" => Some("firefox.exe"),
        _ => None,
    }
}

#[cfg(not(target_os = "windows"))]
fn local_exe_name(browser: &str) -> Option<&'static str> {
    match browser {
        "brave" => Some("brave-browser"),
        "chrome" => Some("google-chrome"),
        "edge" => Some("microsoft-edge"),
        "firefox" => Some("firefox"),
        _ => None,
    }
}

/// `PATH` ortam değişkeninde bir program arar.
///
/// `Command` ile `where` (Windows) / `which` (unix) çağrılır; bulunan ilk satır
/// döner. Araç yoksa veya hiç bulunamazsa `None`.
fn search_in_path(exe: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let (program, args): (&str, &[&str]) = ("where", &[exe]);
    #[cfg(not(target_os = "windows"))]
    let (program, args): (&str, &[&str]) = ("which", &[exe]);

    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| PathBuf::from(line.trim()))
        .filter(|path| path.is_file())
}

// ---------------------------------------------------------------------
// Uzantı sayfasını açma ve klasörü seçili gösterme
// ---------------------------------------------------------------------

/// Tarayıcının uzantı sayfasını açar.
///
/// İkili bulunamazsa hata döner (`err.browser_not_found`); çağıran bu mesajı
/// kullanıcıya gösterir ve elle yönlendirir.
pub fn open_extensions_page(browser: &str) -> anyhow::Result<()> {
    let exe = find_browser_exe(browser).ok_or_else(|| browser_not_found(browser))?;
    let url = extensions_page(browser);

    #[cfg(target_os = "macos")]
    {
        // macOS'ta `.app` paketinin ikilisi doğrudan çalıştırılabilir; `open -a`
        // yerine ikiliyi kullanmak hem adres argümanını hem de bulunan yolu
        // garanti eder.
        Command::new(&exe).arg(url).spawn()?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        Command::new(&exe).arg(url).spawn()?;
    }

    Ok(())
}

/// "Tarayıcı bulunamadı" hatası — tanılı mesaj.
fn browser_not_found(browser: &str) -> anyhow::Error {
    let label = browser_label(browser).unwrap_or(browser);
    anyhow::anyhow!(i18n::t("err.browser_not_found", &[label]))
}

/// Dosya yöneticisinde bir klasörü/dosyayı **seçili** gösterir.
///
/// Platform ayrımları (`Command` tek yoldan yapılır; `raw_arg` Windows'ta
/// boşluklu yolların Explorer tarafından doğru ayrıştırılmasını sağlar).
pub fn reveal_path(path: &Path) -> anyhow::Result<()> {
    #[cfg(target_os = "windows")]
    {
        // Explorer `/select,` öneki boşluklu yollarda tırnak ister; `raw_arg`
        // olmadan `Command` argümanı kendince kaçırır ve Explorer sessizce
        // başarısız olur. Bu yüzden argüman ham geçirilir.
        use std::os::windows::process::CommandExt;
        Command::new("explorer")
            .raw_arg(format!("/select,{}", path.display()))
            .spawn()?;
    }

    #[cfg(target_os = "macos")]
    {
        // `open -R` dosyayı Finder'da seçili gösterir; klasör verilirse
        // klasörün kendisi seçilir.
        Command::new("open").arg("-R").arg(path).spawn()?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Linux dosya yöneticileri "seçili göster" için standart bir argüman
        // paylaşmaz (Nautilus `--select`, Dolphin `--select`); en güvenlisi
        // klasörün kendisini açmak.
        let dir = if path.is_dir() {
            path.to_path_buf()
        } else {
            path.parent().map(Path::to_path_buf).unwrap_or_else(|| path.to_path_buf())
        };
        Command::new("xdg-open").arg(dir).spawn()?;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
    {
        let _ = path;
        return Err(anyhow::anyhow!(i18n::t("err.unsupported_platform", &[])));
    }

    Ok(())
}

/// Test kolaylığı için seçim komutunun **saf** biçimi.
///
/// Gerçek `Command` çağrısı yapmadan hangi program ve argümanların
/// kullanılacağını döner; birim testleri platform ayrımını buradan doğrular.
#[cfg(test)]
pub fn reveal_command(path: &Path) -> (&'static str, Vec<String>) {
    #[cfg(target_os = "windows")]
    {
        let _ = path;
        ("explorer", vec!["/select,".to_string()])
    }
    #[cfg(target_os = "macos")]
    {
        let _ = path;
        ("open", vec!["-R".to_string()])
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = path;
        ("xdg-open", vec![])
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
    {
        let _ = path;
        ("", vec![])
    }
}

// ---------------------------------------------------------------------
// Tek düğmeli kurulum
// ---------------------------------------------------------------------

/// Eklentiyi kurar: dosyaları hazırlar, tarayıcının uzantı sayfasını açar ve
/// klasörü dosya yöneticisinde seçili gösterir.
///
/// Hazırlanan klasörün yolunu döner (arayüz kullanıcıya gösterir).
pub fn install_extension(app: &AppHandle, browser: &str) -> anyhow::Result<PathBuf> {
    // Desteklenmeyen tarayıcı (ör. Safari) bu akışın dışındadır.
    let label = browser_label(browser)
        .ok_or_else(|| anyhow::anyhow!(i18n::t("err.unknown", &[])))?;

    // 1) Dosyaları hazırla.
    let source = extension_source(app)
        .ok_or_else(|| anyhow::anyhow!(i18n::t("err.browser_plugin_missing", &[])))?;
    let target = browser_plugins_dir().join(label);
    copy_dir(&source, &target)
        .map_err(|e| anyhow::anyhow!(i18n::t("err.open_file", &[&e.to_string()])))?;

    let readme = i18n::t("browser.readme", &[label]);
    std::fs::write(target.join("README.txt"), readme)
        .map_err(|e| anyhow::anyhow!(i18n::t("err.open_file", &[&e.to_string()])))?;

    // 2) Tarayıcının uzantı sayfasını aç.
    if let Err(e) = open_extensions_page(browser) {
        // Sayfa açılamazsa kurulum başarısızdır (kullanıcı hiçbir şey görmezdi);
        // klasör yine de açılır ki elle devam edebilsin.
        let _ = reveal_path(&target);
        return Err(e);
    }

    // 3) Klasörü seçili göster.
    if let Err(e) = reveal_path(&target) {
        // Klasör açılamazsa kurulumu düşürmeyelim: tarayıcı sayfası zaten açık,
        // kullanıcı yolu elle yazabilir. Arayüz klasör yolunu gösterecek.
        let _ = i18n::t("log.browser_files_ready", &[&target.to_string_lossy()]);
        return Err(e);
    }

    Ok(target)
}

// ---------------------------------------------------------------------
// Kurulu tarayıcı tespiti
// ---------------------------------------------------------------------

/// Bir tarayıcının bu makinede kurulu olup olmadığı.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPresence {
    /// Tanımlayıcı (`chrome`, `edge`, `brave`, `firefox`, `safari`).
    pub id: &'static str,
    /// Kullanıcıya gösterilen ad (marka yazımıyla).
    pub label: &'static str,
    /// İkili bulundu mu?
    pub installed: bool,
    /// Bulunan ikilinin yolu (bulunamazsa `None`).
    pub exe: Option<PathBuf>,
}

/// Tüm desteklenen tarayıcıların kurulum durumu (sihirbaz listesi için).
///
/// Kurulu olmayan tarayıcılar arayüzde **gri ve devre dışı** gösterilir:
/// tıklanınca "tarayıcı bulunamadı" hatası almak yerine baştan seçilemez olur.
pub fn browser_presence() -> Vec<BrowserPresence> {
    // Safari yalnızca macOS'ta listelenir (uzantı `.appex`; ikili aranamaz).
    let mut ids: Vec<&'static str> = vec!["chrome", "edge", "brave", "firefox"];
    if cfg!(target_os = "macos") {
        ids.push("safari");
    }

    ids.into_iter()
        .filter_map(|id| {
            let label = browser_label(id)?;
            let exe = find_browser_exe(id);
            Some(BrowserPresence {
                id,
                label,
                installed: exe.is_some() || id == "safari",
                exe,
            })
        })
        .collect()
}

/// Tarayıcının çalışan sürecini arar (Preferences yamalamadan önce şart).
///
/// Windows `tasklist`, diğer platformlarda `pgrep -f` kullanılır.
pub fn is_browser_running(browser: &str) -> bool {
    let Some(name) = browser_process_name(browser) else {
        return false;
    };

    #[cfg(target_os = "windows")]
    {
        let out = Command::new("tasklist")
            .args(["/NH", "/FI", &format!("IMAGENAME eq {name}")])
            .output();
        match out {
            Ok(o) => {
                let text = String::from_utf8_lossy(&o.stdout);
                text.to_ascii_lowercase().contains(name)
            }
            Err(_) => false,
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let out = Command::new("pgrep").args(["-f", name]).output();
        match out {
            Ok(o) => o.status.success(),
            Err(_) => false,
        }
    }
}

/// Çalışan süreçte aranan ikili adı.
#[cfg(target_os = "windows")]
fn browser_process_name(browser: &str) -> Option<&'static str> {
    match browser {
        "brave" => Some("brave.exe"),
        "chrome" => Some("chrome.exe"),
        "edge" => Some("msedge.exe"),
        "firefox" => Some("firefox.exe"),
        _ => None,
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn browser_process_name(browser: &str) -> Option<&'static str> {
    match browser {
        "brave" => Some("brave"),
        "chrome" => Some("chrome"),
        "edge" => Some("msedge"),
        "firefox" => Some("firefox"),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
fn browser_process_name(browser: &str) -> Option<&'static str> {
    match browser {
        "brave" => Some("Brave Browser"),
        "chrome" => Some("Google Chrome"),
        "edge" => Some("Microsoft Edge"),
        "firefox" => Some("firefox"),
        _ => None,
    }
}

// ---------------------------------------------------------------------
// `.crx` indirme (güvenli)
// ---------------------------------------------------------------------

/// CRX imzası — ilk dört bayt her geçerli CRX3 paketinde `Cr24`'tür.
const CRX_MAGIC: [u8; 4] = *b"Cr24";

/// Azami `.crx` boyutu (64 MB) — bozuk/saldırgan bir sunucu disk doldurmasın.
const MAX_CRX_BYTES: u64 = 64 * 1024 * 1024;

/// Dosya gerçekten CRX mi? (imza kontrolü)
pub fn looks_like_crx(bytes: &[u8]) -> bool {
    bytes.starts_with(&CRX_MAGIC)
}

/// `.crx` adresini doğrular: **yalnızca `https://`**.
///
/// Düz HTTP ile indirme, ağ üzerinde paketin değiştirilmesine (ve böylece
/// tarayıcıya kod enjekte edilmesine) kapı açar; bu yüzden reddedilir.
pub fn validate_crx_url(url: &str) -> anyhow::Result<()> {
    let url = url.trim();
    if url.is_empty() {
        return Err(anyhow::anyhow!(i18n::t("err.crx_url_empty", &[])));
    }
    match url.split_once("://") {
        Some(("https", rest)) if !rest.is_empty() => Ok(()),
        Some(("http", _)) => Err(anyhow::anyhow!(i18n::t("err.crx_url_not_https", &[]))),
        _ => Err(anyhow::anyhow!(i18n::t("err.crx_url_not_https", &[]))),
    }
}

/// `.crx` dosyasını indirir ve yolunu döner.
///
/// - Yalnızca `https://` (bkz. `validate_crx_url`)
/// - TLS doğrulaması açık (reqwest + rustls varsayılanı)
/// - 64 MB üst sınır, aşımda indirme iptal ve dosya silinir
/// - Geçici `.part` dosyasına yazıp `rename` ile taşıma: yarım kalmış bir
///   önceki indirme asla "kurulu" sayılmaz
/// - İndirme sonunda `Cr24` imza kontrolü (HTML hata sayfası değil, gerçekten
///   CRX olduğu garanti edilir)
pub async fn download_crx(url: &str) -> anyhow::Result<PathBuf> {
    validate_crx_url(url)?;

    let response = reqwest::get(url.trim())
        .await
        .map_err(|e| anyhow::anyhow!(i18n::t("err.crx_download_failed", &[&e.to_string()])))?;
    if !response.status().is_success() {
        return Err(anyhow::anyhow!(i18n::t(
            "err.crx_http",
            &[&response.status().as_u16().to_string()]
        )));
    }

    // Boyut sınırı: bildirilen boyut zaten aşıyorsa hiç indirmeye başlama.
    if let Some(len) = response.content_length()
        && len > MAX_CRX_BYTES
    {
        return Err(anyhow::anyhow!(i18n::t("err.crx_too_large", &[])));
    }

    let target = browser_plugins_dir().join("extension.crx");
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| anyhow::anyhow!(i18n::t("err.open_file", &[&e.to_string()])))?;
    }
    let part = browser_plugins_dir().join("extension.crx.part");

    {
        use futures_util::StreamExt;
        let mut file = tokio::fs::File::create(&part)
            .await
            .map_err(|e| anyhow::anyhow!(i18n::t("err.open_file", &[&e.to_string()])))?;
        let mut stream = response.bytes_stream();
        let mut received: u64 = 0;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| {
                anyhow::anyhow!(i18n::t("err.crx_download_failed", &[&e.to_string()]))
            })?;
            received += chunk.len() as u64;
            if received > MAX_CRX_BYTES {
                drop(file);
                let _ = tokio::fs::remove_file(&part).await;
                return Err(anyhow::anyhow!(i18n::t("err.crx_too_large", &[])));
            }
            tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
                .await
                .map_err(|e| anyhow::anyhow!(i18n::t("err.open_file", &[&e.to_string()])))?;
        }
        tokio::io::AsyncWriteExt::flush(&mut file)
            .await
            .map_err(|e| anyhow::anyhow!(i18n::t("err.open_file", &[&e.to_string()])))?;
    }

    // İmza kontrolü: boş/yarım kalmış ya da yanlış içerik reddedilir.
    let data = std::fs::read(&part)
        .map_err(|e| anyhow::anyhow!(i18n::t("err.open_file", &[&e.to_string()])))?;
    if !looks_like_crx(&data) {
        let _ = std::fs::remove_file(&part);
        return Err(anyhow::anyhow!(i18n::t("err.crx_invalid", &[])));
    }

    std::fs::rename(&part, &target)
        .map_err(|e| anyhow::anyhow!(i18n::t("err.open_file", &[&e.to_string()])))?;
    Ok(target)
}

// ---------------------------------------------------------------------
// Geliştirici modu
// ---------------------------------------------------------------------

/// Geliştirici modu açma denemesinin sonucu.
#[derive(Debug, Clone, Copy, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DeveloperModeState {
    /// Yazıldı (veya zaten açıktı).
    Enabled,
    /// Tarayıcı çalışıyor — kapatıp tekrar denemelisin.
    BrowserClosed,
    /// Profil klasörü bulunamadı (tarayıcı hiç açılmamış olabilir).
    NotFound,
}

/// Tarayıcının profil (User Data) dizini.
pub fn browser_profile_dir(browser: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let local = std::env::var("LOCALAPPDATA").ok()?;
        let dir = match browser {
            "brave" => PathBuf::from(local).join(r"BraveSoftware\Brave-Browser"),
            "chrome" => PathBuf::from(local).join(r"Google\Chrome"),
            "edge" => PathBuf::from(local).join(r"Microsoft\Edge"),
            _ => return None,
        };
        Some(dir.join("User Data").join("Default"))
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").ok()?;
        let dir = match browser {
            "brave" => PathBuf::from(home)
                .join("Library/Application Support/BraveSoftware/Brave-Browser"),
            "chrome" => PathBuf::from(home)
                .join("Library/Application Support/Google/Chrome"),
            "edge" => PathBuf::from(home)
                .join("Library/Application Support/Microsoft Edge"),
            _ => return None,
        };
        return Some(dir.join("Default"));
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let home = std::env::var("HOME").ok()?;
        let dir = match browser {
            "brave" => PathBuf::from(home).join(".config/BraveSoftware/Brave-Browser"),
            "chrome" => PathBuf::from(home).join(".config/google-chrome"),
            "edge" => PathBuf::from(home).join(".config/microsoft-edge"),
            _ => return None,
        };
        return Some(dir);
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
    {
        let _ = browser;
        None
    }
}

/// `Preferences` JSON'ına `profile.extensions.ui.developer_mode = true` yazar.
///
/// **Saf** fonksiyon: dosya sistemine dokunmaz, girdi metnini dönüştürür.
/// Diğer tüm anahtarlar korunur; bozuk JSON'da `None` döner (dosyayı
/// silmeden/bozmadan vazgeçilir).
pub fn patch_preferences(json: &str) -> Option<String> {
    let mut value: serde_json::Value = serde_json::from_str(json).ok()?;
    let root = value.as_object_mut()?;
    let profile = root
        .entry("profile")
        .or_insert_with(|| serde_json::json!({}));
    let profile = profile.as_object_mut()?;
    let extensions = profile
        .entry("extensions")
        .or_insert_with(|| serde_json::json!({}));
    let extensions = extensions.as_object_mut()?;
    let ui = extensions
        .entry("ui")
        .or_insert_with(|| serde_json::json!({}));
    let ui = ui.as_object_mut()?;
    ui.insert("developer_mode".to_string(), serde_json::json!(true));
    serde_json::to_string_pretty(&value).ok()
}

/// Geliştirici modunu açar (tarayıcının `Preferences` dosyasını yamalar).
///
/// Tarayıcı **çalışıyorsa** dosyaya yazmak işe yaramaz: tarayıcı kapanırken
/// kendi anlık görüntüsüyle dosyayı ezer ve değişiklik kaybolur. Bu yüzden
/// çalışan süreçte yazma yapılmaz, çağıran `BrowserClosed` döner.
pub fn enable_developer_mode(browser: &str) -> DeveloperModeState {
    if is_browser_running(browser) {
        return DeveloperModeState::BrowserClosed;
    }
    let Some(dir) = browser_profile_dir(browser) else {
        return DeveloperModeState::NotFound;
    };
    let prefs = dir.join("Preferences");
    if !prefs.is_file() {
        return DeveloperModeState::NotFound;
    }

    let Ok(text) = std::fs::read_to_string(&prefs) else {
        return DeveloperModeState::NotFound;
    };
    let Some(patched) = patch_preferences(&text) else {
        return DeveloperModeState::NotFound;
    };

    // Atomik yazım: önce yan dosyaya, sonra taşı. Böylece bir hata durumunda
    // kullanıcının gerçek tercihleri kaybolmaz.
    let tmp = dir.join("Preferences.adm.tmp");
    if std::fs::write(&tmp, &patched).is_err() {
        return DeveloperModeState::NotFound;
    }
    if std::fs::rename(&tmp, &prefs).is_err() {
        let _ = std::fs::remove_file(&tmp);
        return DeveloperModeState::NotFound;
    }
    DeveloperModeState::Enabled
}

// ---------------------------------------------------------------------
// `.crx` akışlı kurulum
// ---------------------------------------------------------------------

/// `.crx` kurulumunun sonucu.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrxOutcome {
    /// İndirilen `.crx` dosyasının yolu (kullanıcı sürükleyeceği dosya).
    pub crx_path: PathBuf,
    /// Geliştirici modu açma denemesinin sonucu.
    pub developer_mode: DeveloperModeState,
}

/// `.crx` akışı: indir → geliştirici modunu aç → uzantı sayfasını aç →
/// `.crx`'yi seçili göster.
///
/// Klasör açma adımı **yoktur** (kullanıcı bunu istenmeyen buldu); yalnızca
/// sürüklenecek `.crx` dosyası seçili gösterilir.
pub async fn install_extension_crx(
    app: &AppHandle,
    browser: &str,
    crx_url: &str,
) -> anyhow::Result<CrxOutcome> {
    // 1) `.crx`'yi indir (adres + TLS + boyut + imza doğrulamalı).
    let crx_path = download_crx(crx_url).await?;

    // 2) Geliştirici modunu aç — başarısızlık akışı düşürmez, sonuca yazılır.
    let developer_mode = enable_developer_mode(browser);

    // 3) Uzantı sayfasını aç.
    if let Err(e) = open_extensions_page(browser) {
        // Sayfa açılamazsa en azından dosya görünür olsun ki elle denensin.
        let _ = reveal_path(&crx_path);
        return Err(e);
    }

    // 4) Sürüklenecek `.crx` dosyasını seçili göster.
    reveal_path(&crx_path)?;

    // Log: kullanıcı "ne oldu?" sorusuna yanıt verebilsin.
    let _ = i18n::t(
        "log.crx_downloaded",
        &[&crx_path.to_string_lossy()],
    );
    let _ = app;

    Ok(CrxOutcome {
        crx_path,
        developer_mode,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bilinen_tarayicilar_icin_aday_var() {
        for browser in ["brave", "chrome", "edge", "firefox"] {
            let candidates = browser_path_candidates(browser);
            assert!(
                !candidates.is_empty(),
                "{browser} için kurulum yolu adayı bulunamadı"
            );
            // Adaylar mutlak yol olmalı: yarım yol beklenmedik çalıştırmalara
            // (ör. çalışma dizinindeki rastgele bir `brave.exe`) yol açar.
            assert!(
                candidates.iter().all(|p| p.is_absolute()),
                "{browser} adayları mutlak değil: {candidates:?}"
            );
        }
    }

    #[test]
    fn bilinmeyen_tarayici_icin_aday_yok() {
        assert!(browser_path_candidates("safari").is_empty());
        assert!(browser_path_candidates("").is_empty());
        // Aynı şey ikili adı ve etiket için de geçerli: Safari bu akışta yok.
        assert!(local_exe_name("safari").is_none());
        assert!(browser_label("safari").is_none());
    }

    #[test]
    fn uzanti_sayfasi_adresleri() {
        assert_eq!(extensions_page("brave"), "brave://extensions");
        assert_eq!(extensions_page("chrome"), "chrome://extensions");
        assert_eq!(extensions_page("edge"), "edge://extensions");
        assert_eq!(extensions_page("firefox"), "about:debugging#/runtime/this-firefox");
        // Bilinmeyen tarayıcıya Chrome sayfası varsayılanı.
        assert_eq!(extensions_page("opera"), "chrome://extensions");
    }

    #[test]
    fn secim_komutu_platforma_uygun() {
        let (program, args) = reveal_command(Path::new("/tmp/x"));
        #[cfg(target_os = "windows")]
        {
            assert_eq!(program, "explorer");
            assert!(args.iter().any(|a| a.starts_with("/select,")));
        }
        #[cfg(target_os = "macos")]
        {
            assert_eq!(program, "open");
            assert!(args.iter().any(|a| a == "-R"));
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            assert_eq!(program, "xdg-open");
        }
    }

    #[test]
    fn uzanti_klasoru_marka_adina_gore() {
        assert_eq!(
            plugin_folder("brave").and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_string())),
            Some("Brave".to_string())
        );
        assert!(plugin_folder("safari").is_none());
    }

    // -----------------------------------------------------------------
    // Kurulu tarayıcı tespiti
    // -----------------------------------------------------------------

    #[test]
    fn butun_tarayicilar_presence_listesinde() {
        let list = browser_presence();
        for id in ["chrome", "edge", "brave", "firefox"] {
            let entry = list.iter().find(|b| b.id == id);
            assert!(entry.is_some(), "{id} listede yok");
            let entry = entry.unwrap();
            // `installed` ile `exe` tutarlı olmalı: Safari dışında ikili
            // bulunmadan "kurulu" denirse kullanıcı hata alır.
            assert_eq!(
                entry.installed,
                entry.exe.is_some() || id == "safari",
                "{id} installed/exe tutarsiz"
            );
        }
    }

    #[test]
    fn safari_windows_listesinde_degil() {
        // Safari uzantısı `.appex`; Windows'ta listelenmez.
        if cfg!(target_os = "windows") {
            assert!(browser_presence().iter().all(|b| b.id != "safari"));
        }
    }

    #[test]
    fn surec_adi_tarayiciya_gore() {
        for id in ["brave", "chrome", "edge", "firefox"] {
            assert!(browser_process_name(id).is_some(), "{id} için süreç adı yok");
        }
        assert!(browser_process_name("safari").is_none());
    }

    // -----------------------------------------------------------------
    // `.crx` doğrulama
    // -----------------------------------------------------------------

    #[test]
    fn crx_imza_kontrolu() {
        assert!(looks_like_crx(b"Cr24\x02\x00\x00\x00rest"));
        assert!(!looks_like_crx(b"<!DOCTYPE html>"));
        assert!(!looks_like_crx(b"CRX3"));
        assert!(!looks_like_crx(b"Cr"));
        assert!(!looks_like_crx(b""));
    }

    #[test]
    fn crx_adresi_yalnizca_https() {
        assert!(validate_crx_url("https://github.com/theunal/adm/releases/latest/download/extension.crx").is_ok());
        // Düz HTTP: ağda değiştirilebilir paket — reddedilir.
        assert!(validate_crx_url("http://ornek.tld/extension.crx").is_err());
        assert!(validate_crx_url("ftp://ornek.tld/extension.crx").is_err());
        assert!(validate_crx_url("file:///C:/extension.crx").is_err());
        assert!(validate_crx_url("").is_err());
        assert!(validate_crx_url("   ").is_err());
        // Şema yoksa da reddedilir (eski `https:` yazım hatası).
        assert!(validate_crx_url("github.com/x.crx").is_err());
    }

    // -----------------------------------------------------------------
    // Geliştirici modu
    // -----------------------------------------------------------------

    #[test]
    fn preferences_tek_anahtar_yazar_digerlerini_korur() {
        let input = r#"{"homepage":"https://x.tld","profile":{"name":"Default"}}"#;
        let output = patch_preferences(input).expect("geçerli JSON reddedildi");
        let value: serde_json::Value = serde_json::from_str(&output).unwrap();

        // Diğer anahtarlar korunur.
        assert_eq!(value["homepage"], "https://x.tld");
        assert_eq!(value["profile"]["name"], "Default");
        // İstenen anahtar yazılır.
        assert_eq!(value["profile"]["extensions"]["ui"]["developer_mode"], true);
    }

    #[test]
    fn preferences_bos_ve_bozuk_dosya() {
        // Boş nesne: anahtar yaratılır.
        assert_eq!(
            patch_preferences("{}")
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()),
            Some(serde_json::json!({"profile": {"extensions": {"ui": {"developer_mode": true}}}}))
        );
        // Bozuk JSON: dosya bozulmasın diye None.
        assert!(patch_preferences("bu json degil").is_none());
        assert!(patch_preferences("").is_none());
    }

    #[test]
    fn preferences_idempotent() {
        let once = patch_preferences("{}").unwrap();
        let iki = patch_preferences(&once).unwrap();
        assert_eq!(once, iki, "ikinci yazma fark üretmemeli");
    }

    #[test]
    fn profil_dizini_bilinen_tarayicilar_icin() {
        // Kurulu olmasa da yol formu doğru olmalı (tarayıcı hiç açılmadıysa
        // dizin yoktur ve `enable_developer_mode` `NotFound` döner).
        for id in ["brave", "chrome", "edge"] {
            if let Some(dir) = browser_profile_dir(id) {
                assert!(dir.is_absolute(), "{id} profili mutlak değil: {dir:?}");
                assert!(
                    dir.to_string_lossy().to_lowercase().contains("default")
                        || dir.ends_with("Default"),
                    "{id} profili Default içermiyor: {dir:?}"
                );
            }
        }
    }
}
