/**
 * storage.js — typed persistence layer over chrome.storage.local.
 * Provides settings, history, queue state, and collections with
 * schema defaults and migration-safe reads.
 *
 * In Node tests, a chrome.storage shim can be injected via setChromeShim.
 */
'use strict';

const KEYS = {
  settings: 'pv_settings',
  history: 'pv_history',
  queue: 'pv_queue',
  collections: 'pv_collections',
  seen: 'pv_seen',
};

const DEFAULT_SETTINGS = {
  filenamePattern: '{title}-{index}.{ext}',
  boardFolderEnabled: false,
  folderName: 'PinVault',
  minWidth: 0,
  minHeight: 0,
  minLongestSide: 0,
  formatFilter: 'any',       // any | image | video
  concurrency: 3,
  maxRetries: 2,
  theme: 'system',           // light | dark | system
  duplicateCheck: true,
  confirmBeforeDownload: false,
};

const MAX_HISTORY = 500;
const MAX_COLLECTION_ITEMS = 2000;
const MAX_SEEN = 20000;

let shim = null;

function chromeStore() {
  if (shim) return shim;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return chrome.storage.local;
  }
  throw new Error('chrome.storage.local unavailable; call setChromeShim for tests');
}

function setChromeShim(store) {
  shim = store;
}

function get(keys) {
  return new Promise((resolve, reject) => {
    try {
      chromeStore().get(keys, (res) => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(res || {});
      });
    } catch (err) {
      reject(err);
    }
  });
}

function set(obj) {
  return new Promise((resolve, reject) => {
    try {
      chromeStore().set(obj, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(true);
      });
    } catch (err) {
      reject(err);
    }
  });
}

function remove(keys) {
  return new Promise((resolve, reject) => {
    try {
      chromeStore().remove(keys, () => {
        if (chrome.runtime && chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(true);
      });
    } catch (err) {
      reject(err);
    }
  });
}

function sanitizeSettings(partial) {
  const s = { ...DEFAULT_SETTINGS, ...(partial || {}) };
  s.concurrency = Math.max(1, Math.min(8, Number(s.concurrency) || 3));
  s.maxRetries = Math.max(0, Math.min(5, Number(s.maxRetries) || 2));
  s.minWidth = Math.max(0, Number(s.minWidth) || 0);
  s.minHeight = Math.max(0, Number(s.minHeight) || 0);
  s.minLongestSide = Math.max(0, Number(s.minLongestSide) || 0);
  if (!['any', 'image', 'video'].includes(s.formatFilter)) s.formatFilter = 'any';
  if (!['light', 'dark', 'system'].includes(s.theme)) s.theme = 'system';
  if (typeof s.filenamePattern !== 'string' || s.filenamePattern.length > 120) {
    s.filenamePattern = DEFAULT_SETTINGS.filenamePattern;
  }
  if (typeof s.folderName !== 'string' || s.folderName.length > 80) {
    s.folderName = DEFAULT_SETTINGS.folderName;
  }
  s.boardFolderEnabled = !!s.boardFolderEnabled;
  s.duplicateCheck = s.duplicateCheck !== false;
  s.confirmBeforeDownload = !!s.confirmBeforeDownload;
  return s;
}

async function getSettings() {
  const res = await get(KEYS.settings);
  return sanitizeSettings(res[KEYS.settings]);
}

async function saveSettings(partial) {
  const next = sanitizeSettings(partial);
  await set({ [KEYS.settings]: next });
  return next;
}

async function getHistory() {
  const res = await get(KEYS.history);
  return Array.isArray(res[KEYS.history]) ? res[KEYS.history] : [];
}

async function addHistory(entry) {
  const list = await getHistory();
  list.unshift({
    ...entry,
    ts: entry.ts || new Date().toISOString(),
  });
  const trimmed = list.slice(0, MAX_HISTORY);
  await set({ [KEYS.history]: trimmed });
  return trimmed;
}

async function clearHistory() {
  await remove(KEYS.history);
  return true;
}

async function getQueueState() {
  const res = await get(KEYS.queue);
  return res[KEYS.queue] || { items: [], active: null, updatedAt: null };
}

async function saveQueueState(state) {
  await set({ [KEYS.queue]: { ...state, updatedAt: new Date().toISOString() } });
  return true;
}

async function clearQueueState() {
  await remove(KEYS.queue);
  return true;
}

async function getCollections() {
  const res = await get(KEYS.collections);
  return Array.isArray(res[KEYS.collections]) ? res[KEYS.collections] : [];
}

async function saveCollections(collections) {
  const capped = collections.map((c) => ({
    ...c,
    items: (c.items || []).slice(0, MAX_COLLECTION_ITEMS),
  }));
  await set({ [KEYS.collections]: capped });
  return capped;
}

async function getSeen() {
  const res = await get(KEYS.seen);
  return Array.isArray(res[KEYS.seen]) ? res[KEYS.seen] : [];
}

async function addSeen(keysArray) {
  const current = await getSeen();
  const set = new Set(current);
  for (const k of keysArray || []) {
    if (k) set.add(k);
  }
  const arr = Array.from(set);
  const trimmed = arr.slice(-MAX_SEEN);
  await set({ [KEYS.seen]: trimmed });
  return trimmed;
}

async function clearSeen() {
  await remove(KEYS.seen);
  return true;
}

/** Wipe all extension data (privacy "delete my data" action). */
async function wipeAll() {
  await remove(Object.values(KEYS));
  return true;
}

export {
  KEYS,
  DEFAULT_SETTINGS,
  setChromeShim,
  get,
  set,
  remove,
  sanitizeSettings,
  getSettings,
  saveSettings,
  getHistory,
  addHistory,
  clearHistory,
  getQueueState,
  saveQueueState,
  clearQueueState,
  getCollections,
  saveCollections,
  getSeen,
  addSeen,
  clearSeen,
  wipeAll,
};

const PinVaultStorage = {
  KEYS,
  DEFAULT_SETTINGS,
  setChromeShim,
  get,
  set,
  remove,
  sanitizeSettings,
  getSettings,
  saveSettings,
  getHistory,
  addHistory,
  clearHistory,
  getQueueState,
  saveQueueState,
  clearQueueState,
  getCollections,
  saveCollections,
  getSeen,
  addSeen,
  clearSeen,
  wipeAll,
};

export default PinVaultStorage;

if (typeof globalThis !== 'undefined') {
  globalThis.PinVaultStorage = PinVaultStorage;
}
