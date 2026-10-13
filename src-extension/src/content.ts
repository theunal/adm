// ADM bridge extension — content script
// 1) `downloads.onDeterminingFilename` olmayan tarayıcılarda (Firefox, Safari)
//    dosya bağlantılarına yapılan tıklamaları yakalar.
// 2) Sayfadaki <video>/<audio>/<source> adreslerini arka plan betiğine bildirir.

(() => {
  'use strict';
  const ff = (globalThis as { browser?: unknown }).browser as FirefoxApi | undefined;
  const api = ff ? (ff as unknown as typeof chrome) : chrome;
  const DL_EXT = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|dmg|pkg|iso|exe|msi|apk|deb|rpm|pdf|epub|mobi|doc|docx|xls|xlsx|ppt|pptx|mp4|mkv|avi|mov|webm|mp3|flac|wav|m4a|aac|ogg|jar|bin|img|csv|psd|ai|ttf|otf|woff2?)(\?|#|$)/i;
  const STATUS_INTERVAL_MS = 30000;

  let state: StatusResponse = {
    online: false,
    app: null,
    settings: { port: 48213, intercept: true, minSizeMB: 0, sniff: true },
    clickIntercept: false,
    captureExtensions: [],
  };

  /**
   * Uzantı güncellenince/yeniden yüklenince eski content script sayfada kalır
   * ama `runtime` bağlamı geçersizleşir: `runtime.id` `undefined` olur ve
   * `sendMessage` eşzamanlı olarak fırlatır.
   */
  const alive = (): boolean => {
    try { return !!api.runtime?.id; } catch { return false; }
  };

  // MV3'te `chrome.runtime.sendMessage` geri çağrı verilmezse söz döner;
  // `browser.runtime.sendMessage` (Firefox/Safari) her zaman söz döner. Tek yol
  // yeterli. Alıcı yoksa ("Receiving end does not exist") söz reddedilir;
  // yakalanmazsa her sayfada "Uncaught (in promise)" hatası birikir.
  function send<T = unknown>(msg: ExtMessage): Promise<T | null> {
    if (!alive()) return Promise.resolve(null);
    try {
      return Promise.resolve(api.runtime.sendMessage(msg) as Promise<T>).then((r) => r ?? null, () => null);
    } catch {
      return Promise.resolve(null);
    }
  }

  let statusTimer: ReturnType<typeof setInterval> | null = null;
  function stopStatus(): void {
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
  }
  async function refresh(): Promise<void> {
    if (!alive()) { stopStatus(); return; }
    // Arka plandaki (görünmeyen) pencereler için yoklama anlamsızdır:
    // durum yalnızca görünür paserlar da kullanıcı fark eder ve onlar ilk
    // yükte gönderimde zaten gelir. Pencere yeniden görünür olunca aşağıda
    // `visibilitychange` dinleyicisi ilk geçerli yoklamayı tetikler.
    if (document.visibilityState !== 'visible') return;
    const r = await send<StatusResponse>({ type: 'status' });
    if (!r || typeof r !== 'object' || !('settings' in r)) return;
    state = r;
    // Chromium'da indirmeler arka planda yakalanır; durumu yoklamaya gerek yok.
    if (!state.clickIntercept) stopStatus();
  }
  void refresh();
  statusTimer = setInterval(() => { void refresh(); }, STATUS_INTERVAL_MS);
  // Arka plandaki sekme döndüğünde kullanıcı uygulamayı açmış olabilir.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.clickIntercept) void refresh();
  });

  document.addEventListener('click', (e) => {
    if (!state.clickIntercept || !state.online || !state.settings?.intercept) return;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    // Bağlam geçersizse tıklamayı engelleme: aksi hâlde kullanıcı tıklar ve
    // hiçbir şey olmaz.
    if (!alive()) return;
    const target = e.target as Element | null;
    const a = target && typeof target.closest === 'function'
      ? target.closest<HTMLAnchorElement | SVGAElement>('a[href]')
      : null;
    if (!a) return;
    const href = a instanceof HTMLAnchorElement ? a.href : (a.href as SVGAnimatedString).baseVal;
    if (!href || !/^https?:/i.test(href)) return;
    const list = state.captureExtensions || [];
    const m = href.split(/[?#]/)[0].match(/\.([a-z0-9]{1,8})$/i);
    const ext = m ? m[1].toLowerCase() : '';
    if (list.length ? !(ext && list.includes(ext)) : !(a.hasAttribute('download') || DL_EXT.test(href))) return;
    e.preventDefault();
    e.stopPropagation();
    const msg: ExtMessage = { type: 'download', url: href, filename: a.getAttribute('download') || '', referer: location.href, kind: 'file' };
    void send(msg);
  }, true);

  const reported = new Set<string>();
  function scanMedia(): void {
    if (!alive()) return;
    const items: PageMediaItem[] = [];
    const name = document.title ? document.title.slice(0, 80) : '';
    document.querySelectorAll('video, audio, source').forEach((el) => {
      const media = el as HTMLMediaElement;
      const src = media.currentSrc || media.src || el.getAttribute('src') || '';
      let abs = '';
      try { abs = new URL(src, location.href).href; } catch { return; }
      if (!/^https?:/i.test(abs) || reported.has(abs)) return;
      reported.add(abs);
      items.push({ url: abs, type: el.getAttribute('type') || '', name });
    });
    if (items.length) void send({ type: 'pageMedia', items });
  }

  // SPA'larda (YouTube vb.) sayfa değişmeden adres değişir; eski kayıtlar
  // yeni sayfanın aynı medyasını tekrar bildirmeyi engellemesin.
  let lastHref = location.href;
  function onMediaEvent(): void {
    if (location.href !== lastHref) { lastHref = location.href; reported.clear(); }
    scanMedia();
  }

  scanMedia();
  document.addEventListener('play', onMediaEvent, true);
  document.addEventListener('loadedmetadata', onMediaEvent, true);
  let n = 0;
  const iv = setInterval(() => {
    if (!alive() || ++n > 20) { clearInterval(iv); return; }
    onMediaEvent();
  }, 3000);
})();
