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
}
