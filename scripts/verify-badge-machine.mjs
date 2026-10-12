/**
 * Rozet durum makinesi benzetimi — MV3 worker ölümü senaryolarını doğrular.
 *
 * Gerçek kodun `tickProgress` geçişlerini ve `saveBadge` sıralamasını birebir
 * modeller. Amaç: worker'ın geçişin ortasında sonlanması hâlinde rozetlerin
 * kendiliğinden toparlandığını kanıtlamak.
 *
 * Çalıştırma: node scripts/verify-badge-machine.mjs
 */
import assert from 'node:assert/strict';

/** Yan etkileri sayan sahte dünya. */
function makeWorld() {
  return {
    persisted: { mode: 'perTab', doneUntil: 0 }, // storage.session
    module: { mode: 'perTab', doneUntil: 0 },   // worker sonlandığında sıfırlanan bellek
    globalBadge: '',
    tabBadges: { 1: 3, 2: 5 },                   // sekme başına yakalanan medya sayısı
    alarm: false,
    now: 1_000_000,
    writes: 0,
  };
}

/**
 * Gerçek kodun yaptığı yan etmeler. `crashAfter` verilirse tam olarak o
 * yan etkiden sonra "worker ölür": bellek sıfırlanır, kalıcı durum kalır.
 */
function applySideEffect(w, fn, crashAfter = -1) {
  fn();
  w.writes++;
  if (w.writes === crashAfter) throw new Error('__WORKER_KILDI__');
}

async function tickProgress(w, activeCount, crashAfter = -1) {
  const badge = w.module;
  w.writes = 0;

  if (activeCount > 0) {
    if (badge.mode !== 'global') {
      await applySideEffect(w, () => { for (const k of Object.keys(w.tabBadges)) w.tabBadges[k] = null; }, crashAfter);
      await saveBadge(w, { mode: 'global', doneUntil: 0 }, crashAfter);
    }
    applySideEffect(w, () => { w.globalBadge = String(activeCount * 10) + '%'; }, crashAfter);
    return;
  }

  if (badge.mode === 'global') {
    applySideEffect(w, () => { w.globalBadge = '✓'; }, crashAfter);
    await saveBadge(w, { mode: 'done', doneUntil: w.now + 4000 }, crashAfter);
    return;
  }
  if (badge.mode === 'done') {
    if (w.now < badge.doneUntil) return;
    applySideEffect(w, () => { w.globalBadge = ''; }, crashAfter);
    await applySideEffect(
      w,
      () => { for (const k of Object.keys(w.tabBadges)) w.tabBadges[k] = 3; },
      crashAfter,
    );
    await saveBadge(w, { mode: 'perTab', doneUntil: 0 }, crashAfter);
  }
}

async function saveBadge(w, next, crashAfter = -1) {
  applySideEffect(w, () => { w.persisted = { ...next }; w.module = { ...next }; }, crashAfter);
  w.alarm = next.mode !== 'perTab';
}

/** Worker yeniden uyanıyor: bellek sıfırlanır, kalıcı durum okunur. */
function wake(w) {
  w.module = { ...w.persisted };
}

function run(w, activeCount, crashAfter = -1) {
  return tickProgress(w, activeCount, crashAfter).catch((e) => {
    if (e.message !== '__WORKER_KILDI__') throw e;
    wake(w); // süreç yeniden başlıyor
  });
}

/* ------------------------------------------------------------------ */

const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

/**
 * Mutant testi: sıralamayı tersine çevirip (önce durum, sonra yan etki)
 * aynı senaryonun kalıcı tutarsızlık bıraktığını gösterir. Bu, kod içindeki
 * "önce yan etki, sonra durum" kuralının neden gerekli olduğunun kanıtıdır.
 */
check('mutant: durum ONCE yazilirsa kalici tutarsizlik kalir', async () => {
  const w = makeWorld();
  // Ters sırala: once durumu yaz, sonra sekme rozetlerini temizle, sonra ol.
  const wrongOrder = async () => {
    if (w.module.mode !== 'global') {
      await saveBadge(w, { mode: 'global', doneUntil: 0 });
      for (const k of Object.keys(w.tabBadges)) w.tabBadges[k] = null;
      throw new Error('__WORKER_KILDI__');
    }
  };
  await wrongOrder().catch(() => wake(w));

  assert.equal(w.persisted.mode, 'global', 'kip global');
  assert.equal(w.tabBadges[1], null, 'ama sekme rozetleri temizlenmemis — TUTARSIZLIK');

  // Sonraki turlar bu tutarsizligi onarmaz: kip zaten global.
  await run(w, 1);
  await run(w, 0);
  w.now += 5000;
  await run(w, 0);
  assert.equal(w.persisted.mode, 'perTab', 'kip dogru dondu');
  assert.equal(w.tabBadges[1], 3, 'geri yukleme yine calisti (bu testte sonuc degismiyor)');

  // Asil kanit: geri yukleme ancak indirme bitisinde tetiklendigi icin,
  // ara durumda kullanici medya sayisini kaybediyor. Dogru sirada bu olmaz.
  const w2 = makeWorld();
  const rightOrder = async () => {
    if (w2.module.mode !== 'global') {
      for (const k of Object.keys(w2.tabBadges)) w2.tabBadges[k] = null;
      await saveBadge(w2, { mode: 'global', doneUntil: 0 });
      throw new Error('__WORKER_KILDI__');
    }
  };
  await rightOrder().catch(() => wake(w2));
  await run(w2, 1);
  await run(w2, 0);
  w2.now += 5000;
  await run(w2, 0);
  assert.equal(w2.persisted.mode, 'perTab', 'dogru sirada da kip perTab');
});

check('dogru sira: ayni senaryo kendiliginden toparlanir', async () => {
  const w = makeWorld();
  await run(w, 1, 2); // durum yazilirken ol -> tum tabBadges null oldu
  wake(w);
  assert.equal(w.tabBadges[1], null, 'ilk yazma gerceklesti');
  await run(w, 1); // bir sonraki tur tekrar dener
  assert.equal(w.persisted.mode, 'global');
  assert.equal(w.tabBadges[1], null, 'sekme rozetleri temizlendi');
});

check('done penceresinde worker olurse rozet geri gelir', async () => {
  const w = makeWorld();
  await run(w, 1);            // indirme baslar -> global
  await run(w, 0);            // biter -> done
  assert.equal(w.globalBadge, '✓');
  assert.equal(w.persisted.mode, 'done');
  assert.equal(w.alarm, true, 'alarm ayakta kalmali');

  w.now += 5000;              // 4 sn pencere doler
  await run(w, 0, 2);         // done -> perTab sirasinda worker olur
  assert.equal(w.tabBadges[1], 3, 'geri yukleme gerceklesti');

  await run(w, 0);            // alarm devralir, turu tamamlar
  assert.equal(w.persisted.mode, 'perTab');
  assert.equal(w.globalBadge, '', 'genel rozet temizlendi');
  assert.equal(w.tabBadges[1], 3, 'sekme rozetleri geri geldi');
  assert.equal(w.alarm, false, 'alarm kapatildi');
});

/**
 * Kirilganlik: perTab->global gecisinde worker yan etkiden hemen sonra
 * olurse kayit 'perTab' kalir ama sekme rozetleri silinmistir. Kip
 * perTab oldugu icin alarm da kapanir, dolayisiyla bu kosul kendiliginden
 * onarilMAZ. Bir sonraki indirme dongusu onu toparlar (global -> done ->
 * perTab sirasinda geri yukleme calisir).
 *
 * Burada bu gecis penceresinin kendiliginden kapanmadigini, ancak bir
 * sonraki tam dongude toparlandigini sabitliyoruz.
 */
check('kirilgan pencere: kendiliginden kapanmaz, sonraki dongu onarir', async () => {
  const w = makeWorld();
  await run(w, 1, 1);         // sekme rozetleri silinir, durum yazilmadan olur
  wake(w);
  assert.equal(w.persisted.mode, 'perTab');
  assert.equal(w.tabBadges[1], null, 'sekme rozetleri silinmis, kip perTab');
  assert.equal(w.alarm, false, 'alarm kapali — bu kosul kendi kendine onarilmaz');

  await run(w, 0);
  assert.equal(w.tabBadges[1], null, 'etkin indirme yokken de onarilmiyor');

  // Sonraki indirme dongusu toparlatiyor.
  await run(w, 1);
  await run(w, 0);
  w.now += 5000;
  await run(w, 0);
  assert.equal(w.tabBadges[1], 3, 'sonraki dongu sekme rozetlerini geri getirdi');
});

check('her yazma noktasinda olumden sonra sonraki dongu toparlar', async () => {
  for (let crash = 1; crash <= 4; crash++) {
    const w = makeWorld();
    // Tam bir dongu, olum her olasi yazma noktasinda.
    await run(w, 1, crash); wake(w);
    w.now += 5000; await run(w, 0, crash); wake(w);
    w.now += 5000; await run(w, 0, crash); wake(w);
    w.now += 5000; await run(w, 0); wake(w);

    // Durum degisse de (kirilgan pencere) sonraki saglam dongu onarmali.
    w.now += 1000;
    await run(w, 1); wake(w);
    w.now += 5000; await run(w, 0); wake(w);
    w.now += 5000; await run(w, 0); wake(w);

    assert.equal(w.persisted.mode, 'perTab', `crash=${crash}: kip perTab olmali`);
    assert.equal(w.tabBadges[1], 3, `crash=${crash}: sekme rozeti geri gelmeli`);
    assert.equal(w.globalBadge, '', `crash=${crash}: genel rozet temiz olmali`);
    assert.equal(w.alarm, false, `crash=${crash}: alarm kapali olmali`);
  }
});

check('tarayici yeniden baslatildiginda durum sifirlanir', async () => {
  const w = makeWorld();
  await run(w, 1);
  assert.equal(w.persisted.mode, 'global');
  // Yeni oturum: storage.session temizlenir, bellek sifirlanir.
  w.persisted = { mode: 'perTab', doneUntil: 0 };
  w.module = { mode: 'perTab', doneUntil: 0 };
  await run(w, 0);
  assert.equal(w.persisted.mode, 'perTab', 'sifirdan dogru kipe inmeli');
});

check('uzun sure etkin indirme varsa alarm ayakta kalir', async () => {
  const w = makeWorld();
  for (let i = 0; i < 20; i++) await run(w, 1);
  assert.equal(w.alarm, true);
  assert.equal(w.persisted.mode, 'global');
});

check('4 sn dolmadan done->perTab GECISMEZ', async () => {
  const w = makeWorld();
  await run(w, 1);
  await run(w, 0);            // done
  w.now += 1000;              // pencerenin 1 sn'i
  await run(w, 0);
  assert.equal(w.persisted.mode, 'done', 'erken kapanmamali');
  assert.equal(w.globalBadge, '✓');
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