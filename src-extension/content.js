"use strict";
// ADM bridge extension — content script
// 1) `downloads` API'si olmayan tarayıcılarda (ör. Firefox) dosya
//    bağlantılarına yapılan tıklamaları yakalar.
// 2) Sayfadaki <video>/<audio>/<source> adreslerini arka plan betiğine bildirir.
(() => {
    'use strict';
    const ff = globalThis.browser;
    const api = ff ? ff : chrome;
    const DL_EXT = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz|dmg|pkg|iso|exe|msi|apk|deb|rpm|pdf|epub|mobi|doc|docx|xls|xlsx|ppt|pptx|mp4|mkv|avi|mov|webm|mp3|flac|wav|m4a|aac|ogg|jar|bin|img|csv|psd|ai|ttf|otf|woff2?)(\?|#|$)/i;
    let state = {
        online: false,
        app: null,
        settings: { port: 48213, intercept: true, minSizeMB: 0, sniff: true },
        clickIntercept: false,
        captureExtensions: [],
    };
    // Firefox'un browser.runtime.sendMessage'ı yalnızca söz döner (geri çağrı reddedilir).
    const IS_FIREFOX = !!ff && String(ff.runtime.getURL('')).startsWith('moz-extension:');
    function refresh() {
        const apply = (r) => { if (r)
            state = r; };
        try {
            if (IS_FIREFOX && ff) {
                ff.runtime.sendMessage({ type: 'status' }).then(apply, () => { });
            }
            else {
                api.runtime.sendMessage({ type: 'status' }, (r) => { if (!api.runtime.lastError)
                    apply(r); });
            }
        }
        catch { }
    }
    refresh();
    setInterval(refresh, 30000);
    document.addEventListener('click', (e) => {
        if (!state.clickIntercept || !state.online || !state.settings?.intercept)
            return;
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)
            return;
        const target = e.target;
        const a = target && target.closest ? target.closest('a[href]') : null;
        if (!a)
            return;
        const href = a.href;
        if (!/^https?:/i.test(href))
            return;
        const list = state.captureExtensions || [];
        const m = href.split(/[?#]/)[0].match(/\.([a-z0-9]{1,8})$/i);
        const ext = m ? m[1].toLowerCase() : '';
        if (list.length ? !(ext && list.includes(ext)) : !(a.hasAttribute('download') || DL_EXT.test(href)))
            return;
        e.preventDefault();
        e.stopPropagation();
        const msg = { type: 'download', url: href, filename: a.getAttribute('download') || '', referer: location.href, kind: 'file' };
        api.runtime.sendMessage(msg);
    }, true);
    const reported = new Set();
    function scanMedia() {
        const items = [];
        document.querySelectorAll('video, audio, source').forEach((el) => {
            // <source> currentSrc'e sahip değildir; medya elemanlarına indirgeyip okuruz.
            const media = el;
            const src = media.currentSrc || media.src || el.getAttribute('src');
            if (!src || !/^https?:/i.test(src) || reported.has(src))
                return;
            reported.add(src);
            items.push({ url: src, type: el.getAttribute('type') || '', name: document.title ? document.title.slice(0, 80) : '' });
        });
        if (items.length) {
            try {
                const msg = { type: 'pageMedia', items };
                api.runtime.sendMessage(msg);
            }
            catch { }
        }
    }
    scanMedia();
    document.addEventListener('play', scanMedia, true);
    document.addEventListener('loadedmetadata', scanMedia, true);
    let n = 0;
    const iv = setInterval(() => { scanMedia(); if (++n > 20)
        clearInterval(iv); }, 3000);
})();
