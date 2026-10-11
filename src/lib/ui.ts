/**
 * Kabuk düzeyi arayüz durumu.
 *
 * Araç çubuğu, tablo ve durum çubuğu birbirinin render'ını tetiklemeden aynı
 * duruma (açık pencere, sağ tık konumu, geçici mesaj) erişir. Bunları bir
 * `createStore` içinde toplamak yerine ayrı sinyaller olarak tutmak, hangi
 * parçanın neyi okuduğunu açık kılar.
 */
import { createSignal } from "solid-js";
import type { DownloadItem } from "./format";

/** Ayarlar panelinin açık olup olmadığı (menü: Seçenekler ▸ Ayarlar). */
export const [settingsOpen, setSettingsOpen] = createSignal(false);

/** "Hakkında" penceresi. */
export const [aboutOpen, setAboutOpen] = createSignal(false);

/**
 * Tarayıcı eklentisi kurulum sihirbazı.
 *
 * Ayarlar ▸ Tarayıcılar sekmesinden ve ilk çalıştırma ipucundan açılır;
 * tarayıcı seçimi sihirbaz açılırken verilir (`null` = henüz seçilmedi).
 */
export const [browserSetupBrowser, setBrowserSetupBrowser] =
  createSignal<import("./api").BrowserId | null>(null);

/** Sihirbazı belirli bir tarayıcıyla açar. */
export function openBrowserSetup(browser: import("./api").BrowserId): void {
  setBrowserSetupBrowser(browser);
}

/** Sihirbazı kapatır. */
export function closeBrowserSetup(): void {
  setBrowserSetupBrowser(null);
}

/** Özellikler penceresinin konusu (`null` ise kapalı). */
export const [propertiesItem, setPropertiesItem] = createSignal<DownloadItem | null>(
  null,
);

/** Sağ tık menüsü: ekran konumu ve satır (`null` ise kapalı). */
export interface ContextState {
  x: number;
  y: number;
  item: DownloadItem;
}
export const [contextMenu, setContextMenu] = createSignal<ContextState | null>(
  null,
);

/**
 * Alt durum çubuğunda gösterilen geçici mesaj.
 *
 * Log paneli kaldırıldığı için eylem hatalarının görünür tek yeri burasıdır:
 * `useFeedback.pushFeedback()` bir mesajı buraya yazar, `StatusBar` gösterir
 * ve ~4 saniye sonra kendiliğinden temizlenir. Mesaj yoksa durum çubuğu
 * seçili kaydın adını gösterir.
 */
export interface StatusMessage {
  level: "info" | "success" | "warn" | "error";
  text: string;
}
export const [statusMessage, setStatusMessage] = createSignal<StatusMessage | null>(
  null,
);

/**
 * "Yeni İndirme" penceresi.
 *
 * Adres alanı kenar çubuğunda değil, burada: araç çubuğundaki yeşil
 * **URL Ekle** düğmesi, menüdeki `Dosya ▸ URL Ekle` ve `Ctrl+N` bu pencereyi
 * açar. Pencere `Escape` ile de kapanır (`App.tsx` genel işleyicisi).
 */
export const [addDialogOpen, setAddDialogOpen] = createSignal(false);

/**
 * Alt panel (hız grafiği / olayaily) açık mı?
 *
 * Durum çubuğundaki ▾ düğmesi ve ≡ menüsündeki "Hız Grafiği" /
 * "Olay Günlüğü" girdileri bu sinyalleri değiştirir. İkisi birden kapalıysa
 * alt dock çizilmez.
 */
export const [graphOpen, setGraphOpen] = createSignal(false);
export const [logOpen, setLogOpen] = createSignal(false);