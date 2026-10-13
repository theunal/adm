/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import DetailWindow from "./components/DetailWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { locale, t } from "./lib/i18n";
import "./styles.css";

// Başlangıçta algılanan dili belgeye yansıt: `<html lang>` erişilebilirlik
// için, `<title>` görev çubuğu / sekme başlığı için. Dil değiştiğinde
// `setLocale()` ikisini de günceller.
document.documentElement.lang = locale();
document.title = t("title.window");

const root = document.getElementById("root");
if (!root) {
  throw new Error(t("app.root_missing"));
}

/** Rust tarafının ayrıntı pencereleri için kullandığı etiket öneki. */
const DETAIL_LABEL_PREFIX = "detail-";

/**
 * Bu pencere bir indirme ayrıntı popup'u mu?
 *
 * Rust `open_detail_window` komutu her indirme için `detail-<id>` etiketli
 * küçük bir pencere açar. Konu etiketten okunur (sorgu dizesi taşımak yerine):
 * pencere adresi platforma göre değişse de etiket değişmez.
 *
 * Etiket okunamazsa (tarayıcıda `npm run dev` ile açılan Vite sayfası) hata
 * verilmez — normal tam ekran kabuk çizilir.
 */
function detailIdFromLabel(): number | null {
  try {
    // `label` Tauri v2'de bir **özelliktir**, metot değil.
    const label = getCurrentWindow().label;
    if (!label.startsWith(DETAIL_LABEL_PREFIX)) return null;
    const id = Number(label.slice(DETAIL_LABEL_PREFIX.length));
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

const detailId = detailIdFromLabel();

render(() => (detailId ? <DetailWindow id={detailId} /> : <App />), root);
