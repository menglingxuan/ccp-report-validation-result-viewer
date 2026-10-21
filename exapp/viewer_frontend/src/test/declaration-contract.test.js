// 「引用 ⊆ 声明」契约测试：item 里出现的一切引用（渠道 / 来源渠道 / 字段 / ctxKey）
// 都必须是顶层声明表（reportChannelDefs / sourceChannelDefs / usedCtxKeyDefs）已声明的。
//
// 契约（见 docs/DATA_SCHEMA.md §3.1/§3.2）：
//   - `reportChannelDefs = [{id,name,desc,format,fieldDefs:[{id,name,userTag,type}]}]`；
//   - `sourceChannelDefs = [{id,name,format}]`（format: csv / xml）；
//   - `usedCtxKeyDefs = { <ctxKey>: {id,type,rules,def} }`（rules: fdm / cvt / vdt），item.ctxDefs 只留 {id,hits}；
//   - item.channels[].id / .sources[].id / .sources[].fields[].id / 规则 ctxs 必须在对应声明表里解析；
//   - item 里可以重复写名称，但必须与声明一致；声明表被引用时不可省；
//   - warnings / errors / uncompared 只写名称（不带 id），logs 与 skippedItems 写 id。
//
// 这条契约的意义：声明集是**完备且权威**的，因此「id 能否解析」不再依赖任何启发式回退
// （预设表 / 名称反查），字段定义也只需一处维护。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDataset } from '../lib/validate.js';
import { hoistRegistries, hydrateDataset, CHANNEL_ID_PRESET, SOURCE_ID_PRESET } from '../public/core.js';

const SRC_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = path.join(SRC_DIR, 'public');
const SRC_A = '来源渠道 A';
const FIELD = { id: '1', name: 'tradeId', userTag: 'contextAssertion', type: 'id' };
const CTX_KEY = 'hktr.ctx.default';

const item = (over) => Object.assign({
  tradeId: 'T-1',
  reportDate: '2026-08-16',
  ctxDefs: { [CTX_KEY]: { id: 1, hits: '命中 1 个映射条目' } },
  channels: [{
    id: 1,
    sources: [{ id: 1, fields: [{ id: '1', result: 'PASSED', cmpLeft: { valueSrcFmt: 'csv' }, cmpRight: { valueSrcFmt: 'xml', ctxs: [1] } }] }],
  }],
  warnings: [{ channel: 'HKTR', source: SRC_A, type: 't', level: 'WARN', text: 'w' }],
  logs: [{ scope: 'field', channelId: 1, sourceId: 1, field: '1', text: 'x' }],
}, over || {});

const dataset = (over) => Object.assign({
  mode: 'single',
  reportEnv: 'OTCXXX',
  reportChannelDefs: [{ id: 1, name: 'HKTR', desc: '香港交易资料储存库', format: 'xml', fieldDefs: [FIELD] }],
  sourceChannelDefs: [{ id: 1, name: SRC_A, format: 'csv' }],
  usedCtxKeyDefs: { [CTX_KEY]: { id: 1, type: 'builtin', rules: ['fdm'], def: 'HKTR 默认上下文' } },
  items: [item()],
}, over || {});

test('契约：item 引用的渠道 / 来源渠道 / 字段 / ctxKey 必须已声明', () => {
  assert.equal(validateDataset(dataset()).ok, true, '已声明的引用合法');

  const undeclaredCh = validateDataset(dataset({ items: [item({ channels: [{ id: 3, sources: [] }] })] }));
  assert.equal(undeclaredCh.ok, false);
  assert.ok(undeclaredCh.errors.some((e) => e.includes('未在顶层 reportChannelDefs 声明表里声明')), JSON.stringify(undeclaredCh.errors));

  const undeclaredSrc = validateDataset(dataset({ items: [item({ channels: [{ id: 1, sources: [{ id: 2, fields: [] }] }] })] }));
  assert.equal(undeclaredSrc.ok, false);
  assert.ok(undeclaredSrc.errors.some((e) => e.includes('未在顶层 sourceChannelDefs 声明表里声明')), JSON.stringify(undeclaredSrc.errors));

  const undeclaredField = validateDataset(dataset({ items: [item({ channels: [{ id: 1, sources: [{ id: 1, fields: [{ id: '9' }] }] }] })] }));
  assert.equal(undeclaredField.ok, false);
  assert.ok(undeclaredField.errors.some((e) => e.includes('fieldDefs 里声明')), JSON.stringify(undeclaredField.errors));

  const undeclaredCtx = validateDataset(dataset({ items: [item({
    ctxDefs: { [CTX_KEY]: { id: 1 } },
    channels: [{ id: 1, sources: [{ id: 1, fields: [{ id: '1', cmpRight: { ctxs: [7] } }] }] }],
  })] }));
  assert.equal(undeclaredCtx.ok, false);
  assert.ok(undeclaredCtx.errors.some((e) => e.includes('引用了未在 usedCtxKeyDefs 声明的 ctx id：7')), JSON.stringify(undeclaredCtx.errors));
});

test('契约：旧形态（定义写在 item 里、顶层无声明）不再合法，hoistRegistries 可迁移', () => {
  const legacy = {
    mode: 'single',
    items: [{
      tradeId: 'T-1',
      reportDate: '2026-08-16',
      ctxDefs: { [CTX_KEY]: { id: 1, scopes: [1], type: 'builtin', def: 'HKTR 默认上下文', hits: 'h' } },
      channels: [{
        id: 1, name: 'HKTR', desc: 'D', format: 'xml',
        fields: [{ id: '1', name: 'tradeId', userTag: 'contextAssertion', type: 'id' }],
        sources: [{ id: 1, name: SRC_A, fields: [{ id: '1', cmpLeft: { srcType: 2 }, cmpRight: { srcType: 1, ctxs: [1] } }] }],
      }],
    }],
  };
  const r = validateDataset(legacy);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('未在顶层 reportChannelDefs 声明表里声明')), JSON.stringify(r.errors));
  assert.ok(r.errors.some((e) => e.includes('未在顶层 sourceChannelDefs 声明表里声明')), JSON.stringify(r.errors));

  // 迁移工具 / 生成器的归一化步骤（hoistRegistries）把它转成声明表形态，转换后即合规。
  const migrated = hoistRegistries(JSON.parse(JSON.stringify(legacy)));
  assert.deepEqual(migrated.reportChannelDefs, [{
    id: 1, name: 'HKTR', desc: 'D', format: 'xml',
    fieldDefs: [{ id: '1', name: 'tradeId', userTag: 'contextAssertion', type: 'id' }],
  }]);
  assert.deepEqual(migrated.sourceChannelDefs, [{ id: 1, name: SRC_A, format: 'csv' }]);
  assert.deepEqual(migrated.usedCtxKeyDefs, { [CTX_KEY]: { id: 1, type: 'builtin', rules: ['fdm'], def: 'HKTR 默认上下文' } });
  assert.deepEqual(migrated.items[0].ctxDefs, { [CTX_KEY]: { id: 1, hits: 'h' } }, 'item 内只留 { id, hits }');
  assert.equal('fields' in migrated.items[0].channels[0], false, 'item 内不再写字段定义');
  // 比较规则的 srcType（数字）归一为 valueSrcFmt（字符串）。
  assert.equal(migrated.items[0].channels[0].sources[0].fields[0].cmpRight.valueSrcFmt, 'xml');
  assert.equal('srcType' in migrated.items[0].channels[0].sources[0].fields[0].cmpLeft, false);
  assert.equal(validateDataset(migrated).ok, true, JSON.stringify(validateDataset(migrated).errors));
});

// 顶层键顺序固定（docs/DATA_SCHEMA.md §1）：声明表读在数据前，skippedItems 紧跟声明表之后。
const EXPECTED_ROOT_ORDER = [
  'mode', 'reportEnv', 'creationType',
  'reportChannelDefs', 'sourceChannelDefs', 'usedCtxKeyDefs',
  'skippedItems', 'items',
];

test('契约：顶层键顺序为 …声明表 → usedCtxKeyDefs → skippedItems → items', () => {
  const hoisted = hoistRegistries({
    mode: 'single', reportEnv: 'E', creationType: 'sample',
    skippedItems: [{ itemId: 'T-9', channel: 'HKTR', channelId: 1, source: null, sourceId: null, reason: 'r' }],
    items: [item()],
  });
  assert.deepEqual(Object.keys(hoisted), EXPECTED_ROOT_ORDER, 'hoistRegistries 输出键顺序');

  // 无 skippedItems 时也不应凭空多出该键（顺序断言去掉它）。
  const noSkip = hoistRegistries({ mode: 'single', reportEnv: 'E', creationType: 'sample', items: [item()] });
  assert.deepEqual(Object.keys(noSkip), EXPECTED_ROOT_ORDER.filter((k) => k !== 'skippedItems'));

  // 落盘数据同序（单文件主数据 / 默认模板数据 + 多文件清单）。
  ['report-validation-data.json', 'report-validation-data-default.json'].forEach((name) => {
    const json = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8'));
    assert.deepEqual(Object.keys(json), EXPECTED_ROOT_ORDER, name + ' 顶层键顺序');
  });
});

test('契约：item 里重复写的名称必须与声明一致（可省，但不能各说一套）', () => {
  const agree = dataset({ items: [item({ channels: [{ id: 1, name: 'HKTR', sources: [{ id: 1, name: SRC_A, fields: [] }] }] })] });
  assert.equal(validateDataset(agree).ok, true, JSON.stringify(validateDataset(agree).errors));

  const badName = dataset({ items: [item({ channels: [{ id: 1, name: 'JSFA', sources: [] }] })] });
  assert.equal(validateDataset(badName).ok, false);
  assert.ok(validateDataset(badName).errors.some((e) => e.includes('与顶层声明')), JSON.stringify(validateDataset(badName).errors));

  const badSrcName = dataset({ items: [item({ channels: [{ id: 1, sources: [{ id: 1, name: '来源渠道 B', fields: [] }] }] })] });
  assert.equal(validateDataset(badSrcName).ok, false);
  assert.ok(validateDataset(badSrcName).errors.some((e) => e.includes('与顶层声明')), JSON.stringify(validateDataset(badSrcName).errors));

  const badDesc = dataset({ items: [item({ channels: [{ id: 1, desc: 'OTHER', sources: [] }] })] });
  assert.equal(validateDataset(badDesc).ok, false);
  assert.ok(validateDataset(badDesc).errors.some((e) => e.includes('desc 与顶层渠道声明不一致')), JSON.stringify(validateDataset(badDesc).errors));
});

test('契约：声明表可省，但一旦有引用就必须存在', () => {
  // 没有任何渠道引用（空 channels）时不需要声明表。
  assert.equal(validateDataset({ mode: 'single', items: [{ tradeId: 'T-1', reportDate: 'd', channels: [] }] }).ok, true);
  assert.equal(validateDataset({ mode: 'single', items: [] }).ok, true);
  // 多文件清单的 item 桩没有 channels：清单可以只带声明表、也可以不带。
  assert.equal(validateDataset({ mode: 'multi', reportChannelDefs: [{ id: 1, name: 'HKTR' }], items: [{ tradeId: 'T-1', file: 'a.json' }] }).ok, true);
});

test('契约：skippedItems 名称 + id 双写，且两者都必须在声明表里', () => {
  const ok = dataset({
    reportChannelDefs: [{ id: 1, name: 'HKTR', fieldDefs: [FIELD] }, { id: 2, name: 'JSFA', fieldDefs: [] }],
    sourceChannelDefs: [{ id: 1, name: SRC_A, format: 'csv' }, { id: 2, name: '来源渠道 B', format: 'csv' }],
    skippedItems: [{ itemId: 'T-9', channel: 'JSFA', channelId: 2, source: '来源渠道 B', sourceId: 2, reason: 'r' }],
  });
  assert.equal(validateDataset(ok).ok, true, JSON.stringify(validateDataset(ok).errors));

  const undeclared = dataset({ skippedItems: [{ itemId: 'T-9', channel: 'JSFA', channelId: 2, reason: 'r' }] });
  assert.equal(validateDataset(undeclared).ok, false);
  assert.ok(validateDataset(undeclared).errors.some((e) => e.includes('skippedItems[0]')), JSON.stringify(validateDataset(undeclared).errors));
});

test('生成器：hoistRegistries 会把 skippedItems 的引用补进声明表（保证「引用 ⊆ 声明」）', () => {
  const flat = {
    mode: 'single',
    items: [{
      tradeId: 'T-1', reportDate: 'd',
      ctxDefs: { [CTX_KEY]: { id: 1, scopes: [1], type: 'builtin', def: 'D', hits: 'h' } },
      channels: [{
        id: 1, name: 'HKTR', desc: 'D', format: 'xml',
        fields: [{ id: 1, name: 'tradeId', userTag: 'contextAssertion', type: 'id' }],
        sources: [{ id: 1, name: SRC_A, fields: [{ id: '1', cmpLeft: { srcType: 2 }, cmpRight: { srcType: 1, ctxs: [1] } }] }],
      }],
    }],
    // 被跳过的 item 用了 JSFA / 来源渠道 B，而所有 item 里都没有它们：
    skippedItems: [{ itemId: 'T-9', channel: 'JSFA', channelId: 2, source: '来源渠道 B', sourceId: 2, reason: 'r' }],
  };
  const hoisted = hoistRegistries(flat);
  assert.deepEqual(hoisted.reportChannelDefs.map((c) => c.id + ':' + c.name), ['1:HKTR', '2:JSFA'], 'skipped 引用也要声明');
  assert.deepEqual(hoisted.sourceChannelDefs.map((s) => s.id + ':' + s.name), ['1:' + SRC_A, '2:来源渠道 B']);
  assert.equal(hoisted.reportChannelDefs[0].fieldDefs.length, 1, '字段定义提到报告渠道声明里');
  assert.equal(validateDataset(hoisted).ok, true, JSON.stringify(validateDataset(hoisted).errors));
  // 声明冲突（同 id 不同名称）依然会被发现。
  assert.throws(() => hoistRegistries({
    items: [{ tradeId: 'A', channels: [{ id: 1, name: 'HKTR' }] }, { tradeId: 'B', channels: [{ id: 1, name: 'JSFA' }] }],
  }), /定义不一致/);
  // 同一渠道内字段 id 定义不一致也会被发现。
  assert.throws(() => hoistRegistries({
    items: [
      { tradeId: 'A', channels: [{ id: 1, name: 'HKTR', fields: [{ id: '1', name: 'a', userTag: 't', type: 'id' }] }] },
      { tradeId: 'B', channels: [{ id: 1, name: 'HKTR', fields: [{ id: '1', name: 'b', userTag: 't', type: 'id' }] }] },
    ],
  }), /定义不一致/);
  // ctxKey 定义不一致也报错。
  assert.throws(() => hoistRegistries({
    items: [
      { tradeId: 'A', channels: [], ctxDefs: { [CTX_KEY]: { id: 1, rules: ['fdm'], def: 'X' } } },
      { tradeId: 'B', channels: [], ctxDefs: { [CTX_KEY]: { id: 1, rules: ['fdm'], def: 'Y' } } },
    ],
  }), /定义不一致/);
});

test('落盘样例数据：每个数据文件都满足「引用 ⊆ 声明」（含全部批次）', () => {
  // 这条守卫是必要的：样例批次是按数据集切片重新拼出来的顶层对象，
  // 一旦忘记带上三张声明表，所有批次都会静默变成「未声明」形态
  //（生成器 tools/generate-sample-data.js 的 batchDataset() 就是为此存在的）。
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(f);
      else if (/^report-validation-data(-default)?\.json$/.test(ent.name)) files.push(f);
    }
  };
  walk(PUBLIC_DIR);
  assert.ok(files.length >= 20, '应能找到样例数据文件（含批次），实际 ' + files.length);
  files.forEach((f) => {
    const json = JSON.parse(fs.readFileSync(f, 'utf8'));
    const r = validateDataset(json);
    assert.equal(r.ok, true, path.relative(SRC_DIR, f) + ' 不满足契约：' + JSON.stringify((r.errors || []).slice(0, 3)));
  });
});

test('落盘样例数据：多文件批次清单的声明表覆盖 item 文件里的引用', () => {
  // 多文件模式下清单只会被校验「它自己」：item 文件里的引用不在清单里，
  // 若清单声明不全，查看器 hydrate 时补不出名称（渠道 / 来源渠道会空着）。
  const manifests = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(f);
      else if (ent.name === 'report-validation-data.json') manifests.push(f);
    }
  };
  walk(PUBLIC_DIR);
  const multi = manifests.filter((f) => JSON.parse(fs.readFileSync(f, 'utf8')).mode === 'multi');
  assert.ok(multi.length >= 1, '应至少有一个多文件批次（清单 mode=multi）');
  multi.forEach((manifestPath) => {
    const dir = path.dirname(manifestPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const chById = new Map((manifest.reportChannelDefs || []).map((c) => [c.id, c]));
    const srcIds = new Set((manifest.sourceChannelDefs || []).map((s) => s.id));
    const ctxById = new Map(Object.values(manifest.usedCtxKeyDefs || {}).map((d) => [d.id, d]));
    let refs = 0;
    manifest.items.forEach((stub) => {
      const rel = stub.file || stub.dataUrl;
      assert.ok(rel, '清单 item 必须有 file（多文件模式）');
      const itemJson = JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
      const where = path.relative(SRC_DIR, manifestPath) + '：' + stub.tradeId;
      (itemJson.channels || []).forEach((ch) => {
        refs++;
        const chDef = chById.get(ch.id);
        assert.ok(chDef, where + ' 的渠道 id=' + ch.id + ' 未在清单声明');
        assert.equal(ch.name, undefined, 'item 文件里不应重复写渠道定义（' + stub.tradeId + '）');
        assert.equal(ch.fields, undefined, 'item 文件里不应重复写字段定义（' + stub.tradeId + '）');
        (ch.sources || []).forEach((s) => {
          refs++;
          assert.equal(srcIds.has(s.id), true, where + ' 的来源渠道 id=' + s.id + ' 未在清单声明');
          assert.equal(s.name, undefined, 'item 文件里不应重复写来源渠道定义');
          (s.fields || []).forEach((f) => {
            refs++;
            // 字段定义在父级报告渠道的 fieldDefs 里（见 #7：按父级渠道 id 向上查找）。
            assert.ok((chDef.fieldDefs || []).some((d) => d.id === f.id), where + ' 的字段 id=' + f.id + ' 未在该渠道 fieldDefs 里声明');
          });
        });
      });
      Object.keys(itemJson.ctxDefs || {}).forEach((key) => {
        const local = itemJson.ctxDefs[key] || {};
        refs++;
        assert.ok(ctxById.has(local.id), where + ' 的 ctxKey ' + key + '（id=' + local.id + '）未在清单 usedCtxKeyDefs 里声明');
        assert.equal('type' in local || 'rules' in local || 'def' in local, false, 'item 文件里不应重复写 ctxKey 定义');
      });
    });
    assert.ok(refs > 0, '应至少检查到一个引用');
  });
});

test('落盘样例数据：声明表覆盖所有引用（含 skippedItems），且声明项与预设一致', () => {
  ['report-validation-data.json', 'report-validation-data-default.json'].forEach((name) => {
    const json = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8'));
    const chById = new Map((json.reportChannelDefs || []).map((c) => [c.id, c]));
    const srcIds = new Set((json.sourceChannelDefs || []).map((s) => s.id));
    const ctxIds = new Set(Object.values(json.usedCtxKeyDefs || {}).map((d) => d.id));
    assert.equal(validateDataset(json).ok, true, name + ' 必须通过契约校验：' + JSON.stringify(validateDataset(json).errors.slice(0, 3)));
    // items 与 skippedItems 里的所有引用都能在声明表里解析。
    const refs = [];
    json.items.forEach((it) => (it.channels || []).forEach((ch) => {
      refs.push(['channel', ch.id, it.tradeId]);
      (ch.sources || []).forEach((s) => {
        refs.push(['source', s.id, it.tradeId]);
        (s.fields || []).forEach((f) => refs.push(['field', ch.id + '/' + f.id, it.tradeId]));
      });
      (ch.sources || []).forEach((s) => (s.fields || []).forEach((f) => {
        ['cmpLeft', 'cmpRight', 'cvtLeft', 'cvtRight', 'vdt'].forEach((rk) => {
          (f[rk] && f[rk].ctxs ? f[rk].ctxs : []).forEach((cid) => refs.push(['ctx', cid, it.tradeId]));
        });
      }));
    }));
    (json.skippedItems || []).forEach((s) => {
      if (s.channelId != null) refs.push(['channel', s.channelId, 'skipped:' + s.itemId]);
      if (s.sourceId != null) refs.push(['source', s.sourceId, 'skipped:' + s.itemId]);
    });
    refs.forEach(([kind, id, where]) => {
      const declared = kind === 'channel' ? chById.has(id)
        : kind === 'source' ? srcIds.has(id)
          : kind === 'ctx' ? ctxIds.has(id)
            : (chById.get(Number(String(id).split('/')[0])) || { fieldDefs: [] }).fieldDefs.some((d) => d.id === String(id).split('/')[1]);
      assert.equal(declared, true, name + '：' + where + ' 引用的 ' + kind + ' id=' + id + ' 未声明');
    });
    // 预设一致性（HKTR=1 / JSFA=2 / CFTC=3、来源渠道 A=1 / B=2）。
    (json.reportChannelDefs || []).forEach((c) => {
      if (CHANNEL_ID_PRESET[c.name] != null) assert.equal(c.id, CHANNEL_ID_PRESET[c.name], '渠道 ' + c.name + ' 的 id 应为预设值');
    });
    (json.sourceChannelDefs || []).forEach((s) => {
      if (SOURCE_ID_PRESET[s.name] != null) assert.equal(s.id, SOURCE_ID_PRESET[s.name], '来源渠道 ' + s.name + ' 的 id 应为预设值');
    });
    // hydrate 后名称 / 字段定义 / ctxKey 定义都齐备（查看器其余代码照旧工作）。
    const hydrated = hydrateDataset(json);
    assert.equal(hydrated.items[0].channels.every((c) => c.name && Array.isArray(c.fields) && c.fields.length > 0 && c.sources.every((s) => s.name)), true, 'hydrate 后渠道 / 来源 / 字段定义齐备');
    const anyCtx = Object.keys(hydrated.items[0].ctxDefs || {})[0];
    if (anyCtx) assert.ok(hydrated.items[0].ctxDefs[anyCtx].rules.length > 0, 'hydrate 后 ctxKey 的 rules 齐备');
  });
});
