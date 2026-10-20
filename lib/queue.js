/**
 * queue.js — bounded-concurrency download queue with retry/backoff, pause,
 * resume, cancel, retry, snapshots (for persistence/restart recovery), and
 * per-batch completion promises. Dependency-free and unit-testable.
 *
 * API summary:
 *   new DownloadQueue({ worker?, concurrency?, maxRetries?, backoffBaseMs?, retryBaseDelayMs? })
 *   add(id, item) / addOne(item) / addMany(items)
 *   start() / pause() / resume() / cancel() / retry(ids)
 *   snapshot() / stats() / items() / isDone() / checkDuplicate(url)
 *   on(listener) -> unsubscribe
 *
 * Worker contract: async (item, {attempt}) => {ok:true} | {ok:false,error}
 * | {skipped:true,error} | throws. Transient failures are retried with
 * exponential backoff up to maxRetries; a final failure marks the item failed.
 */
'use strict';

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BACKOFF_BASE_MS = 800;
const DEFAULT_BACKOFF_MAX_MS = 8000;

function clamp(n, min, max) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class DownloadQueue {
  constructor(opts) {
    const o = opts || {};
    this.worker = typeof o.worker === 'function' ? o.worker : null;
    this.concurrency = clamp(o.concurrency, 1, 8) || DEFAULT_CONCURRENCY;
    this.maxRetries = clamp(o.maxRetries, 0, 8) || DEFAULT_MAX_RETRIES;
    this.backoffBaseMs = clamp(o.retryBaseDelayMs !== undefined ? o.retryBaseDelayMs : o.backoffBaseMs, 1, 60000) || DEFAULT_BACKOFF_BASE_MS;
    this.backoffMaxMs = clamp(o.backoffMaxMs, 1, 60000) || DEFAULT_BACKOFF_MAX_MS;
    this._items = [];
    this._index = new Map();
    this._running = 0;
    this._paused = false;
    this._cancelled = false;
    this._started = false;
    this._done = false;
    this._listeners = new Set();
    this._batchWatchers = [];
    this._seq = 0;
  }

  _nextId() {
    this._seq += 1;
    return 'q' + this._seq + '-' + Date.now().toString(36);
  }

  _emit(type, payload) {
    const snap = this.snapshot();
    for (const fn of Array.from(this._listeners)) {
      try {
        fn({ type, ...(payload || {}) }, snap);
      } catch (_err) { /* listener errors are isolated */ }
    }
  }

  _notifyWatchers() {
    for (const w of this._batchWatchers.slice()) {
      let pending = false;
      for (const id of w.ids) {
        const r = this._index.get(id);
        if (!r || r.status === 'queued' || r.status === 'running') {
          pending = true;
          break;
        }
      }
      if (!pending) {
        const idx = this._batchWatchers.indexOf(w);
        if (idx !== -1) this._batchWatchers.splice(idx, 1);
        w.resolve(this._summary());
      }
    }
  }

  _summary() {
    const s = this.snapshot();
    return {
      completed: s.completed,
      failed: s.failed,
      skipped: s.skipped,
      cancelled: s.cancelled,
      total: s.total,
      failures: this._items
        .filter((r) => r.status === 'failed')
        .map((r) => ({ id: r.id, error: r.error || 'download failed', item: r.item })),
    };
  }

  _watchBatch(ids) {
    return new Promise((resolve) => {
      this._batchWatchers.push({ ids: new Set(ids), resolve });
      this._notifyWatchers();
    });
  }

  /**
   * Claim queued items up to the concurrency limit. Called from the add
   * methods, start(), resume() and after each item settles. Synchronous
   * claiming keeps the concurrency bound tight and makes pause semantics
   * deterministic.
   */
  _start() {
    if (this._cancelled) return;
    this._started = true;
    while (!this._paused && !this._cancelled && this._running < this.concurrency) {
      const next = this._items.find((r) => r.status === 'queued');
      if (!next) break;
      next.status = 'running';
      next.startedAt = new Date().toISOString();
      this._running += 1;
      this._emit('tick', {});
      this._process(next);
    }
  }

  _maybeDone() {
    if (this._done) return;
    for (const r of this._items) {
      if (r.status === 'queued' || r.status === 'running') return;
    }
    this._done = true;
    this._emit('done', {});
  }

  async _process(rec) {
    rec.attempts = 1;
    const maxAttempts = this.maxRetries + 1;
    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        rec.attempts = attempt;
        if (this._cancelled) {
          rec.status = 'cancelled';
          rec.error = 'cancelled';
          break;
        }
        let result = null;
        try {
          result = this.worker
            ? await this.worker(rec.item, { attempt })
            : { ok: false, error: 'no_worker' };
        } catch (err) {
          result = { ok: false, error: err && err.message ? err.message : String(err) };
        }
        if (result && result.skipped) {
          rec.status = 'skipped';
          rec.error = result.error || 'skipped';
          break;
        }
        if (result && result.ok === false) {
          rec.error = result.error || 'download failed';
          if (attempt < maxAttempts && !this._cancelled) {
            await delay(this._backoffFor(attempt));
            continue;
          }
          rec.status = 'failed';
          break;
        }
        rec.status = 'completed';
        rec.error = null;
        break;
      }
    } finally {
      rec.finishedAt = new Date().toISOString();
      this._running = Math.max(0, this._running - 1);
      this._emit('progress', { id: rec.id, status: rec.status });
      this._notifyWatchers();
      this._emit('tick', {});
      this._start();
      this._maybeDone();
    }
  }

  _backoffFor(attempt) {
    return Math.min(this.backoffMaxMs, this.backoffBaseMs * Math.pow(2, attempt - 1));
  }

  /**
   * Add an item with an explicit id (service-worker persistence path).
   * @param {string} id
   * @param {*} item
   * @returns {DownloadQueue} this
   */
  add(id, item) {
    const key = String(id);
    if (this._index.has(key)) return this;
    const rec = {
      id: key,
      item,
      status: 'queued',
      attempts: 0,
      error: null,
      startedAt: null,
      finishedAt: null,
    };
    this._items.push(rec);
    this._index.set(key, rec);
    this._emit('added', { id: key });
    return this;
  }

  /**
   * Add a single item with an auto-generated id and resolve when it settles.
   * @param {*} item
   * @returns {Promise<object>} batch summary
   */
  addOne(item) {
    const id = this._nextId();
    this.add(id, item);
    this._start();
    return this._watchBatch([id]);
  }

  /**
   * Add many items and resolve when they all settle.
   * @param {Array<*>} items
   * @returns {Promise<object>} batch summary
   */
  addMany(items) {
    const ids = [];
    for (const it of Array.isArray(items) ? items : []) {
      const id = this._nextId();
      this.add(id, it);
      ids.push(id);
    }
    this._start();
    return this._watchBatch(ids);
  }

  /** Start processing queued items (idempotent). */
  start() {
    this._start();
    return this;
  }

  /** Pause: running items finish, queued items wait. */
  pause() {
    this._paused = true;
    this._emit('paused', {});
    return this;
  }

  /** Resume processing queued items. */
  resume() {
    this._paused = false;
    this._emit('resumed', {});
    this._start();
    return this;
  }

  /** Cancel: queued items are marked cancelled; running items finish. */
  cancel() {
    this._cancelled = true;
    for (const r of this._items) {
      if (r.status === 'queued') {
        r.status = 'cancelled';
        r.error = 'cancelled';
        r.finishedAt = new Date().toISOString();
      }
    }
    this._emit('cancelled', {});
    this._notifyWatchers();
    this._maybeDone();
    return this;
  }

  /** Requeue failed/cancelled items by id (or all if ids omitted). */
  retry(ids) {
    const wanted = ids && ids.length ? new Set(ids) : null;
    for (const r of this._items) {
      if ((r.status === 'failed' || r.status === 'cancelled' || r.status === 'skipped') &&
          (!wanted || wanted.has(r.id))) {
        r.status = 'queued';
        r.error = null;
        r.attempts = 0;
        r.startedAt = null;
        r.finishedAt = null;
      }
    }
    this._done = false;
    this._cancelled = false;
    this._emit('retried', { ids: wanted ? Array.from(wanted) : [] });
    this._start();
    return this;
  }

  /** Duplicate guard hook — queue itself never duplicates downloads. */
  checkDuplicate(url) {
    return false;
  }

  /**
   * Snapshot of the queue state (for persistence and restart recovery).
   * @returns {object} {total, queued, running, completed, failed, skipped,
   *   cancelled, paused, entries}
   */
  snapshot() {
    let completed = 0;
    let failed = 0;
    let skipped = 0;
    let cancelled = 0;
    let queued = 0;
    let running = 0;
    for (const r of this._items) {
      if (r.status === 'completed') completed += 1;
      else if (r.status === 'failed') failed += 1;
      else if (r.status === 'skipped') skipped += 1;
      else if (r.status === 'cancelled') cancelled += 1;
      else if (r.status === 'running') running += 1;
      else queued += 1;
    }
    return {
      total: this._items.length,
      queued,
      running,
      completed,
      failed,
      skipped,
      cancelled,
      paused: this._paused,
      entries: this._items.map((r) => ({
        id: r.id,
        item: r.item,
        status: r.status,
        attempts: r.attempts,
        error: r.error,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      })),
    };
  }

  /** Alias of snapshot for callers that prefer stats(). */
  stats() {
    return this.snapshot();
  }

  /** Live item records (with .item payloads). */
  items() {
    return this._items.slice();
  }

  isDone() {
    return this._done;
  }

  /**
   * Subscribe to queue events. Listener receives (event, snapshot).
   * Events: added, tick, progress, paused, resumed, cancelled, retried, done.
   * @param {Function} listener
   * @returns {Function} unsubscribe
   */
  on(listener) {
    if (typeof listener !== 'function') return function () {};
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }
}

export {
  DownloadQueue,
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_RETRIES,
};

const PinVaultQueue = {
  DownloadQueue,
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_RETRIES,
};

export default PinVaultQueue;

if (typeof globalThis !== 'undefined') {
  globalThis.PinVaultQueue = PinVaultQueue;
}
