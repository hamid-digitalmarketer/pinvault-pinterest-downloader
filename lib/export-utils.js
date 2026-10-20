/**
 * export-utils.js — CSV / JSON export of media inventories.
 * Dependency-free shared module.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof globalThis !== 'undefined') {
    globalThis.PinVaultExportUtils = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CSV_HEADERS = [
    'pin_url', 'media_url', 'filename', 'width', 'height', 'format',
    'title', 'board', 'download_date', 'status', 'collection',
  ];

  /**
   * Convert a single value to a safe CSV cell.
   * @param {*} v
   * @returns {string}
   */
  function csvCell(v) {
    const s = v === null || v === undefined ? '' : String(v);
    if (/[",\n\r]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function finiteOrZero(n) {
    return typeof n === 'number' && Number.isFinite(n) ? n : 0;
  }

  function recordToRow(rec) {
    const r = rec || {};
    return {
      pin_url: r.pinUrl || r.pin_url || '',
      media_url: r.url || r.media_url || '',
      filename: r.filename || '',
      width: finiteOrZero(r.width),
      height: finiteOrZero(r.height),
      format: r.format || '',
      title: r.title || '',
      board: r.board || '',
      download_date: r.downloadDate || r.detectedAt || '',
      status: r.status || 'collected',
      collection: r.collection || '',
    };
  }

  /**
   * Serialize a list of media records to CSV with a header row.
   * @param {Array<object>} records
   * @returns {string}
   */
  function toCsv(records) {
    const lines = [CSV_HEADERS.join(',')];
    for (const r of Array.isArray(records) ? records : []) {
      const row = recordToRow(r);
      lines.push(CSV_HEADERS.map((h) => csvCell(row[h])).join(','));
    }
    return lines.join('\r\n');
  }

  /**
   * Serialize a list of media records to JSON.
   * Returns an array of records; each record carries an exported_at timestamp.
   * @param {Array<object>} records
   * @returns {string}
   */
  function toJson(records) {
    const rows = (Array.isArray(records) ? records : []).map((r) => {
      const row = recordToRow(r);
      row.exported_at = new Date().toISOString();
      return row;
    });
    return JSON.stringify(rows, null, 2);
  }

  return { CSV_HEADERS, csvCell, toCsv, toJson };
});
