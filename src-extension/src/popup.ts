(() => {
  'use strict';

  // Firefox (ve türevleri) uzantı sayfalarını moz-extension:// üzerinden sunar.
  const ff = (globalThis as { browser?: unknown }).browser as FirefoxApi | undefined;
  const api = ff ? (ff as unknown as typeof chrome) : chrome;
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const t = (k: string, subs?: string | string[]): string => {
    try { return api.i18n.getMessage(k, subs) || k; } catch { return k; }
  };

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t((el as HTMLElement).dataset.i18n ?? '');
  });
  document.documentElement.lang = (() => { try { return api.i18n.getUILanguage(); } catch { return 'en'; } })();

  // Firefox'un browser.runtime.sendMessage'ı yalnızca söz döner (geri çağrı reddedilir).
  const IS_FIREFOX = !!ff && String(ff.runtime.getURL('')).startsWith('moz-extension:');

  function send<T = unknown>(msg: ExtMessage): Promise<T | null> {
    return new Promise((resolve) => {
      try {
        if (IS_FIREFOX && ff) ff.runtime.sendMessage(msg).then((r) => resolve(r as T), () => resolve(null));
        else api.runtime.sendMessage(msg, (r) => resolve(api.runtime.lastError ? null : (r as T)));
      } catch { resolve(null); }
    });
  }
  function fmtSize(n: number): string {
    if (!n) return '';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(i ? 1 : 0) + ' ' + u[i];
  }

  let tab: chrome.tabs.Tab | null | undefined = null;

  async function currentTab(): Promise<chrome.tabs.Tab | undefined> {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs[0];
  }

  async function refresh() {
    const st = await send<StatusResponse>({ type: 'status' });
    const online = !!(st && st.online);
    $('dot').classList.toggle('on', online);
    $('statusText').textContent = online
      ? t('popupConnected', [String(st?.app?.version ?? '')]) + (st?.app?.active ? ` · ${t('popupActive', [String(st.app.active)])}` : '')
      : t('popupOffline');
    $('offline').classList.toggle('hidden', online);
    if (st && st.settings) {
      $<HTMLInputElement>('intercept').checked = !!st.settings.intercept;
      $<HTMLInputElement>('sniff').checked = !!st.settings.sniff;
      $<HTMLInputElement>('port').value = String(st.settings.port);
      $<HTMLInputElement>('minSize').value = String(st.settings.minSizeMB || 0);
    }
  }

  async function loadMedia() {
    tab = await currentTab();
    const list = (tab && (await send<MediaInfo[]>({ type: 'getMedia', tabId: tab.id! }))) || [];
    const ul = $('media');
    ul.innerHTML = '';
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
      const btn = document.createElement('button'); btn.className = 'small'; btn.textContent = t('popupDownload');
      btn.onclick = async () => {
        btn.disabled = true; btn.textContent = '…';
        const k = m.kind === 'hls' || m.kind === 'dash' ? 'video' : 'file';
        const r = await send<{ ok: boolean }>({ type: 'download', url: m.url, filename: k === 'file' ? m.name : '', referer: tab?.url, kind: k });
        btn.textContent = r && r.ok ? t('popupSent') : t('popupError');
      };
      li.append(info, btn);
      ul.appendChild(li);
    }
  }

  // ---------- Downloads (progress list) ----------
  const seenActive = new Set<string>();   // bu pencere açıkken etkin olan kimlikler → son durumları da gösterilir
  const STATE_LABEL: Record<string, string> = { queued: 'stateQueued', paused: 'statePaused', probing: 'stateProbing', completed: 'stateCompleted', failed: 'stateFailed', cancelled: 'stateCancelled' };

  async function loadDownloads() {
    const all = (await send<DownloadItem[]>({ type: 'downloads' })) || [];
    const shown = all.filter((d) => {
      if (d.state === 'downloading' || d.state === 'probing') { seenActive.add(d.id); return true; }
      if (d.state === 'queued' || d.state === 'paused') return true;
      return seenActive.has(d.id);
    });
    const ul = $('dl');
    $('noDl').classList.toggle('hidden', shown.length > 0);
    // Yalnızca satır kümesi değişince yeniden kur; aksi hâlde yerinde güncelle ki
    // düğmeler tıklanabilir kalsın.
    const ids = shown.map((d) => d.id).join('|');
    if (ul.dataset.ids !== ids) { ul.innerHTML = ''; ul.dataset.ids = ids; for (const d of shown) ul.appendChild(buildRow(d)); }
    for (const d of shown) updateRow(d);
  }

  function buildRow(d: DownloadItem): HTMLLIElement {
    const li = document.createElement('li'); li.dataset.id = d.id;
    const info = document.createElement('div'); info.className = 'info';
    const name = document.createElement('div'); name.className = 'name';
    const bar = document.createElement('div'); bar.className = 'bar'; bar.appendChild(Object.assign(document.createElement('div'), { className: 'fill' }));
    const meta = document.createElement('div'); meta.className = 'meta';
    info.append(name, bar, meta);
    const actions = document.createElement('div'); actions.className = 'actions';
    const toggle = document.createElement('button'); toggle.className = 'icon toggle';
    toggle.onclick = () => send({ type: 'action', id: d.id, action: toggle.dataset.action ?? '' }).then(loadDownloads);
    const cancel = document.createElement('button'); cancel.className = 'icon cancel'; cancel.textContent = '✕'; cancel.title = t('popupCancel');
    cancel.onclick = () => send({ type: 'action', id: d.id, action: cancel.dataset.action || 'cancel' }).then(loadDownloads);
    actions.append(toggle, cancel);
    li.append(info, actions);
    return li;
  }

  function updateRow(d: DownloadItem) {
    const li = $('dl').querySelector<HTMLLIElement>(`li[data-id="${d.id}"]`); if (!li) return;
    const nameEl = li.querySelector<HTMLElement>('.name');
    if (nameEl) { nameEl.textContent = d.name; nameEl.title = d.name; }
    const active = d.state === 'downloading' || d.state === 'probing';
    const pct = d.total > 0 ? Math.min(100, Math.round((100 * d.received) / d.total)) : (d.state === 'completed' ? 100 : 0);
    const bar = li.querySelector<HTMLElement>('.bar');
    if (bar) {
      bar.className = 'bar' + (active && d.total <= 0 ? ' indeterminate' : '') + (d.state === 'completed' ? ' done' : '') + (d.state === 'failed' ? ' failed' : '');
      const fill = li.querySelector<HTMLElement>('.fill');
      if (fill) fill.style.width = (active && d.total <= 0) ? '' : pct + '%';
    }
    const parts = [];
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
    if (active) { toggle.textContent = '❚❚'; toggle.title = t('popupPause'); toggle.dataset.action = 'pause'; }
    else { toggle.textContent = '▶'; toggle.title = t('popupResume'); toggle.dataset.action = 'resume'; }
    cancel.dataset.action = terminal ? 'remove' : 'cancel';
    cancel.title = terminal ? t('popupRemove') : t('popupCancel');
  }

  $('pageVideo').onclick = async () => {
    tab = tab || (await currentTab());
    if (!tab?.url) return;
    $('pageVideo').textContent = t('popupSending');
    const r = await send<{ ok: boolean }>({ type: 'download', url: tab.url, referer: tab.url, kind: 'video' });
    $('pageVideo').textContent = r && r.ok ? t('popupStarted') : t('popupFailed');
    loadDownloads();
    setTimeout(() => ($('pageVideo').textContent = t('popupPageVideo')), 2500);
  };
  $('pageLink').onclick = async () => {
    tab = tab || (await currentTab());
    if (!tab?.url) return;
    await send({ type: 'download', url: tab.url, referer: tab.url, kind: 'file' });
    window.close();
  };
  $('intercept').onchange = (e) => send({ type: 'setSettings', settings: { intercept: (e.currentTarget as HTMLInputElement).checked } });
  $('sniff').onchange = (e) => send({ type: 'setSettings', settings: { sniff: (e.currentTarget as HTMLInputElement).checked } });
  $('port').onchange = (e) => send({ type: 'setSettings', settings: { port: parseInt((e.currentTarget as HTMLInputElement).value, 10) || 48213 } }).then(refresh);
  $('minSize').onchange = (e) => send({ type: 'setSettings', settings: { minSizeMB: parseInt((e.currentTarget as HTMLInputElement).value, 10) || 0 } });

  refresh();
  loadMedia();
  loadDownloads();
  setInterval(loadDownloads, 1000);
})();
