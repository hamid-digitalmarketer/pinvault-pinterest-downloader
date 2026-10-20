'use strict';
import * as Dup from '../lib/duplicate-utils.js';

export default {
  'mediaKey normalizes URL variants of same image': () => {
    const a = Dup.mediaKey({ url: 'https://i.pinimg.com/736x/ab/cd/ef/abc.jpg' });
    const b = Dup.mediaKey({ url: 'https://i.pinimg.com/originals/ab/cd/ef/abc.jpg?v=3' });
    assert.strictEqual(a, b);
  },

  'mediaKey distinguishes different images': () => {
    const a = Dup.mediaKey({ url: 'https://i.pinimg.com/736x/ab/cd/ef/abc.jpg' });
    const b = Dup.mediaKey({ url: 'https://i.pinimg.com/736x/ab/cd/ef/xyz.jpg' });
    assert.notStrictEqual(a, b);
  },

  'pinKey groups by pin id regardless of url': () => {
    const a = Dup.pinKey({ id: '123', url: 'https://i.pinimg.com/736x/a.jpg' });
    const b = Dup.pinKey({ id: '123', url: 'https://i.pinimg.com/originals/a.jpg' });
    assert.strictEqual(a, b);
    const c = Dup.pinKey({ id: '456', url: 'https://i.pinimg.com/736x/a.jpg' });
    assert.notStrictEqual(a, c);
  },

  'pinKey falls back to URL when id missing': () => {
    const a = Dup.pinKey({ url: 'https://i.pinimg.com/736x/a.jpg' });
    assert.ok(a && a.length > 0);
  },

  'DuplicateSet detects exact duplicate via media URL': () => {
    const ds = new Dup.DuplicateSet();
    const r1 = { url: 'https://i.pinimg.com/736x/ab/cd/ef/abc.jpg', width: 100, height: 100 };
    const r2 = { url: 'https://i.pinimg.com/originals/ab/cd/ef/abc.jpg', width: 100, height: 100 };
    assert.strictEqual(ds.check(r1), false);
    assert.strictEqual(ds.check(r2), true);
  },

  'DuplicateSet distinguishes visually similar but different files': () => {
    const ds = new Dup.DuplicateSet();
    ds.check({ url: 'https://i.pinimg.com/736x/a/b/1.jpg', width: 800, height: 800 });
    const similar = { url: 'https://i.pinimg.com/736x/a/b/2.jpg', width: 800, height: 800 };
    assert.strictEqual(ds.check(similar), false, 'exact duplicates only');
  },

  'DuplicateSet treats same pin id as duplicate': () => {
    const ds = new Dup.DuplicateSet();
    ds.check({ id: '42', url: 'https://i.pinimg.com/736x/a.jpg' });
    assert.strictEqual(ds.check({ id: '42', url: 'https://i.pinimg.com/736x/b.jpg' }), true);
  },

  'DuplicateSet handles empty url gracefully': () => {
    const ds = new Dup.DuplicateSet();
    assert.strictEqual(ds.check({ url: '' }), false);
    assert.strictEqual(ds.check({ url: '' }), false, 'empty never marked duplicate');
  },

  'DuplicateSet serializes and restores': () => {
    const ds = new Dup.DuplicateSet();
    ds.check({ id: '1', url: 'https://i.pinimg.com/736x/a.jpg' });
    ds.check({ id: '2', url: 'https://i.pinimg.com/736x/b.jpg' });
    const snapshot = ds.serialize();
    const ds2 = new Dup.DuplicateSet(snapshot);
    assert.strictEqual(ds2.check({ id: '1', url: 'https://i.pinimg.com/736x/c.jpg' }), true);
    assert.strictEqual(ds2.check({ id: '2', url: 'https://i.pinimg.com/736x/d.jpg' }), true);
  },
};
