/**
 * Derlenmiş eklenti betiklerinin yanına statik dosyaları kopyalar.
 *
 * `tsc` yalnızca `.ts` girdilerini derler ve yan yalnızca `.js` üretir.
 * `manifest.json`, `popup.html`, `popup.css`, `icons/` ve `_locales/` elle
 * dokunulmayan girdilerdir; tarayıcı bunları `build/` altında bekler.
 *
 * Bu betik `tsc` **sonrasında** çalışır: `build/` klasörünü silmez, yalnızca
 * eksikse oluşturur ve statik dosyaların üzerine yazar. `tsc` çıktı adları
 * sabit olduğu için (background / content / popup) bayat `.js` birikmesi
 * oluşmaz.
 */
import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// scripts/ -> proje kökü
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const extensionDir = join(root, "src-extension");
const outDir = join(extensionDir, "build");

/** Kopyalanacak statik dosya ve klasörler (`src/` ve `build/` hariç). */
const ASSETS = ["manifest.json", "popup.html", "popup.css", "icons", "_locales"];

await mkdir(outDir, { recursive: true });

for (const name of ASSETS) {
  await cp(join(extensionDir, name), join(outDir, name), { recursive: true });
}

console.log(`eklenti varlıkları kopyalandı (${ASSETS.length} öğe -> src-extension/build)`);