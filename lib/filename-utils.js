/**
 * filename-utils.js — safe filename sanitization, template rendering, sequence
 * numbering, and path-traversal protection.
 * Dependency-free shared module.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof globalThis !== 'undefined') {
    globalThis.PinVaultFilenameUtils = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;
  const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
  const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
  const TRAILING_DOTS = /[. ]+$/g;

  const MAX_FILENAME_LENGTH = 150; // keep well under common 255-byte limits (UTF-8 aware)
  const MAX_TITLE_LENGTH = 80;

  /**
   * Sanitize a filename segment (no slashes, no reserved names, no traversal).
   * @param {string} name
   * @param {object} [opts]
   * @returns {string}
   */
  function sanitizeSegment(name, opts) {
    const o = opts || {};
    if (typeof name !== 'string') return o.fallback || '';
    let s = name.trim();
    s = s.replace(INVALID_CHARS, '_');
    s = s.replace(CONTROL_CHARS, '');
    s = s.replace(TRAILING_DOTS, '');
    s = s.replace(/\.\./g, '_');
    if (RESERVED_NAMES.test(s)) s = '_' + s;
    if (s === '' || s === '.') s = o.fallback || '_';
    const max = typeof o.max === 'number' ? o.max : MAX_TITLE_LENGTH;
    if (s.length > max) s = s.slice(0, max).replace(/[. ]+$/, '');
    return s;
  }

  /**
   * Sanitize a full filename (name + extension).
   * @param {string} filename
   * @returns {string}
   */
  function sanitizeFilename(filename) {
    if (typeof filename !== 'string') return 'download.jpg';
    let name = filename.trim();
    const dotIdx = name.lastIndexOf('.');
    let ext = '';
    let base = name;
    if (dotIdx > 0 && dotIdx < name.length - 1) {
      base = name.slice(0, dotIdx);
      ext = name.slice(dotIdx + 1);
    }
    const safeBase = sanitizeSegment(base, { fallback: 'pin', max: MAX_FILENAME_LENGTH });
    let safeExt = ext.replace(INVALID_CHARS, '').replace(CONTROL_CHARS, '').toLowerCase().slice(0, 10);
    if (safeExt === '') safeExt = 'jpg';
    const result = `${safeBase}.${safeExt}`;
    if (result.length > MAX_FILENAME_LENGTH) {
      return `${result.slice(0, MAX_FILENAME_LENGTH - safeExt.length - 1).replace(/[. ]+$/, '')}.${safeExt}`;
    }
    return result;
  }

  /**
   * Sanitize any user- or page-derived string for use as a filename.
   * Illegal filesystem characters become '-', control characters are removed,
   * whitespace runs collapse to a single space, and length is capped while the
   * extension (if any) is preserved.
   * @param {string} name
   * @param {object} [opts] {maxLength, fallback}
   * @returns {string}
   */
  function sanitize(name, opts) {
    const o = opts || {};
    if (typeof name !== 'string') return o.fallback || '';
    let s = String(name);
    // Collapse whitespace runs (including tabs/newlines) to a single space
    // BEFORE removing control characters, so tabs inside a word become spaces.
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(/[\u0000-\u001F\u007F]/g, '');       // remaining control characters
    s = s.replace(/[<>:"/\\|?*]/g, '-');               // illegal filesystem characters
    s = s.replace(TRAILING_DOTS, '');
    // Reserved Windows names: prefix the leading token so 'CON.txt' is safe.
    const leading = s.split('.')[0] || s;
    if (RESERVED_NAMES.test(leading)) s = '_' + s;
    if (s === '' || s === '.') s = o.fallback || 'pin';
    const maxLength = typeof o.maxLength === 'number' ? o.maxLength : MAX_FILENAME_LENGTH;
    if (s.length > maxLength) {
      const dotIdx = s.lastIndexOf('.');
      if (dotIdx > 0) {
        const ext = s.slice(dotIdx);
        const keep = Math.max(1, maxLength - ext.length);
        s = s.slice(0, keep).replace(/[. ]+$/, '') + ext;
      } else {
        s = s.slice(0, maxLength).replace(/[. ]+$/, '');
      }
    }
    return s;
  }

  /**
   * Assert a filename is safe to use: no path traversal, no empty or reserved
   * names. Throws an Error otherwise.
   * @param {string} name
   */
  function assertSafeName(name) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('unsafe filename: empty');
    }
    if (name === '..' || name === '.') {
      throw new Error('unsafe filename: dot segment');
    }
    if (/(^|[\\/])\.\.([\\/]|$)/.test(name) || name.includes('../') || name.includes('..\\')) {
      throw new Error('unsafe filename: path traversal');
    }
    if (/[<>:"|?*]/.test(name)) {
      throw new Error('unsafe filename: illegal characters');
    }
  }

  /**
   * Format a date as yyyy-mm-dd (no locale dependency).
   * @param {Date|string|number} date
   * @returns {string}
   */
  function formatDate(date) {
    const dt = date instanceof Date ? date : new Date(date);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * Render a filename template.
   * Supported placeholders:
   *   {pin_id}  {title}  {board}  {date}  {index}  {ext}
   * Dynamic values are sanitized; unknown placeholders render as empty strings.
   * @param {string} template
   * @param {object} data
   * @returns {string} rendered filename.
   */
  function renderTemplate(template, data) {
    const d = data || {};
    const index = typeof d.index === 'number' ? d.index : 1;
    const ext = sanitizeSegment(String(d.ext || 'jpg'), { max: 10 }) || 'jpg';
    const tokens = {
      pin_id: sanitizeSegment(String(d.pin_id !== undefined ? d.pin_id : (d.pinId || '')), { fallback: 'unknown' }),
      title: sanitizeSegment(String(d.title || ''), { fallback: 'pin' }),
      board: sanitizeSegment(String(d.board || ''), { fallback: 'board' }),
      date: d.date || formatDate(new Date()),
      index: String(index),
    };
    let out = String(template || '');
    out = out.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, tok) => {
      if (tok === 'ext') return ext;
      return Object.prototype.hasOwnProperty.call(tokens, tok) ? tokens[tok] : '';
    });
    return out;
  }

  /**
   * Build a complete download filename plus optional subdirectory from a media
   * record and settings.
   * @param {object} rec {pin_id|id, title, board, format, url}
   * @param {object} opts {pattern, index, ext, date, boardFolderEnabled}
   * @returns {{filename: string, subdir: string}}
   */
  function buildFilename(rec, opts) {
    const o = opts || {};
    const data = rec || {};
    const pattern = o.pattern || '{title}-{index}.{ext}';
    const index = typeof o.index === 'number' ? o.index : 1;
    const ext = sanitizeSegment(String(o.ext || data.format || 'jpg'), { max: 10 }) || 'jpg';
    const rendered = renderTemplate(pattern, {
      pin_id: data.pin_id !== undefined ? data.pin_id : (data.id || ''),
      title: data.title || '',
      board: data.board || '',
      date: o.date || formatDate(new Date()),
      index,
      ext,
    });
    // Kebab-case the rendered filename (spaces become hyphens) so multi-word
    // titles produce compact, cross-platform friendly names.
    const filename = (sanitize(rendered, { maxLength: MAX_FILENAME_LENGTH, fallback: 'pin' }) || 'pin').replace(/\s+/g, '-');
    let subdir = '';
    if (o.boardFolderEnabled && data.board) {
      subdir = boardFolder(data.board);
    }
    return { filename, subdir };
  }

  /**
   * Return a safe subfolder segment from a board name.
   * @param {string} board
   * @returns {string}
   */
  function boardFolder(board) {
    return sanitizeSegment(String(board || ''), { fallback: 'pinterest', max: 60 });
  }

  return {
    sanitizeSegment,
    sanitizeFilename,
    sanitize,
    assertSafeName,
    renderTemplate,
    buildFilename,
    formatDate,
    boardFolder,
    MAX_FILENAME_LENGTH,
  };
});
