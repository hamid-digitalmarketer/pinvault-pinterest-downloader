'use strict';
const path = require('path');
const Url = require(path.join(__dirname, '..', 'lib', 'url-utils.js'));

module.exports = {
  'accepts https pin URL': () => {
    assert.ok(Url.isValidPinUrl('https://www.pinterest.com/pin/123456789012345678/'));
  },

  'accepts pin.it short link': () => {
    assert.ok(Url.isValidPinUrl('https://pin.it/abc123'));
  },

  'accepts http variants and subdomains': () => {
    assert.ok(Url.isValidPinUrl('http://pinterest.com/pin/1/'));
    assert.ok(Url.isValidPinUrl('https://uk.pinterest.com/pin/2/'));
  },

  'rejects non-pinterest domains': () => {
    assert.ok(!Url.isValidPinUrl('https://example.com/pin/1/'));
    assert.ok(!Url.isValidPinUrl('https://evil-pinterest.com/pin/1/'));
  },

  'rejects non-http schemes and garbage': () => {
    assert.ok(!Url.isValidPinUrl('ftp://pinterest.com/x'));
    assert.ok(!Url.isValidPinUrl('javascript:alert(1)'));
    assert.ok(!Url.isValidPinUrl(''));
    assert.ok(!Url.isValidPinUrl('pinterest.com/pin/1'));
  },

  'extracts pin id from canonical path': () => {
    assert.strictEqual(Url.extractPinId('https://www.pinterest.com/pin/8456231789512304567/'), '8456231789512304567');
  },

  'extracts pin id from query and short links': () => {
    assert.strictEqual(Url.extractPinId('https://www.pinterest.com/pin/123/?foo=bar'), '123');
    assert.strictEqual(Url.extractPinId('https://pin.it/abc123xyz'), '');
  },

  'normalizes pinimg URL by stripping query and path suffixes': () => {
    const a = 'https://i.pinimg.com/736x/ab/cd/ef/abc.jpg?v=2';
    const b = 'https://i.pinimg.com/736x/ab/cd/ef/abc.jpg';
    assert.strictEqual(Url.normalizeMediaUrl(a), Url.normalizeMediaUrl(b));
  },

  'normalizeMediaUrl keeps pinimg identity across sizes': () => {
    const a = Url.normalizeMediaUrl('https://i.pinimg.com/736x/ab/cd/ef/abc.jpg');
    const b = Url.normalizeMediaUrl('https://i.pinimg.com/originals/ab/cd/ef/abc.jpg');
    assert.strictEqual(a, b, 'size bucket should be ignored');
  },

  'normalizeMediaUrl differentiates different hashes': () => {
    const a = Url.normalizeMediaUrl('https://i.pinimg.com/736x/ab/cd/ef/abc.jpg');
    const b = Url.normalizeMediaUrl('https://i.pinimg.com/736x/ab/cd/ef/xyz.jpg');
    assert.notStrictEqual(a, b);
  },

  'normalizeMediaUrl strips default ports and lowercases': () => {
    const a = Url.normalizeMediaUrl('https://i.pinimg.com:443/736x/AB/CD/EF/abc.JPG');
    const b = Url.normalizeMediaUrl('https://i.pinimg.com/736x/ab/cd/ef/abc.jpg');
    assert.strictEqual(a, b);
  },

  'isPinimgUrl detects CDN hosts only': () => {
    assert.ok(Url.isPinimgUrl('https://i.pinimg.com/736x/a/b/c.jpg'));
    assert.ok(Url.isPinimgUrl('https://s.pinimg.com/abc.png'));
    assert.ok(!Url.isPinimgUrl('https://example.com/i.jpg'));
    assert.ok(!Url.isPinimgUrl('https://www.pinterest.com/x'));
  },

  'isDirectMediaUrl accepts image and video extensions': () => {
    assert.ok(Url.isDirectMediaUrl('https://x.com/a.jpg'));
    assert.ok(Url.isDirectMediaUrl('https://x.com/a.webp?q=1'));
    assert.ok(Url.isDirectMediaUrl('https://x.com/a.mp4'));
    assert.ok(Url.isDirectMediaUrl('https://x.com/a.mov'));
    assert.ok(!Url.isDirectMediaUrl('https://x.com/a.html'));
    assert.ok(!Url.isDirectMediaUrl('https://x.com/a'));
    assert.ok(!Url.isDirectMediaUrl('javascript:alert(1)'));
  },

  'isVideoUrl distinguishes video from image': () => {
    assert.ok(Url.isVideoUrl('https://x.com/v.mp4'));
    assert.ok(Url.isVideoUrl('https://x.com/v.m3u8'));
    assert.ok(Url.isVideoUrl('https://x.com/v.webm'));
    assert.ok(!Url.isVideoUrl('https://x.com/v.jpg'));
  },

  'pickHighestResolution returns the widest accessible variant': () => {
    const variants = [
      { url: 'u736', width: 736, height: 920 },
      { url: 'u474', width: 474, height: 593 },
      { url: 'u1200', width: 1200, height: 1500 },
    ];
    const best = Url.pickHighestResolution(variants);
    assert.strictEqual(best, 'u1200');
  },

  'pickHighestResolution prefers accessible (no login wall hint)': () => {
    const variants = [
      { url: 'https://i.pinimg.com/originals/a/b/c.jpg', width: 2000, height: 2000, requiresAuth: true },
      { url: 'https://i.pinimg.com/736x/a/b/c.jpg', width: 736, height: 736, requiresAuth: false },
    ];
    assert.strictEqual(Url.pickHighestResolution(variants), 'https://i.pinimg.com/736x/a/b/c.jpg');
  },

  'pickHighestResolution tolerates empty list': () => {
    assert.strictEqual(Url.pickHighestResolution([]), null);
  },

  'safeAbsoluteUrl prevents scheme tricks': () => {
    assert.ok(!Url.safeAbsoluteUrl('data:text/html,<script>alert(1)</script>'));
    assert.ok(!Url.safeAbsoluteUrl('file:///etc/passwd'));
    assert.ok(!Url.safeAbsoluteUrl('//example.com/x.png'));
    assert.strictEqual(Url.safeAbsoluteUrl('https://i.pinimg.com/a.png'), 'https://i.pinimg.com/a.png');
  },
};
