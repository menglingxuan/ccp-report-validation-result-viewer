/* ============================================================
 * core.js — 纯函数核心（无 DOM / 无应用状态，可被主线程与 Worker 共用）
 * 所有函数均为纯计算：相同输入 -> 相同输出，不读写全局状态。
 * ============================================================ */

/* ---------- 契约版本号（唯一权威定义） ----------
 * 这里有两个**互不相干**的版本号，不要再混用：
 *   - `CURRENT_FORMAT_VERSION` / `SUPPORTED_FORMAT_VERSIONS`：**数据契约版本**，
 *     来源是 `batch-meta.json` 的 `formatVersion`（不是 config.json！）。
 *     查看器只能加载白名单内的版本；生成器（JS / Java）与扫描器默认值都用 `CURRENT_FORMAT_VERSION`。
 *   - `CURRENT_CONFIG_VERSION` / `SUPPORTED_CONFIG_VERSIONS`：**config.json 的结构版本**
 *     （`configVersion`），只表达「配置文件结构」的演进；与批次能否加载**无关**。
 * 历史：v2 = 声明表 + id 引用的契约；v3 = 删除兼容层（不再接受 srcType / item.fields / scopes 等旧形态），
 * 因此 v2 数据仍可读（契约本身未变），但新生成的数据一律写 v3。
 * ------------------------------------------------------------------ */
export const CURRENT_FORMAT_VERSION = 3;
export const SUPPORTED_FORMAT_VERSIONS = [3];
export const CURRENT_CONFIG_VERSION = 1;
export const SUPPORTED_CONFIG_VERSIONS = [1];

// 批次 / 数据文件的 formatVersion 是否在查看器支持范围内（缺省按当前版本处理）。
export function formatVersionSupported(v, supported) {
  const list = Array.isArray(supported) && supported.length ? supported : SUPPORTED_FORMAT_VERSIONS;
  const n = v === undefined || v === null || v === '' ? CURRENT_FORMAT_VERSION : Number(v);
  return list.indexOf(n) !== -1;
}

// config.json 的 configVersion 是否被本查看器支持（未知 / 更新版本给告警用）。
export function configVersionSupported(v, supported) {
  const list = Array.isArray(supported) && supported.length ? supported : SUPPORTED_CONFIG_VERSIONS;
  const n = v === undefined || v === null || v === '' ? CURRENT_CONFIG_VERSION : Number(v);
  return list.indexOf(n) !== -1;
}

// 限定名（大小写不敏感）：tag:/userTag: 都会匹配「用户标签」列（含原始值与显示标签）。
const SEARCH_KEYS = { field: 'field', xpath: 'aoEl', csv: 'aoEl', tag: 'userTagHay', usertag: 'userTagHay', eo: 'eo', ao: 'ao', ctx: 'ctxs', desc: 'remarks' };

// 多文件清单里每个 item 的预计算 summary（total/passed/failed/rate/warnings/…）。
// 清单由外部工具生成，字段可能缺失或非数字：一律归一为数字（缺失 -> 0），
// 避免把 undefined 渲染到侧栏卡片，也避免筛选（存在失败 / 全部通过）出现不确定判定。
const ITEM_SUMMARY_KEYS = ['total', 'passed', 'failed', 'rate', 'warnings', 'warningsIgnored', 'errors', 'uncompared', 'logs'];
export function normalizeItemSummary(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  ITEM_SUMMARY_KEYS.forEach(function (k) {
    const v = s[k];
    out[k] = (typeof v === 'number' && isFinite(v)) ? v : 0;
  });
  return out;
}

/* ---------- 渠道 / 来源渠道的稳定标识（id）与「启用渠道」口径 ----------
 * 契约见 docs/DATA_SCHEMA.md §3/§4：
 *   - 定义侧：渠道 / 来源渠道 / 字段 / ctxKey 的**定义只在顶层声明表里写一次**
 *     （`$root.reportChannelDefs[] = {id,name,desc,format,fieldDefs}`、
 *      `$root.sourceChannelDefs[] = {id,name,format}`、`$root.usedCtxKeyDefs{} = {id,type,rules,def}`），
 *     item 里只保留 `id` 引用；预设 HKTR=1 / JSFA=2 / CFTC=3，来源渠道 A=1 / 来源渠道 B=2；
 *   - 启用侧：是否参与本次比较由 `item.channels[].enabled` 决定（缺省视为 true）——**唯一口径**，
 *     flatFields / 计数 / 图表 / 对比 / 全局搜索 / 统计 全部走它（历史上的 item.enabledChannels 名单已彻底移除）；
 *   - 引用侧：logs 与 skippedItems 写 id（logs 只写 id；skippedItems 名称 + id 双写）；
 *     warnings / errors / uncompared **只写名称**（不带 id，保持原始可读性）。
 * 查看器在加载时用 `hydrateDataset()` 把声明表整套补回 item（只有名称的老形态数据原样通过），
 * 因此渲染 / 搜索 / 忽略配置 / 深链接仍全部按**名称**工作。
 * id 只用于**稳定标识**：日志锚点、内部 locator（data-* 属性）、跨 item 关联。
 * ------------------------------------------------------------------ */
export const CHANNEL_ID_PRESET = { HKTR: 1, JSFA: 2, CFTC: 3 };
export const SOURCE_ID_PRESET = { '来源渠道 A': 1, '来源渠道 B': 2 };

export function channelIdOf(ch, index) {
  if (ch && typeof ch.id === 'number' && Number.isInteger(ch.id) && ch.id > 0) return ch.id;
  const preset = ch && CHANNEL_ID_PRESET[ch.name];
  return preset || (Number(index) + 1);
}
export function sourceIdOf(src, index) {
  if (src && typeof src.id === 'number' && Number.isInteger(src.id) && src.id > 0) return src.id;
  const preset = src && SOURCE_ID_PRESET[src.name];
  return preset || (Number(index) + 1);
}
// 渠道是否启用（缺省启用）。兼容 `enabledChannels` 时代的数据：那时渠道上没有 enabled，一律视为启用。
export function isChannelEnabled(ch) { return !ch || ch.enabled !== false; }
// 参与比较的渠道（含 id 归一）：所有计数 / 统计 / 渲染必须经此得到渠道集合。
export function enabledChannelsOf(item) {
  const out = [];
  ((item && item.channels) || []).forEach(function (ch, i) {
    if (isChannelEnabled(ch)) out.push({ ch: ch, index: i, id: channelIdOf(ch, i) });
  });
  return out;
}
export function enabledChannelIds(item) {
  return enabledChannelsOf(item).map(function (e) { return e.id; });
}
// 名称 -> id / id -> 名称（边界转换用；未登记时回退预设表，再不行返回 null / ''）。
export function channelIdByName(item, name) {
  const chs = (item && item.channels) || [];
  for (let i = 0; i < chs.length; i++) if (chs[i].name === name) return channelIdOf(chs[i], i);
  return CHANNEL_ID_PRESET[name] || null;
}
export function channelNameById(item, id) {
  const chs = (item && item.channels) || [];
  for (let i = 0; i < chs.length; i++) if (channelIdOf(chs[i], i) === id) return chs[i].name;
  const keys = Object.keys(CHANNEL_ID_PRESET);
  for (let i = 0; i < keys.length; i++) if (CHANNEL_ID_PRESET[keys[i]] === id) return keys[i];
  return '';
}
// 数据集级 id -> 名称映射（健康总览等跨 item 聚合的展示用）。
export function channelNameMap(items) {
  const map = {};
  Object.keys(CHANNEL_ID_PRESET).forEach(function (n) { map[CHANNEL_ID_PRESET[n]] = n; });
  (items || []).forEach(function (it) {
    ((it && it.channels) || []).forEach(function (ch, i) { map[channelIdOf(ch, i)] = ch.name; });
  });
  return map;
}
// 引用解析（消息 / 日志行 / 跳过条目）：优先 id，缺失时按名称回退。
export function refChannelId(item, m) {
  if (!m) return null;
  if (typeof m.channelId === 'number') return m.channelId;
  return m.channel ? channelIdByName(item, m.channel) : null;
}
export function refSourceId(item, m) {
  if (!m) return null;
  if (typeof m.sourceId === 'number') return m.sourceId;
  const chId = refChannelId(item, m);
  if (chId == null || !m.source) return null;
  const chs = (item && item.channels) || [];
  for (let i = 0; i < chs.length; i++) {
    if (channelIdOf(chs[i], i) !== chId) continue;
    const srcs = chs[i].sources || [];
    for (let j = 0; j < srcs.length; j++) if (srcs[j].name === m.source) return sourceIdOf(srcs[j], j);
  }
  return null;
}

/* ---------- 顶层声明表（$root.reportChannelDefs / sourceChannelDefs / usedCtxKeyDefs）----------
 * 归一化形态：所有**定义**只在顶层写一次，item 里只留 id 引用。
 *
 *   $root.reportChannelDefs = [ { id, name, desc, format, fieldDefs: [ {id,name,userTag,type} ] } ]
 *   $root.sourceChannelDefs = [ { id, name, format } ]                       // format: csv / xml
 *   $root.usedCtxKeyDefs    = { <ctxKey>: { id, type, rules, def } }         // rules: fdm / cvt / vdt
 *   item.ctxDefs            = { <ctxKey>: { id, hits } }                     // 只留 id 引用 + 命中数
 *   item.channels           = [ { id, enabled?, files, sources: [ { id, fields: [ …比较结果… ] } ] } ]
 *
 * 三个纯函数构成一组可逆变换（都返回新对象，不改动入参）：
 *   - `registriesOf()`：读出 id -> 定义 的映射（没声明表时返回空表）；
 *   - `hydrateDataset()` / `hydrateItem()`：把定义**整套**补回 item，使查看器其余代码继续按
 *     「item 里什么都有」的旧口径工作：渠道 name/desc/format、渠道 fieldDefs -> ch.fields、
 *     usedCtxKeyDefs 的 type/rules/def -> item.ctxDefs、消息与日志行缺失的名称按 id 补回。
 *     **绝不解析日志文本**（text 只是展示内容）；只有名称的老形态数据原样通过。
 *   - `hoistRegistries()`：反向，把定义提到顶层、item 只留 id（生成器 / 迁移工具用）。
 * 定义冲突（同一 id 指向不同名称、同一名称使用不同 id、同一字段 id 定义不一致、同一 ctxKey 定义不一致）
 * 在 `hoistRegistries()` 里直接抛错：静默取第一个会把「数据自相矛盾」变成看不见的数据丢失。
 * ------------------------------------------------------------------ */

/** 顶层报告渠道声明表：id -> { id, name, desc, format, fieldDefs, fieldById }。无声明表时返回空对象。 */
export function channelRegistryMap(root) {
  const map = {};
  const list = root && Array.isArray(root.reportChannelDefs) ? root.reportChannelDefs : [];
  list.forEach(function (c) {
    if (!c || typeof c.id !== 'number') return;
    const fieldDefs = Array.isArray(c.fieldDefs) ? c.fieldDefs : [];
    const fieldById = {};
    fieldDefs.forEach(function (d) {
      if (d && d.id != null) fieldById[String(d.id)] = d;
    });
    map[c.id] = {
      id: c.id,
      name: c.name || '',
      desc: c.desc == null ? '' : c.desc,
      format: c.format || '',
      fieldDefs: fieldDefs,
      fieldById: fieldById,
    };
  });
  return map;
}

/** 顶层来源渠道声明表：id -> { id, name, format }。无声明表时返回空对象。 */
export function sourceRegistryMap(root) {
  const map = {};
  const list = root && Array.isArray(root.sourceChannelDefs) ? root.sourceChannelDefs : [];
  list.forEach(function (s) {
    if (s && typeof s.id === 'number') map[s.id] = { id: s.id, name: s.name || '', format: s.format || '' };
  });
  return map;
}

/** 顶层 ctxKey 声明表：{ byId, byKey }（byKey[key] = { id, key, type, rules, def }）。无声明表时返回空表。 */
export function ctxKeyRegistry(root) {
  const byId = {};
  const byKey = {};
  const defs = (root && root.usedCtxKeyDefs) || {};
  Object.keys(defs).forEach(function (k) {
    const d = defs[k] || {};
    const entry = {
      id: typeof d.id === 'number' ? d.id : null,
      key: k,
      type: d.type === 'user' ? 'user' : 'builtin',
      rules: normalizeCtxRules(d),
      def: d.def == null ? '' : d.def,
    };
    byKey[k] = entry;
    if (entry.id != null) byId[entry.id] = entry;
  });
  return { byId: byId, byKey: byKey };
}

/** 三张声明表一起读（hydrate 用）。 */
export function registriesOf(root) {
  return {
    channels: channelRegistryMap(root),
    sources: sourceRegistryMap(root),
    ctxKeys: ctxKeyRegistry(root),
  };
}

// 带渠道 / 来源渠道引用的消息段：item 级的 warnings / errors / uncompared / logs，
// 以及数据集级的 skippedItems（同构）。
// 这些段里的 `channel` / `source` 是**展示用名称**，`channelId` / `sourceId` 是稳定标识：
// 新生成的数据里 logs / skippedItems 只写 id，名称由查看器加载时按 id 解析回来；
// warnings / errors / uncompared 反过来只写名称（不带 id，保持原始可读性）。
const REF_SECTIONS = ['warnings', 'errors', 'uncompared', 'logs'];

// 按 id 把名称补回消息 / 日志行：**只补缺失的名称**，不覆盖已有的，也**绝不解析 text**
// （日志文本是给人看的展示内容，真实数据里可能完全不含渠道相关信息）。
// 名称 -> id 的反向解析是 hoistRegistries / refChannelId 的职责，不在这里做。
function fillRefNames(entry, chReg, srcReg) {
  if (!entry || typeof entry !== 'object') return entry;
  const chDef = entry.channelId != null ? chReg[entry.channelId] : null;
  const srcDef = entry.sourceId != null ? srcReg[entry.sourceId] : null;
  const needCh = !!chDef && (entry.channel == null || entry.channel === '');
  const needSrc = !!srcDef && (entry.source == null || entry.source === '');
  if (!needCh && !needSrc) return entry;
  const out = Object.assign({}, entry);
  if (needCh) out.channel = chDef.name;
  if (needSrc) out.source = srcDef.name;
  return out;
}

/** 把顶层声明表的定义补回单个 item（缺定义时保持原样；老形态数据不受影响）。 */
export function hydrateItem(item, registries) {
  const chReg = (registries && registries.channels) || {};
  const srcReg = (registries && registries.sources) || {};
  const ctxReg = (registries && registries.ctxKeys) || { byId: {}, byKey: {} };
  const out = Object.assign({}, item);
  out.channels = ((item && item.channels) || []).map(function (ch) {
    const def = chReg[ch.id] || {};
    const merged = Object.assign({}, ch, {
      name: ch.name != null && ch.name !== '' ? ch.name : (def.name || ''),
    });
    if (merged.desc == null) merged.desc = def.desc || '';
    if (merged.format == null) merged.format = def.format || '';
    // 字段定义注册表在顶层（reportChannelDefs[].fieldDefs）：补回 item，后续所有字段查找照旧。
    if (!Array.isArray(merged.fields)) merged.fields = def.fieldDefs || [];
    merged.sources = ((ch.sources) || []).map(function (s) {
      const sdef = srcReg[s.id] || {};
      const smerged = Object.assign({}, s, {
        name: s.name != null && s.name !== '' ? s.name : (sdef.name || ''),
      });
      if (smerged.format == null || smerged.format === '') smerged.format = sdef.format || '';
      return smerged;
    });
    return merged;
  });
  // item.ctxDefs：文件里只有 { id, hits }，type / rules / def 从顶层 usedCtxKeyDefs 补回。
  if (item.ctxDefs && typeof item.ctxDefs === 'object' && !Array.isArray(item.ctxDefs)) {
    const mergedDefs = {};
    Object.keys(item.ctxDefs).forEach(function (key) {
      const local = item.ctxDefs[key] || {};
      const decl = (typeof local.id === 'number' ? ctxReg.byId[local.id] : null) || ctxReg.byKey[key] || {};
      const m = Object.assign({}, local);
      if (m.id == null && decl.id != null) m.id = decl.id;
      if (m.type == null) m.type = decl.type || 'builtin';
      if (!Array.isArray(m.rules)) m.rules = Array.isArray(decl.rules) ? decl.rules.slice() : [];
      if (m.def == null || m.def === '') m.def = decl.def || '';
      mergedDefs[key] = m;
    });
    out.ctxDefs = mergedDefs;
  }
  // 消息 / 日志行的渠道与来源渠道名称：同样按 id 从声明表解析（只在名称缺失时补）。
  REF_SECTIONS.forEach(function (k) {
    if (!Array.isArray(item[k])) return;
    out[k] = item[k].map(function (e) { return fillRefNames(e, chReg, srcReg); });
  });
  return out;
}

/** 把顶层声明表的定义补回整个数据集（查看器加载时的唯一入口；幂等）。 */
export function hydrateDataset(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.items)) return json;
  const reg = registriesOf(json);
  if (!Object.keys(reg.channels).length && !Object.keys(reg.sources).length && !Object.keys(reg.ctxKeys.byId).length) {
    return json; // 只有名称、无 id / 声明的老形态
  }
  const out = Object.assign({}, json, { items: json.items.map(function (it) { return hydrateItem(it, reg); }) });
  // skippedItems 是数据集级条目（引用别的 item 的渠道 / 来源渠道）：名称同样按 id 补回。
  if (Array.isArray(json.skippedItems)) {
    out.skippedItems = json.skippedItems.map(function (s) { return fillRefNames(s, reg.channels, reg.sources); });
  }
  return out;
}

/** 收集 item 里的报告渠道 / 来源渠道 / 字段定义（hoist 的第一步；同时报出冲突）。 */
export function collectDefinitions(items) {
  const channels = [];
  const sources = [];
  const chById = {};
  const chByName = {};
  const srcById = {};
  const conflicts = [];
  (items || []).forEach(function (it, ii) {
    const label = (it && it.tradeId) || ('items[' + ii + ']');
    ((it && it.channels) || []).forEach(function (ch) {
      if (!ch || typeof ch.id !== 'number') return;
      const name = ch.name || '';
      let chDef = chById[ch.id];
      if (chDef != null && chDef.name !== name) {
        conflicts.push(label + ' 报告渠道 id=' + ch.id + ' 在不同 item 里指向不同名称：「' + chDef.name + '」/「' + name + '」');
      } else if (chByName[name] != null && chByName[name].id !== ch.id) {
        conflicts.push(label + ' 报告渠道「' + name + '」在不同 item 里使用不同 id：' + chByName[name].id + ' / ' + ch.id);
      } else if (chDef == null) {
        chDef = { id: ch.id, name: name, fieldDefs: [], __fieldById: {} };
        if (ch.desc != null && ch.desc !== '') chDef.desc = ch.desc;
        if (ch.format != null && ch.format !== '') chDef.format = ch.format;
        chById[ch.id] = chDef;
        chByName[name] = chDef;
        channels.push(chDef);
      }
      // 报告渠道的字段定义注册表（item.channels[].fields）：
      // 定义是数据集级的，因此取所有 item 的并集（同一字段 id 的定义必须一致）。
      const fieldDefs = Array.isArray(ch.fields) ? ch.fields : [];
      fieldDefs.forEach(function (d) {
        if (!d || d.id == null) return;
        const key = String(d.id);
        const prev = chDef.__fieldById[key];
        if (prev == null) {
          const copy = Object.assign({}, d, { id: key });
          chDef.__fieldById[key] = copy;
          chDef.fieldDefs.push(copy);
        } else if (prev.name !== d.name || prev.userTag !== d.userTag || prev.type !== d.type) {
          conflicts.push(label + ' 报告渠道「' + name + '」的字段 id=' + key + ' 定义在不同 item 里不一致');
        }
      });
      ((ch.sources) || []).forEach(function (s) {
        if (!s || typeof s.id !== 'number') return;
        const sname = s.name || '';
        if (srcById[s.id] != null && srcById[s.id].name !== sname) {
          conflicts.push(label + ' 来源渠道 id=' + s.id + ' 指向不同名称：「' + srcById[s.id].name + '」/「' + sname + '」');
        } else if (srcById[s.id] == null) {
          // 来源渠道的数据格式 = 该来源比对值侧的格式（cmpLeft.valueSrcFmt；缺省 csv）。
          let fmt = '';
          (s.fields || []).forEach(function (f) {
            const side = (f && f.cmpLeft) || {};
            const v = side.valueSrcFmt;
            if (!fmt && v) fmt = v;
          });
          srcById[s.id] = { id: s.id, name: sname, format: fmt || 'csv' };
          sources.push(srcById[s.id]);
        }
      });
    });
  });
  const byId = function (a, b) { return a.id - b.id; };
  channels.forEach(function (c) {
    c.fieldDefs.sort(function (a, b) { return Number(a.id) - Number(b.id); });
    delete c.__fieldById;
  });
  return { channels: channels.sort(byId), sources: sources.sort(byId), conflicts: conflicts };
}

// ctxKey 规则的规范顺序（展示 / 输出都用它，保证数据稳定可控）。
export const CTX_RULES = ['fdm', 'cvt', 'vdt'];

// 规则只认名称（fdm / cvt / vdt）；未声明 / 非法值一律丢弃。
function normalizeCtxRules(def) {
  const raw = Array.isArray(def.rules) ? def.rules : (def.rules == null ? [] : [def.rules]);
  const out = [];
  raw.forEach(function (r) {
    if (CTX_RULES.indexOf(r) >= 0 && out.indexOf(r) === -1) out.push(r);
  });
  return CTX_RULES.filter(function (n) { return out.indexOf(n) !== -1; });
}

/** 收集 item 里的 ctxKey 定义（hoist 用）：<ctxKey> -> { id, type, rules, def }；定义冲突时报错。 */
export function collectCtxDefs(items) {
  const byKey = {};
  const conflicts = [];
  (items || []).forEach(function (it, ii) {
    const label = (it && it.tradeId) || ('items[' + ii + ']');
    const defs = (it && it.ctxDefs) || {};
    Object.keys(defs).forEach(function (key) {
      const local = defs[key] || {};
      const id = typeof local.id === 'number' ? local.id : null;
      const type = local.type === 'user' ? 'user' : 'builtin';
      const rules = normalizeCtxRules(local);
      const def = local.def == null ? '' : local.def;
      const prev = byKey[key];
      if (prev == null) {
        byKey[key] = { id: id, type: type, rules: rules, def: def };
        return;
      }
      if (prev.id !== id) {
        conflicts.push(label + ' ctxKey「' + key + '」在不同 item 里使用不同 id：' + prev.id + ' / ' + id);
      } else if (prev.def !== def || prev.type !== type) {
        conflicts.push(label + ' ctxKey「' + key + '」的定义在不同 item 里不一致');
      }
      rules.forEach(function (r) { if (prev.rules.indexOf(r) === -1) prev.rules.push(r); });
    });
  });
  Object.keys(byKey).forEach(function (k) {
    byKey[k].rules = CTX_RULES.filter(function (r) { return byKey[k].rules.indexOf(r) >= 0; });
  });
  return { byKey: byKey, conflicts: conflicts };
}

/**
 * 把定义提到顶层、item 只留 id 引用（生成器 / 迁移工具的最后一步）。
 *
 *   - 渠道 / 来源渠道 / 字段定义 -> `$root.reportChannelDefs`（含 `fieldDefs`）；
 *   - ctxKey 定义（除 `hits`）-> `$root.usedCtxKeyDefs`，item 内只留 `{ id, hits }`；
 *   - `warnings` / `errors` / `uncompared` 去掉 `channelId` / `sourceId`（只保留名称，原始可读）；
 *   - `logs` / `skippedItems` 保持 id（logs 只写 id，skippedItems 名称 + id 双写）。
 *
 * 定义冲突时直接抛错 —— 生成器数据不可能冲突，只有手写 / 迁移数据才会。
 * `skippedItems` 引用的渠道 / 来源渠道也会被补进声明表（被跳过的 item 不在 items 里，
 * 而契约要求「引用 ⊆ 声明」）。
 */
export function hoistRegistries(dataset) {
  if (!dataset || typeof dataset !== 'object' || !Array.isArray(dataset.items)) return dataset;
  const defs = collectDefinitions(dataset.items);
  const ctxDefs = collectCtxDefs(dataset.items);
  const defineById = function (list, id, def) {
    if (id == null) return;
    if (list.some(function (x) { return x.id === id; })) return;
    list.push(def);
  };
  const byId = function (a, b) { return a.id - b.id; };
  (dataset.skippedItems || []).forEach(function (s) {
    if (!s) return;
    if (s.channelId != null && s.channel != null && s.channel !== '') {
      defineById(defs.channels, s.channelId, { id: s.channelId, name: s.channel, fieldDefs: [] });
    }
    if (s.sourceId != null && s.source != null && s.source !== '') {
      defineById(defs.sources, s.sourceId, { id: s.sourceId, name: s.source, format: 'csv' });
    }
  });
  defs.channels.forEach(function (c) { if (!Array.isArray(c.fieldDefs)) c.fieldDefs = []; });
  defs.channels.sort(byId);
  defs.sources.sort(byId);
  const conflicts = defs.conflicts.concat(ctxDefs.conflicts);
  if (conflicts.length) {
    throw new Error('渠道 / 来源渠道 / ctxKey 定义不一致，无法集中到顶层声明表：\n  - ' + conflicts.join('\n  - '));
  }
  const items = dataset.items.map(function (it) {
    const out = Object.assign({}, it);
    // 消息只保留名称（channelId / sourceId 属于冗余：日志行才需要 id 定位）。
    ['warnings', 'errors', 'uncompared'].forEach(function (k) {
      if (!Array.isArray(it[k])) return;
      out[k] = it[k].map(function (m) {
        if (!m || typeof m !== 'object' || Array.isArray(m)) return m;
        const copy = Object.assign({}, m);
        delete copy.channelId;
        delete copy.sourceId;
        return copy;
      });
    });
    // ctxDefs：定义提到顶层，item 只留 { id, hits }。
    if (it.ctxDefs && typeof it.ctxDefs === 'object' && !Array.isArray(it.ctxDefs)) {
      const slim = {};
      Object.keys(it.ctxDefs).forEach(function (key) {
        const local = it.ctxDefs[key] || {};
        const decl = ctxDefs.byKey[key];
        const entry = {};
        const id = decl && typeof decl.id === 'number' ? decl.id : local.id;
        if (typeof id === 'number') entry.id = id;
        if (local.hits !== undefined) entry.hits = local.hits;
        slim[key] = entry;
      });
      out.ctxDefs = slim;
    }
    delete out.fields; // 老形态的 item 级字段注册表：已提到顶层 fieldDefs
    out.channels = ((it && it.channels) || []).map(function (ch) {
      const c = { id: ch.id };
      if (ch.enabled === false) c.enabled = false;
      if (ch.files !== undefined) c.files = ch.files;
      c.sources = ((ch.sources) || []).map(function (s) {
        const o = { id: s.id };
        if (s.fields !== undefined) o.fields = s.fields;
        return o;
      });
      return c;
    });
    return out;
  });
  const out = {};
  Object.keys(dataset).forEach(function (k) {
    // 已经重新写出的顶层成员（含被移动了位置的 skippedItems）与旧形态顶层键都不再复制。
    if (k === 'reportChannelDefs' || k === 'sourceChannelDefs' || k === 'usedCtxKeyDefs'
      || k === 'skippedItems' || k === 'items') return;
    out[k] = dataset[k];
  });
  // 键顺序固定为「其余顶层字段 -> 三张声明表 -> skippedItems -> items」
  // （声明表读在数据前、skippedItems 紧跟声明表之后，便于人读；JSON 键顺序不影响解析）。
  out.reportChannelDefs = defs.channels;
  out.sourceChannelDefs = defs.sources;
  out.usedCtxKeyDefs = ctxDefs.byKey;
  if (dataset.skippedItems !== undefined) out.skippedItems = dataset.skippedItems;
  out.items = items;
  return out;
}

/* ---------- 「完整日志」字段定位（日志锚点） ----------
 * 数据契约见 docs/DATA_SCHEMA.md §3：scope="field" 的日志行带 field（字段 id）且 channelId / sourceId 非空。
 *   - 合成键 = **channelId | sourceId | fieldId**（数字，天然无歧义；不再需要名称 slug / 哈希与碰撞兜底）；
 *   - DOM id = log-<channelId>-<sourceId>-f<字段id>.<同键序号>，例 log-1-1-f2.1；
 *     同键序号 = 该行在同键行中的次序（按 item.logs 顺序编号，与搜索 / 作用域筛选无关 -> id 稳定）。
 * 名称（channel / source）只用于展示，由 hydrateItem() 按 id 从声明表解析回来。
 * ------------------------------------------------------------------ */
export function logFieldKey(channelId, sourceId, fieldId) {
  return String(channelId == null ? '' : channelId) + '|' + String(sourceId == null ? '' : sourceId) + '|' + String(fieldId || '');
}
export function logAnchorId(channelId, sourceId, fieldId, seq) {
  return 'log-' + String(channelId == null ? 'x' : channelId) + '-' + String(sourceId == null ? 'x' : sourceId) +
    '-f' + String(fieldId || '') + '.' + (seq || 1);
}
// 带锚点的日志行：scope="field" 且渠道 / 来源渠道 / field 三值齐备。
// 判定只认 id 或名称两个**结构化字段**（id 优先），**绝不解析 text**：日志文本是展示内容，
// 真实数据可能完全不含渠道信息，前缀格式也不保证。
export function isFieldLogLine(l) {
  if (!l || l.scope !== 'field' || !l.field) return false;
  const hasChannel = l.channelId != null || (typeof l.channel === 'string' && l.channel !== '');
  const hasSource = l.sourceId != null || (typeof l.source === 'string' && l.source !== '');
  return hasChannel && hasSource;
}

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
  // 用户标签：优先用「原始值 + 显示标签」合并字段（userTagHay），使界面显示的标签也可直接搜到。
  const tag = r.userTagHay != null ? r.userTagHay : r.userTag;
  return r.field + ' ' + tag + ' ' + r.aoEl + ' ' + r.eoEl + ' ' + r.eoCvtEl + ' ' + r.aoCvtEl + ' ' + r.vdtEl + ' ' + r.eoUnconverted + ' ' + r.aoUnconverted + ' ' + r.eo + ' ' + r.ao + ' ' + (r.remarks || '') + ' ' + ((r.ctxKeys || r.ctxs) || []).join(' ');
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

export function flatFields(item, tagLabels) {
  const rows = [];
  // ctxDefs id → key 反向映射（用于搜索 / 显示 / 排序时把 id 解析为可读 key）。
  const keyById = {};
  const ctxDefs = item.ctxDefs || {};
  Object.keys(ctxDefs).forEach(function (k) { keyById[ctxDefs[k].id] = k; });
  // 「启用渠道」唯一口径：只展开参与本次比较的渠道（channels[].enabled，缺省启用）。
  // 未启用渠道的字段行不属于本次比较结果，任何地方都不应展示 / 统计（历史上统计卡与字段表就因此各算一套）。
  enabledChannelsOf(item).forEach(function (entry) {
    const ch = entry.ch;
    const chId = entry.id;
    // 字段注册表为 report channel 级别：每个渠道的字段定义不同。
    const defs = {};
    (ch.fields || []).forEach(function (d) { defs[d.id] = d; });
    (ch.sources || []).forEach(function (s, si) {
      const srcId = sourceIdOf(s, si);
      (s.fields || []).forEach(f => {
        const def = defs[f.id] || {};
        // 用户标签的搜索用合并串：原始值（如 platformAssertion）+ 显示标签（如「平台断言」），
        // 标签映射由调用方按当前语言解析后传入（纯函数不依赖配置 / i18n）。
        const tagRaw = def.userTag || '';
        const tagLabel = tagLabels && tagRaw && tagLabels[tagRaw] != null ? String(tagLabels[tagRaw]) : '';
        const tagHay = tagLabel && tagLabel !== tagRaw ? tagRaw + ' ' + tagLabel : tagRaw;
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
          channel: ch.name, source: s.name, channelId: chId, sourceId: srcId,
          id: f.id, field: def.name, userTag: tagRaw, userTagHay: tagHay,
          // 表达式 / 预览列：aoEl/eoEl 为左右侧定位（XPath 或 CSV 列），其余为各规则的原始表达式与未转换值。
          aoEl: right.el || '', valueSrcFmt: right.valueSrcFmt || 'xml',
          eoEl: left.el || '',
          eoCvtEl: cvtL.el || '',
          aoCvtEl: cvtR.el || '',
          vdtEl: vdt.el || '',
          eoUnconverted: cvtL.raw != null ? cvtL.raw : '',
          aoUnconverted: cvtR.raw != null ? cvtR.raw : '',
          type: def.type, ctxs: ctxUnion, ctxKeys: ctxKeys,
          eo: left.value, ao: right.value, result: f.result, remarks: f.remarks,
          // prints 保留待用（字段详情页已改为从「完整日志」读取该字段的关联日志行，见 app.js 的 fieldLogLines）。
          prints: f.prints,
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
// 口径：只统计**启用渠道**（channels[].enabled）的字段与消息；channel 参数为**渠道名**（界面/URL 口径）或 'ALL'。
export function computeHealthPure(items, date, channel, ignoreConfig) {
  let total = 0, passed = 0, failed = 0, warnings = 0, errors = 0;
  const errAgg = {}, warnAgg = {};
  const list = (!date || date === 'ALL') ? items.slice() : items.filter(function (it) { return it.reportDate === date; });
  const perItem = list.map(function (it) {
    let pTotal = 0, pPassed = 0, pFailed = 0, pWarn = 0, pErr = 0;
    const enabledIds = enabledChannelIds(it);
    // 消息 / 日志的作用域判定：item 级（无渠道 id）恒在作用域内；渠道级必须已启用且命中渠道筛选。
    const chInScope = function (m) {
      const id = refChannelId(it, m);
      if (id == null) return true;
      if (enabledIds.indexOf(id) === -1) return false;
      if (channel && channel !== 'ALL' && channelNameById(it, id) !== channel) return false;
      return true;
    };
    enabledChannelsOf(it).forEach(function (entry) {
      const ch = entry.ch;
      if (channel && channel !== 'ALL' && ch.name !== channel) return;
      (ch.sources || []).forEach(function (s) { (s.fields || []).forEach(function (fd) { pTotal++; fd.result === 'PASSED' ? pPassed++ : pFailed++; }); });
    });
    (it.errors || []).forEach(function (e) {
      if (!chInScope(e)) return;
      pErr++; const k = (e.type || '?') + '|' + e.channel; errAgg[k] = (errAgg[k] || 0) + 1;
    });
    (it.warnings || []).forEach(function (w) {
      if (!chInScope(w)) return;
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

/* ---------- item 级统计摘要（侧栏卡片 / 多文件清单 summary，唯一口径） ---------- */
// 唯一口径：字段只统计**启用渠道**（channels[].enabled）；消息 / 日志按作用域过滤
// （item 级恒在作用域内，渠道级必须已启用）。
// 侧栏卡片（app.js itemStatsAll）与写进多文件清单的 summary（sample-data.js）
// 都走这里，保证「卡片字段数」与「字段表条数」永远一致。
export function itemStatsPure(item, ignoreConfig) {
  const enabledIds = enabledChannelIds(item);
  const inScope = function (m) {
    const id = refChannelId(item, m);
    return id == null || enabledIds.indexOf(id) !== -1;
  };
  let total = 0, passed = 0, failed = 0;
  let warnings = 0, warningsIgnored = 0, errors = 0, uncompared = 0, logs = 0;
  enabledChannelsOf(item).forEach(function (entry) {
    ((entry.ch && entry.ch.sources) || []).forEach(function (s) {
      (s.fields || []).forEach(function (fd) { total++; fd.result === 'PASSED' ? passed++ : failed++; });
    });
  });
  ((item && item.errors) || []).forEach(function (e) { if (inScope(e)) errors++; });
  ((item && item.warnings) || []).forEach(function (w) {
    if (!inScope(w)) return;
    // platform 跟随 item：计算忽略 key 时从 item 注入（source 条目自带，可能为空）。
    const wm = Object.assign({}, w, { platform: item.platform });
    if (msgIsIgnoredPure('warnings', wm, ignoreConfig)) warningsIgnored++;
    else warnings++;
  });
  ((item && item.uncompared) || []).forEach(function (u) { if (inScope(u)) uncompared++; });
  ((item && item.logs) || []).forEach(function (l) { if (inScope(l)) logs++; });
  return {
    total: total, passed: passed, failed: failed,
    rate: total ? Math.round(passed / total * 100) : 0,
    warnings: warnings, warningsIgnored: warningsIgnored, errors: errors, uncompared: uncompared, logs: logs,
  };
}

/* ---------- 全局搜索（跨 item） ---------- */
// opts.tagLabels：用户标签「原始值 → 当前语言显示标签」映射（可选）；传入后可用显示标签搜索。
// 口径：flatFields 已经只展开**启用渠道**（channels[].enabled），因此这里无需再做渠道过滤。
export function globalSearchPure(items, q, limit, opts) {
  const pq = parseSearchQuery(q);
  const matcher = makeMatcher(pq);
  const tagLabels = opts && opts.tagLabels;
  const results = [];
  if (!matcher) return results;
  items.forEach(function (it) {
    flatFields(it, tagLabels).forEach(function (r) {
      if (matchRow(r, pq, matcher)) {
        results.push({ itemId: it.tradeId, channel: r.channel, source: r.source, channelId: r.channelId, sourceId: r.sourceId, fieldId: r.id, field: r.field, userTag: r.userTag, snippet: r.eo + ' → ' + r.ao });
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
