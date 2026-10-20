/**
 * PinVault — content script for Pinterest pages.
 *
 * Resilient Pinterest page integration:
 *  - Hover overlay download button on pins
 *  - Image URL detection from pinimg CDN (highest accessible resolution)
 *  - Video pin detection (best accessible mp4; m3u8 flagged as unsupported —
 *    no DRM bypass; segmented HLS cannot be saved as a single file)
 *  - Lazy-loaded content via MutationObserver
 *  - Defensive DOM queries with multiple fallback selectors
 *  - Never injects into unrelated sites (host matching is enforced by manifest)
 *
 * All DOM-derived data is treated as untrusted input.
 */
(() => {
  'use strict';

  const PIN_SELECTORS = [
    'div[data-testid="pin"]',
    'div[data-test-id="pin"]',
    'div[data-grid-item]',
    'div[role="listitem"] article',
    'div[role="listitem"]',
    'a[href*="/pin/"]',
  ];

  const IMG_ATTRS = ['src', 'data-src', 'data-pin-media', 'data-image-url', 'srcset'];
  const VIDEO_URL_ATTRS = ['src', 'data-src', 'data-video-url'];

  let overlayHost = null; // root element hosting overlay buttons
  let scanCache = null;   // { records, ts }

  function isPinterestPage() {
    return /(^|\.)pinterest\.(com|co\.uk|ca|de|fr|jp|cl|com\.mx|es|it|at|pt|dk|se|nz|co|ph|ie|ru|ch|au|com)(\.|$)/i.test(
      location.hostname
    );
  }

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $all(sel, root) {
    return Array.from((root || document).querySelectorAll(sel));
  }

  /** Extract pin id from an anchor href or dataset. */
  function pinIdFrom(element) {
    if (element.dataset && element.dataset.pinId) return element.dataset.pinId;
    if (element.dataset && element.dataset.pinIdLong) return element.dataset.pinIdLong;
    const hrefs = [];
    const a = element.closest('a[href*="/pin/"]');
    if (a) hrefs.push(a.getAttribute('href') || '');
    if (element.getAttribute && element.getAttribute('href')) hrefs.push(element.getAttribute('href'));
    for (const h of hrefs) {
      const m = h.match(/\/pin\/(\d{1,20})(?:\/|$)/);
      if (m) return m[1];
    }
    // data-id on article sometimes holds the id
    if (element.dataset && element.dataset.id && /^\d{1,20}$/.test(String(element.dataset.id))) {
      return element.dataset.id;
    }
    return null;
  }

  function absolutize(url) {
    try {
      const u = new URL(url, location.href);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
    } catch (_err) { /* ignore */ }
    return null;
  }

  function isPinimgUrl(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host.endsWith('.pinimg.com') || host === 'pinimg.com' || host.endsWith('.pinimg.com.cn');
    } catch (_err) {
      return false;
    }
  }

  /** Collect image candidate URLs from an <img>. */
  function imageUrlsFromImg(img) {
    const out = new Set();
    const add = (v) => {
      const u = absolutize(v);
      if (u && isPinimgUrl(u)) out.add(u);
    };
    for (const attr of IMG_ATTRS) {
      const val = img.getAttribute(attr);
      if (!val) continue;
      if (attr === 'srcset') {
        for (const part of val.split(',')) {
          const token = part.trim().split(/\s+/)[0];
          if (token) add(token);
        }
      } else {
        add(val);
      }
    }
    return Array.from(out);
  }

  /** Collect video URLs from an element subtree. */
  function videoUrlsFrom(el) {
    const out = new Set();
    const add = (v) => {
      const u = absolutize(v);
      if (u) out.add(u);
    };
    const videos = $all('video', el);
    for (const v of videos) {
      for (const attr of VIDEO_URL_ATTRS) {
        const val = v.getAttribute(attr);
        if (val) add(val);
      }
      const src = v.currentSrc || v.src;
      if (src) add(src);
    }
    // Look for <source> children
    for (const s of $all('source', el)) {
      const val = s.getAttribute('src');
      if (val) add(val);
    }
    // Pinterest sometimes exposes video URLs in data attributes on the container
    if (el.dataset) {
      for (const key of Object.keys(el.dataset)) {
        const v = el.dataset[key];
        if (typeof v === 'string' && /\.(mp4|webm|m4v|m3u8)(\?|$)/i.test(v)) add(v);
      }
    }
    // Detect m3u8 in script JSON (best-effort, bounded)
    return Array.from(out).slice(0, 12);
  }

  function isVideoPin(el) {
    return !!($('video', el) || (el.dataset && /video/i.test(String(el.dataset.pinType || ''))));
  }

  /** Extract a single pin record from a DOM element. */
  function extractPinRecord(el) {
    const pinId = pinIdFrom(el);
    const img = $('img', el);
    const imgUrls = img ? imageUrlsFromImg(img) : [];
    const videoUrls = isVideoPin(el) ? videoUrlsFrom(el) : [];
    if (!imgUrls.length && !videoUrls.length) return null;

    const titleEl = $('[data-testid="pinTitle"], [data-test-id="pinTitle"], div[title], a[title]', el);
    let title = '';
    if (titleEl) {
      title = (titleEl.getAttribute('title') || titleEl.textContent || '').trim();
    }
    if (!title && img) title = (img.getAttribute('alt') || '').trim();

    const boardEl = $('[data-testid="pinrep-header"], [data-test-id="boardName"], a[href*="/board/"]', el);
    let board = '';
    if (boardEl) {
      const t = boardEl.getAttribute('title') || boardEl.textContent || '';
      board = t.trim();
    }
    const a = el.closest('a[href*="/pin/"]');
    const pinUrl = a ? absolutize(a.getAttribute('href')) : (pinId ? `https://www.pinterest.com/pin/${pinId}/` : '');
    const sourceUrl = (a && a.href) ? a.href : '';
    const naturalW = img ? (img.naturalWidth || 0) : 0;
    const naturalH = img ? (img.naturalHeight || 0) : 0;

    // Reuse shared extractor logic shape expected by lib/pin-extractor element path.
    return {
      id: pinId,
      title,
      board,
      pinUrl,
      sourceUrl,
      imgUrls,
      videoUrls,
      width: naturalW,
      height: naturalH,
    };
  }

  /** Scan visible + queued pins on the current page. */
  function scanPage(progress) {
    const elements = [];
    for (const sel of PIN_SELECTORS) {
      const found = $all(sel);
      for (const el of found) {
        if (elements.includes(el)) continue;
        // Prefer the smallest meaningful pin unit: skip parents that contain other candidates.
        const isContainer = !!$('div[data-testid="pin"]', el) || !!$('div[role="listitem"] article', el);
        if (isContainer && sel !== 'div[data-testid="pin"]') continue;
        elements.push(el);
      }
    }
    const records = [];
    const seen = new Set();
    let i = 0;
    for (const el of elements) {
      const rec = extractPinRecord(el);
      if (rec && (rec.imgUrls.length || rec.videoUrls.length)) {
        const key = rec.id || rec.imgUrls[0] || rec.videoUrls[0] || '';
        if (!key || seen.has(key)) continue;
        seen.add(key);
        records.push(rec);
      }
      i += 1;
      if (progress && i % 40 === 0) {
        try {
          progress({ found: records.length, scanned: i });
        } catch (_err) { /* ignore */ }
      }
    }
    return records;
  }

  function notifyProgress(payload) {
    chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', payload, nonce: `pv-${Date.now()}` }).catch(() => {});
  }

  async function handleScanRequest() {
    const records = scanPage(notifyProgress);
    scanCache = { records, ts: Date.now() };
    return { ok: true, count: records.length, records };
  }

  // ---- Hover overlay ----
  function ensureOverlayHost() {
    if (overlayHost && document.body.contains(overlayHost)) return overlayHost;
    overlayHost = document.createElement('div');
    overlayHost.id = 'pinvault-overlay-host';
    overlayHost.setAttribute('data-testid', 'pinvault-overlay-host');
    overlayHost.style.display = 'none';
    document.body.appendChild(overlayHost);
    return overlayHost;
  }

  async function quickDownloadRecord(rec) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: 'DOWNLOAD_ONE',
        payload: { record: rec },
        nonce: `pv-${Date.now()}`,
      });
      if (res && res.ok === false) {
        showToast(`Download failed: ${res.error || 'unknown error'}`);
      } else {
        showToast('Download started');
      }
    } catch (err) {
      showToast(`Extension error: ${err.message}`);
    }
  }

  function showToast(text) {
    let t = document.getElementById('pinvault-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'pinvault-toast';
      document.body.appendChild(t);
    }
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function attachOverlayToPin(el) {
    if (el._pinvaultAttached) return;
    el._pinvaultAttached = true;
    const host = ensureOverlayHost();

    el.addEventListener('mouseenter', () => {
      const rec = extractPinRecord(el);
      if (!rec) return;
      host.style.display = 'block';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pinvault-dl-btn';
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', 'Download this pin with PinVault');
      btn.textContent = 'Download';
      btn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void quickDownloadRecord(rec);
        host.style.display = 'none';
      });
      host.innerHTML = '';
      host.appendChild(btn);
      // Position near the pin
      const rect = el.getBoundingClientRect();
      btn.style.top = `${Math.max(8, rect.top + 8)}px`;
      btn.style.left = `${Math.max(8, rect.left + 8)}px`;
    });

    el.addEventListener('mouseleave', () => {
      host.style.display = 'none';
    });
  }

  function attachToPins(root) {
    for (const sel of PIN_SELECTORS) {
      for (const el of $all(sel, root)) {
        attachOverlayToPin(el);
      }
    }
  }

  function init() {
    if (!isPinterestPage()) return;
    attachToPins(document);
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          const el = node;
          if (el.matches && el.matches(PIN_SELECTORS.join(','))) {
            attachOverlayToPin(el);
          } else if (el.querySelectorAll) {
            attachToPins(el);
          }
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // ---- Messaging ----
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;
    switch (msg.type) {
      case 'PING':
        sendResponse({ ok: true, pong: true, host: location.hostname });
        return false;
      case 'SCAN_PAGE':
        handleScanRequest()
          .then((res) => sendResponse(res))
          .catch((err) => sendResponse({ ok: false, error: err.message }));
        return true;
      case 'DOWNLOAD_ONE': {
        const rec = msg.payload && msg.payload.record;
        if (!rec) {
          sendResponse({ ok: false, error: 'missing record' });
          return false;
        }
        quickDownloadRecord(rec).then(() => sendResponse({ ok: true }));
        return true;
      }
      default:
        return false;
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
