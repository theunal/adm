/**
 * Uygulama ayarları — dil, varsayılan kanal sayısı ve indirme konumları.
 *
 * Tek kaynak `settings` tablosudur (`src-tauri/src/db.rs`). Ayar
 * **yalnızca** buradan okunur ve buradan yazılır; arayüz başka bir yerden
 * kalıcı dil tutmaz.
 *
 * Yazma sırası önemlidir:
 *
 * 1. Rust'a `save_settings` gönderilir (kalıcı + Rust tarafındaki dil).
 * 2. Ardından `applyLocale` ile arayüz dili güncellenir.
 * 3. Son olarak `notifyLocaleChanged` tetiklenir; liste yeniden yüklenirken
 *    kalıcı hata mesajları **yeni** dilde çevrilir.
 *
 * Sıra tersine çevrilirse liste eski dilde yeniden yüklenirdi.
 */
import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { getSettings, saveSettings, type Settings } from "./api";
import {
  applyLocale,
  detectLocale,
  notifyLocaleChanged,
  type Locale,
} from "./i18n";

export type { Settings };

/** Kanal sayısı aralığı (Rust tarafıyla aynı). */
export const MIN_CHANNELS = 1;
export const MAX_CHANNELS = 32;

/** Kanal sayısı önayarları (formla aynı). */
export const CHANNEL_PRESETS = [1, 4, 8, 16, 32];

/**
 * Ayarlar okunana kadar geçerli sayılan değerler.
 *
 * Rust tarafındaki `Settings::default()` ile **aynı** olmalıdır; uygulama
 * ilk boyamada bu değerleri gösterir, ardından gerçek ayarlar gelir.
 */
function fallback(): Settings {
  return {
    lang: detectLocale(),
    defaultChannelCount: 8,
    videoDir: null,
    audioDir: null,
    otherDir: null,
    defaultDir: "",

    serverPort: 48213,
    maxConcurrent: 3,
    autoStart: true,
    notifyOnComplete: true,
    showDetailOnStart: true,
    autoCloseDetail: false,
    watchClipboard: true,
    captureGroupIds: [],
    customExtensions: "",
    organizeByCategory: true,
    ytdlpPath: "",
    videoFormat: "",
    videoContainer: "mp4",
    videoMaxHeight: 1080,
    checkForUpdates: true,
    startInTray: false,
    closeToTray: true,
    autostart: false,
    denoPromptSuppressed: false,
    lastUpdateCheck: null,
    skippedUpdateVersion: null,
  };
}

const [settings, setSettings] = createStore<Settings>(fallback());

/** Ayarlar yüklendi mi? (Uygulama kabuğu bunu bekler.) */
const [settingsReady, setSettingsReady] = createSignal(false);

/** Kanal sayısını geçerli aralığa sıkıştırır. */
function clampChannels(count: number): number {
  if (!Number.isFinite(count)) return MIN_CHANNELS;
  return Math.min(MAX_CHANNELS, Math.max(MIN_CHANNELS, Math.round(count)));
}

/** Boş metni `null` yapar (Rust tarafındaki `Option<PathBuf>` ile eşleşir). */
function emptyToNull(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text.length > 0 ? text : null;
}

/**
 * Ayarları bir kez okur ve dili uygular.
 *
 * Hata olursa varsayılanlarla devam edilir; uygulama açılmaz çalışmaz.
 */
export async function initSettings(): Promise<void> {
  try {
    const loaded = await getSettings();
    setSettings(reconcile({ ...loaded, defaultChannelCount: clampChannels(loaded.defaultChannelCount) }));
    await applyLocale(loaded.lang);
  } catch {
    // Ayar okunamazsa geçici değerlerle devam; Rust tarafı da TR'de kalır.
    await applyLocale(settings.lang);
  } finally {
    setSettingsReady(true);
  }
}

/**
 * Mevcut ayarların bir kopyası.
 *
 * Tüm alanlar kopyalanır: `updateSettings` bu kopyanın üzerine yama uygular,
 * eksik alan bırakmak Rust tarafında o alanı varsayılana döndürürdü.
 */
function snapshot(): Settings {
  return { ...settings };
}

/**
 * Ayarı arayüzde ve kalıcı olarak günceller.
 *
 * Önce Rust'a yazılır; **başarılı olursa** arayüz durumu güncellenir. Böylece
 * yazma başarısız olduğunda arayüz ile Rust'un dili ayrışmaz. Hata çağırana
 * iletilir (arayüz değişmeden).
 *
 * Dil değişirse `onLocaleChange` geri çağrıları tetiklenir (liste yenilenir).
 */
export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const next: Settings = { ...snapshot(), ...patch };
  next.defaultChannelCount = clampChannels(next.defaultChannelCount);
  next.videoDir = emptyToNull(next.videoDir);
  next.audioDir = emptyToNull(next.audioDir);
  next.otherDir = emptyToNull(next.otherDir);
  next.defaultDir = (next.defaultDir ?? "").trim();

  const languageChanged = next.lang !== settings.lang;

  await saveSettings(next);

  setSettings(reconcile(next));

  if (languageChanged) {
    await applyLocale(next.lang);
    notifyLocaleChanged();
  }
}

/** Dili değiştirir (başlık çubuğu ve ayarlar ekranı). */
export async function changeLang(lang: Locale): Promise<void> {
  await updateSettings({ lang });
}

/** Varsayılan kanal sayısını değiştirir. */
export async function setDefaultChannels(count: number): Promise<void> {
  await updateSettings({ defaultChannelCount: count });
}

/* -----------------------------------------------------------------
   MC portu — video biçimi ve yakalama uzantıları
   ----------------------------------------------------------------- */

/** Seçilebilir azami çözünürlükler (`settings::VIDEO_MAX_HEIGHTS`). */
export const VIDEO_MAX_HEIGHTS = [-2, -1, 0, 360, 480, 720, 1080, 1440, 2160];

/** Seçilebilir kapsayıcılar (`Settings::normalize` ile aynı küme). */
export const VIDEO_CONTAINERS = ["mp4", "mkv", "webm", "original"] as const;

/** Kapsayıcı kimliği. */
export type VideoContainer = (typeof VIDEO_CONTAINERS)[number];

/**
 * Azami çözünürlük değerinin sözlük anahtarı.
 *
 * `-2`/`-1` ses modlarıdır, `0` "en iyi"dir; kalanlar `{yükseklik}p`.
 */
export function heightLabelKey(height: number): string {
  if (height === -2) return "settings.height.audio_mp3";
  if (height === -1) return "settings.height.audio_m4a";
  if (height <= 0) return "settings.height.best";
  return "settings.height.p";
}

/** Yükseklik etiketi için yer tutucular (yalnızca `p` biçiminde dolu). */
export function heightParams(height: number): Record<string, string | number> {
  return height > 0 ? { height } : {};
}

/**
 * Etkin yt-dlp biçim argümanlarını üretir.
 *
 * Rust `Settings::ytdlp_format_arguments` portudur; ayarlar sekmesindeki
 * önizleme bu listeyi **birebir** gösterir. Özel biçim doluysa yalnızca o
 * kullanılır; ses modlarında (`-1`, `-2`) ayıklama argümanları döner.
 */
export function formatArguments(source: Settings): string[] {
  const custom = source.videoFormat.trim();
  if (custom) {
    const container = source.videoContainer === "original" ? "mkv" : source.videoContainer;
    return ["-f", custom, "--merge-output-format", container];
  }

  if (source.videoMaxHeight === -1 || source.videoMaxHeight === -2) {
    const codec = source.videoMaxHeight === -1 ? "m4a" : "mp3";
    return ["-f", "ba/b", "-x", "--audio-format", codec, "--audio-quality", "0"];
  }

  const h = source.videoMaxHeight > 0 ? `[height<=${source.videoMaxHeight}]` : "";
  let expr: string;
  const args: string[] = [];

  switch (source.videoContainer) {
    case "mp4":
      // H.264 + AAC tercih edilir (QuickTime/iOS uyumlu); olmazsa
      // birleştirilip mp4'e çevrilir.
      expr = `bv*${h}[vcodec^=avc1]+ba[acodec^=mp4a]/bv*${h}[ext=mp4]+ba[ext=m4a]/bv*${h}+ba/b${h}/b`;
      args.push("--merge-output-format", "mp4", "--remux-video", "mp4");
      break;
    case "webm":
      expr = `bv*${h}[ext=webm]+ba[ext=webm]/bv*${h}+ba/b${h}/b`;
      args.push("--merge-output-format", "webm");
      break;
    case "mkv":
      expr = `bv*${h}+ba/b${h}/b`;
      args.push("--merge-output-format", "mkv");
      break;
    default:
      expr = `bv*${h}+ba/b${h}/b`;
      break;
  }

  return ["-f", expr, ...args];
}

/** Yakalama için seçilebilir gruplar (`capture::GROUPS` sırasıyla). */
export const CAPTURE_GROUPS = [
  "image",
  "music",
  "video",
  "apps",
  "document",
  "compressed",
] as const;

/** Yakalama grubu kimliği. */
export type CaptureGroup = (typeof CAPTURE_GROUPS)[number];

/** Grup → uzantı listesi (`capture::GROUPS` portu). */
const GROUP_EXTENSIONS: Record<CaptureGroup, string[]> = {
  image: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg", "ico", "heic", "tiff"],
  music: ["mp3", "flac", "wav", "aac", "ogg", "opus", "m4a", "wma", "aiff", "alac"],
  video: ["mp4", "mkv", "webm", "mov", "avi", "wmv", "flv", "m4v", "3gp", "ts"],
  apps: ["exe", "msi", "dmg", "pkg", "apk", "deb", "rpm", "appimage", "jar", "xpi"],
  document: [
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "epub", "mobi", "csv",
  ],
  compressed: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "zst", "iso", "img"],
};

/**
 * Seçili gruplar + özel listeden etkin uzantıları çıkarır.
 *
 * Rust `capture::extensions` portudur: küçük harfe indirir, baştaki noktayı
 * atar, yinelenenleri eler ve sıralar.
 */
export function captureExtensions(source: Settings): string[] {
  const out: string[] = [];

  for (const group of CAPTURE_GROUPS) {
    if (!source.captureGroupIds.includes(group)) continue;
    for (const ext of GROUP_EXTENSIONS[group]) {
      if (!out.includes(ext)) out.push(ext);
    }
  }

  for (const part of source.customExtensions.split(/[,;\s]+/)) {
    const ext = part.trim().replace(/^\./, "").toLowerCase();
    if (ext && /^[a-z0-9-]+$/.test(ext) && !out.includes(ext)) out.push(ext);
  }

  return out.sort();
}

export { settings, settingsReady };