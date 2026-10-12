/**
 * `src-extension/build/` -> `src-extension/dist/chromium` ve `dist/firefox`.
 *
 * Tek kaynak manifestten (`src-extension/manifest.json`) tarayıcıya özel iki
 * manifest üretir. `manifest.json` her iki tarayıcıda da çalışan birleşik hâli
 * tutar (Tauri paketi ve kurulum sihirbazı onu kullanır); burada ise her
 * tarayıcıya yalnızca kendi alanları verilir:
 *
 *   chromium : `background.service_worker`, `minimum_chrome_version`,
 *              `update_url` (mağaza dışı güncelleme)
 *   firefox  : `background.scripts`, `browser_specific_settings.gecko`
 *              (`update_url` + veri toplama beyanı), `gecko_android`
 *
 * `name` / `description` bilerek DEĞİŞTİRİLMEZ: manifestte `__MSG_extName__`
 * ve `__MSG_extDesc__` olarak dururlar ve `_locales/` üzerinden çözülürler.
 *
 * Sürüm: `EXT_VERSION` > manifestteki `version` > `package.json` sürümü.
 * Depo:   `GITHUB_REPOSITORY` > `extension.config.json` içindeki `repo`.
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, basename } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const extDir = join(root, 'src-extension');
const buildDir = join(extDir, 'build');
const outRoot = join(extDir, 'dist');

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

if (!existsSync(join(buildDir, 'manifest.json'))) {
  console.error('HATA: src-extension/build/ yok. Önce `npm run extension:build` çalıştırın.');
  process.exit(1);
}

const cfg = read(join(extDir, 'extension.config.json'));
const pkg = read(join(root, 'package.json'));
const baseManifest = read(join(buildDir, 'manifest.json'));

const version = process.env.EXT_VERSION || baseManifest.version || pkg.version;
const repo = process.env.GITHUB_REPOSITORY || cfg.repo;
const dl = `https://github.com/${repo}/releases/latest/download`;

/** Manifest anahtarları okunabilir ve kararlı sırada yazılır. */
const KEY_ORDER = [
  'manifest_version', 'name', 'description', 'version', 'default_locale',
  'minimum_chrome_version', 'icons', 'permissions', 'host_permissions',
  'background', 'browser_specific_settings', 'update_url', 'action', 'content_scripts',
];
function order(manifest) {
  const out = {};
  for (const k of KEY_ORDER) if (k in manifest) out[k] = manifest[k];
  for (const k of Object.keys(manifest)) if (!(k in out)) out[k] = manifest[k];
  return out;
}

/** Tarayıcıya özel olmayan ortak alanlar. */
function common() {
  const m = { ...baseManifest, version };
  delete m.background;
  delete m.browser_specific_settings;
  delete m.update_url;
  delete m.minimum_chrome_version;
  return m;
}

const targets = {
  chromium: order({
    ...common(),
    minimum_chrome_version: baseManifest.minimum_chrome_version,
    background: { service_worker: 'background.js' },
    update_url: `${dl}/update.xml`,
  }),
  firefox: order({
    ...common(),
    background: { scripts: ['background.js'] },
    browser_specific_settings: {
      gecko: {
        id: cfg.geckoId,
        strict_min_version: cfg.geckoMinVersion,
        // AMO barındırılan (unlisted) eklentilerde `update_url` YASAKTIR:
        // addons-linter `MANIFEST_UPDATE_URL` hatası verir ve imzalama
        // reddedilebilir. Güncellemeleri AMO yürütür. Bu alan yalnızca
        // Firefox Developer Edition'da kendinden barındırılan kurulum için
        // gerekir; `extension.config.json` içindeki
        // `firefoxSelfHostedUpdates` bayrağı ile açılır.
        ...(cfg.firefoxSelfHostedUpdates ? { update_url: `${dl}/updates.json` } : {}),
        data_collection_permissions: { required: ['none'] },
      },
      gecko_android: { strict_min_version: cfg.geckoAndroidMinVersion },
    },
  }),
};

// ---------- Doğrulama: manifestte adı geçen dosyalar gerçekten var mı? ----
function referencedFiles(manifest) {
  const files = new Set();
  for (const p of Object.values(manifest.icons || {})) files.add(p);
  for (const p of Object.values(manifest.action?.default_icon || {})) files.add(p);
  if (manifest.action?.default_popup) files.add(manifest.action.default_popup);
  if (manifest.background?.service_worker) files.add(manifest.background.service_worker);
  for (const p of manifest.background?.scripts || []) files.add(p);
  for (const cs of manifest.content_scripts || []) for (const p of cs.js || []) files.add(p);
  for (const cs of manifest.content_scripts || []) for (const p of cs.css || []) files.add(p);
  return [...files];
}

rmSync(outRoot, { recursive: true, force: true });

for (const [name, manifest] of Object.entries(targets)) {
  const out = join(outRoot, name);
  mkdirSync(out, { recursive: true });
  cpSync(buildDir, out, {
    recursive: true,
    filter: (src) => basename(src) !== 'manifest.json',
  });
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const missing = referencedFiles(manifest).filter((p) => !existsSync(join(out, p)));
  if (missing.length) {
    console.error(`HATA: dist/${name} içinde eksik dosya: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`dist/${name} hazır (v${version})`);
}

console.log(`depo: ${repo}`);
