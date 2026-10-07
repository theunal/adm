/**
 * Arayüz i18n altyapısı — locale sinyali, çeviri ve dil değiştirme.
 *
 * Akış:
 * 1. `detectLocale()` — `localStorage` → `navigator.language` → TR varsayılan.
 * 2. `locale()`      — anlık dil (`"tr" | "en"`); şablonlar bunu okur.
 * 3. `t(key, params)` — sözlükten metin + `{ad}` yer tutucuları + çoğul.
 * 4. `setLocale(next)` — sinyal + kalıcılık + belge/pencere başlığı + Rust.
 *
 * Rust tarafındaki karşılık `src-tauri/src/i18n.rs`'dir; ikisi aynı anahtar
 * uzayını paylaşmaz (Rust mesajları kendi sözlüğünde yaşar), ancak ikisi de
 * aynı `set_language` komutuyla senkronlanır.
 */
import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { en } from "./en";
import { tr, type Dict, type Template } from "./tr";

export type { Dict, Template };
export type Locale = "tr" | "en";

/** `localStorage` anahtarı. */
const STORAGE_KEY = "adm.lang";

/** Tanınmayan bir dil için varsayılan. */
const DEFAULT_LOCALE: Locale = "tr";

const DICTS: Record<Locale, Dict> = { tr, en };

/** Yer tutucu değerleri (sayılar metne çevrilir). */
export type Params = Record<string, string | number>;

/** Çoğul anahtarlarda `count` zorunludur. */
export type PluralParams = Params & { count: number };

// -----------------------------------------------------------------
// Locale algılama
// -----------------------------------------------------------------

/**
 * Başlangıç dilini belirler.
 *
 * Sıra: kayıtlı tercih → tarayıcı dili (`tr*`/`en*`) → Türkçe.
 */
export function detectLocale(): Locale {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (saved === "tr" || saved === "en") return saved;
  } catch {
    // localStorage erişilemez (gizli sekme / kısıtlı bağlam) — sessiz geç.
  }

  const nav =
    typeof navigator !== "undefined" ? (navigator.language ?? "") : "";
  const tag = nav.toLowerCase();
  if (tag.startsWith("tr")) return "tr";
  if (tag.startsWith("en")) return "en";
  return DEFAULT_LOCALE;
}

/** Aktif dil (başlangıçta `detectLocale()` sonucu). */
export const [locale, setLocaleSignal] = createSignal<Locale>(detectLocale());

/** `Intl` için dil etiketi (`tr-TR` / `en-US`). */
export function localeTag(): string {
  return locale() === "tr" ? "tr-TR" : "en-US";
}

// -----------------------------------------------------------------
// Çeviri
// -----------------------------------------------------------------

/** Çoğul biçim seçicileri (dillere göre önbelleklenir). */
const pluralRules = new Map<Locale, Intl.PluralRules>();

function rulesFor(lang: Locale): Intl.PluralRules {
  let rules = pluralRules.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(lang);
    pluralRules.set(lang, rules);
  }
  return rules;
}

/** `{ad}` yer tutucularını doldurur. */
function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** Çoğul biçimi seçer; eşleşmeyen kategori için `other` kullanılır. */
function pickPlural(
  forms: { one: string; other: string },
  count: number,
): string {
  const category = rulesFor(locale()).select(count);
  return (forms as Record<string, string>)[category] ?? forms.other;
}

/**
 * Anahtarı çevirir.
 *
 * Bilinmeyen anahtar **kendini döner** — bu, eksik bir çevirinin üretimde
 * boş metin yerine okunabilir bir işaret görünmesini sağlar.
 */
export function t(key: string, params?: Params | PluralParams): string {
  const entry = DICTS[locale()][key as keyof Dict] as Template | undefined;
  if (entry === undefined) return key;

  const template =
    typeof entry === "string"
      ? entry
      : pickPlural(entry, Number((params as PluralParams | undefined)?.count ?? 0));

  return interpolate(template, params);
}

// -----------------------------------------------------------------
// Dil değiştirme
// -----------------------------------------------------------------

/** Dil değiştikten sonra çalışacak geri çağrılar (listeyi yenilemek için). */
const afterLocaleChange = new Set<() => void>();

/**
 * Dil uygulandıktan **sonra** çağrılacak bir geri çağrı kaydeder.
 *
 * Rust'a `set_language` gönderildikten sonra tetiklenir; böylece kalıcı
 * `error_message` kayıtları yeniden okunurken **yeni** dilde çevrilir.
 */
export function onLocaleChange(fn: () => void): void {
  afterLocaleChange.add(fn);
}

/** Tercihi kalıcılaştırır (localStorage erişilemezse sessiz geçer). */
function persist(lang: Locale): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, lang);
  } catch {
    // Yazma engelliyse dil yalnızca bu oturumda geçerli olur.
  }
}

/** `<html lang>`, `<title>` ve sekme etiketlerini günceller. */
function applyDocument(lang: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  document.title = t("title.window");
}

/** Pencere başlığını değiştirir (Tauri dışında sessizce atlanır). */
async function applyWindowTitle(): Promise<void> {
  try {
    await getCurrentWindow().setTitle(t("title.window"));
  } catch {
    // Tarayıcıda çalışıyordur; başlık zaten `document.title` ile güncellendi.
  }
}

/** Rust tarafındaki dile bildirir (Tauri dışında sessizce atlanır). */
async function notifyRust(lang: Locale): Promise<void> {
  try {
    await invoke("set_language", { lang });
  } catch {
    // Tarayıcı modunda Rust yok; arayüz yine de çalışır.
  }
}

/**
 * Dili değiştirir.
 *
 * Sinyal **eşzamanlı** güncellenir (arayüz anında yeniden çizilir), ardından
 * Rust'a bildirilir ve `onLocaleChange` geri çağrıları tetiklenir.
 */
export async function setLocale(lang: Locale): Promise<void> {
  setLocaleSignal(lang);
  persist(lang);
  applyDocument(lang);

  await notifyRust(lang);
  await applyWindowTitle();

  for (const fn of afterLocaleChange) fn();
}

/** Başka bir dile geçer (dil anahtarı düğmesi için). */
export function toggleLocale(): void {
  void setLocale(locale() === "tr" ? "en" : "tr");
}