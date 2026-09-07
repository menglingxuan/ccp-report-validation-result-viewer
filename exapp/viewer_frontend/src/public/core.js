/* ============================================================
 * core.js — 纯函数核心（无 DOM / 无应用状态，可被主线程与 Worker 共用）
 * 所有函数均为纯计算：相同输入 -> 相同输出，不读写全局状态。
 * ============================================================ */

const SEARCH_KEYS = { field: 'field', xpath: 'aoEl', csv: 'aoEl', eo: 'eo', ao: 'ao', ctx: 'ctxs', desc: 'remarks' };

export function parseSearchQuery(q) {
  let s = (q || '').trim();
  let key = null, regex = false;
  for (;;) {
    const m = /^\s*([A-Za-z]+):/.exec(s);
    if (!m) break;
    const k = m[1].toLowerCase();
    if (k === 'regex') { regex = true; s = s.slice(m[0].length); }
    else if (SEARCH_KEYS[k]) { key = SEARCH_KEYS[k]; s = s.slice(m[0].length); }
    else break;
  }
  return { key: key, regex: regex, text: s.trim() };
}

function searchValue(obj, key) {
  const v = obj[key];
  if (key === 'ctxs') return ((obj.ctxKeys || obj.ctxs) || []).join(' ');
  return String(v == null ? '' : v);
}

function fieldHay(r) {
  return r.field + ' ' + r.userTag + ' ' + r.aoEl + ' ' + r.eoEl + ' ' + r.eoCvtEl + ' ' + r.aoCvtEl + ' ' + r.vdtEl + ' ' + r.eoUnconverted + ' ' + r.aoUnconverted + ' ' + r.eo + ' ' + r.ao + ' ' + (r.remarks || '') + ' ' + ((r.ctxKeys || r.ctxs) || []).join(' ');
}

export function makeMatcher(pq) {
  const text = pq.text;
  if (!text) return null;
  if (pq.regex) {
    try { const re = new RegExp(text, 'i'); return function (hay) { return re.test(hay); }; } catch (e) {}
  }
  const lower = text.toLowerCase();
  return function (hay) { return hay.toLowerCase().includes(lower); };
}

export function matchRow(r, pq, matcher) {
  return matcher(pq.key ? searchValue(r, pq.key) : fieldHay(r));
}

export function specialValueMatch(v, kind) {
  const s = String(v);
  if (kind === 'empty') return s === '';
  if (kind === 'blank') return /^\s+$/.test(s);
  if (kind === 'special') return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B\u200C\u200D\uFEFF]/.test(s);
  return true;
}

export function sortValue(r, key) {
  switch (key) {
    case 'field': return r.field;
    case 'userTag': return r.userTag;
    case 'aoEl': return r.aoEl;
    case 'eoEl': return r.eoEl;
    case 'eoCvtEl': return r.eoCvtEl;
    case 'aoCvtEl': return r.aoCvtEl;
    case 'vdtEl': return r.vdtEl;
    case 'eoUnconverted': return r.eoUnconverted;
    case 'aoUnconverted': return r.aoUnconverted;
    case 'type': return r.type;
    case 'result': return r.result;
    case 'ctxs': return (r.ctxKeys || r.ctxs || []).join(',');
    case 'eo': return r.eo;
    case 'ao': return r.ao;
    case 'channel': return r.channel;
    case 'source': return r.source;
    case 'remarks': return r.remarks;
    default: return '';
  }
}

export function flatFields(item) {
  const rows = [];
  // ctxDefs id → key 反向映射（用于搜索 / 显示 / 排序时把 id 解析为可读 key）。
  const keyById = {};
  const ctxDefs = item.ctxDefs || {};
  Object.keys(ctxDefs).forEach(function (k) { keyById[ctxDefs[k].id] = k; });
  (item.channels || []).forEach(ch => {
    // 字段注册表为 report channel 级别：每个渠道的字段定义不同。
    const defs = {};
    (ch.fields || []).forEach(function (d) { defs[d.id] = d; });
    (ch.sources || []).forEach(s => {
      (s.fields || []).forEach(f => {
        const def = defs[f.id] || {};
        const right = f.cmpRight || {};
        const left = f.cmpLeft || {};
        const cvtL = f.cvtLeft || {};
        const cvtR = f.cvtRight || {};
        const vdt = f.vdt || {};
        // 命中 ctx 合集：field.ctxs 已删除，由各规则 ctxs 取并集（id 引用）。
        const ctxUnion = [];
        const ctxKeys = [];
        [left, right, cvtL, cvtR, vdt].forEach(function (o) {
          (o.ctxs || []).forEach(function (id) {
            if (ctxUnion.indexOf(id) === -1) {
              ctxUnion.push(id);
              ctxKeys.push(keyById[id] != null ? keyById[id] : String(id));
            }
          });
        });
        rows.push({
          channel: ch.name, source: s.name,
          id: f.id, field: def.name, userTag: def.userTag || '',
          // 表达式 / 预览列：aoEl/eoEl 为左右侧定位（XPath 或 CSV 列），其余为各规则的原始表达式与未转换值。
          aoEl: right.el || '', srcType: right.srcType || 1,
          eoEl: left.el || '',
          eoCvtEl: cvtL.el || '',
          aoCvtEl: cvtR.el || '',
          vdtEl: vdt.el || '',
          eoUnconverted: cvtL.raw != null ? cvtL.raw : '',
          aoUnconverted: cvtR.raw != null ? cvtR.raw : '',
          type: def.type, ctxs: ctxUnion, ctxKeys: ctxKeys,
          eo: left.value, ao: right.value, result: f.result, remarks: f.remarks, prints: f.prints,
        });
      });
    });
  });
  return rows;
}

/* ---------- 警告忽略配置：按平台分组 -> 扁平 key ---------- */
export function groupedToFlat(grouped) {
  const flat = {};
  Object.keys(grouped || {}).forEach(function (platform) {
    const g = grouped[platform];
    if (!g || typeof g !== 'object') return;
    (g.warnings || []).forEach(function (w) {
      const key = JSON.stringify(['warn', platform, w.channel || '', w.source || '', w.scope || (w.field ? 'field' : 'channel'), w.type || '', w.level || '', w.field || '']);
      flat[key] = true;
    });
    (g.uncomparedXpaths || []).forEach(function (u) {
      // 未比较元素已不携带 ctx，ctx 槽位恒为空，避免与 msgIgnoreKey 生成的 key 失配。
      const key = JSON.stringify(['xpath', u.xpath || '', u.channel || '', platform, u.product || '', '']);
      flat[key] = true;
    });
    (g.uncomparedCsvs || []).forEach(function (u) {
      const key = JSON.stringify(['csv', u.value || '', u.channel || '', platform, u.product || '', '']);
      flat[key] = true;
    });
  });
  return flat;
}

export function normalizeIgnoreConfig(cfg) {
  if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
    const keys = Object.keys(cfg);
    const isFlat = keys.every(function (k) { try { return Array.isArray(JSON.parse(k)); } catch (e) { return false; } });
    return isFlat ? cfg : groupedToFlat(cfg);
  }
  return null;
}

export function msgIgnoreKey(tab, m) {
  if (tab === 'warnings') return JSON.stringify(['warn', m.platform || '', m.channel || '', m.source || '', m.scope || '', m.type, m.level, m.field || '']);
  if (tab === 'uncompared') {
    const isCsv = m.type === 2;
    return JSON.stringify([isCsv ? 'csv' : 'xpath', m.value || '', m.channel, m.platform || '', m.product || '', '']);
  }
  return null;
}

function msgIsIgnoredPure(tab, m, ignoreConfig) {
  const k = msgIgnoreKey(tab, m);
  return k ? !!(ignoreConfig && ignoreConfig[k]) : false;
}

/* ---------- 字段差异高亮（FAILED 字段逐字符 LCS diff） ---------- */
export function diffSegments(a, b) {
  a = String(a == null ? '' : a); b = String(b == null ? '' : b);
  if (a === b) return { a: [{ t: 0, s: a }], b: [{ t: 0, s: b }] };
  const MAX = 600;
  if (a.length > MAX || b.length > MAX || a.length * b.length > 200000) {
    return { a: [{ t: 1, s: a }], b: [{ t: 2, s: b }] };
  }
  const n = a.length, m = b.length;
  const W = m + 1;
  const dp = new Uint32Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * W + j] = a[i] === b[j] ? dp[(i + 1) * W + (j + 1)] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + (j + 1)]);
    }
  }
  const as = [], bs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { as.push({ t: 0, s: a[i] }); bs.push({ t: 0, s: b[j] }); i++; j++; }
    else if (dp[(i + 1) * W + j] >= dp[i * W + (j + 1)]) { as.push({ t: 1, s: a[i] }); i++; }
    else { bs.push({ t: 2, s: b[j] }); j++; }
  }
  while (i < n) { as.push({ t: 1, s: a[i] }); i++; }
  while (j < m) { bs.push({ t: 2, s: b[j] }); j++; }
  function merge(seg) {
    const out = [];
    seg.forEach(function (x) {
      const last = out[out.length - 1];
      if (last && last.t === x.t) last.s += x.s; else out.push({ t: x.t, s: x.s });
    });
    return out;
  }
  return { a: merge(as), b: merge(bs) };
}

/* ---------- 健康总览（跨全部 item，支持按报告日期/渠道过滤） ---------- */
export function computeHealthPure(items, date, channel, ignoreConfig) {
  let total = 0, passed = 0, failed = 0, warnings = 0, errors = 0;
  const errAgg = {}, warnAgg = {};
  const list = (!date || date === 'ALL') ? items.slice() : items.filter(function (it) { return it.reportDate === date; });
  const perItem = list.map(function (it) {
    let pTotal = 0, pPassed = 0, pFailed = 0, pWarn = 0, pErr = 0;
    (it.channels || []).forEach(function (ch) {
      if (channel && channel !== 'ALL' && ch.name !== channel) return;
      (ch.sources || []).forEach(function (s) { (s.fields || []).forEach(function (fd) { pTotal++; fd.result === 'PASSED' ? pPassed++ : pFailed++; }); });
    });
    (it.errors || []).forEach(function (e) {
      if (channel && channel !== 'ALL' && e.channel !== channel) return;
      pErr++; const k = (e.type || '?') + '|' + e.channel; errAgg[k] = (errAgg[k] || 0) + 1;
    });
    (it.warnings || []).forEach(function (w) {
      if (channel && channel !== 'ALL' && w.channel !== channel) return;
      // platform/product 跟随 item：计算忽略 key 时从 item 注入。
      const wm = Object.assign({}, w, { platform: it.platform, product: it.product });
      if (!msgIsIgnoredPure('warnings', wm, ignoreConfig)) { pWarn++; const k = (w.type || '?') + '|' + w.channel; warnAgg[k] = (warnAgg[k] || 0) + 1; }
    });
    total += pTotal; passed += pPassed; failed += pFailed; warnings += pWarn; errors += pErr;
    return { id: it.tradeId, failed: pFailed, total: pTotal, rate: pTotal ? Math.round(pPassed / pTotal * 100) : 0, warnings: pWarn, errors: pErr };
  });
  const rate = total ? Math.round(passed / total * 100) : 0;
  return { items: list, perItem: perItem, total: total, passed: passed, failed: failed, warnings: warnings, errors: errors, rate: rate, errAgg: errAgg, warnAgg: warnAgg };
}

/* ---------- 全局搜索（跨 item） ---------- */
export function globalSearchPure(items, q, limit) {
  const pq = parseSearchQuery(q);
  const matcher = makeMatcher(pq);
  const results = [];
  if (!matcher) return results;
  items.forEach(function (it) {
    const enabled = Array.isArray(it.enabledChannels) ? it.enabledChannels : (it.channels || []).map(function (c) { return c.name; });
    flatFields(it).forEach(function (r) {
      if (enabled.indexOf(r.channel) === -1) return;
      if (matchRow(r, pq, matcher)) {
        results.push({ itemId: it.tradeId, channel: r.channel, source: r.source, fieldId: r.id, field: r.field, snippet: r.eo + ' → ' + r.ao });
      }
    });
  });
  return results.slice(0, limit || 200);
}
