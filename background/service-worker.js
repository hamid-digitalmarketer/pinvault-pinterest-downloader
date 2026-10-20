/**
 * PinVault — background service worker (Manifest V3, module type).
 *
 * Responsibilities:
 *  - Message routing (validated envelopes only)
 *  - Single & bulk download orchestration via chrome.downloads
 *  - Bounded-concurrency queue with retry/backoff, pause, cancel, retry
 *  - Duplicate detection (URL normalization + pin id) persisted across sessions
 *  - Filename sanitization with configurable templates
 *  - History + queue persistence in chrome.storage.local
 *  - Service-worker restart recovery (queue state restored and resumed safely)
 *
 * Security: no sensitive data is ever logged; payloads are treated as untrusted.
 */
import { DownloadQueue } from '../lib/queue.js';
import * as urlUtils from '../lib/url-utils.js';
import * as filenameUtils from '../lib/filename-utils.js';
import * as duplicateUtils from '../lib/duplicate-utils.js';
import * as storage from '../lib/storage.js';
import * as messaging from '../lib/messaging.js';

const VERSION = '1.0.0';

// ---- In-memory queue (rebuilt from persisted state on worker start) ----
let queue = null;
let batchMeta = null; // {sourceLabel, startedAt, itemsTotal}

const VALID_DOWNLOAD_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp',
  'mp4', 'webm', 'm4v',
]);

function logInfo(scope, msg) {
  // Structured, non-sensitive logging only.
  // Never include URLs, pin ids, filenames, or user content.
  console.log(`[PinVault ${VERSION}] ${scope}: ${msg}`);
}

function sanitizeDownloadFilename(rec, settings, index) {
  const pattern = settings.filenamePattern || '{title}-{index}.{ext}';
  const title = rec.title || rec.id || 'pin';
  const board = rec.board || '';
  const ext = sanitizeExt(rec.format || inferExt(rec.url));
  return filenameUtils.renderTemplate(pattern, {
    pinId: rec.id || '',
    title,
    board,
    index: index || 1,
    date: new Date(),
    ext,
  });
}

function sanitizeExt(ext) {
  const e = String(ext || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
  return VALID_DOWNLOAD_EXTENSIONS.has(e) ? e : 'jpg';
}

function inferExt(url) {
  try {
    const path = new URL(url).pathname;
    const m = path.match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : 'jpg';
  } catch (_err) {
    return 'jpg';
  }
}

function buildDownloadFilename(rec, settings, index) {
  const base = sanitizeDownloadFilename(rec, settings, index);
  let folder = '';
  if (settings.boardFolderEnabled && rec.board) {
    folder = filenameUtils.boardFolder(rec.board);
  } else if (settings.folderName) {
    folder = filenameUtils.sanitizeSegment(String(settings.folderName), { fallback: 'PinVault', max: 60 });
  }
  if (folder) {
    return `${folder}/${base}`;
  }
  return base;
}

/** Filter a media record against quality settings. */
function passesQualityFilter(rec, settings) {
  if (rec.type === 'video') {
    return settings.formatFilter === 'any' || settings.formatFilter === 'video';
  }
  if (settings.formatFilter === 'video') return false;
  const w = Number(rec.width) || 0;
  const h = Number(rec.height) || 0;
  if (settings.minWidth > 0 && w > 0 && w < settings.minWidth) return false;
  if (settings.minHeight > 0 && h > 0 && h < settings.minHeight) return false;
  if (settings.minLongestSide > 0) {
    const longest = Math.max(w, h);
    if (longest > 0 && longest < settings.minLongestSide) return false;
  }
  return true;
}

/**
 * Execute one download via chrome.downloads with conflict-avoidance retry.
 * @returns {Promise<{ok:boolean, skipped?:boolean, error?:string, filename?:string}>}
 */
async function performDownload(rec, settings, index) {
  const filename = buildDownloadFilename(rec, settings, index);
  const url = String(rec.url);
  if (!urlUtils.isValidHttpUrl(url)) {
    return { ok: false, error: 'invalid_url' };
  }
  let suggestedFilename = filename;
  // Avoid collisions inside the queue: check existing downloads for the exact filename.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const dlId = await new Promise((resolve, reject) => {
        chrome.downloads.download(
          {
            url,
            filename: suggestedFilename,
            conflictAction: 'uniquify',
            saveAs: settings.confirmBeforeDownload === true,
          },
          (id) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(id);
          }
        );
      });
      return { ok: true, filename: suggestedFilename, downloadId: dlId };
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (/conflict/i.test(msg)) {
        const p = suggestedFilename.lastIndexOf('.');
        const base = p > 0 ? suggestedFilename.slice(0, p) : suggestedFilename;
        const ext = p > 0 ? suggestedFilename.slice(p + 1) : 'jpg';
        suggestedFilename = `${base}-${Date.now().toString(36)}.${ext}`;
        continue;
      }
      if (/invalid filename/i.test(msg) || /not a valid filename/i.test(msg)) {
        suggestedFilename = `pinvault-${Date.now().toString(36)}.${sanitizeExt(rec.format)}`;
        continue;
      }
      return { ok: false, error: msg.slice(0, 300) };
    }
  }
  return { ok: false, error: 'filename_conflict' };
}

function buildQueueWorker() {
  return async (item, ctx) => {
    const settings = await storage.getSettings();
    const rec = item.record;
    const index = item.index || 1;
    if (rec.type === 'video' && rec.unsupportedReason === 'hls_segmented') {
      return { skipped: true, error: 'hls_segmented_unsupported' };
    }
    if (!passesQualityFilter(rec, settings)) {
      return { skipped: true, error: 'quality_filter' };
    }
    if (settings.duplicateCheck) {
      const seen = new Set(await storage.getSeen());
      const k = duplicateUtils.pinKey(rec);
      const mk = duplicateUtils.mediaKey(rec);
      if (seen.has(k) || seen.has(mk)) {
        return { skipped: true, error: 'duplicate' };
      }
    }
    const result = await performDownload(rec, settings, index);
    if (result.ok) {
      await storage.addSeen([
        duplicateUtils.pinKey(rec),
        duplicateUtils.mediaKey(rec),
      ]);
      await storage.addHistory({
        id: rec.id || null,
        url: rec.url,
        type: rec.type,
        filename: result.filename || '',
        width: rec.width || 0,
        height: rec.height || 0,
        format: rec.format || '',
        status: 'completed',
        error: null,
        batch: batchMeta ? batchMeta.sourceLabel : null,
      });
    }
    return result;
  };
}

function emitQueueEvent(type, payload) {
  const snap = queue ? queue.snapshot() : null;
  void chrome.runtime
    .sendMessage({ type: 'QUEUE_EVENT', payload: { event: type, payload, snapshot: snap }, nonce: `pv-${Date.now()}` })
    .catch(() => {});
}

async function ensureQueue() {
  if (queue) return queue;
  const settings = await storage.getSettings();
  queue = new DownloadQueue({
    worker: buildQueueWorker(),
    concurrency: settings.concurrency,
    maxRetries: settings.maxRetries,
  });
  queue.on((evt, snap) => {
    emitQueueEvent(evt.type, evt);
    if (evt.type === 'done') {
      void persistQueueAfterDone();
    }
  });
  return queue;
}

async function persistQueueAfterDone() {
  try {
    const q = await ensureQueue();
    await storage.saveQueueState({
      items: q.items().map((r) => ({
        id: r.id,
        status: r.status,
        error: r.error,
        attempts: r.attempts,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      })),
      active: false,
      batch: batchMeta,
    });
    if (q.snapshot().completed === q.snapshot().total && q.snapshot().total > 0) {
      // Finished cleanly: keep last state for UI, no auto-resume needed.
      logInfo('queue', 'batch finished');
    }
  } catch (err) {
    logInfo('queue', `persist failed: ${err.message}`);
  }
}

async function restoreQueueFromStorage() {
  try {
    const state = await storage.getQueueState();
    if (!state || !Array.isArray(state.items) || state.items.length === 0) return;
    const incomplete = state.items.filter(
      (r) => r.status === 'queued' || r.status === 'running' || r.status === 'failed'
    );
    if (incomplete.length === 0) {
      // All finished previously; keep history only.
      await storage.clearQueueState();
      return;
    }
    batchMeta = state.batch || null;
    const settings = await storage.getSettings();
    queue = new DownloadQueue({
      worker: buildQueueWorker(),
      concurrency: settings.concurrency,
      maxRetries: settings.maxRetries,
    });
    // Re-queue incomplete items; completed/skipped are recorded but not re-downloaded.
    // To rebuild items we need their records — they were persisted as part of the
    // queue payload (we store record in item). If missing, skip item.
    let index = 1;
    for (const it of state.items) {
      if (it.status === 'completed' || it.status === 'skipped' || it.status === 'cancelled') continue;
      if (it.record && it.record.url) {
        queue.add(it.id, { record: it.record, index: it.index || index });
        index += 1;
      }
    }
    queue.on((evt, snap) => {
      emitQueueEvent(evt.type, evt);
      if (evt.type === 'done') void persistQueueAfterDone();
    });
    if (queue.items().length > 0) {
      logInfo('queue', `recovered ${queue.items().length} pending item(s)`);
      void queue.start();
    } else {
      await storage.clearQueueState();
    }
  } catch (err) {
    logInfo('queue', `restore failed: ${err.message}`);
  }
}

/** Snapshot of queue items with their record metadata for UI rendering. */
function queueSnapshotForUi() {
  if (!queue) return { items: [], meta: batchMeta, snapshot: null };
  return {
    items: queue.items(),
    meta: batchMeta,
    snapshot: queue.snapshot(),
  };
}

async function handleMessage(msg) {
  const settings = await storage.getSettings();
  switch (msg.type) {
    case 'PING':
      return { pong: true, version: VERSION };

    case 'GET_SETTINGS':
      return settings;

    case 'SAVE_SETTINGS': {
      const next = await storage.saveSettings(msg.payload.settings || {});
      // Rebuild queue with new concurrency on next ensure.
      queue = null;
      await ensureQueue();
      return next;
    }

    case 'GET_HISTORY':
      return storage.getHistory();

    case 'CLEAR_HISTORY':
      await storage.clearHistory();
      return { cleared: true };

    case 'GET_COLLECTIONS':
      return storage.getCollections();

    case 'SAVE_COLLECTIONS': {
      const list = Array.isArray(msg.payload.collections) ? msg.payload.collections : [];
      return storage.saveCollections(list);
    }

    case 'WIPE_DATA':
      await storage.wipeAll();
      if (queue) queue.cancel();
      queue = null;
      return { wiped: true };

    case 'DOWNLOAD_ONE': {
      const rec = msg.payload.record;
      if (!rec || !rec.url) return { ok: false, error: 'missing_record' };
      const result = await performDownload(rec, settings, 1);
      if (result.ok) {
        await storage.addSeen([
          duplicateUtils.pinKey(rec),
          duplicateUtils.mediaKey(rec),
        ]);
        await storage.addHistory({
          id: rec.id || null,
          url: rec.url,
          type: rec.type,
          filename: result.filename || '',
          width: rec.width || 0,
          height: rec.height || 0,
          format: rec.format || '',
          status: 'completed',
          error: null,
          batch: 'quick',
        });
      }
      return result;
    }

    case 'DOWNLOAD_BULK': {
      const records = Array.isArray(msg.payload.records) ? msg.payload.records : [];
      if (records.length === 0) return { ok: false, error: 'no_records' };
      const label = String(msg.payload.sourceLabel || 'bulk').slice(0, 120);
      const q = await ensureQueue();
      if (q.isDone() && q.snapshot().total > 0) {
        // Fresh queue for a new batch after completion.
        queue = new DownloadQueue({
          worker: buildQueueWorker(),
          concurrency: settings.concurrency,
          maxRetries: settings.maxRetries,
        });
        queue.on((evt, snap) => {
          emitQueueEvent(evt.type, evt);
          if (evt.type === 'done') void persistQueueAfterDone();
        });
      }
      batchMeta = { sourceLabel: label, startedAt: new Date().toISOString(), itemsTotal: records.length };
      let index = 1;
      for (const rec of records) {
        const itemId = `${rec.id || 'item'}-${index}-${Date.now().toString(36)}`;
        queue.add(itemId, { record: rec, index });
        index += 1;
      }
      // Persist state immediately for restart recovery.
      await storage.saveQueueState({
        items: queue.items().map((r) => ({
          id: r.id,
          status: r.status,
          error: r.error,
          attempts: r.attempts,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
          record: r.item && r.item.record ? r.item.record : null,
          index: r.item && r.item.index ? r.item.index : null,
        })),
        active: true,
        batch: batchMeta,
      });
      void queue.start();
      return { ok: true, queued: records.length, batch: batchMeta };
    }

    case 'QUEUE_START':
      await ensureQueue();
      if (queue) void queue.start();
      return queueSnapshotForUi();

    case 'QUEUE_PAUSE':
      if (queue) queue.pause();
      return queueSnapshotForUi();

    case 'QUEUE_RESUME':
      if (queue) queue.resume();
      return queueSnapshotForUi();

    case 'QUEUE_CANCEL':
      if (queue) queue.cancel();
      await storage.clearQueueState();
      return queueSnapshotForUi();

    case 'QUEUE_RETRY': {
      const q = await ensureQueue();
      const ids = Array.isArray(msg.payload.ids) ? msg.payload.ids : null;
      q.retry(ids);
      return queueSnapshotForUi();
    }

    case 'QUEUE_STATUS':
      return queueSnapshotForUi();

    case 'GET_QUEUE_STATE':
      return storage.getQueueState();

    case 'EXPORT_INVENTORY': {
      const records = Array.isArray(msg.payload.records) ? msg.payload.records : [];
      const format = msg.payload.format === 'json' ? 'json' : 'csv';
      const collection = String(msg.payload.collection || 'inventory');
      const rendered = format === 'json' ? renderJson(records) : renderCsv(records);
      const mime = format === 'json' ? 'application/json' : 'text/csv';
      const dataUrl = `data:${mime};charset=utf-8,${encodeURIComponent(rendered)}`;
      const ts = Date.now();
      const filename = `pinvault-${collection}-${ts}.${format}`;
      try {
        const dlId = await new Promise((resolve, reject) => {
          chrome.downloads.download({ url: dataUrl, filename, conflictAction: 'uniquify' }, (id) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(id);
          });
        });
        return { ok: true, downloadId: dlId, filename, count: records.length };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'GET_BADGE': {
      const snap = queue ? queue.snapshot() : null;
      return { snapshot: snap, version: VERSION };
    }

    default:
      return { error: `unhandled:${msg.type}` };
  }
}

function csvField(v) {
  const s = v == null ? '' : String(v);
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function renderCsv(records) {
  const header = ['pin_id', 'type', 'url', 'width', 'height', 'format', 'title', 'board', 'source_url', 'pin_url', 'download_date', 'status'];
  const lines = [header.join(',')];
  for (const r of records) {
    lines.push([
      csvField(r.id),
      csvField(r.type),
      csvField(r.url),
      csvField(r.width),
      csvField(r.height),
      csvField(r.format),
      csvField(r.title),
      csvField(r.board),
      csvField(r.sourceUrl),
      csvField(r.pinUrl),
      csvField(r.downloadDate || r.detectedAt || ''),
      csvField(r.status || ''),
    ].join(','));
  }
  return lines.join('\r\n');
}

function renderJson(records) {
  const clean = records.map((r) => ({
    pin_id: r.id || null,
    type: r.type || null,
    url: r.url || null,
    width: r.width || 0,
    height: r.height || 0,
    format: r.format || null,
    title: r.title || '',
    board: r.board || '',
    source_url: r.sourceUrl || null,
    pin_url: r.pinUrl || null,
    download_date: r.downloadDate || r.detectedAt || null,
    status: r.status || 'collected',
  }));
  return JSON.stringify({ exported_by: 'PinVault', version: VERSION, exported_at: new Date().toISOString(), items: clean }, null, 2);
}

// ---- chrome event listeners ----
chrome.runtime.onInstalled.addListener((details) => {
  logInfo('install', `reason=${details.reason}`);
  void storage.getSettings().catch(() => {});
});

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  const v = messaging.validateEnvelope(raw);
  if (!v.ok) {
    sendResponse({ ok: false, error: v.error });
    return false;
  }
  messaging.safeRespond(handleMessage)(v.message, sender)
    .then((res) => sendResponse(res))
    .catch(() => sendResponse({ ok: false, error: 'internal_error' }));
  return true; // async response
});

// ---- startup recovery ----
void restoreQueueFromStorage();
