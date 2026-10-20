'use strict';
import path from 'node:path';
import * as Filename from '../lib/filename-utils.js';

export default {
  'sanitizes illegal filesystem characters': () => {
    const out = Filename.sanitize('a/b\\c:d*e?f"g<h>i|j');
    assert.ok(!/[\\/:*?"<>|]/.test(out), 'illegal chars remain: ' + out);
    assert.strictEqual(out, 'a-b-c-d-e-f-g-h-i-j');
  },

  'removes control characters and trims': () => {
    const out = Filename.sanitize('\u0000\u0001hello\u001f world \n');
    assert.ok(!/[\u0000-\u001f]/.test(out));
    assert.strictEqual(out.trim(), 'hello world');
  },

  'collapses whitespace runs': () => {
    assert.strictEqual(Filename.sanitize('a   b\t\tc'), 'a b c');
  },

  'caps length with extension preserved': () => {
    const long = 'x'.repeat(300) + '.jpg';
    const out = Filename.sanitize(long, { maxLength: 120 });
    assert.ok(out.length <= 120);
    assert.ok(out.endsWith('.jpg'));
  },

  'prevents path traversal': () => {
    assert.throws(() => Filename.assertSafeName('..'), '.. should be rejected');
    assert.throws(() => Filename.assertSafeName('a/../../b'), 'traversal should be rejected');
    assert.throws(() => Filename.assertSafeName('..\\..\\secret'), 'backslash traversal rejected');
  },

  'safe names pass assertSafeName': () => {
    Filename.assertSafeName('my-pin-title-001.jpg');
    Filename.assertSafeName('board_pin123.webp');
  },

  'reserved windows names are sanitized': () => {
    const out = Filename.sanitize('CON.txt');
    assert.ok(!/^CON$/i.test(path.basename(out, path.extname(out))));
    assert.ok(!/^(CON|PRN|AUX|NUL|COM1|LPT1)$/i.test(path.basename(out, path.extname(out))));
  },

  'renderTemplate replaces all placeholders': () => {
    const ctx = {
      pin_id: '12345',
      title: 'My Awesome Pin',
      board: 'design board',
      date: '2026-10-19',
      index: 7,
      ext: 'jpg',
    };
    const out = Filename.renderTemplate('{title}-{index}.{ext}', ctx);
    assert.strictEqual(out, 'My Awesome Pin-7.jpg');
  },

  'renderTemplate sanitizes dynamic parts': () => {
    const ctx = { pin_id: '1', title: 'bad/name:with*chars', board: 'b', date: 'd', index: 1, ext: 'jpg' };
    const out = Filename.renderTemplate('{title}', ctx);
    assert.ok(!/[\\/:*?"<>|]/.test(out));
  },

  'renderTemplate handles missing parts as empty or fallback': () => {
    const out = Filename.renderTemplate('{missing}-{index}', { index: 2 });
    assert.strictEqual(out, '-2');
  },

  'buildFilename respects folder option': () => {
    const rec = { pin_id: '99', title: 'Cool', board: 'Board Name' };
    const plain = Filename.buildFilename(rec, { pattern: '{title}-{index}.{ext}', index: 1, ext: 'jpg' });
    assert.strictEqual(plain.filename, 'Cool-1.jpg');
    const withFolder = Filename.buildFilename(rec, {
      pattern: '{title}-{index}.{ext}', index: 1, ext: 'jpg', boardFolderEnabled: true,
    });
    assert.ok(withFolder.subdir.includes('Board-Name') || withFolder.subdir.includes('Board Name'));
  },

  'buildFilename uses safe board subdir': () => {
    const rec = { pin_id: '1', title: 't', board: 'a/b*c' };
    const out = Filename.buildFilename(rec, {
      pattern: '{board}_{pin_id}.{ext}', index: 0, ext: 'png', boardFolderEnabled: true,
    });
    assert.ok(!/[\\/:*?"<>|]/.test(out.subdir));
  },

  'default pattern yields pinterest-title-001 style names': () => {
    const rec = { pin_id: '8456', title: 'Modern Kitchen Design', board: 'b' };
    const out = Filename.buildFilename(rec, { pattern: 'pinterest-{title}-{index}.{ext}', index: 1, ext: 'jpg' });
    assert.strictEqual(out.filename, 'pinterest-Modern-Kitchen-Design-1.jpg');
  },

  'date formatting uses zero padded components': () => {
    const dt = new Date(2026, 9, 19); // Oct 19 2026
    assert.strictEqual(Filename.formatDate(dt), '2026-10-19');
  },
};
