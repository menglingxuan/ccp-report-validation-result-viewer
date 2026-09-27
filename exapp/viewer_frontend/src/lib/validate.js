// 轻量数据校验器（零依赖）：校验数据文件顶层结构与关键字段，返回错误列表。
// 用于服务启动时 / 扫描时提前发现坏数据，避免前端渲染崩溃。
//
//   import { validateDataset } from './lib/validate.js';
//   const { ok, errors } = validateDataset(json);
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHANNEL_ID_PRESET, SOURCE_ID_PRESET } from '../public/core.js';

// { name: id } -> { id: name }
function invert(map) {
  const out = {};
  Object.keys(map).forEach(function (k) { out[map[k]] = k; });
  return out;
}

// 渠道 / 来源渠道的引用字段（warnings / errors / uncompared / logs / skippedItems）：
// 名称与 id **双写**（channel + channelId / source + sourceId）—— ids 是硬性的，名称可省：
// 只写 channelId / sourceId 时由查看器在加载时按 id 从声明表解析出名称（见 core.js hydrateItem）；
// 只写名称的老写法仍然可读（按名称反查 id），但日志段的新数据一律只写 id。
// id 可为 null（表示未关联到具体渠道 / 来源）。
function checkRefFields(m, label, errors, opts) {
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
  // 与名称的一致性：双写时两边必须指向同一渠道 / 来源渠道。
  // opts.expectKnown=false 时（skippedItems 这类引用了「不在 items 中的 item」的条目），
  // 解析不到的 id 不再报错——无从验证，只验证能验证的那部分。
  const expectKnown = o.expectKnown !== false;
  if (o.resolveChannelName && m.channelId != null) {
    const name = o.resolveChannelName(m.channelId);
    if (name == null) {
      if (expectKnown) errors.push(label + ' channelId=' + m.channelId + ' 未在数据集内登记');
    } else if (m.channel && m.channel !== name) {
      errors.push(label + ' channel(' + m.channel + ') 与 channelId(' + m.channelId + ' → ' + name + ') 不一致');
    }
  }
  if (o.resolveSourceName && m.sourceId != null && m.channelId != null) {
    const sname = o.resolveSourceName(m.channelId, m.sourceId);
    if (sname == null) {
      if (expectKnown) errors.push(label + ' sourceId=' + m.sourceId + ' 未在该渠道内登记');
    } else if (m.source && m.source !== sname) {
      errors.push(label + ' source(' + m.source + ') 与 sourceId(' + m.sourceId + ' → ' + sname + ') 不一致');
    }
  }
}

// 日志行契约（`item.logs[]`，见 docs/DATA_SCHEMA.md §3）：
//   { scope, channelId, sourceId, field, text }（旧数据里可能还带 channel / source 名称）
//   - scope 只能是 item / channel / field；
//   - field（字段 id）仅在 scope="field" 时有值，且此时 channelId / sourceId 必须非空；
//   - 渠道 / 来源渠道的**名称可省**（日志只写 id，名称由查看器按 id 解析回来）；
//   - text 是给人看的展示内容：**不是数据通道**，不得用它携带渠道 / 来源信息。
//   （字段级日志行只在 item.logs 里存一份：fields[] 不新增任何字段。）
function validateLogEntries(list, label, errors, opts) {
  list.forEach(function (l, li) {
    const llabel = label + '[' + li + ']';
    if (!l || typeof l !== 'object' || Array.isArray(l)) { errors.push(llabel + ' 必须是对象'); return; }
    if (typeof l.text !== 'string') errors.push(llabel + ' 缺少 text 字符串');
    if (l.scope !== undefined && l.scope !== null
        && l.scope !== 'item' && l.scope !== 'channel' && l.scope !== 'field') {
      errors.push(llabel + ' scope 只能是 "item" / "channel" / "field"');
    }
    ['field'].forEach(function (k) {
      if (l[k] !== undefined && l[k] !== null && typeof l[k] !== 'string') {
        errors.push(llabel + ' ' + k + ' 必须是字符串或 null');
      }
    });
    checkRefFields(l, llabel, errors, opts);
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
  // 顶层登记表（`$root.channels` / `$root.sources`）：渠道与来源渠道的**声明**只写一次。
  // 契约：item.channels / item.channels[].sources 里出现的渠道与来源渠道**必须是已声明的**
  // （引用 ⊆ 声明）；item 里可以重复写名称 / 描述 / 格式，但必须与声明一致。
  // 两项都允许省略：只有都不被引用时才不需要声明（空数据集 / 无 channels 的夹具）。
  if (json.channels !== undefined && !Array.isArray(json.channels)) {
    errors.push('channels 必须是数组（顶层报告渠道声明表）');
  }
  if (json.sources !== undefined && !Array.isArray(json.sources)) {
    errors.push('sources 必须是数组（顶层来源渠道声明表）');
  }
  const chPresetById = invert(CHANNEL_ID_PRESET);
  const srcPresetById = invert(SOURCE_ID_PRESET);
  // 声明表（**只由顶层 channels / sources 填充**）：id -> { id, name, desc, format }。
  const chDeclared = {};
  const chDeclaredByName = {};
  // 声明表（来源渠道）：id -> name。
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
  // 渠道声明：id 数据集内全局唯一（同一 id → 同一 name，反之亦然），且不得与预设冲突。
  const declareChannel = function (id, name, label) {
    if (chDeclared[id] != null && chDeclared[id].name !== name) {
      errors.push(label + ' 渠道 id=' + id + ' 在 channels 声明表内已指向「' + chDeclared[id].name + '」，与「' + name + '」冲突（声明必须唯一）');
      return;
    }
    if (chDeclaredByName[name] != null && chDeclaredByName[name] !== id) {
      errors.push(label + ' 渠道「' + name + '」在 channels 声明表内已使用 id=' + chDeclaredByName[name] + '，与 id=' + id + ' 冲突（声明必须唯一）');
      return;
    }
    if (presetPairError('渠道', id, name, label, CHANNEL_ID_PRESET, chPresetById)) return;
    chDeclared[id] = { id: id, name: name };
    chDeclaredByName[name] = id;
  };
  // 来源渠道声明：声明表在顶层，因此 id 与名称都**数据集级唯一**。
  const declareSource = function (id, name, label) {
    if (srcDeclared[id] != null && srcDeclared[id] !== name) {
      errors.push(label + ' 来源渠道 id=' + id + ' 在 sources 声明表内已指向「' + srcDeclared[id] + '」，与「' + name + '」冲突（声明必须唯一）');
      return;
    }
    if (srcDeclaredByName[name] != null && srcDeclaredByName[name] !== id) {
      errors.push(label + ' 来源渠道「' + name + '」在 sources 声明表内已使用 id=' + srcDeclaredByName[name] + '，与 id=' + id + ' 冲突（声明必须唯一）');
      return;
    }
    if (presetPairError('来源渠道', id, name, label, SOURCE_ID_PRESET, srcPresetById)) return;
    srcDeclared[id] = name;
    srcDeclaredByName[name] = id;
  };
  // 顶层声明表校验：必须先于 item 扫描（item 里只有 id 引用）。
  if (Array.isArray(json.channels)) {
    json.channels.forEach(function (c, i) {
      const label = 'channels[' + i + ']';
      if (!c || typeof c !== 'object' || Array.isArray(c)) { errors.push(label + ' 必须是对象'); return; }
      if (typeof c.id !== 'number' || !Number.isInteger(c.id) || c.id <= 0) { errors.push(label + ' 缺少正整数 id'); return; }
      if (typeof c.name !== 'string' || !c.name) { errors.push(label + ' 缺少 name'); return; }
      if (c.desc !== undefined && c.desc !== null && typeof c.desc !== 'string') errors.push(label + ' desc 必须是字符串或 null');
      if (c.format !== undefined && c.format !== null && c.format !== 'xml' && c.format !== 'csv') {
        errors.push(label + ' format 只能是 "xml" / "csv" 或省略，当前为：' + c.format);
      }
      declareChannel(c.id, c.name, label);
      if (chDeclared[c.id]) {
        chDeclared[c.id].def = c;
      }
    });
  }
  if (Array.isArray(json.sources)) {
    json.sources.forEach(function (s, i) {
      const label = 'sources[' + i + ']';
      if (!s || typeof s !== 'object' || Array.isArray(s)) { errors.push(label + ' 必须是对象'); return; }
      if (typeof s.id !== 'number' || !Number.isInteger(s.id) || s.id <= 0) { errors.push(label + ' 缺少正整数 id'); return; }
      if (typeof s.name !== 'string' || !s.name) { errors.push(label + ' 缺少 name'); return; }
      declareSource(s.id, s.name, label);
    });
  }
  // 数据集级解析：引用必须能在声明表里解析（无声明即报错，不再兑底到预设）。
  const refOpts = {
    resolveChannelName: function (id) {
      return chDeclared[id] != null ? chDeclared[id].name : null;
    },
    resolveSourceName: function (chId, srcId) {
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
    const ctxIds = {};
    if (item.ctxDefs !== undefined && (typeof item.ctxDefs !== 'object' || item.ctxDefs === null)) {
      errors.push(label + ' ctxDefs 必须是对象');
    } else if (item.ctxDefs) {
      Object.keys(item.ctxDefs).forEach(function (key) {
        const def = item.ctxDefs[key];
        if (!def || typeof def !== 'object') { errors.push(label + ' ctxDefs.' + key + ' 必须是对象'); return; }
        if (typeof def.id !== 'number' || !Number.isInteger(def.id) || def.id <= 0) {
          errors.push(label + ' ctxDefs.' + key + ' 缺少正整数 id');
        } else if (ctxIds[def.id]) {
          errors.push(label + ' ctxDefs.' + key + ' 的 id 重复：' + def.id);
        } else {
          ctxIds[def.id] = true;
        }
        const sp = def.scopes;
        const valid = (n) => n === 1 || n === 2 || n === 3;
        const okSp = (Array.isArray(sp) && sp.length > 0 && sp.every(valid)) || valid(sp);
        if (!okSp) errors.push(label + ' ctxDefs.' + key + ' 的 scopes 必须是 1/2/3 或由它们组成的数组');
        if (def.type !== undefined && def.type !== 'builtin' && def.type !== 'user') {
          errors.push(label + ' ctxDefs.' + key + ' 的 type 只能是 "builtin" 或 "user"');
        }
      });
    }
    if (item.enabledChannels !== undefined) {
      errors.push(label + ' enabledChannels 已移除（渠道启用标记改为 channels[].enabled）');
    }
    ['warnings', 'errors', 'uncompared', 'logs'].forEach(function (k) {
      if (item[k] !== undefined && !Array.isArray(item[k])) errors.push(label + ' ' + k + ' 必须是数组');
    });
    // item 级引用的作用域：渠道 / 来源渠道 id 必须在顶层声明表里已声明（引用 ⊆ 声明）。
    const itemChName = {};
    const itemSrcName = {};
    const itemRefOpts = {
      resolveChannelName: function (id) {
        return chDeclared[id] != null ? chDeclared[id].name : null;
      },
      resolveSourceName: function (chId, srcId) {
        return srcDeclared[srcId] != null ? srcDeclared[srcId] : null;
      },
    };
    item.channels.forEach(function (ch, ci) {
      const clabel = label + '.channels[' + ci + ']';
      if (!ch || typeof ch !== 'object') {
        errors.push(clabel + ' 必须是对象');
        return;
      }
      // 渠道稳定标识：正整数，且**必须已在顶层 channels 声明表里声明**（item 里不再接受新定义）。
      if (typeof ch.id !== 'number' || !Number.isInteger(ch.id) || ch.id <= 0) {
        errors.push(clabel + ' 缺少正整数 id（report channel id）');
      } else if (chDeclared[ch.id] == null) {
        errors.push(clabel + ' id=' + ch.id + ' 未在顶层 channels 声明表里声明（item 里的报送渠道必须是已声明的渠道）');
        itemChName[ch.id] = typeof ch.name === 'string' ? ch.name : '';
      } else {
        const declared = chDeclared[ch.id];
        itemChName[ch.id] = declared.name;
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
      // 启用标记：唯一口径 channels[].enabled（缺省视为 true，旧数据仍可读）。
      if (ch.enabled !== undefined && ch.enabled !== null && typeof ch.enabled !== 'boolean') {
        errors.push(clabel + ' enabled 必须是布尔值或省略（省略 = 启用）');
      }
      // 字段注册表为 report channel 级别。
      if (ch.fields !== undefined && !Array.isArray(ch.fields)) {
        errors.push(clabel + ' fields 必须是数组');
      } else if (Array.isArray(ch.fields)) {
        ch.fields.forEach(function (d, di) {
          if (!d || typeof d !== 'object') { errors.push(clabel + '.fields[' + di + '] 必须是对象'); return; }
          if (typeof d.id !== 'string' || !/^\d+$/.test(d.id)) errors.push(clabel + '.fields[' + di + '] 缺少数字字符串 id');
          if (typeof d.name !== 'string') errors.push(clabel + '.fields[' + di + '] 缺少 name');
          if (typeof d.userTag !== 'string') errors.push(clabel + '.fields[' + di + '] 缺少 userTag');
          if (typeof d.type !== 'string') errors.push(clabel + '.fields[' + di + '] 缺少 type');
        });
      }
      if (!Array.isArray(ch.sources)) errors.push(clabel + ' 缺少 sources 数组');
      if (Array.isArray(ch.sources)) {
        ch.sources.forEach(function (s, si) {
          const slabel = clabel + '.sources[' + si + ']';
          if (!s || typeof s !== 'object') { errors.push(slabel + ' 必须是对象'); return; }
          // 来源渠道稳定标识：正整数，且**必须已在顶层 sources 声明表里声明**。
          if (typeof s.id !== 'number' || !Number.isInteger(s.id) || s.id <= 0) {
            errors.push(slabel + ' 缺少正整数 id（source id）');
          } else if (srcDeclared[s.id] == null) {
            errors.push(slabel + ' id=' + s.id + ' 未在顶层 sources 声明表里声明（item 里的来源渠道必须是已声明的来源渠道）');
            itemSrcName[s.id] = typeof s.name === 'string' ? s.name : '';
          } else {
            itemSrcName[s.id] = srcDeclared[s.id];
            if (typeof s.name === 'string' && s.name !== '' && s.name !== srcDeclared[s.id]) {
              errors.push(slabel + ' name「' + s.name + '」与顶层声明「' + srcDeclared[s.id] + '」不一致');
            }
          }
          if (!Array.isArray(s.fields)) { errors.push(slabel + ' 缺少 fields 数组'); return; }
          s.fields.forEach(function (f, fi) {
            const flabel = slabel + '.fields[' + fi + ']';
            if (!f || typeof f !== 'object') { errors.push(flabel + ' 必须是对象'); return; }
            if (typeof f.id !== 'string' || !/^\d+$/.test(f.id)) errors.push(flabel + ' 缺少数字字符串 id');
            // cvtLeft / cvtRight / vdt 为可选配置，允许为 null。
            ['cvtLeft', 'cvtRight', 'vdt'].forEach(function (rk) {
              if (f[rk] !== undefined && f[rk] !== null && (typeof f[rk] !== 'object' || Array.isArray(f[rk]))) {
                errors.push(flabel + ' ' + rk + ' 必须为对象或 null');
              }
            });
            // 校验所有 ctx 引用（id）均在 ctxDefs 中有定义；ctx（单数）为原始字符串表达式。
            ['cmpLeft', 'cmpRight', 'cvtLeft', 'cvtRight', 'vdt'].forEach(function (rk) {
              const r = f[rk];
              if (!r || typeof r !== 'object') return;
              if (r.ctx !== undefined && r.ctx !== null && typeof r.ctx !== 'string') {
                errors.push(flabel + ' ' + rk + '.ctx 必须是字符串（命中 ctxKey 的原始表达式）或 null');
              }
              (Array.isArray(r.ctxs) ? r.ctxs : []).forEach(function (cid) {
                if (typeof cid !== 'number' || !ctxIds[cid]) errors.push(flabel + ' ' + rk + '.ctxs 引用了未定义的 ctx id：' + cid);
              });
            });
          });
        });
      }
    });
    // 日志行与消息引用：必须在 channels / sources 扫描之后校验，
    // 这样 item 级的 id ↔ name 映射已经建好（引用必须能在本 item 内解析）。
    if (Array.isArray(item.logs)) validateLogEntries(item.logs, label + '.logs', errors, itemRefOpts);
    ['warnings', 'errors', 'uncompared'].forEach(function (k) {
      (Array.isArray(item[k]) ? item[k] : []).forEach(function (m, mi) {
        if (!m || typeof m !== 'object' || Array.isArray(m)) { errors.push(label + '.' + k + '[' + mi + '] 必须是对象'); return; }
        checkRefFields(m, label + '.' + k + '[' + mi + ']', errors, itemRefOpts);
      });
    });
  });
  // skippedItems 是**数据集级**条目（引用的是别的 item）：放在所有 item 之后校验，用数据集级映射解析。
  pendingSkipped.forEach(function (s, i) {
    const label = 'skippedItems[' + i + ']';
    if (!s || typeof s !== 'object' || Array.isArray(s)) { errors.push(label + ' 必须是对象'); return; }
    if (typeof s.itemId !== 'string' || !s.itemId) errors.push(label + ' 缺少 itemId');
    if (typeof s.reason !== 'string' || !s.reason) errors.push(label + ' 缺少 reason');
    checkRefFields(s, label, errors, refOpts);
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
  const files = argv.length ? argv : ['public/report-validation-data.json', 'public/report-validation-data-default.json', 'public/report-validation-data-init.json'];
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
