/**
 * duplicate-utils.js — duplicate detection (exact URL keys + pin id keys).
 * Local-first: no external services, no image uploads.
 * Near-duplicate (perceptual hash) detection is documented as a future
 * enhancement; this module ships exact-match detection which is fast and
 * predictable. DuplicateSet is the stateful in-memory helper used by the
 * queue and dashboard; dedupe/buildSeenSet are the stateless helpers.
 */
'use strict';

import * as urlUtils from './url-utils.js';

/**
 * Compute a stable duplicate key for a media record.
 * @param {object} rec {url, id}
 * @returns {string}
 */
function mediaKey(rec) {
  if (!rec || typeof rec.url !== 'string' || rec.url === '') return '';
  const norm = urlUtils.normalizeMediaUrl(rec.url);
  if (norm) return 'url:' + norm;
  return 'url:' + rec.url;
}

/**
 * Pin-level key: uses pin id (canonical), else normalized pin URL.
 * @param {object} rec {id, pinUrl, url}
 * @returns {string}
 */
function pinKey(rec) {
  if (!rec) return '';
  if (rec.id && /^\d+$/.test(String(rec.id))) return 'pin:' + String(rec.id);
  if (rec.pinUrl) {
    const np = urlUtils.normalizePinUrl(rec.pinUrl);
    if (np) return 'pinurl:' + np;
  }
  const mk = mediaKey(rec);
  return mk ? 'media:' + mk : 'media:' + (rec.url || '');
}

/**
 * Filter a list of records to keep only items not seen before.
 * Optionally passes an existing seen set (for cross-batch detection).
 * @param {Array<object>} records
 * @param {Set<string>} [seen]
 * @returns {{unique: object[], duplicates: object[], seen: Set<string>}}
 */
function dedupe(records, seen) {
  const s = seen || new Set();
  const unique = [];
  const duplicates = [];
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || typeof r.url !== 'string' || r.url === '') continue;
    const k = pinKey(r);
    if (!k || s.has(k)) {
      duplicates.push(r);
      continue;
    }
    s.add(k);
    const mk = mediaKey(r);
    if (mk) s.add(mk);
    unique.push(r);
  }
  return { unique, duplicates, seen: s };
}

/**
 * Build a Set from an array of keys or records.
 * @param {Array<string|object>} entries
 * @returns {Set<string>}
 */
function buildSeenSet(entries) {
  const s = new Set();
  for (const e of Array.isArray(entries) ? entries : []) {
    if (typeof e === 'string') {
      s.add(e);
    } else if (e) {
      const k = pinKey(e);
      if (k) s.add(k);
      const mk = mediaKey(e);
      if (mk) s.add(mk);
    }
  }
  return s;
}

/**
 * DuplicateSet — stateful exact-duplicate detector.
 * check(rec) returns false the first time a record is seen and true when the
 * same media URL or pin id has already been recorded. Empty URLs are never
 * marked as duplicates. Serialize/restore enables persistence across worker
 * restarts.
 */
class DuplicateSet {
  constructor(snapshot) {
    this._keys = new Set(Array.isArray(snapshot) ? snapshot : []);
  }

  check(rec) {
    if (!rec || typeof rec.url !== 'string' || rec.url === '') return false;
    const keys = [];
    const mk = mediaKey(rec);
    if (mk) keys.push(mk);
    const pk = pinKey(rec);
    if (pk && keys.indexOf(pk) === -1) keys.push(pk);
    if (keys.length === 0) return false;
    for (const k of keys) {
      if (this._keys.has(k)) return true;
    }
    for (const k of keys) this._keys.add(k);
    return false;
  }

  serialize() {
    return Array.from(this._keys);
  }
}

export {
  mediaKey,
  pinKey,
  dedupe,
  buildSeenSet,
  DuplicateSet,
};

const PinVaultDuplicateUtils = {
  mediaKey,
  pinKey,
  dedupe,
  buildSeenSet,
  DuplicateSet,
};

export default PinVaultDuplicateUtils;

if (typeof globalThis !== 'undefined') {
  globalThis.PinVaultDuplicateUtils = PinVaultDuplicateUtils;
}
