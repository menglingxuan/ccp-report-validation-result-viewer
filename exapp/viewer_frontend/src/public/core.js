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
    // 「未比较 Item」表列（itemId / reason）：不补齐会静默无排序效果。
    case 'itemId': return r.itemId || r.tradeId;
    case 'reason': return r.reason;
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

/* ---------- 忽略配置：按平台分组 -> 扁平 key（product 已移除，第 4 槽位改为来源渠道 source） ---------- */
// 警告作用域归一化：写文件（groupedToFlat）与算运行期 key（msgIgnoreKey）必须用**同一规则**，
// 否则「导出 → 重新加载」后 key 会变（例如数据里缺 scope 的警告会被猜成 field/channel），
// 导致忽略项静默失效。scope 缺失时按「有 field = field，否则 channel」推断。
export function warnScope(w) {
  return (w && w.scope) || (w && w.field ? 'field' : 'channel');
}

export function groupedToFlat(grouped) {
  const flat = {};
  Object.keys(grouped || {}).forEach(function (platform) {
    const g = grouped[platform];
    if (!g || typeof g !== 'object') return;
    (g.warnings || []).forEach(function (w) {
      const key = JSON.stringify(['warn', platform, w.channel || '', w.source || '', warnScope(w), w.type || '', w.level || '', w.field || '']);
      flat[key] = true;
    });
    (g.uncomparedXpaths || []).forEach(function (u) {
      // 未比较元素不携带 ctx，ctx 槽位恒为空；source 可能为空（渠道级条目）。
      const key = JSON.stringify(['xpath', u.xpath || '', u.channel || '', platform, u.source || '', '']);
      flat[key] = true;
    });
    (g.uncomparedCsvs || []).forEach(function (u) {
      const key = JSON.stringify(['csv', u.value || '', u.channel || '', platform, u.source || '', '']);
      flat[key] = true;
    });
  });
  return flat;
}

// 宽松读取：配置文件可能是（a）当前分组格式，（b）旧版本写下的「扁平 key 对象」（老版本导出/本地镜像）。
// 二者均接受以保证升级后旧数据仍可用；但**导入接口不再接受扁平格式**（parseIgnoreImport 判为 legacy），
// 即「读取宽松、写入/导入严格」，避免静默错配 key。
export function normalizeIgnoreConfig(cfg) {
  if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
    const keys = Object.keys(cfg);
    const isFlat = keys.every(function (k) { try { return Array.isArray(JSON.parse(k)); } catch (e) { return false; } });
    return isFlat ? cfg : groupedToFlat(cfg);
  }
  return null;
}

// 扁平 key -> 按平台分组的配置（与 groupedToFlat 互为逆运算，供导出/回写使用）；
// 平台槽位直接取原值（不再编造 'UNKNOWN'），保证「导出 -> 重新加载」后 key 仍能命中。
// 条目不携带 kind / ctx：容器数组名（warnings / uncomparedXpaths / uncomparedCsvs）即类型，ctx 恒空不落盘。
export function flatToGrouped(flat) {
  const grouped = {};
  Object.keys(flat || {}).forEach(function (k) {
    if (!flat[k]) return;
    let arr;
    try { arr = JSON.parse(k); } catch (e) { return; }
    if (!Array.isArray(arr)) return;
    let platform, entry, bucket;
    if (arr[0] === 'warn') {
      platform = arr[1] || '';
      entry = { channel: arr[2], source: arr[3], scope: arr[4], type: arr[5], level: arr[6], field: arr[7] };
      bucket = 'warnings';
    } else if (arr[0] === 'xpath') {
      platform = arr[3] || '';
      entry = { xpath: arr[1], channel: arr[2], source: arr[4] };
      bucket = 'uncomparedXpaths';
    } else if (arr[0] === 'csv') {
      platform = arr[3] || '';
      entry = { value: arr[1], channel: arr[2], source: arr[4] };
      bucket = 'uncomparedCsvs';
    } else return;
    if (!grouped[platform]) grouped[platform] = { warnings: [], uncomparedXpaths: [], uncomparedCsvs: [] };
    grouped[platform][bucket].push(entry);
  });
  return grouped;
}

// 导入解析（纯函数）：只接受「分组格式」（platform -> { warnings, uncomparedXpaths, uncomparedCsvs }）。
// 支持**分部导入**：文件中「出现的桶」即需要覆盖的部分（warn / xpath / csv），未出现的部分保持不变。
// 空文件 `{}` 视为三部分皆空 = 清空全部忽略（与配置文件默认值 `{}` 的语义一致）。
// 返回 { ok: true, flat, kinds } 或 { ok: false, reason: 'json' | 'shape' | 'legacy' | 'buckets' }。
export function parseIgnoreImport(text) {
  let cfg;
  try { cfg = JSON.parse(text); } catch (e) { return { ok: false, reason: 'json' }; }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { ok: false, reason: 'shape' };
  const platforms = Object.keys(cfg);
  if (!platforms.length) return { ok: true, flat: {}, kinds: ['warn', 'xpath', 'csv'] };
  // 旧版扁平格式（平台键本身是 JSON 数组）不再支持，避免静默错配 key
  const isFlat = platforms.every(function (p) { try { return Array.isArray(JSON.parse(p)); } catch (e) { return false; } });
  if (isFlat) return { ok: false, reason: 'legacy' };
  const bucketKind = { warnings: 'warn', uncomparedXpaths: 'xpath', uncomparedCsvs: 'csv' };
  const kinds = [];
  Object.keys(bucketKind).forEach(function (b) {
    const present = platforms.some(function (p) {
      const g = cfg[p];
      return !!g && typeof g === 'object' && !Array.isArray(g) && Array.isArray(g[b]);
    });
    if (present) kinds.push(bucketKind[b]);
  });
  if (!kinds.length) return { ok: false, reason: 'buckets' };
  return { ok: true, flat: groupedToFlat(cfg), kinds: kinds };
}

// 分部覆盖（纯函数）：只替换 kinds 指定的部分，未指定的部分保留 currentFlat 中的原值。
// kinds 为空（或未提供）时视为“全部替换”（与逐行忽略/取消忽略共享同一份扁平集合）。
export function applyIgnoreImport(currentFlat, parsed) {
  const kinds = (parsed && parsed.kinds && parsed.kinds.length) ? parsed.kinds : ['warn', 'xpath', 'csv'];
  const out = {};
  Object.keys(currentFlat || {}).forEach(function (k) {
    if (!currentFlat[k]) return;
    let arr;
    try { arr = JSON.parse(k); } catch (e) { return; }
    if (!Array.isArray(arr)) return;
    if (kinds.indexOf(arr[0]) === -1) out[k] = true;
  });
  Object.keys((parsed && parsed.flat) || {}).forEach(function (k) { if (parsed.flat[k]) out[k] = true; });
  return out;
}

export function msgIgnoreKey(tab, m) {
  // 警告作用域用 warnScope 归一化，与 groupedToFlat（配置文件读取）保持同一条规则。
  if (tab === 'warnings') return JSON.stringify(['warn', m.platform || '', m.channel || '', m.source || '', warnScope(m), m.type, m.level, m.field || '']);
  if (tab === 'uncompared') {
    const isCsv = m.type === 2;
    // channel / platform / source 均归一化为字符串：全局未比较条目的 channel / source 为 null，
    // 而配置文件读取路径（groupedToFlat）统一用 `|| ''`，不归一会导致 key 失配。
    return JSON.stringify([isCsv ? 'csv' : 'xpath', m.value || '', m.channel || '', m.platform || '', m.source || '', '']);
  }
  return null;
}

function msgIsIgnoredPure(tab, m, ignoreConfig) {
  const k = msgIgnoreKey(tab, m);
  return k ? !!(ignoreConfig && ignoreConfig[k]) : false;
}

/* ---------- 忽略配置管理（查看 / 删除）：扁平 key ↔ 可展示条目 ---------- */
// 支持的类型（与配置文件的分组桶一一对应）：警告 / 未比较 XPath / 未比较 CSV。
export const IGNORE_KINDS = ['warn', 'xpath', 'csv'];

// 解析扁平忽略 key -> 归一化条目；非法/未知类型返回 null。
// 槽位与 groupedToFlat 严格一致：warn=[kind,platform,channel,source,scope,type,level,field]，
// xpath=[kind,value,channel,platform,source,'']，csv=[kind,value,channel,platform,source,'']。
export function parseIgnoreKey(key) {
  let arr;
  try { arr = JSON.parse(key); } catch (e) { return null; }
  if (!Array.isArray(arr) || IGNORE_KINDS.indexOf(arr[0]) === -1) return null;
  const str = function (v) { return v == null ? '' : String(v); };
  if (arr[0] === 'warn') {
    return {
      key: key, kind: 'warn', platform: str(arr[1]), channel: str(arr[2]), source: str(arr[3]),
      scope: str(arr[4]) || 'channel', type: str(arr[5]), level: str(arr[6]), field: str(arr[7]), value: '',
    };
  }
  return {
    key: key, kind: arr[0], platform: str(arr[3]), channel: str(arr[2]), source: str(arr[4]),
    scope: '', type: '', level: '', field: '', value: str(arr[1]),
  };
}

// 列出某类型的忽略条目（按 平台 -> 渠道 -> 来源 -> 值/字段 排序，便于人工核对）。
export function listIgnoreEntries(flat, kind) {
  const out = [];
  Object.keys(flat || {}).forEach(function (k) {
    if (!flat[k]) return;
    const e = parseIgnoreKey(k);
    if (!e || (kind && e.kind !== kind)) return;
    e.text = [e.platform, e.channel, e.source, e.type, e.level, e.field, e.value].join(' ');
    out.push(e);
  });
  // 排序键用「码位比较」而非 localeCompare：后者会忽略分隔符/控制字符，导致顺序不确定。
  const sortKey = function (e) { return [e.platform, e.channel, e.source, e.value, e.type, e.level, e.field].join('\u0001'); };
  out.sort(function (a, b) {
    const ka = sortKey(a), kb = sortKey(b);
    return ka < kb ? -1 : (ka > kb ? 1 : 0);
  });
  return out;
}

// 条目关键字过滤（匹配任意展示字段，大小写不敏感；空查询返回全部）。
// 备注：“管理忽略配置”窗口当前不做筛选（后续可能改为字段级筛选），此纯函数保留供复用。
export function filterIgnoreEntries(entries, query) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return entries;
  return (entries || []).filter(function (e) {
    return String(e.text || '').toLowerCase().indexOf(q) !== -1;
  });
}

// 统计「当前消息集合里，每个忽略 key 实际命中了多少条」：
// 仅统计已忽略（flat[key] 为真）的消息，返回 { key: count }。
// 用于「管理忽略配置」里展示每条配置实际忽略的数据条数（作用域与 msgIgnoreKey 完全一致）。
export function countIgnoredByKey(tab, messages, flat) {
  const out = {};
  (messages || []).forEach(function (m) {
    const k = msgIgnoreKey(tab, m);
    if (!k || !(flat && flat[k])) return;
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}

// 删除若干 key（纯函数：返回新的扁平集合，不修改入参）。
export function removeIgnoreKeys(flat, keys) {
  const drop = {};
  (Array.isArray(keys) ? keys : [keys]).forEach(function (k) { if (k) drop[k] = true; });
  const out = {};
  Object.keys(flat || {}).forEach(function (k) {
    if (!flat[k]) return;
    if (!drop[k]) out[k] = true;
  });
  return out;
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
      // platform 跟随 item：计算忽略 key 时从 item 注入（source 条目自带，可能为空）。
      const wm = Object.assign({}, w, { platform: it.platform });
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

/* ============================================================
 * 任务说明扩展内容（batch-meta.json 的 descriptionEx）
 * 契约见 docs/DATA_SCHEMA.md 6.3：
 *   { "contentType": "markDownTable", "plainContent": "| a | b |\n| --- | --- |\n| 1 | 2 |" }
 * 本段只提供「纯函数」：类型归一化 / Markdown 表格解析 / 最小内联格式 / 筛选 / 排序 / 分页。
 * 渲染器注册表在 public/app.js（DESC_EX_RENDERERS）：新增 contentType 时
 * 只需在此加解析纯函数（+单测）并在注册表登记渲染器，其它逻辑无需改动。
 * ============================================================ */

// 单条 descriptionEx 允许渲染的最大字符数（超出截断并提示，避免超长内容拖慢渲染）。
export const DESC_EX_MAX_CHARS = 65536;

// 默认（未声明）内容类型：按纯文本渲染。
export const DESC_EX_DEFAULT_TYPE = 'text';

// 最小内联格式支持：`code` / **bold** / *italic*（链接、图片、HTML 一律不解析）。
export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// 归一化 descriptionEx：非对象 / plainContent 为空 -> null（视为「无扩展内容」）。
// contentType 大小写不敏感；缺省视为 text（纯文本回退，永不报错、永不空白）。
export function normalizeDescriptionEx(ex) {
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return null;
  const raw = typeof ex.plainContent === 'string' ? ex.plainContent : '';
  if (!raw.trim()) return null;
  const type = typeof ex.contentType === 'string' ? ex.contentType.trim().toLowerCase() : '';
  let content = raw;
  let truncated = false;
  if (content.length > DESC_EX_MAX_CHARS) {
    content = content.slice(0, DESC_EX_MAX_CHARS);
    truncated = true;
  }
  return { contentType: type || DESC_EX_DEFAULT_TYPE, plainContent: content, truncated: truncated };
}

// 最小内联格式 -> HTML（先整体转义，再做白名单替换，不允许任何 HTML 直通）。
export function inlineMarkdown(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s;
}

// 去掉最小内联标记，得到可见文本（用于表格搜索/排序，避免匹配到 ` 与 * 本身）。
export function inlinePlainText(text) {
  return String(text == null ? '' : text).replace(/`/g, '').replace(/\*\*/g, '').replace(/\*/g, '');
}

// 拆一行表格：支持 `\|` 转义的竖线；首尾无转义的 `|` 视为边框被去掉。
function stripTrailingPipe(s) {
  if (!s.endsWith('|')) return s;
  let bs = 0;
  for (let k = s.length - 2; k >= 0 && s[k] === '\\'; k--) bs++;
  return bs % 2 === 1 ? s : s.slice(0, -1);
}

export function splitTableRow(line) {
  let s = String(line == null ? '' : line).trim();
  if (s.startsWith('|')) s = s.slice(1);
  s = stripTrailingPipe(s);
  const cells = [];
  let cur = '';
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
    if (ch === '|') { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  return cells.map(function (c) { return c.trim(); });
}

// 分隔行（| --- | :--- | ---: | ...）判定：仅用于识别「这是表格」。
// 表格渲染**统一左对齐**（含表头），因此不解析对齐标记（避免声明与实际渲染不一致）。
function isAlignRow(line) {
  const cells = splitTableRow(line);
  if (!cells.length) return false;
  return cells.every(function (c) { return /^:?-{1,}:?$/.test(c); });
}

function cell(raw) {
  return { raw: raw, text: inlinePlainText(raw) };
}

/**
 * 解析 Markdown 表格（GFM 子集：表头 + 分隔行 + 数据行；单元格统一左对齐）。
 * 返回 { header: [cell], rows: [[cell]], issues: [{kind, count}] }
 * issues.kind: noheader（无法识别为表格）/ ragged（行列数与表头不一致，已对齐）/ skipped（含 `|` 之外的行被忽略）
 */
export function parseMarkdownTable(md) {
  const issues = [];
  const lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (i >= lines.length || lines[i].indexOf('|') === -1) {
    return { header: [], rows: [], issues: [{ kind: 'noheader', count: 0 }] };
  }
  const headerLine = lines[i];
  let alignLine = '';
  let j = i + 1;
  while (j < lines.length && !lines[j].trim()) j++;
  if (j < lines.length) alignLine = lines[j];
  if (!alignLine || !isAlignRow(alignLine)) {
    return { header: [], rows: [], issues: [{ kind: 'noheader', count: 0 }] };
  }

  const header = splitTableRow(headerLine).map(cell);
  const rows = [];
  let ragged = 0;
  let skipped = 0;
  for (let k = j + 1; k < lines.length; k++) {
    const line = lines[k];
    if (!line.trim()) break;                       // 空行视为表格结束
    if (line.indexOf('|') === -1) { skipped++; continue; }
    const cells = splitTableRow(line);
    if (cells.length !== header.length) ragged++;
    const row = [];
    for (let c = 0; c < header.length; c++) row.push(cell(cells[c] == null ? '' : cells[c]));
    rows.push(row);
  }
  if (ragged) issues.push({ kind: 'ragged', count: ragged });
  if (skipped) issues.push({ kind: 'skipped', count: skipped });
  return { header: header, rows: rows, issues: issues };
}

// 表格筛选（表头字段搜索）：`filters[k]` 为该列的自由输入，列之间为 AND 关系；
// 大小写不敏感，空串/未提供表示不限制该列。全部为空时返回原数组。
export function filterTableRows(rows, filters) {
  const list = Array.isArray(filters) ? filters.map(function (f) { return String(f == null ? '' : f).trim().toLowerCase(); }) : [];
  const active = list.some(function (q) { return q !== ''; });
  if (!active) return rows;
  return rows.filter(function (r) {
    for (let k = 0; k < list.length; k++) {
      const q = list[k];
      if (!q) continue;
      const cell = r[k];
      if (!cell || String(cell.text || '').toLowerCase().indexOf(q) === -1) return false;
    }
    return true;
  });
}

// 表格排序：数字列按数值，其它按本地化字符串；空值恒排在后。
// col < 0 表示「原序」（不排序）。
export function sortTableRows(rows, col, dir) {
  if (!(col >= 0)) return rows;
  const d = dir === -1 ? -1 : 1;
  const num = function (c) {
    const s = String(c.text || '').replace(/,/g, '');
    return s !== '' && !isNaN(Number(s)) ? Number(s) : null;
  };
  const idx = col;
  const out = rows.slice();
  out.sort(function (ra, rb) {
    const a = ra[idx] || { text: '' };
    const b = rb[idx] || { text: '' };
    const ea = String(a.text || '') === '';
    const eb = String(b.text || '') === '';
    if (ea && eb) return 0;
    if (ea) return 1;                              // 空值恒排在后（不随方向翻转）
    if (eb) return -1;
    const na = num(a), nb = num(b);
    if (na != null && nb != null) return (na - nb) * d;
    return String(a.text).localeCompare(String(b.text)) * d;
  });
  return out;
}

// 三态排序循环（与主列表 / descriptionEx 同样的交互）：
// 同一列：升序(1) → 降序(-1) → 原序(col=-1)；点击另一列：从升序开始。
export function cycleSort(sort, col) {
  const s = sort || { col: -1, dir: 1 };
  if (s.col === col) return s.dir === 1 ? { col: col, dir: -1 } : { col: -1, dir: 1 };
  return { col: col, dir: 1 };
}

// 「空值」筛选哨兵：exact 模式下用它匹配文本为空单元格（界面下拉框里的「空值」选项）。
export const FILTER_EMPTY = '__empty__';

// 按列规则过滤（列间 AND）：rules = [{ col, mode, value }]
//   mode 'exact'    — 单元格文本与 value 完全相等（大小写不敏感；value 为 FILTER_EMPTY 时匹配空单元格）
//   mode 'contains' — 单元格文本包含 value（大小写不敏感）
// value 为空串 / null 表示该列不限制；无有效规则时返回原数组。
export function filterRowsByRules(rows, rules) {
  const active = (rules || []).filter(function (r) { return r && r.value != null && r.value !== ''; });
  if (!active.length) return rows || [];
  return (rows || []).filter(function (row) {
    for (let i = 0; i < active.length; i++) {
      const rule = active[i];
      const cell = row[rule.col];
      const text = String((cell && cell.text) || '');
      if (rule.mode === 'exact') {
        if (rule.value === FILTER_EMPTY) { if (text !== '') return false; continue; }
        if (text.toLowerCase() !== String(rule.value).toLowerCase()) return false;
      } else if (text.toLowerCase().indexOf(String(rule.value).toLowerCase()) === -1) {
        return false;
      }
    }
    return true;
  });
}

// 分页：页码从 1 开始，越界自动收敛到合法范围。
export function paginateRows(rows, page, size) {
  const per = Math.max(1, Math.floor(size) || 1);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / per));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (p - 1) * per;
  return { page: p, pages: pages, slice: rows.slice(start, start + per), total: total };
}

// 表格工具（列排序 + 表头字段筛选）的最大页数阈值：总页数 ≤ 该值时不展示（保持纯描述 / 列表简洁）。
// 目前被 descriptionEx 表格与「管理忽略配置」列表共用。
export const DESC_EX_TOOLS_MAX_PAGES = 3;

// 列宽（px）拟合：按各列「最大内容宽度 + 左右内边距」定宽，并限制在 [min, max] 区间。
// 配合 table-layout: fixed 使用，保证分页切换时表格宽度固定（不因当前页内容而变化）。
export function fitColWidths(textWidths, opts) {
  const o = opts || {};
  const padFirst = typeof o.padFirst === 'number' ? o.padFirst : 20;
  const padMid = typeof o.padMid === 'number' ? o.padMid : 20;
  const padLast = typeof o.padLast === 'number' ? o.padLast : 20;
  const min = typeof o.min === 'number' ? o.min : 56;
  const max = (typeof o.max === 'number' && o.max > 0) ? o.max : 360;
  const list = Array.isArray(textWidths) ? textWidths : [];
  const last = list.length - 1;
  return list.map(function (w, i) {
    const pad = i === 0 ? padFirst : (i === last ? padLast : padMid);
    const raw = Math.ceil((typeof w === 'number' && isFinite(w) ? w : 0) + pad);
    return Math.min(max, Math.max(min, raw));
  });
}

// 竖向页码控件最多展示的页码项数（含首/末页与省略号），超出则用 null 表示省略号。
export const DESC_EX_PAGER_MAX_ITEMS = 7;

// 页码序列（用于竖向页码控件）：页码少时全列，多时窗口化 —— [1, …, p-1, p, p+1, …, n]，null 为省略号。
// 预留「首页 + 末页 + 2 个省略号」共 4 个位置，中间的连续页码窗口宽度为 limit - 4。
export function pageItems(page, pages, max) {
  const n = Math.max(1, Math.floor(pages) || 1);
  const cur = Math.min(Math.max(1, Math.floor(page) || 1), n);
  const limit = (typeof max === 'number' && max > 0) ? Math.floor(max) : DESC_EX_PAGER_MAX_ITEMS;
  if (n <= limit) {
    const all = [];
    for (let i = 1; i <= n; i++) all.push(i);
    return all;
  }
  const span = Math.max(1, limit - 4);
  const start = Math.min(Math.max(2, cur - Math.floor(span / 2)), n - 1 - span + 1);
  const end = start + span - 1;
  const out = [1];
  if (start > 2) out.push(null);
  for (let i = start; i <= end; i++) out.push(i);
  if (end < n - 1) out.push(null);
  out.push(n);
  return out;
}

// 是否展示表格工具（列排序 + 表头字段筛选）：仅当「总页数」超过阈值时展示。
export function descExToolsVisible(rowCount, pageSize, maxPages) {
  const per = Math.max(1, Math.floor(pageSize) || 1);
  const rows = Math.max(0, Math.floor(rowCount) || 0);
  const limit = (typeof maxPages === 'number' && maxPages > 0) ? Math.floor(maxPages) : DESC_EX_TOOLS_MAX_PAGES;
  return Math.ceil(rows / per) > limit;
}
