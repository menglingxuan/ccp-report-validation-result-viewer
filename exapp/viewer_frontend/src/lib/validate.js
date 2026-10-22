// 轻量数据校验器（零依赖）：校验数据文件顶层结构与关键字段，返回错误列表。
// 用于服务启动时 / 扫描时提前发现坏数据，避免前端渲染崩溃。
//
//   import { validateDataset } from './lib/validate.js';
//   const { ok, errors } = validateDataset(json);
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHANNEL_ID_PRESET, SOURCE_ID_PRESET, CTX_RULES } from '../public/core.js';

// { name: id } -> { id: name }
function invert(map) {
  const out = {};
  Object.keys(map).forEach(function (k) { out[map[k]] = k; });
  return out;
}

// 消息段（warnings / errors / uncompared）的渠道 / 来源渠道引用：**只写名称**。
// 原始可读性是这些段的首要目标（条目少、人工排查时直接看名字），因此不带 id；
// 名称必须能在顶层声明表里解析（引用 ⊆ 声明），悬空名称照样会在扫描时被指出。
function checkMessageRef(m, label, errors, opts) {
  const o = opts || {};
  ['channel', 'source'].forEach(function (k) {
    if (m[k] !== undefined && m[k] !== null && typeof m[k] !== 'string') {
      errors.push(label + ' ' + k + ' 必须是字符串或 null');
    }
    if (m[k + 'Id'] !== undefined) {
      errors.push(label + ' ' + k + 'Id 已移除（消息段只写名称；需要 id 定位的只有 logs / skippedItems）');
    }
  });
  // 来源渠道属于某个报告渠道：写了 source 就必须有 channel。
  if (m.source != null && m.source !== '' && (m.channel == null || m.channel === '')) {
    errors.push(label + ' source 存在时必须提供 channel（来源渠道属于某个报告渠道）');
  }
  if (typeof m.channel === 'string' && m.channel !== '' && o.hasChannel && !o.hasChannel(m.channel)) {
    errors.push(label + ' channel「' + m.channel + '」未在顶层 reportChannelDefs 声明表里声明');
  }
  if (typeof m.source === 'string' && m.source !== '' && o.hasSource && !o.hasSource(m.source)) {
    errors.push(label + ' source「' + m.source + '」未在顶层 sourceChannelDefs 声明表里声明');
  }
}

// 按 id 引用的渠道 / 来源渠道（logs 只写 id；skippedItems 名称 + id 双写）：id 是硬性的，名称可省。
// 只写 channelId / sourceId 时由查看器在加载时按 id 从声明表解析出名称（见 core.js hydrateItem）；
// 名称与 id 都写时必须指向同一渠道 / 来源渠道。id 可为 null（表示未关联到具体渠道 / 来源）。
function checkIdRefFields(m, label, errors, opts) {
  const o = opts || {};
  ['channel', 'source'].forEach(function (k) {
    if (m[k] !== undefined && m[k] !== null && typeof m[k] !== 'string') {
      errors.push(label + ' ' + k + ' 必须是字符串或 null');
    }
  });
  ['channelId', 'sourceId'].forEach(function (k) {
    if (m[k] === undefined || m[k] === null) return;
    if (typeof m[k] !== 'number' || !Number.isInteger(m[k]) || m[k] <= 0) {
      errors.push(label + ' ' + k + ' 必须是正整数或 null');
    }
  });
  // sourceId 必须与 channelId 成对（来源 id 只在渠道内唯一）。
  if (m.sourceId != null && m.channelId == null) {
    errors.push(label + ' sourceId 存在时必须提供 channelId（来源 id 只在渠道内唯一）');
  }
  // 名称若给出（logs 的旧写法 / skippedItems）也必须已声明；非字符串的名称只报类型错误（上面）。
  if (typeof m.channel === 'string' && m.channel !== '' && o.hasChannel && !o.hasChannel(m.channel)) {
    errors.push(label + ' channel「' + m.channel + '」未在顶层 reportChannelDefs 声明表里声明');
  }
  if (typeof m.source === 'string' && m.source !== '' && o.hasSource && !o.hasSource(m.source)) {
    errors.push(label + ' source「' + m.source + '」未在顶层 sourceChannelDefs 声明表里声明');
  }
  // 与名称的一致性：双写时两边必须指向同一渠道 / 来源渠道。
  // opts.expectKnown=false 时（skippedItems 这类引用了「不在 items 中的 item」的条目），
  // 解析不到的 id 不再报错——无从验证，只验证能验证的那部分。
  const expectKnown = o.expectKnown !== false;
  if (o.resolveChannelName && m.channelId != null) {
    const name = o.resolveChannelName(m.channelId);
    if (name == null) {
      if (expectKnown) errors.push(label + ' channelId=' + m.channelId + ' 未在顶层 reportChannelDefs 声明表里声明');
    } else if (m.channel && m.channel !== name) {
      errors.push(label + ' channel(' + m.channel + ') 与 channelId(' + m.channelId + ' → ' + name + ') 不一致');
    }
  }
  if (o.resolveSourceName && m.sourceId != null && m.channelId != null) {
    const sname = o.resolveSourceName(m.sourceId);
    if (sname == null) {
      if (expectKnown) errors.push(label + ' sourceId=' + m.sourceId + ' 未在顶层 sourceChannelDefs 声明表里声明');
    } else if (m.source && m.source !== sname) {
      errors.push(label + ' source(' + m.source + ') 与 sourceId(' + m.sourceId + ' → ' + sname + ') 不一致');
    }
  }
}

// 日志行契约（`item.logs[]`，见 docs/DATA_SCHEMA.md §3）：
//   { scope, channelId, sourceId, field, text }
//   - scope 只能是 item / channel / field；
//   - field（字段 id）仅在 scope="field" 时有值，且此时 channelId / sourceId 必须非空；
//   - 渠道 / 来源渠道**只写 id**（名称由查看器按 id 从声明表解析回来）；
//   - text 是给人看的展示内容：**不是数据通道**，不得用它携带渠道 / 来源信息。
function validateLogEntries(list, label, errors, opts) {
  list.forEach(function (l, li) {
    const llabel = label + '[' + li + ']';
    if (!l || typeof l !== 'object' || Array.isArray(l)) { errors.push(llabel + ' 必须是对象'); return; }
    if (typeof l.text !== 'string') errors.push(llabel + ' 缺少 text 字符串');
    if (l.scope !== undefined && l.scope !== null
        && l.scope !== 'item' && l.scope !== 'channel' && l.scope !== 'field') {
      errors.push(llabel + ' scope 只能是 "item" / "channel" / "field"');
    }
    if (l.field !== undefined && l.field !== null && typeof l.field !== 'string') {
      errors.push(llabel + ' field 必须是字符串或 null');
    }
    checkIdRefFields(l, llabel, errors, opts);
    const field = typeof l.field === 'string' ? l.field : '';
    if (!field) return;
    if (l.scope !== 'field') errors.push(llabel + ' 只有 scope="field" 的日志行才允许有 field');
    if (l.channelId == null || l.sourceId == null) {
      errors.push(llabel + ' field 非空时 channelId 与 sourceId 都不能为空（锚点与关联用 id，不解析 text）');
    }
  });
}

export function validateDataset(json) {
  const errors = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, errors: ['数据文件顶层必须是对象'] };
  }
  if (!Array.isArray(json.items)) {
    errors.push('缺少 items 数组');
    return { ok: false, errors };
  }
  if (json.mode !== undefined && json.mode !== 'single' && json.mode !== 'multi') {
    errors.push('mode 只能是 "single" 或 "multi"，当前为：' + json.mode);
  }
  if (json.reportEnv !== undefined && json.reportEnv !== null && typeof json.reportEnv !== 'string') {
    errors.push('reportEnv 必须是字符串');
  }
  // 顶层 creationType / skippedItems 为单文件与多文件清单共有字段（见 docs/DATA_SCHEMA.md §1 / §2）。
  // 显式 null 视为「未提供」（Java 生成器的 ObjectMapper 保留 null）。
  if (json.creationType !== undefined && json.creationType !== null
      && json.creationType !== 'sample' && json.creationType !== 'user') {
    errors.push('creationType 只能是 "sample" 或 "user"，当前为：' + json.creationType);
  }
  // 顶层声明表（`$root.reportChannelDefs` / `$root.sourceChannelDefs` / `$root.usedCtxKeyDefs`）：
  // 渠道 / 来源渠道 / 字段 / ctxKey 的**定义**只写一次。
  // 契约：item.channels / item.ctxDefs / 规则里的 ctx 引用**必须是已声明的**（引用 ⊆ 声明）；
  // item 里可以重复写名称（便于人读），但必须与声明一致。
  // 三张表都允许省略：只有都不被引用时才不需要（空数据集 / 无 channels 的夹具）。
  // 键顺序固定为 `mode` → `reportEnv` → `creationType` → `reportChannelDefs` → `sourceChannelDefs`
  // → `usedCtxKeyDefs` → `skippedItems` → `items`（见 docs/DATA_SCHEMA.md §1）。
  if (json.reportChannelDefs !== undefined && !Array.isArray(json.reportChannelDefs)) {
    errors.push('reportChannelDefs 必须是数组（顶层报告渠道声明表）');
  }
  if (json.sourceChannelDefs !== undefined && !Array.isArray(json.sourceChannelDefs)) {
    errors.push('sourceChannelDefs 必须是数组（顶层来源渠道声明表）');
  }
  if (json.usedCtxKeyDefs !== undefined && json.usedCtxKeyDefs !== null
      && (typeof json.usedCtxKeyDefs !== 'object' || Array.isArray(json.usedCtxKeyDefs))) {
    errors.push('usedCtxKeyDefs 必须是对象（顶层 ctxKey 声明表：ctxKey -> 定义）');
  }
  // 旧键名（channels / sources / ctxKeyDefs）与旧 item 元数据名（platformTradeId / platformDealId）
  // 已移除：出现即报错，避免两套口径共存。
  ['channels', 'sources'].forEach(function (k) {
    if (json[k] !== undefined) {
      errors.push(k + ' 已改名（报告渠道 -> reportChannelDefs、来源渠道 -> sourceChannelDefs）');
    }
  });
  if (json.ctxKeyDefs !== undefined) {
    errors.push('ctxKeyDefs 已改名（-> usedCtxKeyDefs）');
  }
  const chPresetById = invert(CHANNEL_ID_PRESET);
  const srcPresetById = invert(SOURCE_ID_PRESET);
  // 声明表（**只由顶层 reportChannelDefs 填充**）：id -> { id, name, def, fieldById }。
  const chDeclared = {};
  const chDeclaredByName = {};
  // 声明表（来源渠道）：id -> name / name -> id。
  const srcDeclared = {};
  const srcDeclaredByName = {};
  const presetPairError = function (kind, id, name, label, preset, presetById) {
    if (presetById[id] != null && presetById[id] !== name) {
      errors.push(label + ' ' + kind + ' id=' + id + ' 已被预设「' + presetById[id] + '」占用，不能用于「' + name + '」');
      return true;
    }
    if (preset[name] != null && preset[name] !== id) {
      errors.push(label + ' ' + kind + '「' + name + '」的预设 id 为 ' + preset[name] + '，当前为 ' + id);
      return true;
    }
    return false;
  };
  // 报告渠道声明：id 数据集内全局唯一（同一 id → 同一 name，反之亦然），且不得与预设冲突。
  const declareChannel = function (id, name, label) {
    if (chDeclared[id] != null && chDeclared[id].name !== name) {
      errors.push(label + ' 渠道 id=' + id + ' 在 reportChannelDefs 声明表内已指向「' + chDeclared[id].name + '」，与「' + name + '」冲突（声明必须唯一）');
      return;
    }
    if (chDeclaredByName[name] != null && chDeclaredByName[name] !== id) {
      errors.push(label + ' 渠道「' + name + '」在 reportChannelDefs 声明表内已使用 id=' + chDeclaredByName[name] + '，与 id=' + id + ' 冲突（声明必须唯一）');
      return;
    }
    if (presetPairError('渠道', id, name, label, CHANNEL_ID_PRESET, chPresetById)) return;
    chDeclared[id] = { id: id, name: name, fieldById: {}, fieldIdByName: {} };
    chDeclaredByName[name] = id;
  };
  // 来源渠道声明：声明表在顶层，因此 id 与名称都**数据集级唯一**。
  const declareSource = function (id, name, label) {
    if (srcDeclared[id] != null && srcDeclared[id] !== name) {
      errors.push(label + ' 来源渠道 id=' + id + ' 在 sourceChannelDefs 声明表内已指向「' + srcDeclared[id] + '」，与「' + name + '」冲突（声明必须唯一）');
      return;
    }
    if (srcDeclaredByName[name] != null && srcDeclaredByName[name] !== id) {
      errors.push(label + ' 来源渠道「' + name + '」在 sourceChannelDefs 声明表内已使用 id=' + srcDeclaredByName[name] + '，与 id=' + id + ' 冲突（声明必须唯一）');
      return;
    }
    if (presetPairError('来源渠道', id, name, label, SOURCE_ID_PRESET, srcPresetById)) return;
    srcDeclared[id] = name;
    srcDeclaredByName[name] = id;
  };
  // 顶层声明表校验：必须先于 item 扫描（item 里只有 id 引用）。
  if (Array.isArray(json.reportChannelDefs)) {
    json.reportChannelDefs.forEach(function (c, i) {
      const label = 'reportChannelDefs[' + i + ']';
      if (!c || typeof c !== 'object' || Array.isArray(c)) { errors.push(label + ' 必须是对象'); return; }
      if (typeof c.id !== 'number' || !Number.isInteger(c.id) || c.id <= 0) { errors.push(label + ' 缺少正整数 id'); return; }
      if (typeof c.name !== 'string' || !c.name) { errors.push(label + ' 缺少 name'); return; }
      if (c.desc !== undefined && c.desc !== null && typeof c.desc !== 'string') errors.push(label + ' desc 必须是字符串或 null');
      if (c.format !== undefined && c.format !== null && c.format !== 'xml' && c.format !== 'csv') {
        errors.push(label + ' format 只能是 "xml" / "csv" 或省略，当前为：' + c.format);
      }
      declareChannel(c.id, c.name, label);
      const declared = chDeclared[c.id];
      if (!declared) return;
      declared.def = c;
      // 字段定义注册表（fieldDefs）：报告渠道级别，渠道内 id 唯一。
      if (c.fieldDefs !== undefined && c.fieldDefs !== null && !Array.isArray(c.fieldDefs)) {
        errors.push(label + ' fieldDefs 必须是数组');
      }
      (Array.isArray(c.fieldDefs) ? c.fieldDefs : []).forEach(function (d, di) {
        const dlabel = label + '.fieldDefs[' + di + ']';
        if (!d || typeof d !== 'object' || Array.isArray(d)) { errors.push(dlabel + ' 必须是对象'); return; }
        if (typeof d.id !== 'string' || !/^\d+$/.test(d.id)) { errors.push(dlabel + ' 缺少数字字符串 id'); return; }
        if (typeof d.name !== 'string' || !d.name) errors.push(dlabel + ' 缺少 name');
        if (typeof d.userTag !== 'string') errors.push(dlabel + ' 缺少 userTag');
        if (typeof d.type !== 'string') errors.push(dlabel + ' 缺少 type');
        if (declared.fieldById[d.id]) {
          errors.push(dlabel + ' 字段 id=' + d.id + ' 在「' + c.name + '」渠道内重复');
          return;
        }
        declared.fieldById[d.id] = d;
        declared.fieldIdByName[String(d.name)] = d.id;
      });
    });
  }
  if (Array.isArray(json.sourceChannelDefs)) {
    json.sourceChannelDefs.forEach(function (s, i) {
      const label = 'sourceChannelDefs[' + i + ']';
      if (!s || typeof s !== 'object' || Array.isArray(s)) { errors.push(label + ' 必须是对象'); return; }
      if (typeof s.id !== 'number' || !Number.isInteger(s.id) || s.id <= 0) { errors.push(label + ' 缺少正整数 id'); return; }
      if (typeof s.name !== 'string' || !s.name) { errors.push(label + ' 缺少 name'); return; }
      if (s.format !== undefined && s.format !== null && s.format !== 'xml' && s.format !== 'csv') {
        errors.push(label + ' format 只能是 "xml" / "csv" 或省略，当前为：' + s.format);
      }
      declareSource(s.id, s.name, label);
    });
  }
  // ctxKey 声明表（ctxKey -> { id, type, rules, def }）：id 数据集内唯一；rules 只能是 fdm / cvt / vdt。
  const ctxDeclared = {};
  const ctxDeclaredByKey = {};
  if (json.usedCtxKeyDefs && typeof json.usedCtxKeyDefs === 'object' && !Array.isArray(json.usedCtxKeyDefs)) {
    Object.keys(json.usedCtxKeyDefs).forEach(function (key) {
      const d = json.usedCtxKeyDefs[key] || {};
      const label = 'usedCtxKeyDefs.' + key;
      if (typeof d.id !== 'number' || !Number.isInteger(d.id) || d.id <= 0) {
        errors.push(label + ' 缺少正整数 id');
      } else if (ctxDeclared[d.id] != null) {
        errors.push(label + ' 的 id 与 usedCtxKeyDefs.' + ctxDeclared[d.id] + ' 重复：' + d.id);
      } else {
        ctxDeclared[d.id] = key;
      }
      ctxDeclaredByKey[key] = d.id;
      if (d.type !== undefined && d.type !== null && d.type !== 'builtin' && d.type !== 'user') {
        errors.push(label + ' 的 type 只能是 "builtin" 或 "user"');
      }
      const rules = d.rules;
      const okRules = (Array.isArray(rules) && rules.length > 0 && rules.every(function (r) { return CTX_RULES.indexOf(r) >= 0; }))
        || CTX_RULES.indexOf(rules) >= 0;
      if (!okRules) errors.push(label + ' 的 rules 必须是 ' + CTX_RULES.join(' / ') + ' 之一或由它们组成的数组');
      if (d.def !== undefined && d.def !== null && typeof d.def !== 'string') errors.push(label + ' 的 def 必须是字符串或 null');
      if (d.hits !== undefined) errors.push(label + ' 不应带 hits（命中数与 item 绑定，写在 item.ctxDefs 里）');
    });
  }
  // 消息段的名称解析：引用 ⊆ 声明（只按名称校验，消息段不带 id）。
  const refOpts = {
    hasChannel: function (name) { return chDeclaredByName[name] != null; },
    hasSource: function (name) { return srcDeclaredByName[name] != null; },
    resolveChannelName: function (id) {
      return chDeclared[id] != null ? chDeclared[id].name : null;
    },
    resolveSourceName: function (srcId) {
      return srcDeclared[srcId] != null ? srcDeclared[srcId] : null;
    },
  };
  const pendingSkipped = Array.isArray(json.skippedItems) ? json.skippedItems : [];
  if (json.skippedItems !== undefined && json.skippedItems !== null && !Array.isArray(json.skippedItems)) {
    errors.push('skippedItems 必须是数组');
  }
  // `enabledChannels` 已彻底移除（改为 `channels[].enabled`）：出现即报错，避免两份口径共存。
  if (json.enabledChannels !== undefined) {
    errors.push('enabledChannels 已移除（渠道启用标记改为 channels[].enabled）');
  }

  const mode = json.mode === 'multi' ? 'multi' : 'single';
  json.items.forEach(function (item, i) {
    const label = 'items[' + i + ']';
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(label + ' 必须是对象');
      return;
    }
    if (typeof item.tradeId !== 'string' || !item.tradeId) {
      errors.push(label + ' 缺少 tradeId');
    }
    if (mode === 'multi') {
      if (typeof item.file !== 'string' || !item.file) {
        errors.push(label + '（多文件模式）缺少 file 字段');
      }
      if (item.summary !== undefined && item.summary !== null
          && (typeof item.summary !== 'object' || Array.isArray(item.summary))) {
        errors.push(label + '（多文件模式）summary 必须是对象');
      }
      return;
    }
    // 单文件模式
    if (!Array.isArray(item.channels)) {
      errors.push(label + ' 缺少 channels 数组');
      return;
    }
    // item.ctxDefs：只写 { id, hits }（定义在顶层 usedCtxKeyDefs）。
    const ctxIds = {};
    if (item.ctxDefs !== undefined && (typeof item.ctxDefs !== 'object' || item.ctxDefs === null || Array.isArray(item.ctxDefs))) {
      errors.push(label + ' ctxDefs 必须是对象（ctxKey -> { id, hits }）');
    } else if (item.ctxDefs) {
      Object.keys(item.ctxDefs).forEach(function (key) {
        const def = item.ctxDefs[key];
        const dlabel = label + ' ctxDefs.' + key;
        if (!def || typeof def !== 'object' || Array.isArray(def)) { errors.push(dlabel + ' 必须是对象'); return; }
        if (typeof def.id !== 'number' || !Number.isInteger(def.id) || def.id <= 0) {
          errors.push(dlabel + ' 缺少正整数 id');
        } else if (ctxDeclared[def.id] == null) {
          errors.push(dlabel + ' id=' + def.id + ' 未在顶层 usedCtxKeyDefs 声明表里声明');
        } else if (ctxDeclared[def.id] !== key) {
          errors.push(dlabel + ' id=' + def.id + ' 在 usedCtxKeyDefs 里对应「' + ctxDeclared[def.id] + '」，与键名不一致');
        } else {
          ctxIds[def.id] = true;
        }
        ['type', 'rules', 'def'].forEach(function (k) {
          if (def[k] !== undefined) errors.push(dlabel + ' 不应带 ' + k + '（定义已移到顶层 usedCtxKeyDefs.' + key + '）');
        });
      });
    }
    // item 元数据改名（无向后兼容）：旧键名出现即报错，避免新旧字段并存导致筛选静默失效。
    if (item.platformTradeId !== undefined) errors.push(label + ' platformTradeId 已改名（-> platformOriTradeId）');
    if (item.platformDealId !== undefined) errors.push(label + ' platformDealId 已改名（-> platformOriTradeDealId）');
    if (item.enabledChannels !== undefined) {
      errors.push(label + ' enabledChannels 已移除（渠道启用标记改为 channels[].enabled）');
    }
    ['warnings', 'errors', 'uncompared', 'logs'].forEach(function (k) {
      if (item[k] !== undefined && !Array.isArray(item[k])) errors.push(label + ' ' + k + ' 必须是数组');
    });
    // item 级引用的作用域：渠道 / 来源渠道 id 必须在顶层声明表里已声明（引用 ⊆ 声明）；
    // 规则里的 ctx 引用必须同时出现在顶层 usedCtxKeyDefs 与本 item 的 ctxDefs 里。
    const itemRefOpts = {
      expectKnown: true,
      hasChannel: refOpts.hasChannel,
      hasSource: refOpts.hasSource,
      resolveChannelName: function (id) {
        return chDeclared[id] != null ? chDeclared[id].name : null;
      },
      resolveSourceName: function (srcId) {
        return srcDeclared[srcId] != null ? srcDeclared[srcId] : null;
      },
    };
    item.channels.forEach(function (ch, ci) {
      const clabel = label + '.channels[' + ci + ']';
      if (!ch || typeof ch !== 'object') {
        errors.push(clabel + ' 必须是对象');
        return;
      }
      // 渠道稳定标识：正整数，且**必须已在顶层 reportChannelDefs 声明表里声明**（item 里不再接受新定义）。
      let chFields = {};
      if (typeof ch.id !== 'number' || !Number.isInteger(ch.id) || ch.id <= 0) {
        errors.push(clabel + ' 缺少正整数 id（report channel id）');
      } else if (chDeclared[ch.id] == null) {
        errors.push(clabel + ' id=' + ch.id + ' 未在顶层 reportChannelDefs 声明表里声明（item 里的报送渠道必须是已声明的渠道）');
      } else {
        const declared = chDeclared[ch.id];
        chFields = declared.fieldById;
        // item 上重复写了 name / desc / format 时必须与声明一致（双写不能各说一套）。
        if (ch.name !== undefined && ch.name !== null && ch.name !== '' && ch.name !== declared.name) {
          errors.push(clabel + ' name「' + ch.name + '」与顶层声明「' + declared.name + '」不一致');
        }
        ['desc', 'format'].forEach(function (k) {
          const def = declared.def;
          if (ch[k] !== undefined && ch[k] !== null && def && def[k] !== undefined && def[k] !== null && ch[k] !== def[k]) {
            errors.push(clabel + ' ' + k + ' 与顶层渠道声明不一致：' + JSON.stringify(ch[k]) + ' vs ' + JSON.stringify(def[k]));
          }
        });
      }
      // 启用标记：唯一口径 channels[].enabled（缺省视为 true）。
      if (ch.enabled !== undefined && ch.enabled !== null && typeof ch.enabled !== 'boolean') {
        errors.push(clabel + ' enabled 必须是布尔值或省略（省略 = 启用）');
      }
      // 字段定义注册表已迁移到顶层（reportChannelDefs[].fieldDefs）：item 里出现即报错。
      if (ch.fields !== undefined) {
        errors.push(clabel + ' fields 已迁移到 reportChannelDefs[].fieldDefs（item 里只引用字段 id）');
      }
      if (!Array.isArray(ch.sources)) errors.push(clabel + ' 缺少 sources 数组');
      if (Array.isArray(ch.sources)) {
        ch.sources.forEach(function (s, si) {
          const slabel = clabel + '.sources[' + si + ']';
          if (!s || typeof s !== 'object') { errors.push(slabel + ' 必须是对象'); return; }
          // 来源渠道稳定标识：正整数，且**必须已在顶层 sourceChannelDefs 声明表里声明**。
          if (typeof s.id !== 'number' || !Number.isInteger(s.id) || s.id <= 0) {
            errors.push(slabel + ' 缺少正整数 id（source id）');
          } else if (srcDeclared[s.id] == null) {
            errors.push(slabel + ' id=' + s.id + ' 未在顶层 sourceChannelDefs 声明表里声明（item 里的来源渠道必须是已声明的来源渠道）');
          } else if (typeof s.name === 'string' && s.name !== '' && s.name !== srcDeclared[s.id]) {
            errors.push(slabel + ' name「' + s.name + '」与顶层声明「' + srcDeclared[s.id] + '」不一致');
          }
          if (!Array.isArray(s.fields)) { errors.push(slabel + ' 缺少 fields 数组'); return; }
          s.fields.forEach(function (f, fi) {
            const flabel = slabel + '.fields[' + fi + ']';
            if (!f || typeof f !== 'object') { errors.push(flabel + ' 必须是对象'); return; }
            // 字段 id 引用：必须是**父级报告渠道** fieldDefs 里已声明的字段（引用 ⊆ 声明）。
            if (typeof f.id !== 'string' || !/^\d+$/.test(f.id)) {
              errors.push(flabel + ' 缺少数字字符串 id');
            } else if (typeof ch.id === 'number' && chDeclared[ch.id] != null && chFields[f.id] == null) {
              errors.push(flabel + ' id=' + f.id + ' 未在报告渠道「' + chDeclared[ch.id].name + '」的 fieldDefs 里声明');
            }
            // cvtLeft / cvtRight / vdt 为可选配置，允许为 null。
            ['cvtLeft', 'cvtRight', 'vdt'].forEach(function (rk) {
              if (f[rk] !== undefined && f[rk] !== null && (typeof f[rk] !== 'object' || Array.isArray(f[rk]))) {
                errors.push(flabel + ' ' + rk + ' 必须为对象或 null');
              }
            });
            // 各规则对象：ctx 引用（id）、值来源格式（valueSrcFmt）。
            ['cmpLeft', 'cmpRight', 'cvtLeft', 'cvtRight', 'vdt'].forEach(function (rk) {
              const r = f[rk];
              if (!r || typeof r !== 'object') return;
              if (r.ctx !== undefined && r.ctx !== null && typeof r.ctx !== 'string') {
                errors.push(flabel + ' ' + rk + '.ctx 必须是字符串（命中 ctxKey 的原始表达式）或 null');
              }
              if (r.srcType !== undefined) {
                errors.push(flabel + ' ' + rk + '.srcType 已改名（-> valueSrcFmt，值为 "csv" / "xml"）');
              }
              if (r.valueSrcFmt !== undefined && r.valueSrcFmt !== null && r.valueSrcFmt !== 'csv' && r.valueSrcFmt !== 'xml') {
                errors.push(flabel + ' ' + rk + '.valueSrcFmt 只能是 "csv" / "xml"，当前为：' + r.valueSrcFmt);
              }
              (Array.isArray(r.ctxs) ? r.ctxs : []).forEach(function (cid) {
                if (typeof cid !== 'number' || ctxDeclared[cid] == null) {
                  errors.push(flabel + ' ' + rk + '.ctxs 引用了未在 usedCtxKeyDefs 声明的 ctx id：' + cid);
                } else if (!ctxIds[cid]) {
                  errors.push(flabel + ' ' + rk + '.ctxs 引用的 ctxKey「' + ctxDeclared[cid] + '」未写在本 item 的 ctxDefs 里');
                }
              });
            });
          });
        });
      }
    });
    // 日志行按 id 引用（渠道 / 来源渠道 id 必须已在顶层声明表里声明）。
    if (Array.isArray(item.logs)) validateLogEntries(item.logs, label + '.logs', errors, itemRefOpts);
    // 消息段只写名称：名称必须能在顶层声明表里解析（引用 ⊆ 声明）。
    ['warnings', 'errors', 'uncompared'].forEach(function (k) {
      (Array.isArray(item[k]) ? item[k] : []).forEach(function (m, mi) {
        if (!m || typeof m !== 'object' || Array.isArray(m)) { errors.push(label + '.' + k + '[' + mi + '] 必须是对象'); return; }
        checkMessageRef(m, label + '.' + k + '[' + mi + ']', errors, refOpts);
      });
    });
  });
  // skippedItems 是**数据集级**条目（引用的是别的 item）：名称 + id 双写。
  // 生成器会把它们引用的渠道 / 来源渠道一并补进声明表，因此 id 也必须能解析。
  pendingSkipped.forEach(function (s, i) {
    const label = 'skippedItems[' + i + ']';
    if (!s || typeof s !== 'object' || Array.isArray(s)) { errors.push(label + ' 必须是对象'); return; }
    if (typeof s.itemId !== 'string' || !s.itemId) errors.push(label + ' 缺少 itemId');
    if (typeof s.reason !== 'string' || !s.reason) errors.push(label + ' 缺少 reason');
    checkIdRefFields(s, label, errors, refOpts);
  });

  return { ok: errors.length === 0, errors };
}

export function validateFile(filePath) {
  try {
    const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { file: filePath, ...validateDataset(json) };
  } catch (e) {
    return { file: filePath, ok: false, errors: ['解析失败：' + e.message] };
  }
}

export function main() {
  const argv = process.argv.slice(2);
  const files = argv.length ? argv : ['public/report-validation-data.json'];
  let fail = 0;
  files.forEach(function (f) {
    const r = validateFile(f);
    if (r.ok) console.log('OK  ' + f);
    else {
      fail++;
      console.log('FAIL ' + f);
      r.errors.forEach(function (e) { console.log('   - ' + e); });
    }
  });
  process.exit(fail ? 1 : 0);
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
