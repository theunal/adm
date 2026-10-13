/**
 * Tauri köprüsü — komut çağrıları ve olay aboneliği.
 *
 * Hata mesajları Rust tarafında `i18n.rs` sözlüğünden seçili dilde üretilir;
 * burada yalnızca taşınır. Diyalog başlıkları arayüzde üretildiği için
 * `lib/i18n` sözlüğünden gelir.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  BridgeStatus,
  DownloadEvent,
  DownloadItem,
  DownloadKind,
} from "./format";
import type { Locale } from "./i18n";
import { t } from "./i18n";

export type { BridgeStatus };

/** Rust `settings` tablosunun arayüz karşılığı. */
export interface Settings {
  /** Arayüz dili. */
  lang: Locale;
  /** Yeni indirmelerde varsayılan kanal sayısı (1..=32). */
  defaultChannelCount: number;
  /** Video hedef klasörü; boşsa genel hedefe düşer. */
  videoDir: string | null;
  /** Ses hedef klasörü. */
  audioDir: string | null;
  /** Diğer dosyaların hedef klasörü. */
  otherDir: string | null;
  /** Eşleşmeyen dosyaların (ve boş kategorilerin) hedefi. */
  defaultDir: string;

  // -----------------------------------------------------------------
  // MC portu ayarları
  // -----------------------------------------------------------------
  /** Tarayıcı köprüsünün dinlediği port (1024..=65535). */
  serverPort: number;
  /** Aynı anda çalışan indirme sayısı (1..=10). */
  maxConcurrent: number;
  /** Yeni indirmeler hemen başlar; kapalıysa kuyrukta bekler. */
  autoStart: boolean;
  /** Tamamlanınca bildirim göster. */
  notifyOnComplete: boolean;
  /** İndirme başlarken detay penceresini aç. */
  showDetailOnStart: boolean;
  /** Detay penceresini tamamlanınca kapat. */
  autoCloseDetail: boolean;
  /** Panoyu izleyip bulunan bağlantıları sor. */
  watchClipboard: boolean;
  /** Yakalanacak dosya türü grupları (`capture::DEFAULT_GROUPS`). */
  captureGroupIds: string[];
  /** Yakalamaya eklenen özel uzantılar (virgülle ayrılmış). */
  customExtensions: string;
  /** İndirmeleri kategori alt klasörlerine ayır. */
  organizeByCategory: boolean;
  /** Özel yt-dlp yolu (boş = PATH'teki/araçlar klasöründeki). */
  ytdlpPath: string;
  /** Özel yt-dlp `-f` ifadesi (boş = hazır seçiciler). */
  videoFormat: string;
  /** Video kapsayıcısı: `mp4` | `mkv` | `webm` | `original`. */
  videoContainer: string;
  /** Azami çözünürlük (0 = en iyi, -1 = ses m4a, -2 = ses mp3). */
  videoMaxHeight: number;
  /** Açılışta güncelleme denetle. */
  checkForUpdates: boolean;
  /** Uygulamayı tepki simgesinde (pencere açmadan) başlat. */
  startInTray: boolean;
  /** Pencere kapatılınca uygulamayı arka planda tut. */
  closeToTray: boolean;
  /** Windows oturum açılışında çalıştır. */
  autostart: boolean;
  /** deno kurulum sorusu bir daha sorulmasın. */
  denoPromptSuppressed: boolean;
  /** Son güncelleme denetimi (RFC 3339). */
  lastUpdateCheck: string | null;
  /** Kullanıcının atladığı sürüm. */
  skippedUpdateVersion: string | null;
  /** `.crx` eklenti paketinin indirileceği **https** adresi. */
  extensionCrxUrl: string;
}

/** Tauri olayının adı. */
export const DOWNLOAD_EVENT = "download://event";

/** Yeni indirme başlatır. */
export function startDownload(args: {
  url: string;
  filePath?: string | null;
  channelCount: number;
  /** `"video"` ise yt-dlp ile indirilir; varsayılan `"file"`. */
  kind?: DownloadKind;
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

/** Tamamlanmış / iptal edilmiş kayıtları temizler; silinen sayıyı döner. */
export function clearFinished(): Promise<number> {
  return invoke<number>("clear_finished");
}

/** Çalışan tüm indirmeleri duraklatır; etkilenen sayıyı döner. */
export function pauseAllDownloads(): Promise<number> {
  return invoke<number>("pause_all_downloads");
}

/** Sürdürülebilir tüm indirmeleri sürdürür; etkilenen sayıyı döner. */
export function resumeAllDownloads(): Promise<number> {
  return invoke<number>("resume_all_downloads");
}

/** Çalışan tüm indirmeleri iptal eder; etkilenen sayıyı döner. */
export function cancelAllDownloads(): Promise<number> {
  return invoke<number>("cancel_all_downloads");
}

/**
 * IDM tarzı ayrıntı penceresini açar (yoksa) ya da öne getirir.
 *
 * Pencerenin konusu `detail-<id>` etiketinden okunur; aynı indirme için ikinci
 * bir pencere açılmaz.
 */
export function openDetailWindow(id: number, fileName: string): Promise<void> {
  return invoke<void>("open_detail_window", { id, fileName });
}

/** Bir indirmenin ayrıntı penceresini kapatır (yoksa hata değildir). */
export function closeDetailWindow(id: number): Promise<void> {
  return invoke<void>("close_detail_window", { id });
}

/** Bir yolun bulunduğu birimde kalan bayt sayısı (durum çubuğu). */
export function diskFreeSpace(path: string): Promise<number> {
  return invoke<number>("disk_free_space", { path });
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

/** Uygulama ayarlarını okur. */
export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

/** Uygulama ayarlarını kaydeder; kaydedilen dil hemen etkinleşir. */
export function saveSettings(settings: Settings): Promise<void> {
  return invoke<void>("save_settings", { settings });
}

/**
 * Bir URL için ayarlara göre çözümlenen tam hedef yol.
 *
 * Yeni indirme formu bu değeri önizleme olarak gösterir; kullanıcı
 * "Gözat" ile değiştirebilir.
 */
export function resolveTargetPath(url: string): Promise<string> {
  return invoke<string>("resolve_target_path", { url });
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

/**
 * Klasör seçme diyaloğunu açar.
 *
 * Rust tarafındaki `dialog:allow-open` yetkisi sayesinde çalışır.
 */
export async function pickFolder(
  title: string,
  defaultDir?: string,
): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({
    directory: true,
    multiple: false,
    title,
    ...(defaultDir ? { defaultPath: defaultDir } : {}),
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

/* -----------------------------------------------------------------
   Tarayıcı köprüsü ve eklenti kurulumu (MC portu)
   ----------------------------------------------------------------- */

/**
 * Dosya kopyalanarak kurulan tarayıcılar (krom paketi).
 *
 * Safari bilinçli olarak buna dâhil değildir: uzantı `.appex` olduğu için
 * dosya kopyalanarak kurulamaz, indirilen ayrı bir `.app` içinde gelir.
 * `prepare_browser_files` / `open_plugin_folder` /
 * `open_browser_extensions_page` bu yüzden Safari'yi tanımaz.
 */
export type BrowserId = "chrome" | "edge" | "brave" | "firefox";

/** Sihirbazda gösterilebilecek tarayıcılar (macOS'ta Safari de gelir). */
export type WizardBrowser = BrowserId | "safari";

/** Köprünün durumunu okur. */
export function bridgeStatus(): Promise<BridgeStatus> {
  return invoke<BridgeStatus>("bridge_status");
}

/** Desteklenen tarayıcıların listesi. */
/** Tarayıcı listesi (macOS'ta Safari de dâhildir). */
export function browserList(): Promise<WizardBrowser[]> {
  return invoke<WizardBrowser[]>("browser_list");
}

/**
 * Sürüm sayfasını tarayıcıda açar.
 *
 * Adres Rust tarafında sabittir; arayüzün rastgele bir adresi açabilmesi için
 * `opener:allow-open-url` yetkisi gerekmez. Safari uzantısı bu sayfadaki
 * `safari-unsigned-macos.zip` dosyasından indirilir.
 */
export function openReleasePage(): Promise<void> {
  return invoke<void>("open_release_page");
}

/**
 * Bir tarayıcının bu makinede kurulu olup olmadığı.
 *
 * Kurulu olmayan tarayıcılar sihirbazda ve ayarlarda **gri ve devre dışı**
 * gösterilir: tıklınca "tarayıcı bulunamadı" hatası almak yerine baştan
 * seçilemez olur.
 */
export type BrowserPresence = {
  id: WizardBrowser;
  /** Kullanıcıya gösterilen ad (marka yazımıyla). */
  label: string;
  /** Tarayıcı ikilisi bulundu mu? */
  installed: boolean;
  /** Bulunan ikilinin yolu (bulunamazsa boş). */
  exe: string | null;
};

/** Kurulu tarayıcıların listesi + kurulum durumu. */
export function browserPresence(): Promise<BrowserPresence[]> {
  return invoke<BrowserPresence[]>("browser_presence");
}

/**
 * `.crx` akışıyla eklenti kurar.
 *
 * Rust tarafı: `.crx`'yi **https** adresinden indirir (boyut + imza
 * doğrulamalı), tarayıcının `Preferences` dosyasına `developer_mode = true`
 * yazar (tarayıcı çalışıyorsa atlanır), uzantı sayfasını açar ve `.crx`
 * dosyasını dosya yöneticisinde **seçili** gösterir.
 *
 * Kullanıcı tek yapar: dosyayı açılan sayfaya sürükler ve tarayıcının kendi
 * "Uzantı ekle" onayına basar.
 */
export type CrxOutcome = {
  /** İndirilen ve sürüklenecek `.crx` dosyasının yolu. */
  crxPath: string;
  /** Geliştirici modu açma denemesinin sonucu. */
  developerMode: "enabled" | "browserClosed" | "notFound";
};

export function installExtensionCrx(
  browser: BrowserId,
  crxUrl?: string,
): Promise<CrxOutcome> {
  return invoke<CrxOutcome>("install_extension_crx", { browser, crxUrl });
}

/** Eklenti dosyalarını tarayıcı klasörüne kopyalar.
 *
 * Dönen değer, "paketlenmemiş öğe yükle" için seçilecek klasörün yoludur.
 */
export function prepareBrowserFiles(browser: BrowserId): Promise<string> {
  return invoke<string>("prepare_browser_files", { browser });
}

/**
 * Klasör akışıyla eklenti kurar (`.crx` akışının **yedek** yolu).
 *
 * Eklenti dosyalarını klasöre kopyalar, tarayıcının uzantı sayfasını açar ve
 * klasörü dosya yöneticisinde seçili gösterir; kullanıcı "Paketlenmemiş öğe
 * yükle" ile klasörü seçer. Bazı Brave sürümlerinde `.crx` sürükle-bırak
 * çalışmadığı için bu akış her zaman erişilebilir durumda tutulur.
 */
export function installExtensionFolder(browser: BrowserId): Promise<string> {
  return invoke<string>("install_extension", { browser });
}

/** Eklenti klasörünü dosya yöneticisinde açar. */
export function openPluginFolder(browser: BrowserId): Promise<void> {
  return invoke<void>("open_plugin_folder", { browser });
}

/** Bir dosyayı (ör. indirilen `.crx`) dosya yöneticisinde seçili gösterir. */
export function revealFile(path: string): Promise<void> {
  return invoke<void>("reveal_path", { path });
}

/** Tarayıcının uzantı yönetimi sayfasını açar. */
export function openBrowserExtensionsPage(browser: BrowserId): Promise<void> {
  return invoke<void>("open_browser_extensions_page", { browser });
}

/* -----------------------------------------------------------------
   Harici araçlar (yt-dlp / ffmpeg / deno)
   ----------------------------------------------------------------- */

/**
 * Harici araç kimlikleri.
 *
 * `tools::Tool::as_str()` değerleriyle birebir aynıdır (`ytdlp`, `ffmpeg`,
 * `deno`) — bu dizeler `install_tool` komutuna argüman olarak gider.
 */
export type ToolId = "ytdlp" | "ffmpeg" | "deno";

/** Bir aracın kurulum durumu. */
export interface ToolStatus {
  tool: string;
  installed: boolean;
  path: string | null;
  version: string | null;
}

/** Kurulu araçların durumu. */
export function toolStatus(): Promise<ToolStatus[]> {
  return invoke<ToolStatus[]>("tool_status");
}

/** Aracı indirip kurar; ilerleme `download://event` ile yayınlanır. */
export function installTool(tool: ToolId): Promise<string> {
  return invoke<string>("install_tool", { tool });
}

/* -----------------------------------------------------------------
   Site girişi (çerezler)
   ----------------------------------------------------------------- */

/** WebView2'den toplanan tek bir çerez. */
export interface SiteCookie {
  domain: string;
  path: string;
  secure: boolean;
  expirationDate: number;
  name: string;
  value: string;
}

/** Kayıtlı çerez dosyasının durumu. */
export interface SiteLoginStatus {
  cookieCount: number;
  savedAt: string | null;
  domains: string[];
}

/** Kayıtlı site girişi çerezlerinin durumunu okur. */
export function siteLoginStatus(): Promise<SiteLoginStatus> {
  return invoke<SiteLoginStatus>("site_login_status");
}

/**
 * Uygulama içi giriş penceresini açar (MC `SiteLoginManager`).
 *
 * `url` verilmezse Google hesapları → YouTube adresi kullanılır. Pencere
 * zaten açıksa öne getirilir ve verilen adrese yönlendirilir.
 */
export function openSiteLogin(url?: string): Promise<void> {
  return invoke<void>("open_site_login", { url: url ?? null });
}

/**
 * Giriş penceresinin çerezlerini Netscape dosyasına yazar ve pencereyi kapatır.
 *
 * Kullanıcı pencere içinde oturum açtıktan sonra çağrılır; dönen değer
 * kaydedilen çerez sayısıdır.
 */
export function saveSiteLoginCookies(): Promise<number> {
  return invoke<number>("save_site_login_cookies");
}

/** Giriş penceresinden toplanan çerezleri Netscape dosyasına yazar. */
export function saveSiteCookies(cookies: SiteCookie[]): Promise<number> {
  return invoke<number>("save_site_cookies", { cookies });
}

/** Kayıtlı site girişi çerezlerini siler. */
export function clearSiteCookies(): Promise<void> {
  return invoke<void>("clear_site_cookies");
}

/* -----------------------------------------------------------------
   Güncelleme, pano ve tepsi
   ----------------------------------------------------------------- */

/** Güncellemeyi denetler; sonuç `download://event` ile yayınlanır. */
export function checkForUpdate(): Promise<void> {
  return invoke<void>("check_for_update");
}

/** Panodaki bağlantı sorusunu yanıtlandı olarak işaretler. */
export function answerClipboardPrompt(): Promise<void> {
  return invoke<void>("answer_clipboard_prompt");
}

/**
 * `Ctrl+V`: panodaki metinden bağlantıları alır ve soruyu açar.
 *
 * MC `handlePaste` gibi yalnızca http(s) bağlantıları kabul edilir; izleyicinin
 * dosya türü süzgeci uygulanmaz. Sonuç `clipboard` olayıyla gelir ve aynı
 * `ClipboardPromptDialog` gösterilir.
 *
 * Panoda uygun bağlantı yoksa hata döner (arayüz durum şeridinde gösterir).
 */
export function pasteDownload(): Promise<void> {
  return invoke<void>("paste_download");
}

/** Ana pencereyi gösterir ve öne getirir (tepsi menüsüyle aynı yol). */
export function trayShow(): Promise<void> {
  return invoke<void>("tray_show");
}
