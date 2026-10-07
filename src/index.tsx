/* @refresh reload */
import { render } from "solid-js/web";
import App from "./App";
import { locale, t } from "./lib/i18n";
import "./styles.css";

// Başlangıçta algılanan dili belgeye yansıt: `<html lang>` erişilebilirlik
// için, `<title>` görev çubuğu / sekme başlığı için. Dil değiştiğinde
// `setLocale()` ikisini de yeniden günceller.
document.documentElement.lang = locale();
document.title = t("title.window");

const root = document.getElementById("root");
if (!root) {
  throw new Error(t("app.root_missing"));
}

render(() => <App />, root);