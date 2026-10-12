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
  async function ping(settings?: Settings): Promise<AppInfo | null> {
    const cfg = settings || (await getSettings());
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 1200);
      const r = await fetch(base(cfg) + '/ping?browser=' + BROWSER, { signal: ctrl.signal, cache: 'no-store', headers: BRIDGE_HEADERS });
      clearTimeout(timeout);
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
    const r = await fetch(base(settings) + path, {
      cache: 'no-store', ...init, headers: { ...BRIDGE_HEADERS, ...(init?.headers) },
    });
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
  let progressTimer: ReturnType<typeof setInterval> | null = null;
  let badgeShown = false;
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
    try {
      const tabs = await api.tabs.query({});
      for (const tab of tabs) {
        if (on) {
          try { await api.action.setBadgeText({ tabId: tab.id, text: null as unknown as string }); } catch { }
        } else {
          const list = await readMedia(tab.id!);
          try { await api.action.setBadgeText({ tabId: tab.id, text: list.length ? String(list.length) : '' }); } catch { }
        }
      }
    } catch { }
  }
  async function tickProgress(): Promise<void> {
    const list = await getDownloads();
    const active = list.filter((i) => ACTIVE_STATES.has(i.state));
    if (active.length) {
      const measurable = active.filter((i) => i.total > 0);
      let text = '…';
      if (active.length > 1) text = active.length + '↓';
      else if (measurable.length) {
        const total = measurable.reduce((a, i) => a + i.total, 0);
        const got = measurable.reduce((a, i) => a + Math.min(i.received, i.total), 0);
        text = Math.round((100 * got) / total) + '%';
      }
      if (!badgeShown) { badgeShown = true; await useGlobalBadgeOnAllTabs(true); }
      await setGlobalBadge(text, '#2f6feb');
    } else {
      stopProgress();
      if (badgeShown) {
        badgeShown = false;
        await setGlobalBadge('✓', '#2ebd59');
        setTimeout(async () => { await setGlobalBadge('', '#2f6feb'); await useGlobalBadgeOnAllTabs(false); }, 4000);
      }
    }
  }
  function startProgress(): void {
    if (progressTimer) return;
    tickProgress();
    progressTimer = setInterval(tickProgress, 1500);  // her fetch, iş sürerken MV3 worker'ını canlı tutar
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

  function notify(title: string, message: string): void {
    try {
      api.notifications?.create?.('', {
        type: 'basic', iconUrl: 'icons/icon128.png', title, message: String(message || '').slice(0, 200),
      });
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
      const r = await fetch(base(settings) + '/download', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...BRIDGE_HEADERS }, body: JSON.stringify(body),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!j.ok) throw new Error(j.error || 'app error');
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
    sendToApp({ url, filename, referer: item.referrer, kind: 'file' });
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
  async function clearMedia(tabId: number): Promise<void> {
    if (api.storage.session) await api.storage.session.remove('media:' + tabId);
    mem.delete(tabId);
    try { await api.action.setBadgeText({ tabId, text: '' }); } catch { }
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

  async function addMedia(tabId: number, info: MediaInfo): Promise<void> {
    if (tabId < 0) return;
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

  // ---------- Context menu ----------
  // Firefox `contextMenus`'ü de sunar; `menus` yalnızca eskiden kalan bir yedektir.
  const menus = api.contextMenus || (api as unknown as { menus?: typeof chrome.contextMenus }).menus;
  function createMenus(): void {
    if (!menus) return;
    let created = false;
    const create = (): void => {
      if (created) return;
      created = true;
      try {
        menus.create({ id: 'dm-link', title: t('menuDownloadLink'), contexts: ['link', 'video', 'audio', 'image'] });
        menus.create({ id: 'dm-page-video', title: t('menuPageVideo'), contexts: ['page', 'video', 'frame', 'action'] });
      } catch { }
    };
    // Chrome geri çağrı alır; Firefox'un browser.menus'ü söz döner.
    try {
      if (IS_FIREFOX && ff) ff.menus.removeAll().then(create, create);
      else menus.removeAll(create);
    } catch { create(); }
  }
  api.runtime.onInstalled.addListener(() => { createMenus(); ping(); });
  api.runtime.onStartup?.addListener(() => { createMenus(); ping(); });
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
  api.runtime.onMessage.addListener((rawMsg, sender, sendResponse) => {
    const msg = rawMsg as ExtMessage;
    (async () => {
      try {
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
          case 'getMedia': sendResponse(await readMedia(msg.tabId)); break;
          case 'downloads': sendResponse(await getDownloads()); break;
          case 'action': sendResponse(await downloadAction(msg.id, msg.action)); break;
          case 'download': sendResponse(await sendToApp(msg)); break;
          case 'setSettings': await setSettings(msg.settings || {}); sendResponse({ ok: true }); break;
          case 'pageMedia': {
            if (sender.tab) {
              for (const m of msg.items || []) {
                const kind = classify(m.url, m.type || '');
                if (kind || MEDIA_EXT.test(m.url)) {
                  await addMedia(sender.tab.id!, { url: m.url, type: m.type || '', size: 0, kind: kind || 'media', time: Date.now(), name: m.name });
                }
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
