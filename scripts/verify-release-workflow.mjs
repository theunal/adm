// release.yml'in duzeltmelerini dogrular.
// 1) Safari adiminda bundle kimligi guard'i var mi, APP_ID nasil uretiliyor?
// 2) Retry adimi anchor ile hala dogru paylasiliyor mu?
// 3) Upload deseni artik kurulum dosyalariyla sinirli mi?
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

const doc = yaml.load(readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));

const fails = [];
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'gecti ' : 'KALDI '} ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) fails.push(name);
};

const step = doc.jobs['extension-safari'].steps.find((s) => s.name === 'Convert and build unsigned app');
const run = step.run;

ok('safari adimi bash', step.shell === 'bash');
ok('APP_ID app-name\'dan uretiliyor', run.includes('APP_ID="com.unal.adm.$SLUG"'));
ok('flag APP_ID olarak veriliyor', run.includes('--bundle-identifier "$APP_ID"'));
ok('eski sabit bayrak artik komutta yok',
  !run.split('\n').some((l) => l.trim().startsWith('--bundle-identifier') && l.includes('browserextension')),
  'yorum satirinda gerekce olarak durmasi sorun degil');
ok('pbx okumasi var', run.includes('PRODUCT_BUNDLE_IDENTIFIER = "?[A-Za-z0-9.-]+"?;'));
ok('uyumsuzluk tespiti var', run.includes('"$GEN_EXT" != "$GEN_APP".*'));
ok('duzeltme NEW_EXT = app + .Extension', run.includes('NEW_EXT="$GEN_APP.Extension"'));
ok('BSD sed iki varyantli', (run.match(/sed -i ''/g) ?? []).length === 2);
ok('guard xcodebuild\'dan ONCE', run.indexOf('PRODUCT_BUNDLE_IDENTIFIER') < run.indexOf('xcodebuild -project'));

const release = doc.jobs.release;
const retry = release.steps.find((s) => s.name === 'Create GitHub Release (retry)');
const first = release.steps.find((s) => s.name === 'Create GitHub Release');
ok('anchor &release-config tanimli', Object.keys(first.with ?? {}).includes('tag_name'));
ok('retry ayni yapilandirmayi kullaniyor', retry?.with?.tag_name === first.with.tag_name);
ok('retry yalnizca ilk deneme dusunce', retry?.if?.includes('gh-release.outcome'));
ok('release if hala safari dislamiyor', !release.if.includes('extension-safari'));

const upload = doc.jobs.build.steps.find((s) => s.name === 'Upload installers');
const paths = upload.with.path.split('\n').map((l) => l.trim()).filter(Boolean);
ok('upload deseni daraldi', paths.length === 5, paths.length + ' satir');
ok('bundle/**/* kalmadi', !paths.some((p) => p.endsWith('**/*')));
ok('5 kurulus uzantisi', ['.exe', '.msi', '.deb', '.AppImage', '.dmg'].every((e) => paths.some((p) => p.endsWith(e))));
ok('hedef hala bundle uzerinde', paths.every((p) => p.includes('/bundle/')));
ok('if-no-files-found error', upload.with['if-no-files-found'] === 'error');

console.log(`\n${fails.length ? fails.length + ' KALDI' : '18/18 gecti'}`);
process.exit(fails.length ? 1 : 0);
