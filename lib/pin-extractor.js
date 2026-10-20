/**
 * pin-extractor.js — parse Pinterest pin data (JSON payloads, pin page HTML,
 * DOM-like elements) into normalized media records.
 *
 * The module exposes a single `Extractor` namespace with defensive, fixture-
 * driven parsers. It never assumes a single DOM shape; it gathers candidates
 * and picks the highest *accessible* resolution (login-walled variants are
 * skipped). Video detection reports the best directly-accessible mp4 when
 * available; HLS (m3u8) streams are reported with `unsupportedReason:
 * 'hls_segmented'` because Chrome's downloads API cannot save segmented
 * streams, and DRM content is never touched.
 */
'use strict';

import * as urlUtils from './url-utils.js';

function extFromUrl(url) {
  try {
    const m = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : '';
  } catch (_err) {
    return '';
  }
}

function normalizeId(id) {
  if (id === null || id === undefined) return null;
  const s = String(id);
  if (/^\d+$/.test(s)) return s;
  return s;
}

function buildRecord(parts) {
  const url = parts.url || '';
  const type = parts.type || (urlUtils.isVideoUrl(url) ? 'video' : 'image');
  return {
    id: parts.id !== undefined ? parts.id : null,
    title: parts.title || '',
    board: parts.board || '',
    url,
    width: Number(parts.width) || 0,
    height: Number(parts.height) || 0,
    format: parts.format || extFromUrl(url) || 'jpg',
    type,
    pinUrl: parts.pinUrl || (parts.id ? 'https://www.pinterest.com/pin/' + parts.id + '/' : ''),
    sourceUrl: parts.sourceUrl || '',
    unsupportedReason: parts.unsupportedReason || null,
    detectedAt: parts.detectedAt || new Date().toISOString(),
  };
}

/** Pick the best video from a Pinterest video_list. */
function pickBestVideo(videos) {
  const list = Array.isArray(videos) ? videos : [];
  if (list.length === 0) return null;
  let bestMp4 = null;
  let bestM3u8 = null;
  for (const v of list) {
    if (!v || typeof v.url !== 'string') continue;
    const w = Number(v.width) || 0;
    const h = Number(v.height) || 0;
    const area = w * h;
    if (/\.m3u8($|[?#])/i.test(v.url)) {
      if (!bestM3u8 || area > (bestM3u8.area || 0)) {
        bestM3u8 = { url: v.url, width: w, height: h, area, unsupportedReason: 'hls_segmented' };
      }
    } else if (/\.mp4($|[?#])/i.test(v.url) || /v\.pinimg\.com/i.test(v.url)) {
      if (!bestMp4 || area > (bestMp4.area || 0)) {
        bestMp4 = { url: v.url, width: w, height: h, area, unsupportedReason: null };
      }
    }
  }
  return bestMp4 || bestM3u8;
}

/**
 * Extract a media record from a Pinterest pin JSON payload (fixtures are
 * derived from the shapes Pinterest serves in feeds and board previews).
 * @param {object} json
 * @param {object} [opts] {preferVideo: boolean}
 * @returns {object|null} normalized record.
 */
function extractFromPinJson(json, opts) {
  if (!json || typeof json !== 'object') return null;
  const o = opts || {};
  const id = normalizeId(json.id);
  const title = String(json.title || json.description || '').slice(0, 300);
  let board = '';
  if (typeof json.board === 'string') board = json.board;
  else if (json.board && typeof json.board === 'object') board = String(json.board.name || '');

  const video = pickBestVideo(
    json.videos && Array.isArray(json.videos.video_list) ? json.videos.video_list : []
  );
  if (o.preferVideo && video) {
    return buildRecord({
      id,
      title,
      board,
      url: video.url,
      width: video.width,
      height: video.height,
      format: extFromUrl(video.url) || 'mp4',
      type: 'video',
      pinUrl: json.pinUrl || '',
      sourceUrl: json.sourceUrl || json.link || '',
      unsupportedReason: video.unsupportedReason,
    });
  }

  const imageVariants = [];
  if (json.images && typeof json.images === 'object') {
    for (const key of Object.keys(json.images)) {
      const img = json.images[key];
      if (!img || typeof img.url !== 'string') continue;
      imageVariants.push({
        url: img.url,
        width: Number(img.width) || 0,
        height: Number(img.height) || 0,
        requiresAuth: img.requiresAuth === true,
      });
    }
  }
  const bestUrl = urlUtils.pickHighestResolution(imageVariants);
  if (!bestUrl) {
    if (video) {
      return buildRecord({
        id,
        title,
        board,
        url: video.url,
        width: video.width,
        height: video.height,
        format: extFromUrl(video.url) || 'mp4',
        type: 'video',
        pinUrl: json.pinUrl || '',
        sourceUrl: json.sourceUrl || json.link || '',
        unsupportedReason: video.unsupportedReason,
      });
    }
    return null;
  }
  let best = null;
  for (const v of imageVariants) {
    if (v.url === bestUrl) best = v;
  }
  return buildRecord({
    id,
    title,
    board,
    url: bestUrl,
    width: best ? best.width : 0,
    height: best ? best.height : 0,
    format: extFromUrl(bestUrl) || 'jpg',
    type: 'image',
    pinUrl: json.pinUrl || (id ? 'https://www.pinterest.com/pin/' + id + '/' : ''),
    sourceUrl: json.sourceUrl || json.link || '',
  });
}

/** Extract a single meta attribute (property or name) from an HTML string. */
function metaContent(html, attr, value) {
  const re = new RegExp(
    '<meta[^>]+' + attr + '=["\']' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\'][^>]*>',
    'i'
  );
  const tag = html.match(re);
  if (!tag) return '';
  const c = tag[0].match(/content=["']([^"']*)["']/i);
  return c ? c[1] : '';
}

/**
 * Extract media records from a pin page HTML string.
 * Parses OpenGraph meta (og:image), the canonical pin URL, JSON-LD VideoObject
 * blocks, and fallback <img> tags on pinimg. Returns an array of records.
 * @param {string} html
 * @param {string} [pageUrl]
 * @returns {Array<object>}
 */
function extractFromHtml(html, pageUrl) {
  if (typeof html !== 'string' || html.length === 0) return [];
  const records = [];
  const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i);
  let canonicalHref = '';
  if (canonical) {
    const m = canonical[0].match(/href=["']([^"']+)["']/i);
    if (m) canonicalHref = m[1];
  }
  const idUrl = canonicalHref || pageUrl || '';
  const id = idUrl ? urlUtils.extractPinId(idUrl) : null;
  const ogTitle = metaContent(html, 'property', 'og:title') || metaContent(html, 'name', 'twitter:title') || '';
  const ogImage = metaContent(html, 'property', 'og:image');

  if (ogImage && urlUtils.safeAbsoluteUrl(ogImage)) {
    records.push(buildRecord({
      id,
      title: ogTitle,
      board: '',
      url: urlUtils.safeAbsoluteUrl(ogImage),
      width: 0,
      height: 0,
      format: extFromUrl(ogImage) || 'jpg',
      type: 'image',
      pinUrl: canonicalHref || pageUrl || '',
      sourceUrl: '',
    }));
  }

  // JSON-LD video objects.
  const scriptRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let sm;
  while ((sm = scriptRe.exec(html)) !== null) {
    let parsed = null;
    try {
      parsed = JSON.parse(sm[1]);
    } catch (_err) {
      continue;
    }
    const objs = Array.isArray(parsed) ? parsed : [parsed];
    for (const obj of objs) {
      if (!obj || obj['@type'] === 'VideoObject' || (Array.isArray(obj['@type']) && obj['@type'].indexOf('VideoObject') !== -1)) {
        const contentUrl = obj && obj.contentUrl ? String(obj.contentUrl) : '';
        if (contentUrl && urlUtils.safeAbsoluteUrl(contentUrl)) {
          records.push(buildRecord({
            id,
            title: String(obj.name || ogTitle || '').slice(0, 300),
            board: '',
            url: urlUtils.safeAbsoluteUrl(contentUrl),
            width: Number(obj.width) || 0,
            height: Number(obj.height) || 0,
            format: extFromUrl(contentUrl) || 'mp4',
            type: 'video',
            pinUrl: canonicalHref || pageUrl || '',
            sourceUrl: '',
            unsupportedReason: /\.m3u8($|[?#])/i.test(contentUrl) ? 'hls_segmented' : null,
          }));
        }
      }
    }
  }

  // Fallback: any <img> served from pinimg on the page.
  if (records.length === 0) {
    const imgRe = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let im;
    while ((im = imgRe.exec(html)) !== null) {
      const src = im[1];
      if (!urlUtils.isPinimgUrl(src)) continue;
      records.push(buildRecord({
        id,
        title: ogTitle,
        board: '',
        url: src,
        width: 0,
        height: 0,
        format: extFromUrl(src) || 'jpg',
        type: 'image',
        pinUrl: canonicalHref || pageUrl || '',
        sourceUrl: '',
      }));
      break;
    }
  }
  return records;
}

/**
 * Extract a single media record from a DOM-like element (an object exposing
 * querySelector, as real DOM elements do).
 * @param {object} el
 * @returns {object|null}
 */
function extractFromElement(el) {
  if (!el || typeof el.querySelector !== 'function') return null;
  const img = el.querySelector('img') || null;
  const a = el.querySelector('a') || null;
  const src = img && typeof img.src === 'string' ? img.src : '';
  const href = a && typeof a.href === 'string' ? a.href : '';
  if (!src) return null;
  const id = href ? urlUtils.extractPinId(href) : null;
  const width = img && typeof img.naturalWidth === 'number' && Number.isFinite(img.naturalWidth) ? img.naturalWidth : 0;
  const height = img && typeof img.naturalHeight === 'number' && Number.isFinite(img.naturalHeight) ? img.naturalHeight : 0;
  return buildRecord({
    id: id || null,
    title: (img && typeof img.alt === 'string' ? img.alt : '').slice(0, 300),
    board: '',
    url: src,
    width,
    height,
    format: extFromUrl(src) || 'jpg',
    type: urlUtils.isVideoUrl(src) ? 'video' : 'image',
    pinUrl: href || (id ? 'https://www.pinterest.com/pin/' + id + '/' : ''),
    sourceUrl: '',
    unsupportedReason: /\.m3u8($|[?#])/i.test(src) ? 'hls_segmented' : null,
  });
}

/**
 * Alias of extractFromElement for callers that think of the DOM entry point.
 */
function extractFromDom(el) {
  return extractFromElement(el);
}

/**
 * Extract records from any supported source type.
 * @param {object|string} source JSON object, HTML string, or DOM element.
 * @param {object} [opts]
 * @returns {Array<object>|object|null}
 */
function extractMedia(source, opts) {
  if (typeof source === 'string') return extractFromHtml(source, opts && opts.pageUrl);
  if (source && typeof source.querySelector === 'function') return extractFromElement(source);
  if (source && typeof source === 'object') {
    const rec = extractFromPinJson(source, opts);
    return rec ? [rec] : [];
  }
  return [];
}

const Extractor = {
  extractFromPinJson,
  extractFromHtml,
  extractFromDom,
  extractFromElement,
};

export {
  Extractor,
  extractMedia,
  extractFromPinJson,
  extractFromHtml,
  extractFromDom,
  extractFromElement,
  normalizeId,
};

const PinVaultPinExtractor = {
  Extractor,
  extractMedia,
  extractFromPinJson,
  extractFromHtml,
  extractFromDom,
  extractFromElement,
  normalizeId,
};

export default PinVaultPinExtractor;

if (typeof globalThis !== 'undefined') {
  globalThis.PinVaultPinExtractor = PinVaultPinExtractor;
}
