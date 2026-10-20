'use strict';
const path = require('path');
const Queue = require(path.join(__dirname, '..', 'lib', 'queue.js'));

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function makeWorker(run) {
  // run(task, signal) -> Promise
  return async (task) => {
    if (run === 'fail-first') {
      if (task.n === 0) throw new Error('boom0');
    }
    if (run === 'always-fail') throw new Error('always');
    await delay(5);
    return { ok: true, n: task.n };
  };
}

module.exports = {
  'runs all tasks with bounded concurrency': async () => {
    const q = new Queue.DownloadQueue({ concurrency: 2, maxRetries: 0 });
    let active = 0;
    let peak = 0;
    const tasks = [];
    for (let i = 0; i < 8; i++) {
      tasks.push({ url: 'u' + i, n: i });
    }
    q.on('tick', () => {
      const stats = q.stats();
      active = stats.running;
      if (active > peak) peak = active;
    });
    const results = [];
    q.worker = async (t) => {
      await delay(10);
      results.push(t.n);
      return { ok: true };
    };
    const out = await q.addMany(tasks);
    assert.strictEqual(out.completed, 8);
    assert.strictEqual(out.failed, 0);
    assert.ok(peak <= 2, 'peak concurrency should not exceed bound (peak=' + peak + ')');
    assert.strictEqual(results.length, 8);
  },

  'retries transient failures with backoff': async () => {
    const q = new Queue.DownloadQueue({ concurrency: 1, maxRetries: 2, retryBaseDelayMs: 1 });
    let attempts = 0;
    q.worker = async (t) => {
      attempts++;
      if (attempts < 3) throw new Error('transient');
      return { ok: true };
    };
    const out = await q.addOne({ url: 'retry-me' });
    assert.strictEqual(attempts, 3, 'should retry twice after first failure');
    assert.strictEqual(out.completed, 1);
  },

  'gives up after max retries': async () => {
    const q = new Queue.DownloadQueue({ concurrency: 1, maxRetries: 1, retryBaseDelayMs: 1 });
    q.worker = makeWorker('always-fail');
    const out = await q.addOne({ url: 'bad' });
    assert.strictEqual(out.failed, 1);
    assert.ok(out.failures.length >= 1);
  },

  'pause blocks new task starts': async () => {
    const q = new Queue.DownloadQueue({ concurrency: 1, maxRetries: 0 });
    q.worker = async () => { await delay(20); return { ok: true }; };
    const p1 = q.addOne({ url: 'a' });
    q.pause();
    const p2 = q.addOne({ url: 'b' });
    // After p1 finishes, b must not start while paused.
    await p1;
    await delay(30);
    const stats = q.stats();
    assert.strictEqual(stats.running, 0);
    assert.strictEqual(stats.completed, 1);
    q.resume();
    await p2;
    assert.strictEqual(q.stats().completed, 2);
  },

  'cancel drops queued items and marks them cancelled': async () => {
    const q = new Queue.DownloadQueue({ concurrency: 1, maxRetries: 0 });
    q.worker = async () => { await delay(15); return { ok: true }; };
    const p1 = q.addOne({ url: 'a' });
    const p2 = q.addOne({ url: 'b' });
    const p3 = q.addOne({ url: 'c' });
    q.cancel();
    await Promise.all([p1, p2, p3]);
    const s = q.stats();
    assert.strictEqual(s.cancelled, 2, 'b and c cancelled');
    assert.strictEqual(s.completed, 1);
  },

  'snapshot reflects counts': async () => {
    const q = new Queue.DownloadQueue({ concurrency: 2, maxRetries: 0 });
    q.worker = async (t) => { await delay(5); return t.fail ? { ok: false, error: 'x' } : { ok: true }; };
    const out = await q.addMany([
      { url: 'a' }, { url: 'b' }, { url: 'c', fail: true }, { url: 'd' },
    ]);
    const snap = q.snapshot();
    assert.strictEqual(snap.total, 4);
    assert.strictEqual(snap.completed, 3);
    assert.strictEqual(snap.failed, 1);
    assert.strictEqual(snap.queued, 0);
    assert.strictEqual(snap.running, 0);
    assert.ok(!snap.paused);
    assert.strictEqual(out.completed, 3);
  },

  'persisted jobs can be restored by id': async () => {
    const q = new Queue.DownloadQueue({ concurrency: 1, maxRetries: 0 });
    const seen = [];
    q.worker = async (t) => { seen.push(t.url); return { ok: true }; };
    await q.addMany([{ url: 'a' }, { url: 'b' }]);
    assert.deepEqual(seen.sort(), ['a', 'b']);
    const snap = q.snapshot();
    assert.ok(snap.entries.length === 2);
    // Re-adding the same URL after restart should produce a duplicate decision.
    const dupCheck = q.checkDuplicate({ url: 'a' });
    assert.strictEqual(dupCheck, false, 'queue does not itself dedupe (delegated to service worker)');
  },

  'empty batch resolves cleanly': async () => {
    const q = new Queue.DownloadQueue({ concurrency: 2, maxRetries: 0 });
    const out = await q.addMany([]);
    assert.strictEqual(out.completed, 0);
    assert.strictEqual(out.failed, 0);
  },
};
