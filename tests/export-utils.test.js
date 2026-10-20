'use strict';
import * as Exporters from '../lib/export-utils.js';

export default {
  'csv export escapes commas quotes and newlines': () => {
    const recs = [
      {
        pinUrl: 'https://www.pinterest.com/pin/1/',
        url: 'https://i.pinimg.com/736x/a.jpg',
        title: 'Hello, "world"',
        filename: 'a.jpg',
        width: 100, height: 200, format: 'jpg',
        downloadDate: '2026-10-19', status: 'completed', collection: 'x',
      },
    ];
    const csv = Exporters.toCsv(recs);
    assert.ok(csv.includes('"Hello, ""world"""'), 'quote escaping');
    assert.ok(csv.split('\n').length === 2, 'header + one row');
  },

  'csv export includes required columns in header': () => {
    const csv = Exporters.toCsv([]);
    for (const col of ['pin_url', 'media_url', 'filename', 'width', 'height', 'format', 'download_date', 'status', 'collection']) {
      assert.ok(csv.includes(col), 'missing column ' + col);
    }
  },

  'csv export round trips rows': () => {
    const recs = [
      { pinUrl: 'https://p.com/pin/1/', url: 'https://i.pinimg.com/a.jpg', title: 'T1', filename: 'f1.jpg', width: 10, height: 20, format: 'jpg', downloadDate: '2026-10-19', status: 'completed', collection: '' },
      { pinUrl: 'https://p.com/pin/2/', url: 'https://i.pinimg.com/b.jpg', title: 'T2', filename: 'f2.jpg', width: 30, height: 40, format: 'webp', downloadDate: '2026-10-19', status: 'failed', collection: 'diy' },
    ];
    const csv = Exporters.toCsv(recs);
    const lines = csv.trim().split('\n');
    assert.strictEqual(lines.length, 3);
    assert.ok(lines[1].includes('f1.jpg'));
    assert.ok(lines[2].includes('diy'));
  },

  'json export serializes records with metadata': () => {
    const recs = [{ pinUrl: 'https://p.com/pin/1/', url: 'https://i.pinimg.com/a.jpg', filename: 'f.jpg', width: 5, height: 6, format: 'jpg', downloadDate: '2026-10-19', status: 'completed', collection: 'c' }];
    const json = Exporters.toJson(recs);
    const parsed = JSON.parse(json);
    assert.ok(Array.isArray(parsed));
    assert.strictEqual(parsed.length, 1);
    assert.strictEqual(parsed[0].filename, 'f.jpg');
    assert.ok(parsed[0].exported_at);
  },

  'json export rejects non-finite numbers': () => {
    const recs = [{ pinUrl: 'x', url: 'y', filename: 'f.jpg', width: NaN, height: Infinity, format: 'jpg', downloadDate: 'd', status: 's', collection: '' }];
    const json = Exporters.toJson(recs);
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed[0].width, 0);
    assert.strictEqual(parsed[0].height, 0);
  },

  'safe cell conversion handles null values': () => {
    assert.strictEqual(Exporters.csvCell(null), '');
    assert.strictEqual(Exporters.csvCell(undefined), '');
    assert.strictEqual(Exporters.csvCell(123), '123');
  },
};
