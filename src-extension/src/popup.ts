(() => {
  'use strict';

  const ff = (globalThis as { browser?: unknown }).browser as FirefoxApi | undefined;
  const api = ff ? (ff as unknown as typeof chrome) : chrome;
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const t = (k: string, subs?: string | string[]): string => {
    try { return api.i18n.getMessage(k, subs) || k; } catch { return k; }
  };

  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const msg = t(el.dataset.i18n ?? '');
    if (msg) el.textContent = msg;
  });
  document.documentElement.lang = (() => { try { return api.i18n.getUILanguage(); } catch { return 'en'; } })();

  const HTTP_URL = /^https?:/i;
  const ALL_URLS: chrome.permissions.Permissions = { origins: ['<all_urls>'] };

  // MV3'te `chrome.runtime.sendMessage` geri çağrısız söz döner; `browser.*`
  // (Firefox, Safari) her zaman söz döner. Tek yol hepsinde çalışır.
  function send<T = unknown>(msg: ExtMessage): Promise<T | null> {
    try {
      return Promise.resolve(api.runtime.sendMessage(msg) as Promise<T>).then((r) => r ?? null, () => null);
    } catch {
      return Promise.resolve(null);
    }
  }
  function fmtSize(n: number): string {
    if (!n) return '';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(i ? 1 : 0) + ' ' + u[i];
  }

  let tab: chrome.tabs.Tab | undefined;

  async function currentTab(): Promise<chrome.tabs.Tab | undefined> {
    try {
      const tabs = await api.tabs.query({ active: true, currentWindow: true });
      return tabs && tabs[0];
    } catch {
      return undefined;
    }
  }

  // ---------- Host izni ----------
  // Firefox MV3'te (< 127) `host_permissions` kurulumda verilmez; Chromium'da
  // kullanıcı "Site erişimi: tıklandığında" seçebilir. İzin yoksa webRequest
  // medya yakalayamaz ve çerezler okunamaz — kullanıcıya açıkça söylenir.
  async function checkPermission(): Promise<void> {
    let granted = true;
    try { granted = await api.permissions.contains(ALL_URLS); } catch { }
    $('perm').classList.toggle('hidden', granted);
  }
  $('grant').onclick = () => {
    // Firefox `permissions.request`'i yalnızca kullanıcı jestinin içinde,
    // önünde `await` olmadan çağrıldığında kabul eder.
    try {
      void Promise.resolve(api.permissions.request(ALL_URLS)).then(checkPermission, checkPermission);
    } catch { }
  };

  // ---------- Status ----------
  async function refresh(): Promise<void> {
    const st = await send<StatusResponse>({ type: 'status' });
    const online = !!(st && st.online);
    $('dot').classList.toggle('on', online);
    $('statusText').textContent = online
      ? t('popupConnected', [String(st?.app?.version ?? '')]) + (st?.app?.active ? ` · ${t('popupActive', [String(st.app.active)])}` : '')
      : t('popupOffline');
    $('offline').classList.toggle('hidden', online);
    if (st && st.settings) {
      // Kullanıcı yazarken alanın üstüne yazma.
      const setIfIdle = (id: string, v: string): void => {
        const el = $<HTMLInputElement>(id);
        if (document.activeElement !== el) el.value = v;
      };
      $<HTMLInputElement>('intercept').checked = !!st.settings.intercept;
      $<HTMLInputElement>('sniff').checked = !!st.settings.sniff;
      setIfIdle('port', String(st.settings.port));
      setIfIdle('minSize', String(st.settings.minSizeMB || 0));
    }
    const pageOk = !!(tab?.url && HTTP_URL.test(tab.url));
    $<HTMLButtonElement>('pageVideo').disabled = !online || !pageOk;
    $<HTMLButtonElement>('pageLink').disabled = !online || !pageOk;
  }

  // ---------- Captured media ----------
  let mediaSig = '';
  async function loadMedia(): Promise<void> {
    const tabId = tab?.id;
    const list = (typeof tabId === 'number' && (await send<MediaInfo[]>({ type: 'getMedia', tabId }))) || [];
    // Liste değişmediyse yeniden kurma: "Gönderildi" düğme durumları korunur.
    const sig = list.map((m) => m.key || m.url).join('|');
    if (sig === mediaSig) return;
    mediaSig = sig;
    const ul = $('media');
    ul.textContent = '';
    $('count').textContent = list.length ? `(${list.length})` : '';
    $('noMedia').classList.toggle('hidden', list.length > 0);
    for (const m of list) {
      const li = document.createElement('li');
      const info = document.createElement('div'); info.className = 'info';
      const name = document.createElement('div'); name.className = 'name'; name.textContent = m.name || m.url; name.title = m.url;
      const meta = document.createElement('div'); meta.className = 'meta';
      const kind = m.kind === 'hls' ? t('kindHls') : m.kind === 'dash' ? t('kindDash') : (m.type || t('kindMedia'));
      meta.textContent = [kind, fmtSize(m.size)].filter(Boolean).join(' · ');
      info.append(name, meta);
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'small'; btn.textContent = t('popupDownload');
      btn.onclick = async () => {
        btn.disabled = true; btn.textContent = '…';
        const k = m.kind === 'hls' || m.kind === 'dash' ? 'video' : 'file';
        const r = await send<SendToAppResult>({
          type: 'download', url: m.url, filename: k === 'file' ? m.name : '', referer: tab?.url, kind: k, tabId: tab?.id,
        });
        btn.textContent = r && r.ok ? t('popupSent') : t('popupError');
        if (!(r && r.ok)) btn.disabled = false;
        void loadDownloads();
      };
      li.append(info, btn);
      ul.appendChild(li);
    }
  }

  // ---------- Downloads (progress list) ----------
  const seenActive = new Set<string>();
  const STATE_LABEL: Record<string, string> = { queued: 'stateQueued', paused: 'statePaused', probing: 'stateProbing', completed: 'stateCompleted', failed: 'stateFailed', cancelled: 'stateCancelled' };

  let loadingDownloads = false;
  async function loadDownloads(): Promise<void> {
    if (loadingDownloads) return;
    loadingDownloads = true;
    try {
      const all = (await send<DownloadItem[]>({ type: 'downloads' })) || [];
      const shown = (Array.isArray(all) ? all : []).filter((d) => {
        if (d.state === 'downloading' || d.state === 'probing') { seenActive.add(d.id); return true; }
        if (d.state === 'queued' || d.state === 'paused') return true;
        return seenActive.has(d.id);
      });
      const ul = $('dl');
      $('noDl').classList.toggle('hidden', shown.length > 0);
      // Yalnızca satır kümesi değişince yeniden kur; aksi hâlde yerinde güncelle.
      const ids = shown.map((d) => d.id).join('|');
      if (ul.dataset.ids !== ids) { ul.textContent = ''; ul.dataset.ids = ids; for (const d of shown) ul.appendChild(buildRow(d)); }
      for (const d of shown) updateRow(d);
    } finally {
      loadingDownloads = false;
    }
  }

  function buildRow(d: DownloadItem): HTMLLIElement {
    const li = document.createElement('li'); li.dataset.id = d.id;
    const info = document.createElement('div'); info.className = 'info';
    const name = document.createElement('div'); name.className = 'name';
    const bar = document.createElement('div'); bar.className = 'bar';
    bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100');
    bar.appendChild(Object.assign(document.createElement('div'), { className: 'fill' }));
    const meta = document.createElement('div'); meta.className = 'meta';
    info.append(name, bar, meta);
    const actions = document.createElement('div'); actions.className = 'actions';
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'icon toggle';
    toggle.onclick = () => { void send({ type: 'action', id: d.id, action: toggle.dataset.action ?? '' }).then(loadDownloads); };
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'icon cancel'; cancel.textContent = '✕';
    cancel.title = t('popupCancel'); cancel.setAttribute('aria-label', t('popupCancel'));
    cancel.onclick = () => { void send({ type: 'action', id: d.id, action: cancel.dataset.action || 'cancel' }).then(loadDownloads); };
    actions.append(toggle, cancel);
    li.append(info, actions);
    return li;
  }

  function rowFor(id: string): HTMLLIElement | null {
    // Kimlik tırnak veya köşeli parantez içerebilir; seçiciye ham konmamalı.
    for (const li of Array.from($('dl').children) as HTMLLIElement[]) {
      if (li.dataset.id === id) return li;
    }
    return null;
  }

  function updateRow(d: DownloadItem): void {
    const li = rowFor(d.id); if (!li) return;
    const nameEl = li.querySelector<HTMLElement>('.name');
    if (nameEl) { nameEl.textContent = d.name; nameEl.title = d.name; }
    const active = d.state === 'downloading' || d.state === 'probing';
    const pct = d.total > 0 ? Math.min(100, Math.round((100 * d.received) / d.total)) : (d.state === 'completed' ? 100 : 0);
    const bar = li.querySelector<HTMLElement>('.bar');
    if (bar) {
      const indeterminate = active && d.total <= 0;
      bar.className = 'bar' + (indeterminate ? ' indeterminate' : '') + (d.state === 'completed' ? ' done' : '') + (d.state === 'failed' ? ' failed' : '');
      if (indeterminate) bar.removeAttribute('aria-valuenow'); else bar.setAttribute('aria-valuenow', String(pct));
      const fill = li.querySelector<HTMLElement>('.fill');
      if (fill) fill.style.width = indeterminate ? '' : pct + '%';
    }
    const parts: string[] = [];
    if (d.state === 'downloading') {
      if (d.total > 0) parts.push(pct + '%', fmtSize(d.received) + ' / ' + fmtSize(d.total));
      if (d.speed > 0) parts.push(fmtSize(d.speed) + '/s');
      if (d.stage) parts.push(d.stage);
    } else {
      parts.push(d.stage && active ? d.stage : t(STATE_LABEL[d.state] || d.state));
      if (d.state === 'failed' && d.error) parts.push(d.error);
    }
    const metaEl = li.querySelector<HTMLElement>('.meta');
    if (metaEl) metaEl.textContent = parts.join(' · ');
    const toggle = li.querySelector<HTMLButtonElement>('.toggle');
    const cancel = li.querySelector<HTMLButtonElement>('.cancel');
    if (!toggle || !cancel) return;
    const terminal = d.state === 'completed' || d.state === 'failed' || d.state === 'cancelled';
    toggle.classList.toggle('hidden', terminal);
    const toggleLabel = active ? t('popupPause') : t('popupResume');
    toggle.textContent = active ? '❚❚' : '▶';
    toggle.title = toggleLabel; toggle.setAttribute('aria-label', toggleLabel);
    toggle.dataset.action = active ? 'pause' : 'resume';
    const cancelLabel = terminal ? t('popupRemove') : t('popupCancel');
    cancel.dataset.action = terminal ? 'remove' : 'cancel';
    cancel.title = cancelLabel; cancel.setAttribute('aria-label', cancelLabel);
  }

  // ---------- Actions ----------
  $('pageVideo').onclick = async () => {
    const btn = $<HTMLButtonElement>('pageVideo');
    tab = tab || (await currentTab());
    if (!tab?.url || !HTTP_URL.test(tab.url)) return;
    btn.disabled = true;
    btn.textContent = t('popupSending');
    const r = await send<SendToAppResult>({ type: 'download', url: tab.url, referer: tab.url, kind: 'video', tabId: tab.id });
    btn.textContent = r && r.ok ? t('popupStarted') : t('popupFailed');
    void loadDownloads();
    setTimeout(() => { btn.textContent = t('popupPageVideo'); btn.disabled = false; }, 2500);
  };
  $('pageLink').onclick = async () => {
    tab = tab || (await currentTab());
    if (!tab?.url || !HTTP_URL.test(tab.url)) return;
    const r = await send<SendToAppResult>({ type: 'download', url: tab.url, referer: tab.url, kind: 'file', tabId: tab.id });
    if (r && r.ok) window.close();
    else $('pageLink').textContent = t('popupFailed');
  };
  const checked = (e: Event): boolean => (e.currentTarget as HTMLInputElement).checked;
  $('intercept').onchange = (e) => { void send({ type: 'setSettings', settings: { intercept: checked(e) } }); };
  $('sniff').onchange = (e) => { void send({ type: 'setSettings', settings: { sniff: checked(e) } }); };
  $('port').onchange = (e) => {
    const v = parseInt((e.currentTarget as HTMLInputElement).value, 10);
    void send({ type: 'setSettings', settings: { port: Number.isFinite(v) ? v : 48213 } }).then(refresh);
  };
  $('minSize').onchange = (e) => {
    const v = parseFloat((e.currentTarget as HTMLInputElement).value);
    void send({ type: 'setSettings', settings: { minSizeMB: Number.isFinite(v) && v > 0 ? v : 0 } }).then(refresh);
  };

  void (async () => {
    tab = await currentTab();
    void checkPermission();
    await refresh();
    void loadMedia();
    void loadDownloads();
  })();
  setInterval(() => { void loadDownloads(); }, 1000);
  // "Uygulama çalışmıyor — açınca yeniden bağlanır" metni ancak durum
  // periyodik yenilenirse doğru olur; önceden yalnızca bir kez soruluyordu.
  setInterval(() => { void refresh(); void loadMedia(); }, 2500);
})();
