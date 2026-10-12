/**
 * Otomatik güncelleme manifestlerini üretir:
 *   src-extension/release/update.xml    (Chromium: Chrome, Edge, Brave, Chromium)
 *   src-extension/release/updates.json  (Firefox / gecko)
 *
 * Bu dosyalar `releases/latest/download/` altında herkese açık olmalıdır —
 * depo private ise mağaza dışı güncelleme çalışmaz.
 *
 * Kullanım: `EXT_ID=<chromium-id> node scripts/make-extension-update-files.mjs`
 * Sürüm: `EXT_VERSION` > dist'teki chromium manifesti > `package.json`.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const extDir = join(root, 'src-extension');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

const cfg = read(join(extDir, 'extension.config.json'));
const pkg = read(join(root, 'package.json'));

const distManifest = join(extDir, 'dist', 'chromium', 'manifest.json');
const version = process.env.EXT_VERSION
  || (existsSync(distManifest) ? read(distManifest).version : undefined)
  || pkg.version;

const extId = process.env.EXT_ID;
if (!extId) {
  console.error('HATA: EXT_ID ortam değişkeni gerekli. Önce `npm run extension:id`.');
  process.exit(1);
}

const repo = process.env.GITHUB_REPOSITORY || cfg.repo;
const tag = `v${version}`;
const rel = `https://github.com/${repo}/releases/download/${tag}`;
const releaseDir = join(extDir, 'release');
mkdirSync(releaseDir, { recursive: true });

// Chromium: ExtensionInstallForcelist politikası bu adresten güncellemeyi okur.
writeFileSync(
  join(releaseDir, 'update.xml'),
  `<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${extId}'>
    <updatecheck codebase='${rel}/extension.crx' version='${version}' />
  </app>
</gupdate>
`,
);

// Firefox: manifestteki gecko.update_url bu dosyaya bakar.
writeFileSync(
  join(releaseDir, 'updates.json'),
  JSON.stringify(
    {
      addons: {
        [cfg.geckoId]: {
          updates: [{ version, update_link: `${rel}/extension-firefox.xpi` }],
        },
      },
    },
    null,
    2,
  ) + '\n',
);

console.log(`update.xml ve updates.json üretildi (v${version}, id ${extId})`);
