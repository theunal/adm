/**
 * Özel anahtardan (PEM) Chromium eklenti kimliğini hesaplar ve stdout'a yazar.
 *
 * Chromium, DER kodlu açık anahtarın SHA-256 özetinin ilk 16 baytını alıp her
 * onaltılık basamağı `a`-`p` harfine eşler. Bu yüzden ID anahtara bağlıdır:
 * anahtar değişirse ID değişir.
 *
 * Kullanım: `npm run extension:id` veya `node scripts/extension-id.mjs <pem>`
 * Anahtar yolu: ilk argüman > `CRX_KEY_PATH` > `keys/extension.pem`.
 */
import { readFileSync } from 'node:fs';
import { createPublicKey, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const keyPath = process.argv[2] || process.env.CRX_KEY_PATH || join(root, 'keys', 'extension.pem');

const der = createPublicKey(readFileSync(keyPath)).export({ type: 'spki', format: 'der' });
const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
const id = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
process.stdout.write(id + '\n');
