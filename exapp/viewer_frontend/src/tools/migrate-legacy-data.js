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
//   - channels[].logs 与 overviewLogs 合并为 item.logs（对象式 {scope,channel,source,text}）。
import fs from 'node:fs';
import path from 'node:path';

function ctxKeysOfType(ctx, ctxDefs, type) {
  return (ctx || []).filter(function (k) {
    const def = (ctxDefs && ctxDefs[k]) || {};
    const tp = def.type;
    const types = Array.isArray(tp) ? tp : (tp === 1 || tp === 2 || tp === 3 ? [tp] : []);
    return types.indexOf(type) !== -1;
  });
}

function migrateField(f, ctxDefs, nameToId) {
  const ctx = Array.isArray(f.ctx) ? f.ctx : [];
  const mapCtxs = ctxKeysOfType(ctx, ctxDefs, 1);
  const convRule = f.conversionRule || null;
  const valRule = f.validationRule || null;
  const isCsv = (f.x == null || f.x === '') && (f.aoCsv != null && f.aoCsv !== '');
  const el = isCsv ? (f.aoCsv || '') : (f.x || '');
  return {
    id: nameToId[f.f || f.id || ''] || '',
    ctxs: ctx,
    cmpLeft: { value: f.eo == null ? '' : f.eo, ctx: null, ctxs: [], elRaw: null, el: null, srcType: null },
    cmpRight: { value: f.ao == null ? '' : f.ao, ctx: mapCtxs[0] || null, ctxs: mapCtxs, elRaw: f.excelMapping || '', el: el, srcType: isCsv ? 2 : 1 },
    // cvtLeft / cvtRight / vdt 为可选配置：旧数据未配置时迁移为 null（而非空对象）。
    cvtLeft: convRule
      ? {
          ctx: (convRule.ctx && convRule.ctx[0]) || null,
          ctxs: convRule.ctx || [],
          el: convRule.value,
          elRaw: f.excelConversionRule || '',
          raw: f.eoUnconverted == null ? null : f.eoUnconverted,
        }
      : null,
    cvtRight: null,
    vdt: valRule
      ? {
          ctx: (valRule.ctx && valRule.ctx[0]) || null,
          ctxs: valRule.ctx || [],
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

  // 第二遍：迁移比较字段，id 使用数字字符串。
  (it.channels || []).forEach(function (ch) {
    (ch.sources || []).forEach(function (s) {
      (s.fields || []).forEach(function (f) {
        const mf = migrateField(f, it.ctxDefs, nameToId);
        Object.keys(f).forEach(function (k) { delete f[k]; });
        Object.assign(f, mf);
      });
    });
  });

  // 消息迁移
  (it.channels || []).forEach(function (ch) {
    (ch.warnings || []).forEach(function (w) {
      warnings.push({ scope: w.field ? 'field' : 'channel', source: null, channel: w.channel || ch.name, type: w.type || '', level: w.level || '', text: w.text || '', field: w.field || '' });
    });
    (ch.errors || []).forEach(function (e) {
      errors.push({ scope: e.field ? 'field' : 'channel', source: null, channel: e.channel || ch.name, type: e.type || '', level: e.level || '', text: e.text || '', field: e.field || '' });
    });
    (ch.uncompared || []).forEach(function (u) {
      uncompared.push({ type: 1, channel: u.channel || ch.name, value: u.xpath || '', note: u.note || '' });
    });
    (ch.uncomparedCsv || []).forEach(function (u) {
      uncompared.push({ type: 2, channel: u.channel || ch.name, value: u.csvField || '', note: u.note || '' });
    });
    (ch.logs || []).forEach(function (l) {
      logs.push({ scope: 'channel', channel: ch.name, source: null, text: String(l) });
    });
  });
  (it.overviewLogs || []).forEach(function (l) {
    logs.push({ scope: 'item', channel: null, source: null, text: String(l) });
  });

  // 清理旧结构
  (it.channels || []).forEach(function (ch) {
    delete ch.warnings; delete ch.errors; delete ch.uncompared; delete ch.uncomparedCsv; delete ch.logs;
  });
  delete out.overviewLogs;

  out.fields = fields;
  out.warnings = warnings;
  out.errors = errors;
  out.uncompared = uncompared;
  out.logs = logs;

  return out;
}

function migrateDataset(json) {
  const out = Object.assign({}, json);
  out.items = (json.items || []).map(migrateItem);
  return out;
}

function main() {
  const argv = process.argv.slice(2);
  const src = argv[0];
  const dst = argv[1] || src;
  if (!src) { console.error('用法：node tools/migrate-legacy-data.js <旧文件> [新文件]'); process.exit(1); }
  const json = JSON.parse(fs.readFileSync(src, 'utf8'));
  const migrated = migrateDataset(json);
  fs.writeFileSync(dst, JSON.stringify(migrated, null, 2) + '\n', 'utf8');
  console.log('已迁移：' + src + ' -> ' + dst);
}

if (process.argv[1] && process.argv[1].endsWith('migrate-legacy-data.js')) main();

export { migrateDataset };
