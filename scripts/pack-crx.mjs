/**
 * `src-extension/dist/chromium` -> `src-extension/release/extension.crx`.
 *
 * CRX3 paketi kendi özel anahtarınla imzalanır. Anahtar sabit kaldığı sürece
 * eklenti kimliği de sabit kalır — anahtarı kaybedersen ID değişir ve
 * `ExtensionInstallForcelist` politikası ile güncelleme zinciri kopar.
 *
 * crx3'e tek girdi olarak `manifest.json` verilir: `getFilePaths` bu durumda
 * manifestin bulunduğu klasörün TAMAMINI tarar. Klasörü doğrudan vermek de
 * aynı sonucu verir; manifest yolunu vermek crx3'ün belgelenmiş biçimidir.
 *
 * Anahtar yolu: `CRX_KEY_PATH` ortam değişkeni ya da `keys/extension.pem`.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import crx3 from 'crx3';

const root = fileURLToPath(new URL('..', import.meta.url));
const keyPath = process.env.CRX_KEY_PATH || join(root, 'keys', 'extension.pem');
const distDir = join(root, 'src-extension', 'dist', 'chromium');
const manifestPath = join(distDir, 'manifest.json');
const releaseDir = join(root, 'src-extension', 'release');
const crxPath = join(releaseDir, 'extension.crx');

if (!existsSync(manifestPath)) {
  console.error('HATA: src-extension/dist/chromium yok. Önce `npm run extension:dist` çalıştırın.');
  process.exit(1);
}
if (!existsSync(keyPath)) {
  console.error(`HATA: imza anahtarı bulunamadı: ${keyPath}`);
  console.error('Üretmek için: openssl genrsa -out keys/extension.pem 2048');
  console.error('Anahtar sabittir; kaybederseniz eklenti ID değişir.');
  process.exit(1);
}

mkdirSync(releaseDir, { recursive: true });

await crx3([manifestPath], { keyPath, crxPath });
console.log('release/extension.crx üretildi');
