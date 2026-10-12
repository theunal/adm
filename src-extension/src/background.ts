// ADM bridge extension — background script (Chrome MV3 / Edge / Brave / Firefox)
//
// MC Download Manager uzantısının birebir portudur. Farklar:
//   * Marka ADM, köprü başlığı `X-ADM-Extension`
//   * Safari / native-messaging yolu çıkarıldı (Windows'ta gerekmez)

(() => {
  'use strict';


  // Firefox (ve türevleri) uzantı sayfalarını moz-extension:// üzerinden sunar.
  // `browser` küresi yalnızca Firefox'ta tanımlıdır; Chrome tarafında `chrome` kullanılır.
  const ff = (globalThis as { browser?: unknown }).browser as FirefoxApi | undefined;
  const IS_FIREFOX = !!ff && String(ff.runtime.getURL('')).startsWith('moz-extension:');
  const api = ff ? (ff as unknown as typeof chrome) : chrome;

  const t = (k: string, subs?: string | string[]): string => {
    try { return api.i18n.getMessage(k, subs) || k; } catch { return k; }
  };

  const DEFAULTS: Settings = { port: 48213, intercept: true, minSizeMB: 0, sniff: true };
  const BROWSER = IS_FIREFOX
    ? 'firefox'
    : ((navigator as Navigator & { brave?: unknown }).brave ? 'brave' : (/Edg\//.test(navigator.userAgent) ? 'edge' : 'chrome'));

  const MEDIA_EXT = /\.(mp4|m4v|webm|mkv|mov|avi|flv|mp3|m4a|aac|ogg|opus|wav|flac)(\?|#|$)/i;
  const FRAGMENT = /\.(ts|m4s|m4f|cmfv|cmfa|fmp4|init)(\?|#|$)|[/_.-](seg|segment|chunk|frag|fragment)[-_]?\d+/i;
  const IGNORED_HOSTS = /(^|\.)googlevideo\.com$|(^|\.)fbcdn\.net$|(^|\.)twimg\.com$/i;

  // ---------- Settings ----------
  async function getSettings(): Promise<Settings> {
    const s = (await api.storage.local.get('settings')) as unknown as { settings?: Partial<Settings> };
    return { ...DEFAULTS, ...(s.settings || {}) };
  }
  async function setSettings(patch: Partial<Settings>): Promise<void> {
    const cur = await getSettings();
    await api.storage.local.set({ settings: { ...cur, ...patch } });
  }
  const base = (s: Settings): string => `http://127.0.0.1:${s.port}`;
  // Özel başlık, isteğin bir uzantıdan geldiğinin kanıtıdır: normal web sayfalar
  // CORS ön kontrolü olmadan bu başlığı gönderemez ve köprü CORS'u yalnızca
  // uzantı kaynaklarına verir. Chrome, host iznine tabi uzantı GET'lerinde
  // `Origin` başlığını atladığı için yalnızca Origin yeterli değildir.
  const BRIDGE_HEADERS = { 'X-ADM-Extension': BROWSER };

  // ---------- App communication ----------
  // Köprü TCP bağlantısını kabul edip yanıt yazmayabilir (yarı açık
  // bağlantı, askıda kalan istek). Zaman aşımı olmadan `fetch` hiç bitmez:
  // yoklama 1,5 sn'de bir takılır, worker hiç boşta düşmez ve kullanıcı
  // "hiçbir geri bildirim yok" durumunda kalır. Bu yüzden her köprü isteği
  // `signal` ile sınırlıdır.
  const PING_TIMEOUT_MS = 1200;
  const BRIDGE_TIMEOUT_MS = 5000;

  /** Zaman aşımı olan köprü `fetch`'i. */
  async function bridgeFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    // `AbortSignal.timeout` eski motorlarda yok; `AbortController` her yerde var.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function ping(settings?: Settings): Promise<AppInfo | null> {
    const cfg = settings || (await getSettings());
    try {
      const r = await bridgeFetch(
        base(cfg) + '/ping?browser=' + BROWSER,
        { cache: 'no-store', headers: BRIDGE_HEADERS },
        PING_TIMEOUT_MS,
      );
      if (!r.ok) return null;
      const app = (await r.json()) as AppInfo | null;
      if (app && app.active > 0) startProgress();
      return app;
    } catch {
      return null;
    }
  }

  // ---------- Download progress: toolbar badge + popup list ----------
  async function bridgeJSON<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const settings = await getSettings();
    const r = await bridgeFetch(
      base(settings) + path,
      { cache: 'no-store', ...init, headers: { ...BRIDGE_HEADERS, ...(init?.headers) } },
      BRIDGE_TIMEOUT_MS,
    );
    return (await r.json()) as T;
  }
  async function getDownloads(): Promise<DownloadItem[]> {
    try { const j = await bridgeJSON<{ items?: DownloadItem[] }>('/downloads'); return j.items || []; } catch { return []; }
  }
  async function downloadAction(id: string, action: string): Promise<unknown> {
    try {
      const j = await bridgeJSON('/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }),
      });
      tickProgress();
      return j;
    } catch (e) { return { ok: false, error: String(e) }; }
  }
  const ACTIVE_STATES = new Set(['downloading', 'probing']);

  // ---------------------------------------------------------------------
  // Rozet durumu — MV3 service worker her an sonlanabilir.
  //
  // Önceden bu bilgi yalnızca global değişkende tutuluyordu. Worker
  // sonlandığında kayboluyor, "rozet küresel mi?" sorusunun cevabı yok
  // oluyor ve sekme rozetleri `null`'da kalıyordu; `tickProgress` onarımı
  // yalnızca `badgeShown === true` iken çalıştığı için kendiliğinden
  // düzelmiyordu.
  //
  // Çözüm: geçişin *niyetini* `storage.session`'a yaz, geçişi tembel
  // uzlaştırma ile tamamla. Kapsam tarayıcı oturumuyla aynı — rozetin de
  // ömrü odur. Alarm, canlı bir zamanlayıcı yokken onarımı sürdürür.
  // ---------------------------------------------------------------------
  const BADGE_KEY = 'badge';
  const DONE_BADGE_MS = 4000;
  const PROGRESS_ALARM = 'adm-progress';
  /** Chrome'un izin verdiği en küçük periyot (30 sn). */
  const PROGRESS_ALARM_MIN = 0.5;

  type BadgeMode = 'perTab' | 'global' | 'done';
  interface BadgeState {
    mode: BadgeMode;
    /** 'done' penceresinin bitişi; worker ölse bile kalan süre buradan bilinir. */
    doneUntil: number;
  }

  let badgeCache: BadgeState = { mode: 'perTab', doneUntil: 0 };
  let progressTimer: ReturnType<typeof setInterval> | null = null;

  async function loadBadge(): Promise<BadgeState> {
    if (api.storage.session) {
      try {
        const r = (await api.storage.session.get(BADGE_KEY)) as unknown as Record<string, BadgeState | undefined>;
        const v = r && r[BADGE_KEY];
        // Bozuk/eksik veri `perTab`'a düşsün: en azından rozetler görünür kalır.
        if (v && (v.mode === 'global' || v.mode === 'done' || v.mode === 'perTab')) return v;
      } catch { }
    }
    return badgeCache;
  }

  async function saveBadge(next: BadgeState): Promise<void> {
    badgeCache = next;
    if (api.storage.session) {
      try { await api.storage.session.set({ [BADGE_KEY]: next }); } catch { }
    }
    await syncAlarm();
  }

  /**
   * Uzlaştırma alarmı yalnızca rozet durumu düzeltmeyi beklerken ayakta
   * kalır; `perTab`'a dönülünce kaldırılır — boşta tur dönmesin.
   */
  async function syncAlarm(): Promise<void> {
    if (!api.alarms) return;
    try {
      if (badgeCache.mode === 'perTab') {
        await api.alarms.clear(PROGRESS_ALARM);
      } else if (!(await api.alarms.get(PROGRESS_ALARM))) {
        await api.alarms.create(PROGRESS_ALARM, { periodInMinutes: PROGRESS_ALARM_MIN });
      }
    } catch { }
  }
  async function setGlobalBadge(text: string, color?: string): Promise<void> {
    try {
      await api.action.setBadgeText({ text });
      if (color) await api.action.setBadgeBackgroundColor({ color });
    } catch { }
  }
  // Sekme başına medya sayısı genel rozeti geçersiz kılar; indirme sürerken tüm
  // sekmeler genel metne döner.
  // `text: null` sekme rozetini temizleyip genel metne düşürür — chrome.action
  // tiplerinde null yoktur, bu yüzden tek noktada cast edilir.
  async function useGlobalBadgeOnAllTabs(on: boolean): Promise<void> {
    let tabs: chrome.tabs.Tab[] = [];
    try { tabs = await api.tabs.query({}); } catch { return; }
    await Promise.all(tabs.map(async (tab) => {
      // Sekmesi olmayan kayıtlar (devtools, panel girdileri) atlanır.
      if (tab.id === undefined) return;
      if (on) {
        try { await api.action.setBadgeText({ tabId: tab.id, text: null as unknown as string }); } catch { }
        return;
      }
      // Bir sekmenin medya okuması patlarsa kalan sekmeler atlanmasın:
      // geri yükleme yarım kalırsa rozetler kalıcı yanlış görünür.
      let count = 0;
      try { count = (await readMedia(tab.id)).length; } catch { return; }
      try { await api.action.setBadgeText({ tabId: tab.id, text: count ? String(count) : '' }); } catch { }
    }));
  }
  async function tickProgress(): Promise<void> {
    const list = await getDownloads();
    const active = list.filter((i) => ACTIVE_STATES.has(i.state));
    const badge = await loadBadge();

    if (active.length) {
      const measurable = active.filter((i) => i.total > 0);
      let text = '…';
      if (active.length > 1) text = active.length + '↓';
      else if (measurable.length) {
        const total = measurable.reduce((a, i) => a + i.total, 0);
        const got = measurable.reduce((a, i) => a + Math.min(i.received, i.total), 0);
        text = Math.round((100 * got) / total) + '%';
      }
      // Zaten küreselse sekmeleri tekrar temizlemeye gerek yok; her 1,5
      // saniyede tüm sekmelerde yeniden yazmak boş iş olur.
      //
      // Sıralama önemli: her geçişte **önce yan etki, sonra durum yazılır**.
      // Worker arada ölürse kayıt eski kipte kalır ve bir sonraki tur işi
      // idempotent olarak tekrarlar. Tersi (önce durum) kalıcı tutarsızlık
      // bırakırdı — "durum global diyor ama sekme rozetleri temizlenmemiş".
      if (badge.mode !== 'global') {
        await useGlobalBadgeOnAllTabs(true);
        await saveBadge({ mode: 'global', doneUntil: 0 });
      }
      await setGlobalBadge(text, '#2f6feb');
      return;
    }

    // Etkin indirme yok: hızlı yoklama durur, onarım alarmı devralır.
    stopProgress();

    // Her geçiş kalıcı durumdan okunarak yapılır; canlı bir `setTimeout`'a
    // güvenilmez, çünkü worker bu pencerede sonlanabilir ve o zaman onarım
    // hiç tetiklenmezdi.
    if (badge.mode === 'global') {
      await setGlobalBadge('✓', '#2ebd59');
      await saveBadge({ mode: 'done', doneUntil: Date.now() + DONE_BADGE_MS });
      return;
    }
    if (badge.mode === 'done') {
      if (Date.now() < badge.doneUntil) return;   // hâlâ tamamlandı işareti gösteriliyor
      // Aynı sıralama kuralı: geri yükle, sonra kipi kapat.
      await setGlobalBadge('', '#2f6feb');
      await useGlobalBadgeOnAllTabs(false);
      await saveBadge({ mode: 'perTab', doneUntil: 0 });
    }
  }
  function startProgress(): void {
    if (progressTimer) return;
    tickProgress();
    // Kısa periyot yalnızca "varken" takılabilir: her fetch, iş sürerken
    // worker'ı canlı tutar. Worker ölürse `PROGRESS_ALARM` devralır.
    progressTimer = setInterval(tickProgress, 1500);
  }
  function stopProgress(): void {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
  }

  async function cookiesFor(url: string): Promise<{ header: string; list: CookieInfo[] }> {
    try {
      const list = await api.cookies.getAll({ url });
      return {
        header: list.map((c) => `${c.name}=${c.value}`).join('; '),
        list: list.map((c) => ({
          name: c.name, value: c.value, domain: c.domain, path: c.path,
          secure: !!c.secure, expirationDate: c.expirationDate || 0,
        })),
      };
    } catch {
      return { header: '', list: [] };
    }
  }

  // Bildirim söz döndürür; `await` edilmediği için önceki `catch` yalnızca
  // eşzamanlı throw'ları yakalıyor, red'i değil. Worker bu çağrı bitmeden
  // sonlanırsa kullanıcı bildirimi hiç görmez.
  function notify(title: string, message: string): void {
    // Tek argümanlı `create(options)` hem Chrome hem Firefox'ta geçerli
    // (kimlik otomatik üretilir); `create('', …)` yalnızca Chrome'da
    // çalışıyordu, Firefox `undefined` bekliyor.
    const opts: chrome.notifications.NotificationCreateOptions = {
      type: 'basic', iconUrl: 'icons/icon128.png', title, message: String(message || '').slice(0, 200),
    };
    try {
      const p = api.notifications?.create?.(opts);
      // API yoksa söz de yoktur; varsa red'ı yut.
      if (p && typeof (p as Promise<unknown>).catch === 'function') {
        (p as Promise<unknown>).catch(() => { /* bildirim gösterilemedi */ });
      }
    } catch { }
  }

  async function sendToApp(payload: SendToAppPayload): Promise<SendToAppResult> {
    const settings = await getSettings();
    const ck = await cookiesFor(payload.url);
    const body = {
      url: payload.url, filename: payload.filename || '', referer: payload.referer || '', kind: payload.kind || 'file',
      userAgent: navigator.userAgent, cookieHeader: ck.header, cookies: ck.list,
    };
    try {
      const r = await bridgeFetch(
        base(settings) + '/download',
        { method: 'POST', headers: { 'Content-Type': 'application/json', ...BRIDGE_HEADERS }, body: JSON.stringify(body) },
        BRIDGE_TIMEOUT_MS,
      );
      const j = (await r.json()) as { ok?: boolean; error?: string };
      // Uygulama çalışıyordu ama işi reddetti (geçersiz URL, kota, şema...).
      // Bu "uygulama kapalı" durumu DEĞİLDİR. Önceden her hata
      // `notifOfflineTitle` ile bildiriliyor ve `j.error` yutuluyordu;
      // kullanıcı hem yanlış yönlendiriliyor hem de gerçek nedeni hiç
      // göremiyordu.
      if (!j.ok) {
        notify(t('notifRejectedTitle'), String(j.error || '').slice(0, 200));
        return { ok: false, error: String(j.error || 'app error') };
      }
      notify(payload.kind === 'video' ? t('notifVideoTitle') : t('notifSentTitle'), payload.filename || payload.url);
      startProgress();
      return { ok: true };
    } catch (e) {
      notify(t('notifOfflineTitle'), t('notifOfflineBody'));
      return { ok: false, error: String(e) };
    }
  }

  // ---------- Capture file-type filter (list comes from the app) ----------
  function extOf(name: string): string {
    const m = String(name || '').split(/[?#]/)[0].match(/\.([a-z0-9]{1,8})$/i);
    return m ? m[1].toLowerCase() : '';
  }
  function matchesCaptureTypes(app: AppInfo | null, filename: string, url: string): boolean {
    const list = app && Array.isArray(app.captureExtensions) ? app.captureExtensions : [];
    if (!list.length) return true;
    let path = '';
    try { path = new URL(url).pathname; } catch { }
    const e = extOf(filename) || extOf(path);
    return !!e && list.includes(e);
  }

  // ---------- Download interception (Chrome) ----------
  /**
   * İndirmeyi tetikleyen sayfanın adresi — Rust tarafında `Referer`
   * başlığı olarak gider.
   *
   * Chrome `item.referrer` alanını doldurur. Firefox'ta bu alan hiç yoktur:
   * tip `string` diyor ama çalışma zamanında `undefined`. Boş kalırsa Rust
   * tarafı başlığı hiç eklemiyor (`commands.rs`) ve `Referer` doğrulayan
   * CDN'ler 403 döner — Firefox'ta hotlink korumalı indirmeler bu yüzden
   * kırılıyordu.
   *
   * Sıra: `item.referrer` → indirmeyi başlatan sekmenin adresi → hedefin
   * kendi origin'i.
   */
  async function refererFor(item: chrome.downloads.DownloadItem, url: string): Promise<string> {
    const direct = item.referrer;
    if (direct) return direct;
    // `tabId` gerçekte her iki tarayıcıda da var ama @types/chrome'da
    // tanımlı değil; dar bir yerel bildirimle okunuyor.
    const tabId = (item as chrome.downloads.DownloadItem & { tabId?: number }).tabId;
    if (typeof tabId === 'number' && tabId >= 0) {
      try {
        const tab = await api.tabs.get(tabId);
        if (tab.url && /^https?:/i.test(tab.url)) return tab.url;
      } catch { }
    }
    try { return new URL(url).origin + '/'; } catch { }
    return '';
  }

  async function interceptDownload(item: chrome.downloads.DownloadItem): Promise<boolean> {
    const settings = await getSettings();
    if (!settings.intercept) return false;
    const url = item.finalUrl || item.url;
    if (!/^https?:/i.test(url)) return false;
    if (item.byExtensionId) return false;
    const totalBytes = item.totalBytes || 0;
    if (settings.minSizeMB > 0 && totalBytes > 0 && totalBytes < settings.minSizeMB * 1024 * 1024) return false;
    const app = await ping(settings);
    if (!app) return false;
    if (!matchesCaptureTypes(app, item.filename || '', url)) return false;

    try { await api.downloads.cancel(item.id); } catch { }
    if (IS_FIREFOX && ff) {
      // Küçük bir dosya, uygulama yanıt vermeden bitebilir; tarayıcının kopyasını sil.
      try {
        const [d] = await ff.downloads.search({ id: item.id });
        if (d && d.state === 'complete' && d.exists !== false) await ff.downloads.removeFile(item.id);
      } catch { }
    }
    try { await api.downloads.erase({ id: item.id }); } catch { }
    const filename = (item.filename ? item.filename.split(/[\\/]/).pop() : '') || '';
    const referer = await refererFor(item, url);
    sendToApp({ url, filename, referer, kind: 'file' });
    return true;
  }

  if (api.downloads?.onDeterminingFilename) {
    api.downloads.onDeterminingFilename.addListener((item, suggest) => {
      interceptDownload(item).then((took) => { if (!took) { try { suggest(); } catch { } } });
      return true;
    });
  } else if (api.downloads?.onCreated) {
    // Firefox'ta onDeterminingFilename yoktur: tarayıcı indirmesi haber
    // verildiğinde çoktan başlamıştır. Uygulamaya sorulurken indirmeyi
    // duraklatıp, uygulama reddederse sürdürürüz.
    api.downloads.onCreated.addListener((item) => {
      const paused = item.state === 'in_progress'
        ? Promise.resolve(api.downloads.pause(item.id)).then(() => true, () => false)
        : Promise.resolve(false);
      interceptDownload(item).then(async (took) => {
        if (!took && (await paused)) { try { await api.downloads.resume(item.id); } catch { } }
      });
    });
  }

  // ---------- Media sniffing ----------
  const mem = new Map<number, Map<string, MediaInfo>>();  // tabId -> Map(url -> info)   (storage.session yoksa yedek)

  /**
   * Sekme başına yazma sırası.
   *
   * `addMedia` "oku → değiştir → yaz" üç adımlı bir işlem ve
   * `webRequest.onHeadersReceived` bunu `await` etmeden çağırır. Segmentli
   * (HLS/DASH) bir sayfa 20 paralel `.m4s` isteği attığında 20 çağrı da aynı
   * eski listeyi okuyup üstüne yazıyordu; son yazan kazanıyor, diğer 19'u
   * sessizce kayboluyordu. Zincir, aynı sekmenin işlemlerini sıraya alıyor.
   *
   * `clearMedia` de aynı zincire girer: sekme değişimi sırasında uçuşta olan
   * eklemeler, temizlikten sonra eski sayfanın medyasını geri getiriyordu.
   *
   * Reddedilen bir işlem zinciri bozmaz; hat boşaldığında `mediaQueue`
   * girdisi silinir (sınırsız büyüme olmaz).
   */
  const mediaQueue = new Map<number, Promise<void>>();

  function serializeMedia<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
    const prev = mediaQueue.get(tabId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.then(() => { }, () => { });
    mediaQueue.set(tabId, tail);
    void tail.then(() => { if (mediaQueue.get(tabId) === tail) mediaQueue.delete(tabId); });
    return run;
  }

  async function readMedia(tabId: number): Promise<MediaInfo[]> {
    if (api.storage.session) {
      const key = 'media:' + tabId;
      const r = (await api.storage.session.get(key)) as unknown as Record<string, MediaInfo[]>;
      return r[key] || [];
    }
    return Array.from((mem.get(tabId) || new Map<string, MediaInfo>()).values());
  }
  async function writeMedia(tabId: number, list: MediaInfo[]): Promise<void> {
    if (api.storage.session) {
      await api.storage.session.set({ ['media:' + tabId]: list });
    } else {
      mem.set(tabId, new Map(list.map((m) => [m.url, m])));
    }
    try {
      await api.action.setBadgeText({ tabId, text: list.length ? String(list.length) : '' });
      await api.action.setBadgeBackgroundColor({ tabId, color: '#2f6feb' });
    } catch { }
  }
  function clearMedia(tabId: number): Promise<void> {
    // Aynı zincire girer: temizlik, uçuşta olan eklemelerden SONRA çalışır
    // ve eski sayfanın medyasını geri getirmez.
    return serializeMedia(tabId, async () => {
      if (api.storage.session) await api.storage.session.remove('media:' + tabId);
      mem.delete(tabId);
      try { await api.action.setBadgeText({ tabId, text: '' }); } catch { }
    }).catch(() => { });
  }

  function normalizeKey(url: string): string {
    try {
      const u = new URL(url);
      ['range', 'bytes', 'start', 'end', 'rn', 'rbuf', 'r', '_'].forEach((p) => u.searchParams.delete(p));
      return u.origin + u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '');
    } catch {
      return url;
    }
  }

  function addMedia(tabId: number, info: MediaInfo): Promise<void> {
    if (tabId < 0) return Promise.resolve();
    return serializeMedia(tabId, async () => {
      const settings = await getSettings();
      if (!settings.sniff) return;
      const list = await readMedia(tabId);
      const key = normalizeKey(info.url);
      const idx = list.findIndex((m) => m.key === key);
      const entry: MediaInfo = { ...info, key, name: info.name || guessName(info.url, info.type) };
      if (idx >= 0) {
        if ((info.size || 0) > (list[idx].size || 0)) list[idx] = { ...list[idx], ...entry };
        return;
      }
      list.unshift(entry);
      if (list.length > 40) list.length = 40;
      await writeMedia(tabId, list);
      // `webRequest` bu çağrıyı `await` etmeden yapıyor; storage hatası
      // unhandled promise rejection olmasın.
    }).catch(() => { });
  }

  function guessName(url: string, type: string): string {
    try {
      const u = new URL(url);
      let n = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '') || u.hostname;
      if (!/\.[a-z0-9]{2,5}$/i.test(n) && type) {
        const ext = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'video/quicktime': 'mov' }[type.toLowerCase()];
        if (ext) n += '.' + ext;
      }
      return n;
    } catch {
      return url;
    }
  }

  function headerVal(headers: chrome.webRequest.HttpHeader[] | undefined, name: string): string {
    const h = (headers || []).find((x) => x.name.toLowerCase() === name);
    return h ? h.value ?? '' : '';
  }
  function classify(url: string, ct: string): MediaKind | null {
    ct = (ct || '').toLowerCase();
    if (/\.m3u8(\?|#|$)/i.test(url) || /mpegurl/.test(ct)) return 'hls';
    if (/\.mpd(\?|#|$)/i.test(url) || /dash\+xml/.test(ct)) return 'dash';
    if (FRAGMENT.test(url)) return null;
    if (/^(video|audio)\//.test(ct)) {
      if (/mp2t|iso\.segment|x-mpegurl/.test(ct)) return null;
      return 'media';
    }
    if (/octet-stream/.test(ct) && MEDIA_EXT.test(url)) return 'media';
    return null;
  }

  if (api.webRequest?.onHeadersReceived) {
    api.webRequest.onHeadersReceived.addListener(
      (d) => {
        if (d.tabId < 0 || d.statusCode >= 400) return;
        let host = '';
        try { host = new URL(d.url).hostname; } catch { }
        if (IGNORED_HOSTS.test(host)) return;
        const ct = headerVal(d.responseHeaders, 'content-type');
        const kind = classify(d.url, ct);
        if (!kind) return;
        let size = parseInt(headerVal(d.responseHeaders, 'content-length'), 10) || 0;
        const cr = headerVal(d.responseHeaders, 'content-range').match(/\/(\d+)/);
        if (cr) size = parseInt(cr[1], 10);
        if (kind === 'media' && size > 0 && size < 300 * 1024) return;
        addMedia(d.tabId, { url: d.url, type: ct.split(';')[0], size, kind, time: Date.now() });
      },
      { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other', 'object', 'main_frame'] },
      ['responseHeaders']
    );
  }

  api.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading' && info.url) clearMedia(tabId);
  });
  api.tabs.onRemoved.addListener((tabId) => clearMedia(tabId));

  // ---------- Rozetin kalıcı uzlaştırması ----------
  // Alarm, canlı `setInterval` yokken de devam eden tek sürücüdür. Worker
  // sonlandığında veya tarayıcı yeniden başladığında `tickProgress` yeniden
  // tetiklenir; geçişler kalıcı durumdan okunduğu için yarım kalmış rozet
  // kendiliğinden tamamlanır.
  api.alarms?.onAlarm.addListener((a) => {
    if (a.name === PROGRESS_ALARM) void tickProgress();
  });

  // ---------- Context menu ----------
  // Firefox `contextMenus`'ü de sunar; `menus` yalnızca eskiden kalan bir yedektir.
  const menus = api.contextMenus || (api as unknown as { menus?: typeof chrome.contextMenus }).menus;
  function createMenus(): void {
    if (!menus) return;
    let created = false;
    const create = (): void => {
      if (created) return;
      created = true;
      // Her `create` kendi `try`si içinde: ikisi tek blokta olursa ilk
      // çağrı hata verdiğinde (ör. `removeAll` yarışıyla eski `dm-link`
      // kayıtlıysa "duplicate id") `catch` yutuyor ve `dm-page-video`
      // hiç oluşmuyor. `created` zaten true olduğu için ikinci deneme de
      // atlanıyor, kullanıcı menüyü kalıcı olarak kaybediyordu.
      try { menus.create({ id: 'dm-link', title: t('menuDownloadLink'), contexts: ['link', 'video', 'audio', 'image'] }); } catch { }
      try { menus.create({ id: 'dm-page-video', title: t('menuPageVideo'), contexts: ['page', 'video', 'frame', 'action'] }); } catch { }
    };
    // Chrome geri çağrı alır; Firefox'un browser.menus'ü söz döner.
    try {
      if (IS_FIREFOX && ff) ff.menus.removeAll().then(create, create);
      else menus.removeAll(create);
    } catch { create(); }
  }
  // Tarayıcı açılışında rozet durumu `perTab`'a dönmüş olabilir (oturum
  // sıfırlanır) ya da yarım kalmış bir geçiş olabilir; `tickProgress`
  // kalıcı duruma bakarak doğru kipi kendiliğinden seçer.
  api.runtime.onInstalled.addListener(() => { createMenus(); ping(); void tickProgress(); });
  api.runtime.onStartup?.addListener(() => { createMenus(); ping(); void tickProgress(); });
  menus?.onClicked.addListener((info, tab) => {
    if (info.menuItemId === 'dm-link') {
      const url = info.linkUrl || info.srcUrl;
      if (url) sendToApp({ url, referer: info.pageUrl || tab?.url, kind: 'file' });
    } else if (info.menuItemId === 'dm-page-video') {
      const url = info.pageUrl || tab?.url;
      if (url) sendToApp({ url, referer: url, kind: 'video' });
    }
  });

  // ---------- Popup / content script messages ----------
  //
  // Yetkilendirme: `sender.id` eşleşmesi kapıdır. Web sayfaları
  // `externally_connectable` tanımlı olmadığı için zaten doğrudan
  // `sendMessage` çağıramaz; yalnızca kendi content script'imiz (veya başka
  // bir eklenti) mesaj gönderebilir. `sender.id` kontrolü ikisini de
  // ayırır ve tek satırdır.
  //
  // Ayrıca `pageMedia` girdisi doğrulanmazsa bir sayfa, kendi
  // `<video>`'su olmadan istediği URL'yi "yakalanan medya" listesine
  // yazabilir; kullanıcı Download'a bastığında uygulama o URL'yi **o
  // origin'in çerezleriyle** indirir. Bu yüzden gönderen sekmenin
  // origin'i ile medya URL'sinin origin'i eşleşmeli.
  function sameOrigin(a: string, b: string): boolean {
    try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
  }

  api.runtime.onMessage.addListener((rawMsg, sender, sendResponse) => {
    const msg = rawMsg as ExtMessage;
    (async () => {
      try {
        if (sender.id !== api.runtime.id) { sendResponse({ ok: false, error: 'forbidden' }); return; }
        switch (msg?.type) {
          case 'status': {
            const settings = await getSettings();
            const app = await ping(settings);
            const response: StatusResponse = {
              online: !!app, app, settings,
              clickIntercept: !api.downloads?.onDeterminingFilename,
              captureExtensions: (app && app.captureExtensions) || [],
            };
            sendResponse(response);
            break;
          }
          case 'getMedia': {
            // Sekme kimliği istemciden gelir; yalnızca kendi sekmesine
            // bakabilmesi için gönderenin o sekmeye erişimi doğrulanır.
            const tabId = Number(msg.tabId);
            if (!Number.isInteger(tabId) || tabId < 0) { sendResponse([]); break; }
            if (!sender.tab || sender.tab.id !== tabId) {
              // Popup kendi sekmesini sorar; başka bir sekmeyi soramaz.
              let ok = false;
              try { const tabs = await api.tabs.query({ active: true, currentWindow: true }); ok = tabs.some((t) => t.id === tabId); } catch { }
              if (!ok) { sendResponse([]); break; }
            }
            sendResponse(await readMedia(tabId));
            break;
          }
          case 'downloads': sendResponse(await getDownloads()); break;
          case 'action': sendResponse(await downloadAction(String(msg.id), String(msg.action))); break;
          case 'download': sendResponse(await sendToApp(msg)); break;
          case 'setSettings': {
            // Yalnızca popup ayar değiştirebilir; content script'ın köprü
            // portunu değiştirmesine izin verilmez. Port ayrıca aralığa
            // kırpılır — `popup.html`'deki `min/max` yalnızca HTML giriş
            // doğrulamasıdır, `onchange` okunan değeri kırpmıyordu.
            if (sender.tab) { sendResponse({ ok: false, error: 'forbidden' }); break; }
            const p = msg.settings || {};
            const clean: Partial<Settings> = {};
            if (typeof p.intercept === 'boolean') clean.intercept = p.intercept;
            if (typeof p.sniff === 'boolean') clean.sniff = p.sniff;
            if (typeof p.minSizeMB === 'number' && Number.isFinite(p.minSizeMB)) clean.minSizeMB = Math.max(0, p.minSizeMB);
            if (typeof p.port === 'number' && Number.isInteger(p.port)) clean.port = Math.min(65535, Math.max(1024, p.port));
            await setSettings(clean);
            sendResponse({ ok: true });
            break;
          }
          case 'pageMedia': {
            const items = Array.isArray(msg.items) ? msg.items : [];
            if (sender.tab && sender.tab.id !== undefined && sender.tab.url) {
              for (const m of items) {
                const url = typeof m?.url === 'string' ? m.url : '';
                if (!/^https?:/i.test(url)) continue;
                // Yalnızca gönderen sayfanın kendi origin'inden medya kabul et.
                if (!sameOrigin(sender.tab.url, url)) continue;
                const kind = classify(url, typeof m.type === 'string' ? m.type : '');
                if (!kind && !MEDIA_EXT.test(url)) continue;
                await addMedia(sender.tab.id, {
                  url, type: typeof m.type === 'string' ? m.type : '', size: 0,
                  kind: kind || 'media', time: Date.now(),
                  name: typeof m.name === 'string' ? m.name.slice(0, 120) : undefined,
                });
              }
            }
            sendResponse({ ok: true });
            break;
          }
          default: sendResponse(null);
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  });
})();
