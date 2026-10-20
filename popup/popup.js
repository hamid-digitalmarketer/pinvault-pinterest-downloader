/**
 * PinVault popup logic.
 * Uses vanilla JS; communicates with background via validated envelopes.
 */
import * as PinVaultMessaging from '../lib/messaging.js';
import * as PinVaultPinExtractor from '../lib/pin-extractor.js';

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const send = (type, payload) =>
    chrome.runtime.sendMessage(PinVaultMessaging.createEnvelope(type, payload));

  const els = {
    pinUrl: $('pinUrl'),
    quickDl: $('quickDl'),
    quickStatus: $('quickStatus'),
    scanPage: $('scanPage'),
    scanStatus: $('scanStatus'),
    openDashboard: $('openDashboard'),
    queueCard: $('queueCard'),
    queueStats: $('queueStats'),
    pauseBtn: $('pauseBtn'),
    resumeBtn: $('resumeBtn'),
    cancelBtn: $('cancelBtn'),
    historyList: $('historyList'),
    clearHistory: $('clearHistory'),
    openSettings: $('openSettings'),
    helpLink: $('helpLink'),
    themeToggle: $('themeToggle'),
    versionLabel: $('versionLabel'),
  };

  function setStatus(el, text, kind) {
    el.textContent = text;
    el.className = 'pv-status' + (kind ? ' ' + kind : '');
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'light' || theme === 'dark') {
      root.setAttribute('data-theme', theme);
    } else {
      root.removeAttribute('data-theme'); // system via media query
    }
  }

  async function initTheme() {
    try {
      const res = await send('GET_SETTINGS', {});
      if (res && res.ok && res.data) applyTheme(res.data.theme);
    } catch (_err) { /* keep system theme */ }
  }

  async function refreshQueue() {
    try {
      const res = await send('QUEUE_STATUS', {});
      if (!res || !res.ok) return;
      const q = res.data;
      if (!q || !q.snapshot || q.snapshot.total === 0) {
        els.queueCard.hidden = true;
        return;
      }
      els.queueCard.hidden = false;
      const s = q.snapshot;
      els.queueStats.textContent =
        `Total ${s.total} · Running ${s.running} · Queued ${s.queued} · Completed ${s.completed} · Failed ${s.failed} · Skipped ${s.skipped}${s.paused ? ' · Paused' : ''}`;
    } catch (_err) { /* ignore */ }
  }

  async function refreshHistory() {
    try {
      const res = await send('GET_HISTORY', {});
      if (!res || !res.ok) return;
      const items = res.data || [];
      els.historyList.innerHTML = '';
      if (items.length === 0) {
        const li = document.createElement('li');
        li.textContent = 'No downloads yet.';
        els.historyList.appendChild(li);
        return;
      }
      const head = items.slice(0, 6);
      for (const it of head) {
        const li = document.createElement('li');
        const name = document.createElement('span');
        name.textContent = (it.filename || it.url || '').split('/').pop().slice(0, 42);
        name.title = it.filename || it.url || '';
        const st = document.createElement('span');
        st.className = 'h-status ' + (it.status === 'completed' ? 'ok' : 'fail');
        st.textContent = it.status === 'completed' ? 'done' : (it.error || 'failed');
        li.append(name, st);
        els.historyList.appendChild(li);
      }
    } catch (_err) { /* ignore */ }
  }

  async function quickDownload() {
    const raw = els.pinUrl.value.trim();
    if (!raw) {
      setStatus(els.quickStatus, 'Please paste a Pinterest pin URL first.', 'error');
      return;
    }
    if (!/^https?:\/\//i.test(raw)) {
      setStatus(els.quickStatus, 'URL must start with http(s)://', 'error');
      return;
    }
    setStatus(els.quickStatus, 'Resolving pin…');
    const res = await send('PING', {});
    if (!res || !res.ok) {
      setStatus(els.quickStatus, 'Extension background is unavailable.', 'error');
      return;
    }
    // Fetch the pin page through the extension's host permission to discover media.
    setStatus(els.quickStatus, 'Fetching pin page…');
    try {
      const pageRes = await fetch(raw, { credentials: 'omit', redirect: 'follow' });
      if (!pageRes.ok) {
        setStatus(els.quickStatus, `Pin page returned ${pageRes.status}. It may require login or not exist.`, 'error');
        return;
      }
      const html = await pageRes.text();
      const records = PinVaultPinExtractor && PinVaultPinExtractor.extractFromHtml
        ? PinVaultPinExtractor.extractFromHtml(html, raw)
        : extractFromHtml(html, raw);
      if (records.length === 0) {
        setStatus(els.quickStatus, 'Could not find downloadable media on this pin. Pinterest may require login or the DOM changed.', 'error');
        return;
      }
      const rec = records[0];
      const dl = await send('DOWNLOAD_ONE', { record: rec });
      if (dl && dl.ok) {
        setStatus(els.quickStatus, 'Download started.', 'success');
        els.pinUrl.value = '';
        await refreshHistory();
      } else {
        setStatus(els.quickStatus, 'Download failed: ' + ((dl && dl.error) || 'unknown error'), 'error');
      }
    } catch (err) {
      setStatus(els.quickStatus, 'Network error: ' + err.message, 'error');
    }
  }

  /** Minimal HTML parse: find img URLs inside pin JSON / og:image. */
  function extractFromHtml(html, base) {
    const records = [];
    // og:image gives the highest accessible preview image.
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    const fallback = og ? og[1] : '';
    // Look for pin id in canonical URL or og:url.
    let pinId = null;
    const can = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i);
    const pinMatch = (can ? can[1] : base).match(/\/pin\/(\d{1,20})/);
    if (pinMatch) pinId = pinMatch[1];
    const titleM = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const title = titleM ? decodeEntities(titleM[1]).trim().slice(0, 200) : '';
    if (fallback) {
      records.push({
        id: pinId,
        title,
        board: '',
        pinUrl: base,
        sourceUrl: '',
        url: fallback,
        type: 'image',
        width: 0,
        height: 0,
        format: (fallback.match(/\.([a-z0-9]{2,5})$/i) || [])[1] || 'jpg',
      });
    }
    // JSON-LD video candidates (best-effort)
    const jld = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (jld) {
      try {
        const data = JSON.parse(jld[1]);
        const v = data && data.video;
        if (v && typeof v.contentUrl === 'string') {
          records.push({
            id: pinId,
            title,
            board: '',
            pinUrl: base,
            sourceUrl: '',
            url: v.contentUrl,
            type: 'video',
            width: v.width || 0,
            height: v.height || 0,
            format: 'mp4',
          });
        }
      } catch (_err) { /* ignore */ }
    }
    return records;
  }

  function decodeEntities(s) {
    const ta = document.createElement('textarea');
    ta.innerHTML = s;
    return ta.value;
  }

  async function scanCurrentPage() {
    setStatus(els.scanStatus, 'Scanning Pinterest page…');
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        setStatus(els.scanStatus, 'No active tab available.', 'error');
        return;
      }
      if (!/pinterest\./.test(tab.url || '')) {
        setStatus(els.scanStatus, 'Open a Pinterest page first, then scan.', 'error');
        return;
      }
      const res = await chrome.tabs.sendMessage(
        tab.id,
        PinVaultMessaging.createEnvelope('SCAN_PAGE', {}),
        { frameId: 0 }
      );
      if (!res || !res.ok) {
        setStatus(els.scanStatus, 'Content script did not respond. Reload the Pinterest page and retry.', 'error');
        return;
      }
      setStatus(els.scanStatus, `Found ${res.data.count} media item(s). Open dashboard to download in bulk.`, 'success');
    } catch (err) {
      setStatus(els.scanStatus, 'Scan failed: ' + err.message, 'error');
    }
  }

  async function init() {
    await initTheme();
    await refreshQueue();
    await refreshHistory();
    try {
      const pong = await send('PING', {});
      if (pong && pong.ok && pong.data && pong.data.version) {
        els.versionLabel.textContent = 'v' + pong.data.version;
      }
    } catch (_err) { /* keep default */ }
  }

  els.quickDl.addEventListener('click', quickDownload);
  els.pinUrl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') quickDownload();
  });
  els.scanPage.addEventListener('click', scanCurrentPage);
  els.openDashboard.addEventListener('click', () => chrome.runtime.openOptionsPage());
  els.openSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
  els.helpLink.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  els.clearHistory.addEventListener('click', async () => {
    await send('CLEAR_HISTORY', {});
    await refreshHistory();
  });
  els.pauseBtn.addEventListener('click', async () => { await send('QUEUE_PAUSE', {}); await refreshQueue(); });
  els.resumeBtn.addEventListener('click', async () => { await send('QUEUE_RESUME', {}); await refreshQueue(); });
  els.cancelBtn.addEventListener('click', async () => { await send('QUEUE_CANCEL', {}); await refreshQueue(); });
  els.themeToggle.addEventListener('click', async () => {
    const res = await send('GET_SETTINGS', {});
    const cur = res && res.ok ? res.data.theme : 'system';
    const next = cur === 'light' ? 'dark' : 'light';
    await send('SAVE_SETTINGS', { settings: { theme: next } });
    applyTheme(next);
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'QUEUE_EVENT') {
      void refreshQueue();
    }
  });

  init();
})();
