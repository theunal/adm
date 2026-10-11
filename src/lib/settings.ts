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

export { settings, settingsReady };