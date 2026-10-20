'use strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as Extractor from '../lib/pin-extractor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURES = path.join(__dirname, 'fixtures');

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

export default {
  'parses pin JSON fixture into normalized record': () => {
    const json = JSON.parse(readFixture('pin-basic.json'));
    const rec = Extractor.extractFromPinJson(json);
    assert.strictEqual(rec.id, '8456231789512304567');
    assert.strictEqual(rec.title, 'Minimalist Scandinavian Interior Design Ideas');
    assert.strictEqual(rec.board, 'interior-design');
    assert.ok(/originals\//.test(rec.url), 'prefers original size');
    assert.strictEqual(rec.width, 1200);
    assert.strictEqual(rec.height, 1500);
    assert.strictEqual(rec.type, 'image');
  },

  'highest accessible image variant is chosen from json': () => {
    const json = JSON.parse(readFixture('pin-board-feed.json'));
    const rec = Extractor.extractFromPinJson(json);
    assert.ok(/originals\//.test(rec.url), 'original (800px) beats 736x');
  },

  'video pin exposes best video url and marks type video': () => {
    const json = JSON.parse(readFixture('pin-basic.json'));
    const rec = Extractor.extractFromPinJson(json, { preferVideo: true });
    // If video_list present, extractor should surface it.
    assert.strictEqual(rec.type, 'video');
    assert.ok(/\.mp4$/.test(rec.url));
  },

  'image pin without videos stays image': () => {
    const json = JSON.parse(readFixture('pin-square.json'));
    const rec = Extractor.extractFromPinJson(json, { preferVideo: true });
    assert.strictEqual(rec.type, 'image');
    assert.ok(/\.webp$/.test(rec.url));
  },

  'extractFromHtml parses og image and canonical pin id': () => {
    const html = readFixture('pin-page.html');
    const recs = Extractor.extractFromHtml(html, 'https://www.pinterest.com/pin/9012345678901234567/');
    assert.ok(recs.length >= 1, 'at least one record');
    const img = recs.find((r) => r.type === 'image');
    assert.ok(img, 'image record exists');
    assert.strictEqual(img.id, '9012345678901234567');
    assert.ok(/originals\//.test(img.url));
    assert.strictEqual(img.title, '10 Cozy Fall Outfit Ideas');
  },

  'extractFromHtml finds video in JSON-LD': () => {
    const html = readFixture('pin-page.html');
    const recs = Extractor.extractFromHtml(html, 'https://www.pinterest.com/pin/9012345678901234567/');
    const vid = recs.find((r) => r.type === 'video');
    assert.ok(vid, 'video record exists');
    assert.ok(/\.mp4$/.test(vid.url));
  },

  'extractFromHtml handles hostile scripts without crashing': () => {
    const html = '<html><script>const x = "abc"</script><body><img src="https://i.pinimg.com/736x/a/b/c.jpg"></body></html>';
    const recs = Extractor.extractFromHtml(html, 'https://www.pinterest.com/pin/5/');
    assert.ok(Array.isArray(recs));
    assert.ok(recs.length >= 0);
  },

  'extractFromDom handles element with img alt and link': () => {
    // Simulate a DOM-like object (content script environment).
    const el = {
      querySelector: (sel) => {
        if (sel === 'img') return { src: 'https://i.pinimg.com/736x/ab/cd/ef/abc.jpg', alt: 'Nice pin', naturalWidth: 736, naturalHeight: 920 };
        if (sel === 'a') return { href: 'https://www.pinterest.com/pin/777/' };
        return null;
      },
    };
    const rec = Extractor.extractFromElement(el);
    assert.ok(rec);
    assert.strictEqual(rec.id, '777');
    assert.strictEqual(rec.title, 'Nice pin');
  },

  'extractFromElement tolerates missing links': () => {
    const el = {
      querySelector: (sel) => {
        if (sel === 'img') return { src: 'https://i.pinimg.com/736x/a.jpg', alt: '', naturalWidth: 0, naturalHeight: 0 };
        return null;
      },
    };
    const rec = Extractor.extractFromElement(el);
    assert.ok(rec);
    assert.strictEqual(rec.id, null);
    assert.ok(rec.url.length > 0);
  },

  'unsupported m3u8 is surfaced with reason flag': () => {
    const json = JSON.parse(readFixture('pin-basic.json'));
    json.videos.video_list[0].url = 'https://v.pinimg.com/videos/hls/ab/12/345.m3u8';
    const rec = Extractor.extractFromPinJson(json, { preferVideo: true });
    assert.strictEqual(rec.type, 'video');
    assert.ok(/m3u8/i.test(rec.url));
    assert.strictEqual(rec.unsupportedReason, 'hls_segmented');
  },
};
