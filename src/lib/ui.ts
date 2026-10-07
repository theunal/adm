/**
 * Kabuk düzeyi arayüz durumu.
 *
 * Menü çubuğu, araç çubuğu, kenar çubuğu ve tablo birbirinin render'ını
 * tetiklemeden aynı duruma (açık panel, açık pencere, sağ tık konumu) erişir.
 * Bunları bir `createStore` içinde toplamak yerine ayrı sinyaller olarak
 * tutmak, hangi parçanın neyi okuduğunu açık kılar.
 */
import { createSignal } from "solid-js";
import type { DownloadItem } from "./format";

/** Ayarlar panelinin açık olup olmadığı (menü: Seçenekler ▸ Ayarlar). */
export const [settingsOpen, setSettingsOpen] = createSignal(false);

/** "Hakkında" penceresi. */
export const [aboutOpen, setAboutOpen] = createSignal(false);

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

/** Alt panel: hız grafiği. */
export const [graphOpen, setGraphOpen] = createSignal(true);

/** Alt panel: olay günlüğü. */
export const [logOpen, setLogOpen] = createSignal(false);

/**
 * "Yeni İndirme" penceresi.
 *
 * Adres alanı kenar çubuğunda değil, burada: araç çubuğundaki yeşil
 * **URL Ekle** düğmesi, menüdeki `Dosya ▸ URL Ekle` ve `Ctrl+N` bu pencereyi
 * açar. Pencere `Escape` ile de kapanır (`App.tsx` genel işleyicisi).
 */
export const [addDialogOpen, setAddDialogOpen] = createSignal(false);