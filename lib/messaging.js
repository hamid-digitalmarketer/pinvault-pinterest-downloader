/**
 * messaging.js — safe message passing between extension components.
 * Validates envelopes, allowed message types, and payload shapes.
 * Never logs sensitive payloads.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof globalThis !== 'undefined') {
    globalThis.PinVaultMessaging = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TYPES = new Set([
    'PING',
    'SCAN_PAGE',
    'SCAN_PROGRESS',
    'SCAN_RESULT',
    'DOWNLOAD_ONE',
    'DOWNLOAD_BULK',
    'QUEUE_START',
    'QUEUE_PAUSE',
    'QUEUE_RESUME',
    'QUEUE_CANCEL',
    'QUEUE_RETRY',
    'QUEUE_STATUS',
    'QUEUE_EVENT',
    'GET_SETTINGS',
    'SAVE_SETTINGS',
    'GET_HISTORY',
    'CLEAR_HISTORY',
    'GET_COLLECTIONS',
    'SAVE_COLLECTIONS',
    'EXPORT_INVENTORY',
    'GET_QUEUE_STATE',
    'WIPE_DATA',
    'GET_BADGE',
    'OPEN_DASHBOARD',
  ]);

  /**
   * Build a validated envelope.
   * @param {string} type
   * @param {object} [payload]
   * @returns {{type: string, payload: object, nonce: string}}
   */
  function createEnvelope(type, payload) {
    if (!TYPES.has(type)) {
      throw new Error(`Unknown message type: ${type}`);
    }
    const nonce = `pv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return {
      type,
      payload: payload && typeof payload === 'object' ? payload : {},
      nonce,
    };
  }

  /**
   * Validate an incoming envelope. Returns {ok:true, message} or {ok:false, error}.
   * @param {*} data
   * @returns {{ok: boolean, message?: object, error?: string}}
   */
  function validateEnvelope(data) {
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'invalid envelope' };
    }
    if (!TYPES.has(data.type)) {
      return { ok: false, error: 'unknown message type' };
    }
    if (typeof data.nonce !== 'string' || data.nonce.length > 64) {
      return { ok: false, error: 'invalid nonce' };
    }
    const p = data.payload;
    if (p !== undefined && p !== null && typeof p !== 'object') {
      return { ok: false, error: 'invalid payload' };
    }
    return { ok: true, message: { type: data.type, payload: p || {}, nonce: data.nonce } };
  }

  /**
   * Safe responder wrapper: keeps error strings but never leaks raw stack traces.
   */
  function safeRespond(fn) {
    return async (msg, sender) => {
      try {
        const result = await fn(msg, sender);
        return { ok: true, data: result === undefined ? null : result };
      } catch (err) {
        const short = err && err.message ? err.message : String(err);
        return { ok: false, error: String(short).slice(0, 500) };
      }
    };
  }

  return { TYPES, createEnvelope, validateEnvelope, safeRespond };
});
