/**
 * Medya listesi yazma sırasının doğrulaması.
 *
 * `addMedia` "oku → değiştir → yaz" üç adımlı bir işlem. Sıralama olmadan
 * eşzamanlı çağrılar aynı eski listeyi okuyup birbirini eziyor. Bu betik
 * gerçek `serializeMedia`/`addMedia` mantığını modelledir ve:
 *
 *  1. mutant (sıralama YOK) → kayıp kayıt var mı?
 *  2. doğru sıra → kayıp var mı?
 *  3. sekme değişimi sırasında uçuşta olan ekleme geri geliyor mu?
 *  4. hat bırakmıyor mu?
 *  5. hata zinciri bozmuyor mu?
 *
 * Çalıştırma: node scripts/verify-media-queue.mjs
 */
import assert from 'node:assert/strict';

/** Gecikmeli, gerçekçi bir depolama taklidi. */
function makeStorage() {
  const store = new Map();
  return {
    store,
    // Her yazma bir makro görev döngüsü geçiriyor: gerçekçi yarış penceresi.
    async get(key) {
      await new Promise((r) => setTimeout(r, 0));
      return store.get(key);
    },
    async set(key, value) {
      await new Promise((r) => setTimeout(r, 0));
      store.set(key, value);
    },
    async remove(key) {
      await new Promise((r) => setTimeout(r, 0));
      store.delete(key);
    },
  };
}

/**
 * @param serialize zincir uygulansın mı? false ise mutant davranış.
 */
function makeApp({ serialize = true, failEvery = 0 } = {}) {
  const s = makeStorage();
  const queue = new Map();
  let calls = 0;

  function serializeMedia(tabId, fn) {
    if (!serialize) return fn();
    const prev = queue.get(tabId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.then(() => { }, () => { });
    queue.set(tabId, tail);
    void tail.then(() => { if (queue.get(tabId) === tail) queue.delete(tabId); });
    return run;
  }

  async function addMedia(tabId, info) {
    if (tabId < 0) return Promise.resolve();
    const inner = async () => {
      const list = (await s.get('media:' + tabId)) ?? [];
      if (list.some((m) => m.key === info.key)) return;
      list.unshift({ ...info });
      if (list.length > 40) list.length = 40;
      calls++;
      if (failEvery && calls % failEvery === 0) throw new Error('storage patladi');
      await s.set('media:' + tabId, list);
    };
    return serializeMedia(tabId, inner).catch(() => { });
  }

  async function clearMedia(tabId) {
    const inner = async () => {
      await s.remove('media:' + tabId);
    };
    return serializeMedia(tabId, inner).catch(() => { });
  }

  return { s, addMedia, clearMedia, queue, depth: () => queue.size };
}

const listOf = (app, tabId) => app.s.store.get('media:' + tabId) ?? [];

/* ------------------------------------------------------------------ */

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('mutant: sıralama YOKKEN paralel segmentlerde kayıp kayıt var', async () => {
  const app = makeApp({ serialize: false });
  const urls = Array.from({ length: 20 }, (_, i) => ({ key: 'seg' + i, url: 'https://x/seg' + i + '.m4s' }));
  await Promise.all(urls.map((u) => app.addMedia(7, u)));
  const list = listOf(app, 7);
  assert.ok(list.length < 20, `beklenen: kayip var. 20 kayit degil, ${list.length} kayit durdu`);
});

check('sıralama ile 20 paralel segmentin tamamı kaydedilir', async () => {
  const app = makeApp({ serialize: true });
  const urls = Array.from({ length: 20 }, (_, i) => ({ key: 'seg' + i, url: 'https://x/seg' + i + '.m4s' }));
  await Promise.all(urls.map((u) => app.addMedia(7, u)));
  const list = listOf(app, 7);
  assert.equal(list.length, 20, `20 kayit olmali, ${list.length} var`);
  assert.equal(new Set(list.map((m) => m.key)).size, 20, 'anahtarlar benzersiz olmali');
});

check('farklı sekmeler birbirini bloklamaz', async () => {
  const app = makeApp({ serialize: true });
  await Promise.all([
    ...Array.from({ length: 10 }, (_, i) => app.addMedia(1, { key: 'a' + i })),
    ...Array.from({ length: 10 }, (_, i) => app.addMedia(2, { key: 'b' + i })),
  ]);
  assert.equal(listOf(app, 1).length, 10);
  assert.equal(listOf(app, 2).length, 10);
});

check('aynı URL iki kez gelince tek kayıt kalır', async () => {
  const app = makeApp({ serialize: true });
  await Promise.all(Array.from({ length: 10 }, () => app.addMedia(7, { key: 'same', size: 5 })));
  assert.equal(listOf(app, 7).length, 1, 'tekilleştirme bozulmamali');
});

check('temizlik, uçuşta olan eklemeden SONRA çalışır', async () => {
  const app = makeApp({ serialize: true });
  // Sayfa değişimi: uçuşta olan eklemeler, sonra temizlik.
  const pending = Array.from({ length: 5 }, (_, i) => app.addMedia(7, { key: 'old' + i }));
  const cleared = app.clearMedia(7);
  await Promise.all([...pending, cleared]);
  assert.equal(listOf(app, 7).length, 0, 'eski sayfanin medyasi geri gelmemeli');
});

check('temizlikten SONRA gelen ekleme yeni listeye yazılır', async () => {
  const app = makeApp({ serialize: true });
  await app.clearMedia(7);
  await app.addMedia(7, { key: 'new1' });
  await app.addMedia(7, { key: 'new2' });
  const list = listOf(app, 7);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((m) => m.key).sort(), ['new1', 'new2']);
});

check('40 kayıt sınırı korunur', async () => {
  const app = makeApp({ serialize: true });
  for (let i = 0; i < 55; i++) await app.addMedia(7, { key: 'k' + i });
  assert.equal(listOf(app, 7).length, 40);
});

check('hata zinciri bozmaz, sonraki işlemler yine çalışır', async () => {
  const app = makeApp({ serialize: true, failEvery: 3 });
  for (let i = 0; i < 12; i++) await app.addMedia(7, { key: 'k' + i });
  const list = listOf(app, 7);
  assert.ok(list.length >= 9, `hatlara rağmen cogu kayit yazilmali, ${list.length} yazildi`);
});

check('hat bosaldiginda zincir haritasi temizlenir', async () => {
  const app = makeApp({ serialize: true, failEvery: 4 });
  for (let i = 0; i < 10; i++) await app.addMedia(7, { key: 'k' + i });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(app.depth(), 0, `mediaQueue bosalmali, ${app.depth()} kaldi`);
});

check('negatif tabId yutulur', async () => {
  const app = makeApp({ serialize: true });
  await app.addMedia(-1, { key: 'x' });
  assert.equal(app.s.store.size, 0);
});

let failed = 0;
for (const { name, fn } of checks) {
  try {
    await fn();
    console.log(`  gecti  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  KALDI  ${name}\n         ${e.message}`);
  }
}
console.log(`\n${checks.length - failed}/${checks.length} gecti`);
process.exit(failed ? 1 : 0);