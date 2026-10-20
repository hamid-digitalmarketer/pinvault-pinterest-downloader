/**
 * PinVault dashboard logic — full-page manager.
 * Vanilla JS; communicates with background via validated envelopes and with
 * the active Pinterest tab via content-script SCAN_PAGE.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const send = (type, payload) =>
    chrome.runtime.sendMessage(PinVaultMessaging.createEnvelope(type, payload));

  const state = {
    collected: [],        // normalized records for the Collect view
    selection: new Set(), // indexes of selected collected items
    collections: [],
    activeCollection: null,
    activeCollectionItems: [],
    queuePollTimer: null,
  };

  const els = {
    scanPage: $('scanPage'),
    openPinterest: $('openPinterest'),
    collectStatus: $('collectStatus'),
    grid: $('grid'),
    gridEmpty: $('gridEmpty'),
    selectAll: $('selectAll'),
    deselectAll: $('deselectAll'),
    downloadSelected: $('downloadSelected'),
    saveCollection: $('saveCollection'),
    exportCsv: $('exportCsv'),
    exportJson: $('exportJson'),
    clearCollect: $('clearCollect'),
    selCount: $('selCount'),
    filterOrientation: $('filterOrientation'),
    filterType: $('filterType'),
    filterMinW: $('filterMinW'),
    filterMinH: $('filterMinH'),
    filterFormat: $('filterFormat'),
    filterHideDup: $('filterHideDup'),
    collectionsList: $('collectionsList'),
    collectionDetail: $('collectionDetail'),
    collectionName: $('collectionName'),
    collectionGrid: $('collectionGrid'),
    downloadCollection: $('downloadCollection'),
    deleteCollection: $('deleteCollection'),
    newCollection: $('newCollection'),
    clearHistory: $('clearHistory'),
    historyTableWrap: $('historyTableWrap'),
    settingsForm: $('settingsForm'),
    setPattern: $('setPattern'),
    setBoardFolder: $('setBoardFolder'),
    setFolder: $('setFolder'),
    setConcurrency: $('setConcurrency'),
    setRetries: $('setRetries'),
    setMinW: $('setMinW'),
    setMinH: $('setMinH'),
    setMinLong: $('setMinLong'),
    setFormat: $('setFormat'),
    setTheme: $('setTheme'),
    setDupCheck: $('setDupCheck'),
    setConfirm: $('setConfirm'),
    settingsStatus: $('settingsStatus'),
    wipeData: $('wipeData'),
    themeToggle: $('themeToggle'),
    openPopup: $('openPopup'),
    toast: $('toast'),
  };

  // ---------- utilities ----------
  function toast(text, kind) {
    els.toast.textContent = text;
    els.toast.className = 'db-toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (els.toast.className = 'db-toast'), 2600);
  }

  function setStatus(el, text, kind) {
    el.textContent = text;
    el.className = 'db-inline-status' + (kind ? ' ' + kind : '');
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
  }

  function orientationOf(rec) {
    const w = Number(rec.width) || 0;
    const h = Number(rec.height) || 0;
    if (w && h) {
      if (w > h * 1.1) return 'landscape';
      if (h > w * 1.1) return 'portrait';
      return 'square';
    }
    return 'unknown';
  }

  function normalizeCollected(rec) {
    // Content script returns element-shaped records with imgUrls/videoUrls.
    const imgUrls = Array.isArray(rec.imgUrls) ? rec.imgUrls : (rec.url ? [rec.url] : []);
    const videoUrls = Array.isArray(rec.videoUrls) ? rec.videoUrls : [];
    let bestImage = null;
    let bestVideo = null;
    if (imgUrls.length) {
      const variants = imgUrls.map((u) => ({ url: u, width: rec.width || 0, height: rec.height || 0 }));
      bestImage = { url: PinVaultUrlUtils.pickHighestResolution(variants), width: rec.width || 0, height: rec.height || 0, format: 'jpg' };
    }
    if (videoUrls.length) {
      const solid = videoUrls.filter((u) => !/\.m3u8/i.test(u));
      const chosen = solid[0] || videoUrls[0];
      bestVideo = { url: chosen, width: 0, height: 0, format: /\.m3u8/i.test(chosen) ? 'm3u8' : 'mp4' };
    }
    return {
      id: rec.id || null,
      title: rec.title || '',
      board: rec.board || '',
      pinUrl: rec.pinUrl || '',
      sourceUrl: rec.sourceUrl || '',
      url: bestImage ? bestImage.url : (bestVideo ? bestVideo.url : ''),
      mediaType: bestVideo && !bestImage ? 'video' : 'image',
      width: Number(rec.width) || (bestImage && bestImage.width) || 0,
      height: Number(rec.height) || (bestImage && bestImage.height) || 0,
      format: bestImage ? bestImage.format : (bestVideo ? bestVideo.format : ''),
      imgUrls,
      videoUrls,
      bestImage,
      bestVideo,
      status: 'collected',
      detectedAt: new Date().toISOString(),
    };
  }

  function mediaUrlFor(rec) {
    if (rec.mediaType === 'video' && rec.bestVideo) return rec.bestVideo.url;
    if (rec.bestImage) return rec.bestImage.url;
    return rec.url || '';
  }

  function recordForDownload(rec) {
    const u = mediaUrlFor(rec);
    return {
      id: rec.id,
      title: rec.title,
      board: rec.board,
      pinUrl: rec.pinUrl,
      sourceUrl: rec.sourceUrl,
      url: u,
      type: rec.mediaType,
      width: rec.width,
      height: rec.height,
      format: /\.m3u8/i.test(u) ? 'm3u8' : (rec.format || 'jpg'),
      unsupportedReason: /\.m3u8/i.test(u) ? 'hls_segmented' : null,
      downloadDate: new Date().toISOString(),
      status: 'collected',
    };
  }

  function downloadRecordFor(rec) {
    const d = recordForDownload(rec);
    return d;
  }

  function filteredCollected() {
    const o = els.filterOrientation.value;
    const t = els.filterType.value;
    const minW = parseInt(els.filterMinW.value, 10) || 0;
    const minH = parseInt(els.filterMinH.value, 10) || 0;
    const fmt = els.filterFormat.value;
    const hideDup = els.filterHideDup.checked;
    const seen = new Set();
    const out = [];
    for (let i = 0; i < state.collected.length; i++) {
      const rec = state.collected[i];
      if (o !== 'any' && orientationOf(rec) !== o) continue;
      if (t !== 'any' && rec.mediaType !== t) continue;
      if (fmt !== 'any' && rec.format !== fmt && rec.format !== 'jpg') continue;
      if (minW > 0 && (Number(rec.width) || 0) > 0 && Number(rec.width) < minW) continue;
      if (minH > 0 && (Number(rec.height) || 0) > 0 && Number(rec.height) < minH) continue;
      if (hideDup) {
        const k = PinVaultDuplicateUtils.pinKey(rec) || PinVaultDuplicateUtils.mediaKey(rec) || rec.url;
        if (seen.has(k)) continue;
        seen.add(k);
      }
      out.push({ index: i, rec });
    }
    return out;
  }

  // ---------- render: collect grid ----------
  function renderGrid() {
    const list = filteredCollected();
    els.grid.innerHTML = '';
    els.gridEmpty.hidden = list.length !== 0;
    els.selCount.textContent = String(state.selection.size);
    for (const { index, rec } of list) {
      const item = document.createElement('article');
      item.className = 'db-item' + (state.selection.has(index) ? ' selected' : '');
      item.dataset.index = String(index);

      const img = document.createElement('img');
      img.className = 'thumb';
      img.loading = 'lazy';
      img.alt = rec.title || 'Pin media';
      const thumbUrl = (rec.bestImage && rec.bestImage.url) || mediaUrlFor(rec);
      if (rec.mediaType === 'video') {
        img.src = thumbUrl; // video poster may not be accessible; fallback below
        img.onerror = () => {
          img.onerror = null;
          img.src = '../icons/icon128.png';
          img.style.objectFit = 'contain';
        };
      } else {
        img.src = thumbUrl;
        img.onerror = () => {
          img.onerror = null;
          img.src = '../icons/icon128.png';
          img.style.objectFit = 'contain';
        };
      }

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'sel';
      cb.checked = state.selection.has(index);
      cb.setAttribute('aria-label', 'Select ' + (rec.title || 'pin'));
      cb.addEventListener('change', () => {
        if (cb.checked) state.selection.add(index);
        else state.selection.delete(index);
        item.classList.toggle('selected', cb.checked);
        els.selCount.textContent = String(state.selection.size);
      });

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = rec.mediaType === 'video' ? 'Video' : rec.format;

      const meta = document.createElement('div');
      meta.className = 'meta';
      const title = document.createElement('b');
      title.textContent = rec.title || (rec.id ? 'Pin ' + rec.id : 'Untitled');
      title.title = rec.title || '';
      const dims = document.createElement('span');
      const w = Number(rec.width) || 0;
      const h = Number(rec.height) || 0;
      dims.textContent = w && h ? `${w}×${h}${rec.mediaType === 'video' ? ' · video' : ''}` : (rec.mediaType === 'video' ? 'video' : 'image');
      meta.append(title, dims);

      item.append(img, cb, badge, meta);
      img.addEventListener('click', () => {
        // open pin page in new tab
        if (rec.pinUrl) window.open(rec.pinUrl, '_blank', 'noopener');
      });
      els.grid.appendChild(item);
    }
  }

  // ---------- scan ----------
  async function scanCurrentPage() {
    setStatus(els.collectStatus, 'Scanning current Pinterest page…');
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (!tab || !tab.id) {
        setStatus(els.collectStatus, 'No active tab.', 'error');
        return;
      }
      if (!/(pinterest\.|pin\.it)/.test(tab.url || '')) {
        setStatus(els.collectStatus, 'Please open a Pinterest page first.', 'error');
        return;
      }
      const res = await chrome.tabs.sendMessage(tab.id, PinVaultMessaging.createEnvelope('SCAN_PAGE', {}), { frameId: 0 });
      if (!res || !res.ok) {
        setStatus(els.collectStatus, 'No response from Pinterest page. Reload it and retry.', 'error');
        return;
      }
      const raw = res.data.records || [];
      state.collected = raw.map(normalizeCollected);
      state.selection.clear();
      renderGrid();
      setStatus(els.collectStatus, `Collected ${state.collected.length} media item(s).`, 'success');
      if (state.collected.length === 0) {
        toast('No media found — scroll the page to load more pins, then scan again.');
      }
    } catch (err) {
      setStatus(els.collectStatus, 'Scan failed: ' + err.message, 'error');
    }
  }

  // ---------- bulk download ----------
  async function downloadRecords(records) {
    const payload = records.map(downloadRecordFor);
    if (!payload.length) {
      toast('Nothing selected to download.');
      return;
    }
    setStatus(els.collectStatus, `Queued ${payload.length} download(s)…`, 'success');
    const res = await send('DOWNLOAD_BULK', { records: payload, sourceLabel: 'dashboard' });
    if (!res || !res.ok) {
      toast('Failed to queue downloads: ' + ((res && res.error) || 'unknown error'));
      return;
    }
    toast(`Queued ${res.data.queued} download(s). Track progress in the popup or Chrome downloads.`);
    startQueuePolling();
  }

  async function downloadSelected() {
    const list = filteredCollected();
    const selected = list.filter(({ index }) => state.selection.has(index)).map((x) => x.rec);
    if (!selected.length) {
      // Fall back: user may have meant all filtered items.
      const allFiltered = list.map((x) => x.rec);
      if (allFiltered.length) {
        toast('Nothing explicitly selected — downloading all filtered items.');
        await downloadRecords(allFiltered);
        return;
      }
      toast('Nothing to download.');
      return;
    }
    await downloadRecords(selected);
  }

  async function startQueuePolling() {
    if (state.queuePollTimer) return;
    state.queuePollTimer = setInterval(async () => {
      try {
        const res = await send('QUEUE_STATUS', {});
        if (res && res.ok && res.data && res.data.snapshot) {
          const s = res.data.snapshot;
          if (s.failed > 0) {
            toast(`Queue finished: ${s.completed} done, ${s.failed} failed, ${s.skipped} skipped.`);
          } else if (s.completed === s.total && s.total > 0) {
            toast(`Queue finished: ${s.completed} downloaded.`);
          }
          if (s.completed + s.failed + s.skipped + s.cancelled === s.total && s.total > 0) {
            clearInterval(state.queuePollTimer);
            state.queuePollTimer = null;
          }
        }
      } catch (_err) { /* background may be asleep */ }
    }, 1800);
  }

  // ---------- export ----------
  async function exportInventory(format) {
    const list = filteredCollected().map((x) => x.rec);
    if (!list.length) {
      toast('Nothing to export.');
      return;
    }
    const res = await send('EXPORT_INVENTORY', { records: list, format, collection: 'inventory' });
    if (res && res.ok) toast(`Exported ${res.data.count} item(s) as ${res.data.filename}`);
    else toast('Export failed: ' + ((res && res.error) || 'unknown'));
  }

  // ---------- collections ----------
  async function loadCollections() {
    const res = await send('GET_COLLECTIONS', {});
    state.collections = res && res.ok ? res.data || [] : [];
    renderCollections();
  }

  function renderCollections() {
    els.collectionsList.innerHTML = '';
    if (!state.collections.length) {
      const p = document.createElement('p');
      p.className = 'db-empty';
      p.textContent = 'No collections yet. Save collected media to a named collection to organize references.';
      els.collectionsList.appendChild(p);
      return;
    }
    for (const c of state.collections) {
      const card = document.createElement('div');
      card.className = 'db-collection-card';
      card.tabIndex = 0;
      const h = document.createElement('h3');
      h.textContent = c.name;
      const p = document.createElement('p');
      p.textContent = `${(c.items || []).length} item(s) · created ${c.createdAt || ''}`;
      card.append(h, p);
      card.addEventListener('click', () => showCollection(c.id));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') showCollection(c.id);
      });
      els.collectionsList.appendChild(card);
    }
  }

  function showCollection(id) {
    const c = state.collections.find((x) => x.id === id);
    if (!c) return;
    state.activeCollection = c;
    state.activeCollectionItems = c.items || [];
    els.collectionDetail.hidden = false;
    els.collectionName.textContent = c.name;
    renderCollectionGrid();
  }

  function renderCollectionGrid() {
    els.collectionGrid.innerHTML = '';
    const items = state.activeCollectionItems;
    if (!items.length) {
      const p = document.createElement('p');
      p.textContent = 'Collection is empty.';
      els.collectionGrid.appendChild(p);
      return;
    }
    for (const rec of items) {
      const item = document.createElement('article');
      item.className = 'db-item';
      const img = document.createElement('img');
      img.className = 'thumb';
      img.loading = 'lazy';
      img.alt = rec.title || 'Pin media';
      img.src = (rec.bestImage && rec.bestImage.url) || rec.url || '../icons/icon128.png';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const title = document.createElement('b');
      title.textContent = rec.title || (rec.id ? 'Pin ' + rec.id : 'Untitled');
      const dims = document.createElement('span');
      dims.textContent = `${rec.width || 0}×${rec.height || 0}`;
      meta.append(title, dims);
      item.append(img, meta);
      els.collectionGrid.appendChild(item);
    }
  }

  async function saveAsCollection() {
    const list = filteredCollected().filter(({ index }) => state.selection.has(index)).map((x) => x.rec);
    if (!list.length) {
      toast('Select at least one item to save.');
      return;
    }
    const name = window.prompt('Collection name:', 'Design inspiration');
    if (!name || !name.trim()) return;
    const clean = name.trim().slice(0, 60);
    const id = 'c' + Date.now().toString(36);
    state.collections.push({
      id,
      name: clean,
      createdAt: new Date().toISOString(),
      items: list.map(downloadRecordFor),
    });
    await send('SAVE_COLLECTIONS', { collections: state.collections });
    toast(`Saved ${list.length} item(s) to collection "${clean}".`);
    renderCollections();
  }

  async function downloadActiveCollection() {
    const items = state.activeCollectionItems;
    if (!items.length) return;
    await downloadRecords(items);
  }

  async function deleteActiveCollection() {
    if (!state.activeCollection) return;
    const yes = window.confirm(`Delete collection "${state.activeCollection.name}"? This only removes the local collection entry, never files on disk.`);
    if (!yes) return;
    state.collections = state.collections.filter((c) => c.id !== state.activeCollection.id);
    state.activeCollection = null;
    state.activeCollectionItems = [];
    els.collectionDetail.hidden = true;
    await send('SAVE_COLLECTIONS', { collections: state.collections });
    renderCollections();
    toast('Collection deleted.');
  }

  async function newCollectionPrompt() {
    const name = window.prompt('New empty collection name:', '');
    if (!name || !name.trim()) return;
    const id = 'c' + Date.now().toString(36);
    state.collections.push({ id, name: name.trim().slice(0, 60), createdAt: new Date().toISOString(), items: [] });
    await send('SAVE_COLLECTIONS', { collections: state.collections });
    renderCollections();
  }

  // ---------- history ----------
  async function renderHistory() {
    const res = await send('GET_HISTORY', {});
    const items = res && res.ok ? res.data || [] : [];
    els.historyTableWrap.innerHTML = '';
    if (!items.length) {
      els.historyTableWrap.textContent = 'No downloads yet.';
      return;
    }
    const table = document.createElement('table');
    table.className = 'db-table';
    table.innerHTML = `
      <thead><tr><th>Filename</th><th>Type</th><th>Dimensions</th><th>Status</th><th>Time</th></tr></thead>
    `;
    const tbody = document.createElement('tbody');
    for (const it of items.slice(0, 200)) {
      const tr = document.createElement('tr');
      const fn = document.createElement('td');
      fn.textContent = (it.filename || '').slice(0, 80);
      const ty = document.createElement('td');
      ty.textContent = it.type || '';
      const dm = document.createElement('td');
      dm.textContent = it.width && it.height ? `${it.width}×${it.height}` : '';
      const st = document.createElement('td');
      st.className = it.status === 'completed' ? 'ok' : 'err';
      st.textContent = it.status === 'completed' ? 'completed' : (it.error || 'failed');
      const tm = document.createElement('td');
      tm.textContent = (it.ts || '').slice(0, 16).replace('T', ' ');
      tr.append(fn, ty, dm, st, tm);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    els.historyTableWrap.appendChild(table);
  }

  // ---------- settings ----------
  async function loadSettings() {
    const res = await send('GET_SETTINGS', {});
    const s = res && res.ok ? res.data : {};
    els.setPattern.value = s.filenamePattern || '';
    els.setBoardFolder.checked = !!s.boardFolderEnabled;
    els.setFolder.value = s.folderName || '';
    els.setConcurrency.value = s.concurrency || 3;
    els.setRetries.value = s.maxRetries || 2;
    els.setMinW.value = s.minWidth || 0;
    els.setMinH.value = s.minHeight || 0;
    els.setMinLong.value = s.minLongestSide || 0;
    els.setFormat.value = s.formatFilter || 'any';
    els.setTheme.value = s.theme || 'system';
    els.setDupCheck.checked = s.duplicateCheck !== false;
    els.setConfirm.checked = !!s.confirmBeforeDownload;
    applyTheme(s.theme || 'system');
  }

  async function saveSettings(e) {
    e.preventDefault();
    const settings = {
      filenamePattern: els.setPattern.value,
      boardFolderEnabled: els.setBoardFolder.checked,
      folderName: els.setFolder.value,
      concurrency: parseInt(els.setConcurrency.value, 10) || 3,
      maxRetries: parseInt(els.setRetries.value, 10) || 2,
      minWidth: parseInt(els.setMinW.value, 10) || 0,
      minHeight: parseInt(els.setMinH.value, 10) || 0,
      minLongestSide: parseInt(els.setMinLong.value, 10) || 0,
      formatFilter: els.setFormat.value,
      theme: els.setTheme.value,
      duplicateCheck: els.setDupCheck.checked,
      confirmBeforeDownload: els.setConfirm.checked,
    };
    const res = await send('SAVE_SETTINGS', { settings });
    if (res && res.ok) {
      setStatus(els.settingsStatus, 'Settings saved.', 'success');
      applyTheme(settings.theme);
    } else {
      setStatus(els.settingsStatus, 'Failed to save settings.', 'error');
    }
  }

  async function wipeData() {
    const yes = window.confirm(
      'Delete ALL PinVault data (settings, history, collections, duplicate memory)?\n\nThis cannot be undone. Files already downloaded to disk are not affected.'
    );
    if (!yes) return;
    const res = await send('WIPE_DATA', {});
    if (res && res.ok) {
      await loadSettings();
      await renderHistory();
      await loadCollections();
      toast('All PinVault data deleted.');
    }
  }

  // ---------- tabs / theme ----------
  function switchView(view) {
    document.querySelectorAll('.db-view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    document.querySelectorAll('.db-tab').forEach((t) => {
      const on = t.dataset.view === view;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (view === 'collections') loadCollections();
    if (view === 'history') renderHistory();
    if (view === 'settings') loadSettings();
  }

  function bindEvents() {
    document.querySelectorAll('.db-tab').forEach((t) => {
      t.addEventListener('click', () => switchView(t.dataset.view));
    });

    els.scanPage.addEventListener('click', scanCurrentPage);
    els.openPinterest.addEventListener('click', () => chrome.tabs.create({ url: 'https://www.pinterest.com/' }));
    els.selectAll.addEventListener('click', () => {
      state.selection.clear();
      for (const { index } of filteredCollected()) state.selection.add(index);
      renderGrid();
    });
    els.deselectAll.addEventListener('click', () => {
      state.selection.clear();
      renderGrid();
    });
    els.downloadSelected.addEventListener('click', downloadSelected);
    els.saveCollection.addEventListener('click', saveAsCollection);
    els.exportCsv.addEventListener('click', () => exportInventory('csv'));
    els.exportJson.addEventListener('click', () => exportInventory('json'));
    els.clearCollect.addEventListener('click', () => {
      state.collected = [];
      state.selection.clear();
      renderGrid();
    });

    for (const ctrl of [
      els.filterOrientation, els.filterType, els.filterMinW, els.filterMinH,
      els.filterFormat, els.filterHideDup,
    ]) {
      ctrl.addEventListener('change', renderGrid);
      ctrl.addEventListener('input', renderGrid);
    }

    els.newCollection.addEventListener('click', newCollectionPrompt);
    els.downloadCollection.addEventListener('click', downloadActiveCollection);
    els.deleteCollection.addEventListener('click', deleteActiveCollection);
    els.clearHistory.addEventListener('click', async () => {
      await send('CLEAR_HISTORY', {});
      await renderHistory();
      toast('History cleared.');
    });
    els.settingsForm.addEventListener('submit', saveSettings);
    els.wipeData.addEventListener('click', wipeData);
    els.themeToggle.addEventListener('click', async () => {
      const res = await send('GET_SETTINGS', {});
      const cur = res && res.ok ? res.data.theme : 'system';
      const next = cur === 'light' ? 'dark' : 'light';
      await send('SAVE_SETTINGS', { settings: { theme: next } });
      await loadSettings();
    });
    els.openPopup.addEventListener('click', () => chrome.action.openPopup());
  }

  // ---------- init ----------
  async function init() {
    bindEvents();
    await loadSettings();
    await renderHistory();
    await loadCollections();
    renderGrid();
  }

  init();
})();
