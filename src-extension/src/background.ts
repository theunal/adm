// ADM bridge extension — background script
// Chrome / Edge / Brave / Opera / Vivaldi (MV3 service worker),
// Firefox (MV3 event page) ve Safari (converter ile paketlenmiş) için tek kaynak.
//
// MC Download Manager uzantısının birebir portudur. Farklar:
//   * Marka ADM, köprü başlığı `X-ADM-Extension`
//   * Safari / native-messaging yolu çıkarıldı (köprü HTTP üzerinden)

(() => {
  'use strict';

  // `browser` küresi Firefox ve Safari'de tanımlıdır ve söz (promise) döndürür.
  // Chromium'da yalnızca `chrome` vardır; MV3'te o da çoğu API için söz döndürür.
  // Geri çağrı / söz ayrımı Firefox'a değil, `browser` küresinin varlığına
  // bağlanmalıdır: Safari de `browser` sunar ama `moz-extension:` değildir.
  const ff = (globalThis as { browser?: unknown }).browser as FirefoxApi | undefined;
  const PROMISE_NS = !!ff;
  const IS_FIREFOX = !!ff && String(ff.runtime.getURL('')).startsWith('moz-extension:');
  const IS_SAFARI = !!ff && String(ff.runtime.getURL('')).startsWith('safari-web-extension:');
  const api = ff ? (ff as unknown as typeof chrome) : chrome;

  const t = (k: string, subs?: string | string[]): string => {
    try { return api.i18n.getMessage(k, subs) || k; } catch { return k; }
  };

  const DEFAULTS: Settings = { port: 48213, intercept: true, minSizeMB: 0, sniff: true };

  function detectBrowser(): string {
    if (IS_FIREFOX) return 'firefox';
    if (IS_SAFARI) return 'safari';
    const nav = navigator as Navigator & { brave?: unknown };
    const ua = nav.userAgent;
    if (nav.brave) return 'brave';
    if (/Edg\//.test(ua)) return 'edge';
    if (/OPR\//.test(ua)) return 'opera';
    if (/Vivaldi\//.test(ua)) return 'vivaldi';
    return 'chrome';
  }
  const BROWSER = detectBrowser();

  const MEDIA_EXT = /\.(mp4|m4v|webm|mkv|mov|avi|flv|mp3|m4a|aac|ogg|opus|wav|flac)(\?|#|$)/i;
  const FRAGMENT = /\.(ts|m4s|m4f|cmfv|cmfa|fmp4|init)(\?|#|$)|[/_.-](seg|segment|chunk|frag|fragment)[-_]?\d+/i;
  const IGNORED_HOSTS = /(^|\.)googlevideo\.com$|(^|\.)fbcdn\.net$|(^|\.)twimg\.com$/i;
  const HTTP_URL = /^https?:/i;

  // ---------- Settings ----------
  async function getSettings(): Promise<Settings> {
    const s = (await api.storage.local.get('settings')) as unknown as { settings?: Partial<Settings> };
    return { ...DEFAULTS, ...(s.settings || {}) };
  }
  async function setSettings(patch: Partial<Settings>): Promise<void> {
    const cur = await getSettings();
    await api.storage.local.set({ settings: { ...cur, ...patch } });
    pingCache = null;
  }
  const base = (s: Settings): string => `http://127.0.0.1:${s.port}`;
  // Özel başlık, isteğin bir uzantıdan geldiğinin kanıtıdır: normal web sayfalar
  // CORS ön kontrolü olmadan bu başlığı gönderemez ve köprü CORS'u yalnızca
  // uzantı kaynaklarına verir. Chrome, host iznine tabi uzantı GET'lerinde
  // `Origin` başlığını atladığı için yalnızca Origin yeterli değildir.
  const BRIDGE_HEADERS = { 'X-ADM-Extension': BROWSER };

  // ---------- App communication ----------
  // Köprü TCP bağlantısını kabul edip yanıt yazmayabilir. Zaman aşımı olmadan
  // `fetch` hiç bitmez; bu yüzden her köprü isteği `signal` ile sınırlıdır.
  const PING_TIMEOUT_MS = 1200;
  const BRIDGE_TIMEOUT_MS = 5000;
  /**
   * Her sekmenin her çerçevesindeki content script `status` sorar; her biri
   * ayrı bir ping olursa çok sekmeli bir oturumda köprüye aynı anda onlarca
   * istek gider. Kısa süreli önbellek bunu tek isteğe indirir.
   */
  const PING_CACHE_MS = 2000;
  let pingCache: { at: number; port: number; value: Promise<AppInfo | null> } | null = null;

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

  async function pingNow(cfg: Settings): Promise<AppInfo | null> {
    try {
      const r = await bridgeFetch(
        base(cfg) + '/ping?browser=' + encodeURIComponent(BROWSER),
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

  async function ping(settings?: Settings, fresh = false): Promise<AppInfo | null> {
    const cfg = settings || (await getSettings());
    const now = Date.now();
    if (!fresh && pingCache && pingCache.port === cfg.port && now - pingCache.at < PING_CACHE_MS) {
      return pingCache.value;
    }
    const value = pingNow(cfg);
    pingCache = { at: now, port: cfg.port, value };
    return value;
  }

  // ---------- Download progress: toolbar badge + popup list ----------
  async function bridgeJSON<T = unknown>(path: string, init?: RequestInit): Promise<T> {
    const settings = await getSettings();
    const r = await bridgeFetch(
      base(settings) + path,
      { cache: 'no-store', ...init, headers: { ...BRIDGE_HEADERS, ...(init?.headers) } },
      BRIDGE_TIMEOUT_MS,
    );
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return (await r.json()) as T;
  }
  /** `null` = uygulamaya ulaşılamadı; `[]` = ulaşıldı ama indirme yok. */
  async function fetchDownloads(): Promise<DownloadItem[] | null> {
    try {
      const j = await bridgeJSON<{ items?: DownloadItem[] }>('/downloads');
      return Array.isArray(j.items) ? j.items : [];
    } catch {
      return null;
    }
  }
  async function downloadAction(id: string, action: string): Promise<unknown> {
    if (!DOWNLOAD_ACTIONS.has(action)) return { ok: false, error: 'invalid action' };
    try {
      const j = await bridgeJSON('/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }),
      });
      void tickProgress();
      return j;
    } catch (e) { return { ok: false, error: String(e) }; }
  }
  const ACTIVE_STATES = new Set(['downloading', 'probing']);
  const DOWNLOAD_ACTIONS = new Set(['pause', 'resume', 'cancel', 'remove']);

  // ---------------------------------------------------------------------
  // Rozet durumu — MV3 service worker / Firefox event page her an sonlanabilir.
  // Geçişin *niyeti* `storage.session`'a yazılır, geçiş tembel uzlaştırma ile
  // tamamlanır. Alarm, canlı bir zamanlayıcı yokken onarımı sürdürür.
  // ---------------------------------------------------------------------
  const BADGE_KEY = 'badge';
  const DONE_BADGE_MS = 4000;
  const PROGRESS_ALARM = 'adm-progress';
  /** Chrome 120+ ve Firefox'un izin verdiği en küçük periyot (30 sn). */
  const PROGRESS_ALARM_MIN = 0.5;

  type BadgeMode = 'perTab' | 'global' | 'done';
  interface BadgeState {
    mode: BadgeMode;
    doneUntil: number;
  }

  let badgeCache: BadgeState = { mode: 'perTab', doneUntil: 0 };
  let progressTimer: ReturnType<typeof setInterval> | null = null;

  async function loadBadge(): Promise<BadgeState> {
    if (api.storage.session) {
      try {
        const r = (await api.storage.session.get(BADGE_KEY)) as unknown as Record<string, BadgeState | undefined>;
        const v = r && r[BADGE_KEY];
        if (v && (v.mode === 'global' || v.mode === 'done' || v.mode === 'perTab')) {
          badgeCache = v;
          return v;
        }
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
  // `text: null` sekme rozetini temizleyip genel metne düşürür — chrome.action
  // tiplerinde null yoktur, bu yüzden tek noktada cast edilir.
  async function useGlobalBadgeOnAllTabs(on: boolean): Promise<void> {
    let tabs: chrome.tabs.Tab[] = [];
    try { tabs = await api.tabs.query({}); } catch { return; }
    await Promise.all(tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      if (on) {
        try { await api.action.setBadgeText({ tabId: tab.id, text: null as unknown as string }); } catch { }
        return;
      }
      let count = 0;
      try { count = (await readMedia(tab.id)).length; } catch { return; }
      try { await api.action.setBadgeText({ tabId: tab.id, text: count ? String(count) : '' }); } catch { }
    }));
  }

  /**
   * `setInterval` 1,5 sn'de bir tetikler ama köprü isteği 5 sn'ye kadar
   * sürebilir. Örtüşen turlar aynı rozet geçişini paralel yapar ve
   * `saveBadge` yarışı yaratır; tek uçuşta tur sınırı bunu engeller.
   */
  let tickInFlight: Promise<void> | null = null;
  function tickProgress(): Promise<void> {
    if (!tickInFlight) {
      tickInFlight = runTick().catch(() => { }).finally(() => { tickInFlight = null; });
    }
    return tickInFlight;
  }

  async function runTick(): Promise<void> {
    const list = await fetchDownloads();
    const badge = await loadBadge();
    const active = (list || []).filter((i) => ACTIVE_STATES.has(i.state));

    if (active.length) {
      const measurable = active.filter((i) => i.total > 0);
      let text = '…';
      if (active.length > 1) text = active.length + '↓';
      else if (measurable.length) {
        const total = measurable.reduce((a, i) => a + i.total, 0);
        const got = measurable.reduce((a, i) => a + Math.min(i.received, i.total), 0);
        text = Math.round((100 * got) / total) + '%';
      }
      // Sıralama: önce yan etki, sonra durum. Worker arada ölürse bir sonraki
      // tur işi idempotent olarak tekrarlar.
      if (badge.mode !== 'global') {
        await useGlobalBadgeOnAllTabs(true);
        await saveBadge({ mode: 'global', doneUntil: 0 });
      }
      await setGlobalBadge(text, '#2f6feb');
      return;
    }

    stopProgress();

    // Uygulama kapandı/çöktüyse indirme bitmiş sayılmaz: ✓ göstermeden
    // doğrudan sekme rozetlerine dönülür.
    if (list === null && badge.mode !== 'perTab') {
      await setGlobalBadge('', '#2f6feb');
      await useGlobalBadgeOnAllTabs(false);
      await saveBadge({ mode: 'perTab', doneUntil: 0 });
      return;
    }
    if (badge.mode === 'global') {
      await setGlobalBadge('✓', '#2ebd59');
      await saveBadge({ mode: 'done', doneUntil: Date.now() + DONE_BADGE_MS });
      return;
    }
    if (badge.mode === 'done') {
      if (Date.now() < badge.doneUntil) {
        // Alarm 30 sn'de bir döner; 4 sn'lik pencereyi kaçırmamak için
        // canlı worker varken kısa bir zamanlayıcıyla tekrar dene.
        setTimeout(() => { void tickProgress(); }, badge.doneUntil - Date.now() + 50);
        return;
      }
      await setGlobalBadge('', '#2f6feb');
      await useGlobalBadgeOnAllTabs(false);
      await saveBadge({ mode: 'perTab', doneUntil: 0 });
    }
  }
  function startProgress(): void {
    if (progressTimer) return;
    void tickProgress();
    progressTimer = setInterval(() => { void tickProgress(); }, 1500);
  }
  function stopProgress(): void {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
  }

  // ---------- Cookies ----------
  /**
   * Varsayılan `cookies.getAll({ url })` yalnızca normal pencerenin deposunu
   * okur. Gizli pencere (Chrome "1", Firefox "firefox-private") veya Firefox
   * konteyner sekmelerinden gelen indirmeler bu yüzden çerezsiz gidiyor ve
   * oturum gerektiren dosyalar 401/403 ile düşüyordu.
   */
  async function cookieStoreFor(ctx: CookieContext): Promise<string | undefined> {
    if (ctx.cookieStoreId) return ctx.cookieStoreId;
    if (!api.cookies?.getAllCookieStores) return undefined;
    try {
      const stores = await api.cookies.getAllCookieStores();
      const tabId = ctx.tabId;
      if (typeof tabId === 'number' && tabId >= 0) {
        const s = stores.find((st) => st.tabIds.includes(tabId));
        if (s) return s.id;
      }
      if (ctx.incognito) {
        const tabs = await api.tabs.query({});
        const privateIds = new Set(tabs.filter((tb) => tb.incognito).map((tb) => tb.id));
        const s = stores.find((st) => st.tabIds.some((id) => privateIds.has(id)));
        if (s) return s.id;
      }
    } catch { }
    return undefined;
  }

  async function cookiesFor(url: string, ctx: CookieContext): Promise<{ header: string; list: CookieInfo[] }> {
    if (!api.cookies?.getAll) return { header: '', list: [] };
    try {
      const storeId = await cookieStoreFor(ctx);
      const query: chrome.cookies.GetAllDetails & { firstPartyDomain?: null } = { url };
      if (storeId) query.storeId = storeId;
      // Firefox'ta first-party isolation (privacy.firstparty.isolate / Tor
      // tabanlı türevler) açıkken `firstPartyDomain` verilmezse çağrı hata
      // fırlatır. `null` tüm birinci taraf alanlarını döndürür. Chromium bu
      // anahtarı tanımaz ve şema hatası verir, o yüzden yalnızca Firefox'ta.
      if (IS_FIREFOX) query.firstPartyDomain = null;
      const list = await api.cookies.getAll(query);
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

  function notify(title: string, message: string): void {
    // Tek argümanlı `create(options)` hem Chrome hem Firefox'ta geçerli.
    // Firefox göreli `iconUrl`'yi her zaman çözemez; mutlak adres verilir.
    // Safari'de `notifications` API'si yoktur; opsiyonel zincir onu atlar.
    const opts: chrome.notifications.NotificationCreateOptions = {
      type: 'basic', iconUrl: api.runtime.getURL('icons/icon128.png'), title, message: String(message || '').slice(0, 200),
    };
    try {
      const p = api.notifications?.create?.(opts) as unknown;
      if (p && typeof (p as Promise<unknown>).catch === 'function') {
        (p as Promise<unknown>).catch(() => { });
      }
    } catch { }
  }

  async function sendToApp(payload: SendToAppPayload): Promise<SendToAppResult> {
    if (!HTTP_URL.test(payload.url)) return { ok: false, error: 'unsupported url' };
    const settings = await getSettings();
    const ck = await cookiesFor(payload.url, payload);
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
      let j: { ok?: boolean; error?: string } = {};
      try { j = (await r.json()) as typeof j; } catch { j = { ok: false, error: 'HTTP ' + r.status }; }
      // Uygulama çalışıyor ama işi reddetti — bu "uygulama kapalı" değildir.
      if (!j.ok) {
        notify(t('notifRejectedTitle'), String(j.error || '').slice(0, 200));
        return { ok: false, error: String(j.error || 'app error') };
      }
      notify(payload.kind === 'video' ? t('notifVideoTitle') : t('notifSentTitle'), payload.filename || payload.url);
      startProgress();
      return { ok: true };
    } catch (e) {
      pingCache = null;
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

  // ---------- Download interception ----------
  type BrowserDownloadItem = chrome.downloads.DownloadItem & { tabId?: number; cookieStoreId?: string };

  /**
   * Sıra: `item.referrer` (Chrome) → indirmeyi başlatan sekme → hedefin origin'i.
   * Firefox `referrer` alanını doldurmaz; boş kalırsa `Referer` doğrulayan
   * CDN'ler 403 döner.
   */
  async function refererFor(item: BrowserDownloadItem, url: string): Promise<string> {
    if (item.referrer) return item.referrer;
    const tabId = item.tabId;
    if (typeof tabId === 'number' && tabId >= 0) {
      try {
        const tab = await api.tabs.get(tabId);
        if (tab.url && HTTP_URL.test(tab.url)) return tab.url;
      } catch { }
    }
    try { return new URL(url).origin + '/'; } catch { }
    return '';
  }

  async function shouldIntercept(item: BrowserDownloadItem, settings: Settings): Promise<{ url: string } | null> {
    if (!settings.intercept) return null;
    const url = item.finalUrl || item.url;
    if (!HTTP_URL.test(url)) return null;
    if (item.byExtensionId) return null;
    const totalBytes = item.totalBytes || 0;
    if (settings.minSizeMB > 0 && totalBytes > 0 && totalBytes < settings.minSizeMB * 1024 * 1024) return null;
    const app = await ping(settings, true);
    if (!app) return null;
    if (!matchesCaptureTypes(app, item.filename || '', url)) return null;
    return { url };
  }

  async function interceptDownload(item: BrowserDownloadItem): Promise<boolean> {
    const settings = await getSettings();
    const ok = await shouldIntercept(item, settings);
    if (!ok) return false;
    const { url } = ok;

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
    void sendToApp({
      url, filename, referer, kind: 'file',
      tabId: item.tabId, incognito: item.incognito, cookieStoreId: item.cookieStoreId,
    });
    return true;
  }

  if (api.downloads?.onDeterminingFilename) {
    // Chromium: indirme dosya adı belirlenene kadar bekletilir.
    api.downloads.onDeterminingFilename.addListener((item, suggest) => {
      // Herhangi bir adım reddederse `suggest()` hiç çağrılmaz ve tarayıcı
      // indirmesi sonsuza dek "başlatılıyor"da asılı kalır.
      interceptDownload(item as BrowserDownloadItem)
        .catch(() => false)
        .then((took) => { if (!took) { try { suggest(); } catch { } } });
      return true;
    });
  } else if (api.downloads?.onCreated) {
    // Firefox: onDeterminingFilename yoktur, indirme çoktan başlamıştır.
    // Uygulamaya sorulurken duraklatılır, reddedilirse sürdürülür.
    api.downloads.onCreated.addListener((raw) => {
      const item = raw as BrowserDownloadItem;
      void (async () => {
        const settings = await getSettings().catch(() => DEFAULTS);
        // Yakalama kapalıyken veya http(s) dışı indirmelerde hiç dokunma:
        // devam ettirilemeyen (Range desteklemeyen) bir indirmeyi duraklatmak
        // onu baştan başlatır ya da takılı bırakır.
        if (!settings.intercept || !HTTP_URL.test(item.finalUrl || item.url) || item.byExtensionId) return;
        let paused = false;
        if (item.state === 'in_progress' && item.canResume !== false) {
          try { await api.downloads.pause(item.id); paused = true; } catch { }
        }
        const took = await interceptDownload(item).catch(() => false);
        if (!took && paused) { try { await api.downloads.resume(item.id); } catch { } }
      })();
    });
  }

  // ---------- Media sniffing ----------
  const mem = new Map<number, Map<string, MediaInfo>>();  // storage.session yoksa yedek

  /**
   * Sekme başına yazma sırası: `addMedia` "oku → değiştir → yaz" işlemidir ve
   * webRequest onu `await` etmeden çağırır; zincir aynı sekmenin işlemlerini
   * sıraya alır, böylece paralel segment istekleri birbirini ezmez.
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
      const r = (await api.storage.session.get(key)) as unknown as Record<string, MediaInfo[] | undefined>;
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
    // İndirme sürerken genel rozet geçerli; sekme rozetini yazmak onu ezerdi.
    if (badgeCache.mode !== 'perTab') return;
    try {
      await api.action.setBadgeText({ tabId, text: list.length ? String(list.length) : '' });
      await api.action.setBadgeBackgroundColor({ tabId, color: '#2f6feb' });
    } catch { }
  }
  function clearMedia(tabId: number): Promise<void> {
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
        // Daha büyük boyut bilgisi geldiyse güncelle ve KAYDET — önceden
        // değişiklik yalnızca bellekte yapılıp yazılmıyordu.
        if ((info.size || 0) > (list[idx].size || 0)) {
          list[idx] = { ...list[idx], ...entry };
          await writeMedia(tabId, list);
        }
        return;
      }
      list.unshift(entry);
      if (list.length > 40) list.length = 40;
      await writeMedia(tabId, list);
    }).catch(() => { });
  }

  function guessName(url: string, type: string): string {
    try {
      const u = new URL(url);
      let n = u.hostname;
      try { n = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '') || u.hostname; } catch { }
      if (!/\.[a-z0-9]{2,5}$/i.test(n) && type) {
        const map: Record<string, string> = {
          'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'video/quicktime': 'mov',
        };
        const ext = map[type.toLowerCase()];
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
    try {
      api.webRequest.onHeadersReceived.addListener(
        (d) => {
          if (d.tabId < 0 || d.statusCode >= 400) return undefined;
          let host = '';
          try { host = new URL(d.url).hostname; } catch { }
          if (IGNORED_HOSTS.test(host)) return undefined;
          const ct = headerVal(d.responseHeaders, 'content-type');
          const kind = classify(d.url, ct);
          if (!kind) return undefined;
          let size = parseInt(headerVal(d.responseHeaders, 'content-length'), 10) || 0;
          const cr = headerVal(d.responseHeaders, 'content-range').match(/\/(\d+)/);
          if (cr) size = parseInt(cr[1], 10);
          if (kind === 'media' && size > 0 && size < 300 * 1024) return undefined;
          void addMedia(d.tabId, { url: d.url, type: ct.split(';')[0], size, kind, time: Date.now() });
          return undefined;
        },
        { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other', 'object', 'main_frame'] },
        ['responseHeaders'],
      );
    } catch {
      // Safari bazı istek türlerini tanımaz ve kaydı reddeder; sniffing
      // yine de content script'in DOM taramasıyla çalışmaya devam eder.
    }
  }

  api.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading' && info.url) void clearMedia(tabId);
  });
  api.tabs.onRemoved.addListener((tabId) => { void clearMedia(tabId); });

  // ---------- Rozetin kalıcı uzlaştırması ----------
  api.alarms?.onAlarm.addListener((a) => {
    if (a.name === PROGRESS_ALARM) void tickProgress();
  });

  // ---------- Context menu ----------
  // Firefox `contextMenus`'ü de sunar; `menus` eski sürümler için yedektir.
  // Safari ve Firefox Android'de ikisi de olmayabilir.
  const menus = api.contextMenus || (api as unknown as { menus?: typeof chrome.contextMenus }).menus;
  function createMenus(): void {
    if (!menus) return;
    let created = false;
    const create = (): void => {
      if (created) return;
      created = true;
      // Chrome 'lastError'ı okunmayan geri çağrılar konsola uyarı yazar;
      // her create kendi try'ı + boş geri çağrısıyla çalışır.
      const done = (): void => { void api.runtime.lastError; };
      try { menus.create({ id: 'dm-link', title: t('menuDownloadLink'), contexts: ['link', 'video', 'audio', 'image'] }, done); } catch { }
      try { menus.create({ id: 'dm-page-video', title: t('menuPageVideo'), contexts: ['page', 'video', 'frame', 'action'] }, done); } catch { }
    };
    // `browser` ad alanı söz döner (Firefox, Safari); Chromium geri çağrı alır.
    try {
      if (PROMISE_NS) {
        const ns = ff?.menus ?? menus;
        Promise.resolve(ns.removeAll()).then(create, create);
      } else {
        menus.removeAll(create);
      }
    } catch { create(); }
  }
  api.runtime.onInstalled.addListener(() => { createMenus(); void ping(); void tickProgress(); });
  api.runtime.onStartup?.addListener(() => { createMenus(); void ping(); void tickProgress(); });
  menus?.onClicked.addListener((info, tab) => {
    const ctx = { tabId: tab?.id, incognito: tab?.incognito, cookieStoreId: (tab as { cookieStoreId?: string } | undefined)?.cookieStoreId };
    if (info.menuItemId === 'dm-link') {
      const url = info.linkUrl || info.srcUrl;
      if (url) void sendToApp({ url, referer: info.pageUrl || tab?.url, kind: 'file', ...ctx });
    } else if (info.menuItemId === 'dm-page-video') {
      const url = info.frameUrl || info.pageUrl || tab?.url;
      if (url) void sendToApp({ url, referer: url, kind: 'video', ...ctx });
    }
  });

  // ---------- Popup / content script messages ----------
  //
  // Yetkilendirme: `sender.id` eşleşmesi kapıdır; `externally_connectable`
  // tanımlı olmadığı için web sayfaları doğrudan mesaj gönderemez.
  //
  // İkinci katman: content script'ler potansiyel olarak ele geçirilmiş bir
  // renderer'da çalışır. Ayarları değiştirme, indirmeleri duraklatma/iptal
  // etme ve indirme listesini okuma yalnızca uzantı sayfalarına (popup)
  // açıktır — `sender.tab` olmayan gönderenler.
  //
  // `pageMedia` için: DOM'dan bildirilen medya yalnızca gönderen ÇERÇEVENİN
  // sitesinden kabul edilir. Başka sitedeki CDN medyası zaten webRequest
  // ile ağ seviyesinde (sahte bildirilemez) yakalanır.
  const MULTI_PART_SLD = /^(co|com|net|org|gov|edu|ac|or|ne|go|gob|mil)$/;
  function siteOf(url: string): string {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (/^[\d.]+$/.test(host) || host.includes(':')) return host;
      const parts = host.split('.');
      if (parts.length <= 2) return host;
      const tld = parts[parts.length - 1];
      const sld = parts[parts.length - 2];
      const n = tld.length === 2 && MULTI_PART_SLD.test(sld) ? 3 : 2;
      return parts.slice(-n).join('.');
    } catch {
      return '';
    }
  }
  function sameSite(a: string | undefined, b: string): boolean {
    if (!a) return false;
    const sa = siteOf(a);
    return !!sa && sa === siteOf(b);
  }

  const isExtensionPage = (sender: chrome.runtime.MessageSender): boolean => !sender.tab;

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
            const tabId = Number(msg.tabId);
            if (!Number.isInteger(tabId) || tabId < 0) { sendResponse([]); break; }
            if (sender.tab) {
              // Content script yalnızca kendi sekmesini okuyabilir.
              if (sender.tab.id !== tabId) { sendResponse([]); break; }
            } else {
              // Popup: herhangi bir penceredeki etkin sekme. `currentWindow`
              // arka plandan çağrıldığında son odaklanan pencereyi gösterir ve
              // Firefox'ta popup penceresiyle her zaman aynı olmayabilir.
              let ok = false;
              try { const tabs = await api.tabs.query({ active: true }); ok = tabs.some((tb) => tb.id === tabId); } catch { }
              if (!ok) { sendResponse([]); break; }
            }
            sendResponse(await readMedia(tabId));
            break;
          }
          case 'downloads': {
            if (!isExtensionPage(sender)) { sendResponse([]); break; }
            sendResponse((await fetchDownloads()) || []);
            break;
          }
          case 'action': {
            if (!isExtensionPage(sender)) { sendResponse({ ok: false, error: 'forbidden' }); break; }
            sendResponse(await downloadAction(String(msg.id), String(msg.action)));
            break;
          }
          case 'download': {
            const url = typeof msg.url === 'string' ? msg.url : '';
            if (!HTTP_URL.test(url)) { sendResponse({ ok: false, error: 'unsupported url' }); break; }
            const kind = msg.kind === 'video' ? 'video' : 'file';
            const fromTab = sender.tab;
            // Content script yalnızca kullanıcının tıkladığı dosya bağlantısını
            // gönderir; video (yt-dlp) akışını tetikleyemez.
            if (fromTab && kind !== 'file') { sendResponse({ ok: false, error: 'forbidden' }); break; }
            const tabId = fromTab ? fromTab.id : (typeof msg.tabId === 'number' ? msg.tabId : undefined);
            sendResponse(await sendToApp({
              url,
              filename: typeof msg.filename === 'string' ? msg.filename.slice(0, 255) : '',
              referer: fromTab ? (sender.url || fromTab.url) : (typeof msg.referer === 'string' ? msg.referer : ''),
              kind,
              tabId,
              incognito: fromTab?.incognito,
              cookieStoreId: (fromTab as { cookieStoreId?: string } | undefined)?.cookieStoreId,
            }));
            break;
          }
          case 'setSettings': {
            if (!isExtensionPage(sender)) { sendResponse({ ok: false, error: 'forbidden' }); break; }
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
            const items = Array.isArray(msg.items) ? msg.items.slice(0, 50) : [];
            const tab = sender.tab;
            const frameUrl = sender.url || tab?.url;
            if (tab && tab.id !== undefined && frameUrl) {
              for (const m of items) {
                const url = typeof m?.url === 'string' ? m.url : '';
                if (!HTTP_URL.test(url)) continue;
                if (!sameSite(frameUrl, url) && !sameSite(tab.url, url)) continue;
                const type = typeof m.type === 'string' ? m.type : '';
                const kind = classify(url, type);
                if (!kind && !MEDIA_EXT.test(url)) continue;
                await addMedia(tab.id, {
                  url, type, size: 0,
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
