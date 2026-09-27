// 「引用 ⊆ 声明」契约测试：item 里出现的报送渠道 / 来源渠道必须是顶层 channels / sources 已声明的。
//
// 契约（见 docs/DATA_SCHEMA.md §3.1/§3.2）：
//   - 顶层 `channels = [{id,name,desc,format}]` / `sources = [{id,name}]` 是**唯一**写声明的地方；
//   - `item.channels[].id` 与 `item.channels[].sources[].id` 必须能在声明表里解析；
//   - item 里可以重复写 name / desc / format / 来源名称，但必须与声明一致；
//   - `skippedItems` 引用的渠道 / 来源渠道同样必须已声明（生成器会把它们补进声明表）；
//   - 声明表两项都可以省：只有在没有任何引用时才不需要（空数据集 / 无 channels 的夹具）。
//
// 这条契约的意义：声明集是**完备且权威**的，因此「id 能否解析」不再依赖任何启发式回退
// （预设表 / 名称反查），是后续「引用只留 id」的前提。
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

const item = (over) => Object.assign({
  tradeId: 'T-1',
  reportDate: '2026-08-16',
  channels: [{ id: 1, fields: [], sources: [{ id: 1, fields: [] }] }],
  warnings: [{ channelId: 1, sourceId: 1, type: 't', level: 'WARN', text: 'w' }],
  logs: [{ scope: 'field', channel: 'HKTR', channelId: 1, source: SRC_A, sourceId: 1, field: '1', text: 'x' }],
}, over || {});

const dataset = (over) => Object.assign({
  mode: 'single',
  reportEnv: 'OTCXXX',
  channels: [{ id: 1, name: 'HKTR', desc: '香港交易资料储存库', format: 'xml' }],
  sources: [{ id: 1, name: SRC_A }],
  items: [item()],
}, over || {});

test('契约：item 引用的渠道 / 来源渠道必须已声明（未声明即报错，不再有回退）', () => {
  assert.equal(validateDataset(dataset()).ok, true, '已声明的引用合法');

  const undeclaredCh = validateDataset(dataset({ items: [item({ channels: [{ id: 3, fields: [], sources: [] }] })] }));
  assert.equal(undeclaredCh.ok, false);
  assert.ok(undeclaredCh.errors.some((e) => e.includes('未在顶层 channels 声明表里声明')), JSON.stringify(undeclaredCh.errors));

  const undeclaredSrc = validateDataset(dataset({ items: [item({ channels: [{ id: 1, fields: [], sources: [{ id: 2, fields: [] }] }] })] }));
  assert.equal(undeclaredSrc.ok, false);
  assert.ok(undeclaredSrc.errors.some((e) => e.includes('未在顶层 sources 声明表里声明')), JSON.stringify(undeclaredSrc.errors));
});

test('契约：旧形态（定义写在 item 里、顶层无声明）不再合法，提示要迁移', () => {
  const legacy = {
    mode: 'single',
    items: [{ tradeId: 'T-1', reportDate: '2026-08-16', channels: [{ id: 1, name: 'HKTR', sources: [{ id: 1, name: SRC_A, fields: [] }] }] }],
  };
  const r = validateDataset(legacy);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('未在顶层 channels 声明表里声明')), JSON.stringify(r.errors));
  assert.ok(r.errors.some((e) => e.includes('未在顶层 sources 声明表里声明')), JSON.stringify(r.errors));
  // 迁移工具会把它转成声明表形态（hoistRegistries），转换后即合规。
  const migrated = hoistRegistries(JSON.parse(JSON.stringify(legacy)));
  assert.deepEqual(migrated.channels, [{ id: 1, name: 'HKTR' }]);
  assert.deepEqual(migrated.sources, [{ id: 1, name: SRC_A }]);
  assert.equal(validateDataset(migrated).ok, true, JSON.stringify(validateDataset(migrated).errors));
});

test('契约：item 里重复写的名称必须与声明一致（可省，但不能各说一套）', () => {
  const agree = dataset({ items: [item({ channels: [{ id: 1, name: 'HKTR', fields: [], sources: [{ id: 1, name: SRC_A, fields: [] }] }] })] });
  assert.equal(validateDataset(agree).ok, true, JSON.stringify(validateDataset(agree).errors));

  const badName = dataset({ items: [item({ channels: [{ id: 1, name: 'JSFA', fields: [], sources: [] }] })] });
  assert.equal(validateDataset(badName).ok, false);
  assert.ok(validateDataset(badName).errors.some((e) => e.includes('与顶层声明')), JSON.stringify(validateDataset(badName).errors));

  const badSrcName = dataset({ items: [item({ channels: [{ id: 1, fields: [], sources: [{ id: 1, name: '来源渠道 B', fields: [] }] }] })] });
  assert.equal(validateDataset(badSrcName).ok, false);
  assert.ok(validateDataset(badSrcName).errors.some((e) => e.includes('与顶层声明')), JSON.stringify(validateDataset(badSrcName).errors));

  const badDesc = dataset({ items: [item({ channels: [{ id: 1, desc: 'OTHER', fields: [], sources: [] }] })] });
  assert.equal(validateDataset(badDesc).ok, false);
  assert.ok(validateDataset(badDesc).errors.some((e) => e.includes('desc 与顶层渠道声明不一致')), JSON.stringify(validateDataset(badDesc).errors));
});

test('契约：声明表两项可省，但一旦有引用就必须存在', () => {
  // 没有任何渠道引用（空 channels）时不需要声明表。
  assert.equal(validateDataset({ mode: 'single', items: [{ tradeId: 'T-1', reportDate: 'd', channels: [] }] }).ok, true);
  assert.equal(validateDataset({ mode: 'single', items: [] }).ok, true);
  // 多文件清单的 item 桩没有 channels：清单可以只带声明表、也可以不带。
  assert.equal(validateDataset({ mode: 'multi', channels: [{ id: 1, name: 'HKTR' }], items: [{ tradeId: 'T-1', file: 'a.json' }] }).ok, true);
});

test('契约：skippedItems 引用的渠道 / 来源渠道同样必须已声明', () => {
  // 被跳过的 item 不在 items 里：它的渠道 / 来源渠道也得在声明表里。
  const ok = dataset({
    channels: [{ id: 1, name: 'HKTR' }, { id: 2, name: 'JSFA' }],
    sources: [{ id: 1, name: SRC_A }, { id: 2, name: '来源渠道 B' }],
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
    items: [{ tradeId: 'T-1', reportDate: 'd', channels: [{ id: 1, name: 'HKTR', desc: 'D', format: 'xml', fields: [], sources: [{ id: 1, name: SRC_A, fields: [] }] }] }],
    // 被跳过的 item 用了 JSFA / 来源渠道 B，而所有 item 里都没有它们：
    skippedItems: [{ itemId: 'T-9', channel: 'JSFA', channelId: 2, source: '来源渠道 B', sourceId: 2, reason: 'r' }],
  };
  const hoisted = hoistRegistries(flat);
  assert.deepEqual(hoisted.channels.map((c) => c.id + ':' + c.name), ['1:HKTR', '2:JSFA'], 'skipped 引用也要声明');
  assert.deepEqual(hoisted.sources.map((s) => s.id + ':' + s.name), ['1:' + SRC_A, '2:来源渠道 B']);
  assert.equal(validateDataset(hoisted).ok, true, JSON.stringify(validateDataset(hoisted).errors));
  // 声明冲突（同 id 不同名称）依然会被发现。
  assert.throws(() => hoistRegistries({
    items: [{ tradeId: 'A', channels: [{ id: 1, name: 'HKTR' }] }, { tradeId: 'B', channels: [{ id: 1, name: 'JSFA' }] }],
  }), /定义不一致/);
});

test('落盘样例数据：每个数据文件都满足「引用 ⊆ 声明」（含全部批次）', () => {
  // 这条守卫是必要的：样例批次是按数据集切片重新拼出来的顶层对象，
  // 一旦忘记带上 channels / sources，所有批次都会静默变成「未声明」形态
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
    const chIds = new Set((manifest.channels || []).map((c) => c.id));
    const srcIds = new Set((manifest.sources || []).map((s) => s.id));
    let refs = 0;
    manifest.items.forEach((stub) => {
      const rel = stub.file || stub.dataUrl;
      assert.ok(rel, '清单 item 必须有 file（多文件模式）');
      const itemJson = JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
      (itemJson.channels || []).forEach((ch) => {
        refs++;
        assert.equal(chIds.has(ch.id), true, path.relative(SRC_DIR, manifestPath) + '：' + stub.tradeId + ' 的渠道 id=' + ch.id + ' 未在清单声明');
        assert.equal(ch.name, undefined, 'item 文件里不应重复写渠道定义（' + stub.tradeId + '）');
        (ch.sources || []).forEach((s) => {
          refs++;
          assert.equal(srcIds.has(s.id), true, path.relative(SRC_DIR, manifestPath) + '：' + stub.tradeId + ' 的来源渠道 id=' + s.id + ' 未在清单声明');
        });
      });
    });
    assert.ok(refs > 0, '应至少检查到一个引用');
  });
});

test('落盘样例数据：声明表覆盖所有引用（含 skippedItems），且声明项与预设一致', () => {
  ['report-validation-data.json', 'report-validation-data-default.json'].forEach((name) => {
    const json = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8'));
    const chIds = new Set((json.channels || []).map((c) => c.id));
    const srcIds = new Set((json.sources || []).map((s) => s.id));
    assert.equal(validateDataset(json).ok, true, name + ' 必须通过契约校验：' + JSON.stringify(validateDataset(json).errors.slice(0, 3)));
    // items 与 skippedItems 里的所有引用都能在声明表里解析。
    const refs = [];
    json.items.forEach((it) => (it.channels || []).forEach((ch) => {
      refs.push(['channel', ch.id, it.tradeId]);
      (ch.sources || []).forEach((s) => refs.push(['source', s.id, it.tradeId]));
    }));
    (json.skippedItems || []).forEach((s) => {
      if (s.channelId != null) refs.push(['channel', s.channelId, 'skipped:' + s.itemId]);
      if (s.sourceId != null) refs.push(['source', s.sourceId, 'skipped:' + s.itemId]);
    });
    refs.forEach(([kind, id, where]) => {
      const declared = kind === 'channel' ? chIds.has(id) : srcIds.has(id);
      assert.equal(declared, true, name + '：' + where + ' 引用的 ' + kind + ' id=' + id + ' 未声明');
    });
    // 预设一致性（HKTR=1 / JSFA=2 / CFTC=3、来源渠道 A=1 / B=2）。
    (json.channels || []).forEach((c) => {
      if (CHANNEL_ID_PRESET[c.name] != null) assert.equal(c.id, CHANNEL_ID_PRESET[c.name], '渠道 ' + c.name + ' 的 id 应为预设值');
    });
    (json.sources || []).forEach((s) => {
      if (SOURCE_ID_PRESET[s.name] != null) assert.equal(s.id, SOURCE_ID_PRESET[s.name], '来源渠道 ' + s.name + ' 的 id 应为预设值');
    });
    // hydrate 后 item 侧引用仍然完好（名称被补回）。
    const hydrated = hydrateDataset(json);
    assert.equal(hydrated.items[0].channels.every((c) => c.name && c.sources.every((s) => s.name)), true, 'hydrate 后名称齐备');
  });
});
