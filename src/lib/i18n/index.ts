/**
 * Arayüz i18n altyapısı — locale sinyali ve çeviri.
 *
 * Akış:
 * 1. `detectLocale()` — sistem dili (`tr*`/`en*`), TR varsayılan.
 * 2. `locale()`      — anlık dil (`"tr" | "en"`); şablonlar bunu okur.
 * 3. `t(key, params)` — sözlükten metin + `{ad}` yer tutucuları + çoğul.
 * 4. `applyLocale()` — belge/pencere başlığını senkronlar.
 *
 * Dil **kalıcı** olarak `settings` tablosunda saklanır (`src-tauri/src/db.rs`),
 * bu yüzden bu modül yalnızca arayüz tarafını yönetir; kaydetme ve yükleme
 * `src/lib/settings.ts` üzerinden yapılır.
 *
 * Rust tarafındaki karşılık `src-tauri/src/i18n.rs`'dir; ikisi aynı anahtar
 * uzayını paylaşmaz (Rust mesajları kendi sözlüğünde yaşar), ancak ikisi de
 * `save_settings` komutuyla senkronlanır.
 */
import { createSignal } from "solid-js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { en } from "./en";
import { tr, type Dict, type Template } from "./tr";

export type { Dict, Template };
export type Locale = "tr" | "en";

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
 * Sistem diline göre başlangıç dili.
 *
 * Yalnızca **geçici** bir değerdir: ayarlar yüklenince `settings.ts`
 * kayıtlı dille değiştirir. Böylece ayar okunamazsa bile ilk boyamada
 * Türkçe/İngilizce arasında makul bir dil görünür.
 */
export function detectLocale(): Locale {
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

/** Dil uygulandıktan sonra çalışacak geri çağrılar. */
const afterLocaleChange = new Set<() => void>();

/**
 * Dil uygulandıktan **sonra** çağrılacak bir geri çağrı kaydeder.
 *
 * Rust'a ayarlar kaydedildikten sonra tetiklenir; böylece kalıcı
 * `error_message` kayıtları yeniden okunurken **yeni** dilde çevrilir.
 */
export function onLocaleChange(fn: () => void): void {
  afterLocaleChange.add(fn);
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

/**
 * Dili yalnızca **arayüzde** uygular (sinyal + belge + pencere başlığı).
 *
 * Kalıcılık burada yapılmaz: dil `settings` tablosunda saklanır ve
 * `settings.ts` üzerinden yazılır; böylece tek kaynak kalır.
 */
export async function applyLocale(lang: Locale): Promise<void> {
  setLocaleSignal(lang);
  applyDocument(lang);
  await applyWindowTitle();
}

/**
 * Dil değişikliğinin tamamlandığını bildirir: kayıtlı geri çağrıları tetikler.
 *
 * Bu noktada Rust tarafındaki dil **güncel** olmalıdır; aksi halde liste
 * yeniden yüklenirken kalıcı hata mesajları eski dilde çevrilir.
 */
export function notifyLocaleChanged(): void {
  for (const fn of afterLocaleChange) fn();
}