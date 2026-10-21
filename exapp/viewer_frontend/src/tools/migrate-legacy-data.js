// 旧数据格式 -> 新数据格式 迁移脚本（破坏性重构辅助工具）。
//
// 用法：
//   node tools/migrate-legacy-data.js <旧文件> [新文件]
//   未指定新文件时，覆盖写回旧文件。
//
// 迁移内容：
//   - 字段级：f/t/k 迁移到 item.fields 注册表（按字段名去重）；x/aoCsv/ctx/eo/ao/
//     eoUnconverted/conversionRule/validationRule/excel* 等迁移到 cmpLeft/cmpRight/cvtLeft/cvtRight/vdt。
//   - 消息：channels[].warnings/errors 迁移到 item 级（新增 scope/source，移除 platform/product）。
//   - uncompared/uncomparedCsv 合并为 item.uncompared（新增 type，移除 platform/product/ctx）。
//   - channels[].logs 与 overviewLogs 合并为 item.logs（对象式 {scope,channel,source,field,text}）；
//     字段的 prints 同时生成 scope="field" 的日志行（带 channel/source/field）追加进 item.logs（字段本身不存日志）。
//   - 渠道 / 来源渠道稳定标识：channels[].id / channels[].sources[].id（预设 HKTR=1/JSFA=2/CFTC=3、
//     来源渠道 A=1/B=2；未登记的名称按出现顺序编号）。
//   - 启用口径：item.enabledChannels 名单 → 各渠道的 channels[].enabled（不在名单里的置 false），并删除 enabledChannels。
//   - 引用：logs 与 skippedItems 写 id（logs 只写 channelId / sourceId，skippedItems 名称 + id 双写）；
//     warnings / errors / uncompared **只写名称**（不带 id，保持原始可读性）。
//   - 归一化形态：渠道 / 来源渠道 / 字段 / ctxKey 的定义提到**顶层声明表**
//     （`$root.reportChannelDefs`（含 fieldDefs）/ `$root.sourceChannelDefs` / `$root.usedCtxKeyDefs`），
//     item 里只留 id 引用（见 docs/DATA_SCHEMA.md §1）。
import fs from 'node:fs';
import path from 'node:path';
import { writeJSON } from '../lib/json-write.js';
import { CHANNEL_ID_PRESET, SOURCE_ID_PRESET, hoistRegistries } from '../public/core.js';

// 规则名（新契约）：字段映射规则 -> fdm、值转换规则 -> cvt、终值校验规则 -> vdt。
// 旧数据用 1 / 2 / 3 表示三种规则，标注在 ctxDef.type 上（数组或单值）。
const RULES_BY_LEGACY = { 1: 'fdm', 2: 'cvt', 3: 'vdt' };

// 稳定标识：数据里已有合法 id 就用它，否则回退预设表，再不行按出现顺序编号（保证确定性）。
function channelIdFor(name, index, existing) {
  if (typeof existing === 'number' && Number.isInteger(existing) && existing > 0) return existing;
  const preset = CHANNEL_ID_PRESET[name];
  return preset || (Number(index) + 1);
}
function sourceIdFor(name, index, existing) {
  if (typeof existing === 'number' && Number.isInteger(existing) && existing > 0) return existing;
  const preset = SOURCE_ID_PRESET[name];
  return preset || (Number(index) + 1);
}

function ctxKeysOfType(ctx, ctxDefs, type) {
  return (ctx || []).filter(function (k) {
    const def = (ctxDefs && ctxDefs[k]) || {};
    const tp = def.type;
    const types = Array.isArray(tp) ? tp : (tp === 1 || tp === 2 || tp === 3 ? [tp] : []);
    return types.indexOf(type) !== -1;
  });
}

function migrateField(f, ctxDefs, nameToId, ctxIdByKey) {
  const toIds = function (arr) {
    return (arr || []).map(function (k) { return ctxIdByKey[k]; }).filter(function (id) { return id != null; });
  };
  const ctx = Array.isArray(f.ctx) ? f.ctx : [];
  const mapCtxs = ctxKeysOfType(ctx, ctxDefs, 1);
  const mapCtxIds = toIds(mapCtxs);
  const convRule = f.conversionRule || null;
  const valRule = f.validationRule || null;
  const convCtxIds = convRule ? toIds(convRule.ctx) : [];
  const valCtxIds = valRule ? toIds(valRule.ctx) : [];
  const isCsv = (f.x == null || f.x === '') && (f.aoCsv != null && f.aoCsv !== '');
  const el = isCsv ? (f.aoCsv || '') : (f.x || '');
  return {
    id: nameToId[f.f || f.id || ''] || '',
    cmpLeft: { value: f.eo == null ? '' : f.eo, ctx: null, ctxs: [], elRaw: null, el: null, valueSrcFmt: 'csv' },
    cmpRight: { value: f.ao == null ? '' : f.ao, ctx: mapCtxIds.length ? mapCtxIds[0] : null, ctxs: mapCtxIds, elRaw: f.excelMapping || '', el: el, valueSrcFmt: isCsv ? 'csv' : 'xml' },
    // cvtLeft / cvtRight / vdt 为可选配置：旧数据未配置时迁移为 null（而非空对象）。
    cvtLeft: convRule
      ? {
          ctx: convCtxIds.length ? convCtxIds[0] : null,
          ctxs: convCtxIds,
          el: convRule.value,
          elRaw: f.excelConversionRule || '',
          raw: f.eoUnconverted == null ? null : f.eoUnconverted,
        }
      : null,
    cvtRight: null,
    vdt: valRule
      ? {
          ctx: valCtxIds.length ? valCtxIds[0] : null,
          ctxs: valCtxIds,
          el: valRule.value,
          elRaw: f.excelValidationRule || '',
        }
      : null,
    result: f.result || '',
    remarks: f.note || '',
    resultText: f.resultNote || '',
    resultDetails: Array.isArray(f.extraResults) ? f.extraResults : [],
    prints: Array.isArray(f.prints) ? f.prints : [],
  };
}

function migrateItem(it) {
  const out = Object.assign({}, it);
  const fieldSeen = {};
  const fields = [];
  const warnings = [];
  const errors = [];
  const uncompared = [];
  const logs = [];

  // 渠道 / 来源渠道稳定标识（先定下来，后续消息 / 日志 / 字段都引用它们）。
  const chIdByName = {};
  const srcIdByName = {};
  (it.channels || []).forEach(function (ch, ci) {
    ch.id = channelIdFor(ch.name, ci, ch.id);
    chIdByName[ch.name] = ch.id;
    (ch.sources || []).forEach(function (s, si) {
      s.id = sourceIdFor(s.name, si, s.id);
      (srcIdByName[ch.name] = srcIdByName[ch.name] || {})[s.name] = s.id;
    });
  });
  const idsOf = function (chName, srcName) {
    const channelId = chIdByName[chName] != null ? chIdByName[chName] : (CHANNEL_ID_PRESET[chName] || null);
    const sourceId = (channelId == null || !srcName) ? null
      : ((srcIdByName[chName] || {})[srcName] != null ? srcIdByName[chName][srcName] : (SOURCE_ID_PRESET[srcName] || null));
    return { channelId: channelId, sourceId: sourceId };
  };
  // 启用口径：旧数据用 item.enabledChannels 名单，新契约改为各渠道的 channels[].enabled（唯一口径）。
  // 不在名单里的渠道标为 enabled=false；名单本身删掉，避免两份口径共存。
  const legacyEnabled = Array.isArray(it.enabledChannels) ? it.enabledChannels : null;
  if (legacyEnabled) {
    (it.channels || []).forEach(function (ch) {
      if (legacyEnabled.indexOf(ch.name) === -1) ch.enabled = false;
      else if ('enabled' in ch) delete ch.enabled;
    });
  }
  delete out.enabledChannels;
  // item 元数据改名（无向后兼容）：旧键名统一迁移为新名；否则新契约校验会直接报错。
  if (out.platformTradeId !== undefined) {
    out.platformOriTradeId = out.platformTradeId;
    delete out.platformTradeId;
  }
  if (out.platformDealId !== undefined) {
    out.platformOriTradeDealId = out.platformDealId;
    delete out.platformDealId;
  }

  // 第一遍：按 id（数字字符串）去重收集字段定义，按出现顺序分配编号。
  const nameToId = {};
  (it.channels || []).forEach(function (ch) {
    (ch.sources || []).forEach(function (s) {
      (s.fields || []).forEach(function (f) {
        const name = f.f || f.id || '';
        if (!fieldSeen[name]) {
          fieldSeen[name] = true;
          nameToId[name] = String(fields.length + 1);
          fields.push({ id: nameToId[name], name: name, userTag: f.t || '', type: f.k || '' });
        }
      });
    });
  });

  // 构建新的 ctxDefs（item 级只留 id + hits；type / rules / def 会在 hoistRegistries 时提到顶层 usedCtxKeyDefs）。
  const ctxIdByKey = {};
  const ctxDefsNew = {};
  let ctxId = 1;
  const oldCtxDefs = it.ctxDefs || {};
  Object.keys(oldCtxDefs).forEach(function (key) {
    const def = oldCtxDefs[key] || {};
    const tp = def.type;
    const legacy = Array.isArray(tp) ? tp : (tp === 1 || tp === 2 || tp === 3 ? [tp] : []);
    const rules = legacy.map(function (n) { return RULES_BY_LEGACY[n]; }).filter(Boolean);
    ctxIdByKey[key] = ctxId;
    ctxDefsNew[key] = { id: ctxId, rules: rules, type: 'builtin', def: def.def || '', hits: def.hits || '' };
    ctxId++;
  });

  // 第二遍：迁移比较字段，id 使用数字字符串，ctx 引用改为 ctxDefs 的 id。
  //   字段级日志（scope="field"）：由旧 prints 生成带 channel / source / field 的日志行，只追加进 item.logs，
  //   使这些行可在「完整日志」中定位（channel+source+field）；字段对象本身不存日志。
  const fieldLogs = [];
  (it.channels || []).forEach(function (ch) {
    (ch.sources || []).forEach(function (s) {
      (s.fields || []).forEach(function (f) {
        const chName = typeof ch.name === 'string' ? ch.name : '';
        const srcName = typeof s.name === 'string' ? s.name : '';
        const fid = nameToId[f.f || f.id || ''] || '';
        const mf = migrateField(f, oldCtxDefs, nameToId, ctxIdByKey);
        if (chName && srcName && fid) {
          const ids = idsOf(chName, srcName);
          (mf.prints || []).forEach(function (text) {
            // 字段级日志行只写 id + field（不写渠道 / 来源名称）：与生成器输出形态一致。
            fieldLogs.push({ scope: 'field', channelId: ids.channelId, sourceId: ids.sourceId, field: fid, text: String(text) });
          });
        }
        Object.keys(f).forEach(function (k) { delete f[k]; });
        Object.assign(f, mf);
      });
    });
  });

  // 消息迁移（只写名称：消息段不带 id）。
  (it.channels || []).forEach(function (ch) {
    const chId = idsOf(ch.name, null).channelId;
    (ch.warnings || []).forEach(function (w) {
      warnings.push({ scope: w.field ? 'field' : 'channel', source: w.source || null, channel: w.channel || ch.name, type: w.type || '', level: w.level || '', text: w.text || '', field: w.field || '' });
    });
    (ch.errors || []).forEach(function (e) {
      errors.push({ scope: e.field ? 'field' : 'channel', source: e.source || null, channel: e.channel || ch.name, type: e.type || '', level: e.level || '', text: e.text || '', field: e.field || '' });
    });
    (ch.uncompared || []).forEach(function (u) {
      uncompared.push({ type: 1, channel: u.channel || ch.name, source: null, value: u.xpath || '', note: u.note || '' });
    });
    (ch.uncomparedCsv || []).forEach(function (u) {
      uncompared.push({ type: 2, channel: u.channel || ch.name, source: null, value: u.csvField || '', note: u.note || '' });
    });
    (ch.logs || []).forEach(function (l) {
      logs.push({ scope: 'channel', channelId: chId, sourceId: null, field: null, text: String(l) });
    });
  });
  (it.overviewLogs || []).forEach(function (l) {
    logs.push({ scope: 'item', channelId: null, sourceId: null, field: null, text: String(l) });
  });
  // 字段级日志行（scope="field"）追加在末尾：每条都带 field 与 channelId / sourceId。
  fieldLogs.forEach(function (l) { logs.push(l); });

  // 清理旧结构
  (it.channels || []).forEach(function (ch) {
    delete ch.warnings; delete ch.errors; delete ch.uncompared; delete ch.uncomparedCsv; delete ch.logs;
  });
  delete out.overviewLogs;

  // 字段定义注册表：写入每个报告渠道的 `fields`（hoistRegistries 会提到顶层 reportChannelDefs[].fieldDefs）。
  // 旧数据所有渠道共用一张表，因此每个渠道写同一份（渠道内 id 唯一即可）。
  (it.channels || []).forEach(function (ch) { ch.fields = fields; });
  out.ctxDefs = ctxDefsNew;
  out.warnings = warnings;
  out.errors = errors;
  out.uncompared = uncompared;
  out.logs = logs;

  return out;
}

function migrateDataset(json) {
  const out = Object.assign({}, json);
  out.items = (json.items || []).map(migrateItem);
  // 顶层 skippedItems：双写渠道 / 来源渠道的 id（被跳过的 item 不在数据集里，只能靠预设解析）。
  if (Array.isArray(json.skippedItems)) {
    out.skippedItems = json.skippedItems.map(function (s) {
      const channelId = s.channel ? (CHANNEL_ID_PRESET[s.channel] || null) : null;
      const sourceId = (channelId != null && s.source) ? (SOURCE_ID_PRESET[s.source] || null) : null;
      return Object.assign({}, s, { channelId: channelId, sourceId: sourceId });
    });
  }
  // 最后一步：把 item 里的渠道 / 来源渠道定义提到顶层登记表（item 只留 id 引用）。
  // 定义不一致时会抛错（静默取第一个会把「数据自相矛盾」变成看不见的数据丢失）。
  return hoistRegistries(out);
}

function main() {
  const argv = process.argv.slice(2);
  const src = argv[0];
  const dst = argv[1] || src;
  if (!src) { console.error('用法：node tools/migrate-legacy-data.js <旧文件> [新文件] [--pretty]'); process.exit(1); }
  const json = JSON.parse(fs.readFileSync(src, 'utf8'));
  let migrated;
  try {
    migrated = migrateDataset(json);
  } catch (e) {
    console.error('迁移失败：' + (e && e.message ? e.message : e));
    process.exit(1);
  }
  // 输出紧凑 JSON（迁移产物就是给查看器读的数据文件，紧凑体积约为缩进版的一半，见 lib/json-write.js）；
  // 需要人工比对时加 --pretty。
  writeJSON(dst, migrated, { pretty: argv.includes('--pretty') });
  console.log('已迁移：' + src + ' -> ' + dst);
}

if (process.argv[1] && process.argv[1].endsWith('migrate-legacy-data.js')) main();

export { migrateDataset };
