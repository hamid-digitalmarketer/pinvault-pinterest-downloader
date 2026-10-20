/**
 * url-utils.js — URL validation, Pinterest URL parsing, media URL normalization.
 * Dependency-free shared module, unit-testable in Node and usable in MV3 contexts.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof globalThis !== 'undefined') {
    globalThis.PinVaultUrlUtils = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
  const PIN_IMG_HOST_PATTERNS = [
    /(^|\.)pinimg\.com$/i,
    /(^|\.)pinimg\.com\.cn$/i,
  ];
  const DIRECT_MEDIA_EXT = /\.(jpe?g|png|webp|gif|avif|bmp|mp4|webm|m4v|mov)(?:$|[?#])/i;
  const VIDEO_EXT = /\.(mp4|m3u8|webm)(?:$|[?#])/i;

  function isAllowedProtocol(url) {
    try {
      const u = new URL(url);
      return ALLOWED_PROTOCOLS.has(u.protocol);
    } catch (_err) {
      return false;
    }
  }

  /**
   * Validate that a string is a syntactically valid HTTP(S) URL.
   * @param {string} url
   * @returns {boolean}
   */
  function isValidHttpUrl(url) {
    if (typeof url !== 'string' || url.length === 0 || url.length > 4096) {
      return false;
    }
    try {
      const u = new URL(url);
      if (!ALLOWED_PROTOCOLS.has(u.protocol)) return false;
      if (u.hostname.length < 1) return false;
      return true;
    } catch (_err) {
      return false;
    }
  }

  /**
   * Validate that a URL is a Pinterest page URL (pin, board, or profile page).
   * Allows pinterest.com, pin.it, and pinterest subdomains; rejects lookalikes
   * such as evil-pinterest.com and any non-http scheme.
   * @param {string} url
   * @returns {boolean}
   */
  function isValidPinUrl(url) {
    if (!isValidHttpUrl(url)) return false;
    try {
      const host = new URL(url).hostname.toLowerCase();
      return host === 'pinterest.com' ||
        host === 'pin.it' ||
        host.endsWith('.pinterest.com');
    } catch (_err) {
      return false;
    }
  }

  /**
   * Validate that a URL is on a Pinterest-owned domain.
   * @param {string} url
   * @returns {boolean}
   */
  function isPinterestUrl(url) {
    if (!isValidHttpUrl(url)) return false;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      return host === 'pinterest.com' ||
        host === 'pin.it' ||
        host === 'pinimg.com' ||
        host.endsWith('.pinterest.com') ||
        host.endsWith('.pinimg.com') ||
        host.endsWith('.pinimg.com.cn');
    } catch (_err) {
      return false;
    }
  }

  /**
   * Check whether a media URL is served from Pinterest's CDN (pinimg).
   * @param {string} url
   * @returns {boolean}
   */
  function isPinimgUrl(url) {
    if (!isValidHttpUrl(url)) return false;
    try {
      const host = new URL(url).hostname.toLowerCase();
      return PIN_IMG_HOST_PATTERNS.some((re) => re.test(host));
    } catch (_err) {
      return false;
    }
  }

  /**
   * Check whether a URL points directly at a downloadable media file
   * (image or video extension). Only http(s) URLs are accepted.
   * @param {string} url
   * @returns {boolean}
   */
  function isDirectMediaUrl(url) {
    if (!isValidHttpUrl(url)) return false;
    try {
      const path = new URL(url).pathname;
      if (!DIRECT_MEDIA_EXT.test(path)) return false;
      return true;
    } catch (_err) {
      return false;
    }
  }

  /**
   * Check whether a URL points at a video resource (mp4, m3u8, webm).
   * @param {string} url
   * @returns {boolean}
   */
  function isVideoUrl(url) {
    if (!isValidHttpUrl(url)) return false;
    try {
      return VIDEO_EXT.test(new URL(url).pathname);
    } catch (_err) {
      return false;
    }
  }

  /**
   * Resolve a possibly-relative URL against a base and ensure the result is
   * an absolute http(s) URL (no data:, file:, javascript:, protocol-relative).
   * @param {string} url
   * @returns {string|null} safe absolute URL or null.
   */
  function safeAbsoluteUrl(url) {
    if (typeof url !== 'string' || url.length === 0 || url.length > 4096) return null;
    if (/^\s*\/\//.test(url)) return null; // protocol-relative URL
    try {
      const u = new URL(url);
      if (!ALLOWED_PROTOCOLS.has(u.protocol)) return null;
      return u.toString();
    } catch (_err) {
      return null;
    }
  }

  /**
   * Extract a Pinterest pin id from various Pinterest URL shapes.
   * Supported shapes:
   *   https://www.pinterest.com/pin/123456789012345678/
   *   https://www.pinterest.com/pin/123456789012345678/some-description/
   *   https://www.pinterest.com/board/pin/123456789012345678/
   * Short links (pin.it) expose no id until resolved, so '' is returned.
   * @param {string} url
   * @returns {string} numeric pin id, or '' if not identifiable.
   */
  function extractPinId(url) {
    if (typeof url !== 'string') return '';
    try {
      const u = new URL(url);
      if (!ALLOWED_PROTOCOLS.has(u.protocol)) return '';
      const host = u.hostname.toLowerCase();
      if (host === 'pin.it') return ''; // short link has no visible id
      const m = u.pathname.match(/\/(?:pin)\/(\d{1,20})(?:\/|$)/i);
      if (m) return m[1];
      const qm = u.searchParams.get('pin_id');
      if (qm && /^\d{1,20}$/.test(qm)) return qm;
      return '';
    } catch (_err) {
      return '';
    }
  }

  /**
   * Normalize a Pinterest page URL to a canonical pin URL for duplicate detection.
   * @param {string} url
   * @returns {string|null}
   */
  function normalizePinUrl(url) {
    if (!isValidHttpUrl(url)) return null;
    try {
      const u = new URL(url);
      u.hash = '';
      u.search = '';
      u.pathname = u.pathname.replace(/\/+$/, '');
      return u.toString().replace(/\/$/, '');
    } catch (_err) {
      return null;
    }
  }

  /**
   * Normalize a media URL for duplicate detection.
   * Strips CDN resizing/token parameters that do not identify the source image.
   * @param {string} url
   * @returns {string|null} canonical media key.
   */
  function normalizeMediaUrl(url) {
    if (!isValidHttpUrl(url)) return null;
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      if (PIN_IMG_HOST_PATTERNS.some((re) => re.test(host))) {
        let path = u.pathname;
        const sizeSegment = /\/(?:\d{2,4}x\d{2,4}|originals|enlarged|closeup|400x400|75x75|100x100|200x200|280x280|345x345|600x315|735x1102|736x|1200x630)\//i;
        path = path.replace(sizeSegment, '/');
        return 'pinimg:' + host + path.toLowerCase();
      }
      u.hash = '';
      u.search = '';
      return u.origin + u.pathname.toLowerCase();
    } catch (_err) {
      return null;
    }
  }

  /**
   * Build an absolute URL from a possibly-relative src with a base.
   * @param {string} src
   * @param {string} base
   * @returns {string|null}
   */
  function absolutize(src, base) {
    if (typeof src !== 'string') return null;
    try {
      const u = new URL(src, base);
      return ALLOWED_PROTOCOLS.has(u.protocol) ? u.toString() : null;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Pick the largest accessible image URL variant by explicit dimensions,
   * then by parsing pinimg size tokens. Variants that require authentication
   * (requiresAuth === true) are excluded so users never get a dead originals
   * URL behind a login wall.
   * @param {Array<{url: string, width?: number, height?: number, requiresAuth?: boolean}>} variants
   * @returns {string|null}
   */
  function pickHighestResolution(variants) {
    if (!Array.isArray(variants) || variants.length === 0) return null;
    let best = null;
    for (const v of variants) {
      if (!v || typeof v.url !== 'string') continue;
      if (v.requiresAuth === true) continue;
      const dims = { width: 0, height: 0 };
      if (typeof v.width === 'number' && Number.isFinite(v.width)) dims.width = v.width;
      if (typeof v.height === 'number' && Number.isFinite(v.height)) dims.height = v.height;
      if (!dims.width || !dims.height) {
        try {
          const m = new URL(v.url).pathname.match(/\/(\d{2,4})x(\d{2,4})\//);
          if (m) {
            dims.width = parseInt(m[1], 10);
            dims.height = parseInt(m[2], 10);
          }
        } catch (_err) { /* ignore */ }
      }
      const area = dims.width * dims.height;
      const hasOriginals = /\/originals\//i.test(v.url);
      const score = hasOriginals ? Number.MAX_SAFE_INTEGER : area;
      if (score > 0 && (!best || score > best.score)) {
        best = { url: v.url, score, width: dims.width, height: dims.height };
      }
    }
    return best ? best.url : null;
  }

  return {
    isAllowedProtocol,
    isValidHttpUrl,
    isValidPinUrl,
    isPinterestUrl,
    isPinimgUrl,
    isDirectMediaUrl,
    isVideoUrl,
    safeAbsoluteUrl,
    extractPinId,
    normalizePinUrl,
    normalizeMediaUrl,
    absolutize,
    pickHighestResolution,
  };
});
