/* ============================================================
 * worker.js — 计算 Worker：把健康总览 / 全局搜索等重计算移出主线程。
 * 纯计算、无缓存、无持久化，保证结果与主线程一致。
 * ============================================================ */
import { computeHealthPure, globalSearchPure } from './core.js';

self.onmessage = function (e) {
  const msg = e.data || {};
  const id = msg.id;
  try {
    if (msg.type === 'health') {
      const p = msg.payload || {};
      self.postMessage({ id: id, ok: true, result: computeHealthPure(p.items || [], p.date, p.channel, p.ignoreConfig || {}) });
    } else if (msg.type === 'globalSearch') {
      const p = msg.payload || {};
      self.postMessage({ id: id, ok: true, result: globalSearchPure(p.items || [], p.q, p.limit) });
    } else {
      self.postMessage({ id: id, ok: false, error: 'unknown message type: ' + msg.type });
    }
  } catch (err) {
    self.postMessage({ id: id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
