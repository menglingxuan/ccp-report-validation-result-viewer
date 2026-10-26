// 批次模式转换（多文件 -> 单文件）测试：
// 用样例数据真正拆成多文件批次，再合并回单文件，断言结构与校验结果；并覆盖错误分支（不写坏数据）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildDataset, splitToFiles } from '../lib/sample-data.js';
import { validateDataset } from '../lib/validate.js';
import {
  DEFAULT_MANIFEST_NAME, BACKUP_SUFFIX,
  mergeManifest, mergeBatchDir, mergeBatchDirToSingle, resolveManifestPath, findBatchDir, listBatchDirs,
} from '../lib/merge-batch.js';

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-merge-' + tag + '-'));
}

// 造一个多文件模式批次目录：清单 + data/items/*.json + batch-meta.json
function makeMultiBatch(dir, opts) {
  const o = opts || {};
  const dataset = buildDataset({ itemCount: o.itemCount || 3, seed: 7 });
  const manifestName = o.manifestName || DEFAULT_MANIFEST_NAME;
  splitToFiles(dataset, dir, manifestName);
  fs.writeFileSync(path.join(dir, 'batch-meta.json'), JSON.stringify({
    reportEnv: dataset.reportEnv,
    creationType: 'sample',
    batchId: o.batchId || 'batch-merge-test',
    batchName: o.batchId || 'batch-merge-test',
    date: '2026-08-16',
    executedAt: '2026-08-16T17:00:00+08:00',
    formatVersion: 4,
    dataUrl: o.dataUrl || manifestName,
    summary: { items: dataset.items.length },
  }, null, 2) + '\n');
  return { dataset: dataset, manifestName: manifestName };
}

test('mergeManifest：多文件清单 + item 内容 -> 单文件数据集（保留顶层字段、丢弃 file/summary）', () => {
  const manifest = {
    mode: 'multi',
    reportEnv: 'ENVX',
    creationType: 'sample',
    skippedItems: [{ itemId: 'T-X', channel: null, source: null, reason: 'no-data' }],
    extra: { note: 'keep me' },
    items: [
      { tradeId: 'T-1', file: 'data/items/T-1.json', summary: { total: 3 } },
      { tradeId: 'T-2', file: 'data/items/T-2.json', summary: { total: 1 } },
    ],
  };
  const a = { tradeId: 'T-1', channels: [] };
  const b = { tradeId: 'T-2', channels: [] };

  const r = mergeManifest(manifest, [a, b]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.issues, []);
  assert.equal(r.dataset.mode, 'single');
  assert.equal(r.dataset.reportEnv, 'ENVX');
  assert.equal(r.dataset.creationType, 'sample');
  assert.deepEqual(r.dataset.skippedItems, manifest.skippedItems, '顶层字段原样保留');
  assert.deepEqual(r.dataset.extra, { note: 'keep me' }, '未知顶层字段也保留');
  assert.deepEqual(r.dataset.items, [a, b], 'item 顺序与清单一致，且不含 file/summary');
  assert.equal(Object.prototype.hasOwnProperty.call(r.dataset.items[0], 'file'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(r.dataset.items[0], 'summary'), false);
});

test('mergeManifest：非多文件清单 / 缺 items / tradeId 不一致都给出明确结果', () => {
  assert.equal(mergeManifest({ mode: 'single', items: [] }, []).ok, false, '单文件清单不再合并');
  assert.equal(mergeManifest(null, []).ok, false);
  const noItems = mergeManifest({ mode: 'multi' }, []);
  assert.equal(noItems.ok, true);
  assert.deepEqual(noItems.dataset.items, []);
  assert.match(noItems.issues.join('；'), /缺少 items 数组/);

  const mismatch = mergeManifest({ mode: 'multi', items: [{ tradeId: 'T-1', file: 'a.json' }] }, [{ tradeId: 'T-9' }]);
  assert.equal(mismatch.ok, true);
  assert.match(mismatch.issues.join('；'), /tradeId（T-9）与清单（T-1）不一致/);

  const countMismatch = mergeManifest({ mode: 'multi', items: [{ tradeId: 'T-1', file: 'a.json' }] }, []);
  assert.match(countMismatch.issues.join('；'), /数量（0）与清单（1）不一致/);
});

test('mergeBatchDir：真实多文件批次能合并，且结果通过 validateDataset', () => {
  const dir = tmpDir('ok');
  try {
    const made = makeMultiBatch(dir, { itemCount: 4 });
    const manifestBefore = JSON.parse(fs.readFileSync(path.join(dir, made.manifestName), 'utf8'));

    const res = mergeBatchDir(dir);
    assert.equal(res.ok, true, res.error || '');
    assert.equal(res.itemFiles.length, 4);
    assert.equal(res.dataset.mode, 'single');
    assert.equal(res.dataset.items.length, 4);
    assert.equal(res.dataset.reportEnv, made.dataset.reportEnv);

    // 合并结果的 item 应与拆分前的原始 item 完全一致（深度相等；拆出的 item 文件即原文）。
    made.dataset.items.forEach(function (orig, i) {
      assert.deepEqual(res.dataset.items[i], orig, '第 ' + (i + 1) + ' 个 item 与拆分前一致');
    });

    const v = validateDataset(res.dataset);
    assert.equal(v.ok, true, '合并结果应通过数据校验：' + v.errors.join('；'));
    assert.deepEqual(res.issues, []);

    // 清单未被修改（mergeBatchDir 只读）
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, made.manifestName), 'utf8')), manifestBefore);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mergeBatchDirToSingle：原地覆盖清单 + 备份 + 可 dry-run；item 文件保留', () => {
  const dir = tmpDir('write');
  try {
    const made = makeMultiBatch(dir, { itemCount: 3 });
    const manifestPath = path.join(dir, made.manifestName);
    const multiText = fs.readFileSync(manifestPath, 'utf8');

    // dry-run：不写文件
    const dry = mergeBatchDirToSingle(dir, { dryRun: true });
    assert.equal(dry.ok, true, dry.error || '');
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), multiText, 'dry-run 不应改动清单');
    assert.equal(fs.existsSync(manifestPath + BACKUP_SUFFIX), false);

    const res = mergeBatchDirToSingle(dir);
    assert.equal(res.ok, true, res.error || '');
    assert.equal(res.outputPath, manifestPath, '默认原地覆盖清单');
    assert.equal(res.backupPath, manifestPath + BACKUP_SUFFIX);
    assert.equal(fs.readFileSync(res.backupPath, 'utf8'), multiText, '备份是多文件清单原文');

    const after = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(after.mode, 'single');
    assert.equal(after.items.length, 3);
    assert.equal(after.items[0].file, undefined);
    assert.equal(fs.existsSync(path.join(dir, 'data', 'items')), true, 'item 文件保留（可回退）');

    // 幂等性：已是单文件模式时报错且不写
    const again = mergeBatchDirToSingle(dir);
    assert.equal(again.ok, false);
    assert.match(again.error, /mode 不是 "multi"/);
    assert.equal(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).mode, 'single');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mergeBatchDir：缺 item 文件 / 非法 JSON / 非多文件清单都失败且不改动清单', () => {
  const dir = tmpDir('bad');
  try {
    const made = makeMultiBatch(dir, { itemCount: 2 });
    const manifestPath = path.join(dir, made.manifestName);
    const before = fs.readFileSync(manifestPath, 'utf8');

    // 删掉一个 item 文件
    const itemsDir = path.join(dir, 'data', 'items');
    const victim = fs.readdirSync(itemsDir)[0];
    fs.rmSync(path.join(itemsDir, victim));
    const missing = mergeBatchDirToSingle(dir);
    assert.equal(missing.ok, false);
    assert.match(missing.error, /item 文件不存在/);
    assert.equal(fs.readFileSync(manifestPath, 'utf8'), before, '失败时清单保持不变');

    // 恢复后再把文件改成非法 JSON
    splitToFiles(made.dataset, dir, made.manifestName);
    fs.writeFileSync(path.join(itemsDir, victim), '{ not json', 'utf8');
    const broken = mergeBatchDir(dir);
    assert.equal(broken.ok, false);
    assert.match(broken.error, /不是合法 JSON/);

    // 单文件模式清单
    fs.writeFileSync(manifestPath, JSON.stringify({ mode: 'single', items: [] }, null, 2), 'utf8');
    const single = mergeBatchDir(dir);
    assert.equal(single.ok, false);
    assert.match(single.error, /mode 不是 "multi"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveManifestPath / findBatchDir / listBatchDirs：按 batch-meta 的 dataUrl 与索引定位批次', () => {
  const dir = tmpDir('find');
  try {
    const batchesDir = path.join(dir, 'batches');
    const batchDir = path.join(batchesDir, '2026-08-16', 'b-multi');
    fs.mkdirSync(batchDir, { recursive: true });
    makeMultiBatch(batchDir, { itemCount: 2, batchId: 'b-multi', dataUrl: 'data/batch.json', manifestName: 'data/batch.json' });

    // 清单名优先取 batch-meta.json 的 dataUrl（相对批次目录）
    assert.equal(resolveManifestPath(batchDir), path.join(batchDir, 'data', 'batch.json'));

    // 无 batch-meta.json 时退回默认名
    const plain = path.join(batchesDir, 'plain');
    fs.mkdirSync(plain, { recursive: true });
    assert.equal(resolveManifestPath(plain), path.join(plain, DEFAULT_MANIFEST_NAME));

    // 索引优先：batchId -> path
    const indexFile = path.join(dir, 'batches-index.json');
    fs.writeFileSync(indexFile, JSON.stringify({
      schemaVersion: 1,
      batches: [{ batchId: 'b-multi', path: path.relative(dir, batchDir).replace(/\\/g, '/'), dataUrl: 'batches/2026-08-16/b-multi/data/batch.json' }],
    }, null, 2), 'utf8');
    assert.equal(findBatchDir(batchesDir, 'b-multi', indexFile), batchDir);
    // 索引中没有时按目录名递归查找
    assert.equal(findBatchDir(batchesDir, 'b-multi', null), batchDir);
    assert.equal(findBatchDir(batchesDir, 'nope', null), null);

    const list = listBatchDirs(batchesDir);
    const hit = list.find(function (b) { return b.batchId === 'b-multi'; });
    assert.ok(hit, '应能列出该批次');
    assert.equal(hit.mode, 'multi');
    assert.equal(hit.dir, batchDir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// v4 契约回归：v4 引入的 ctx 相关结构（usedCtxKeyDefs / item.ctxDtls 只留 { hits } / 规则的
// ctxRaw + metaCtxs）必须逐字节穿过「多文件 -> 单文件」，不得被转换工具改写或丢掉
// —— 版本升级后最容易静默坏掉的就是这类"工具原样搬运"的字段。
test('v4 契约：多文件 -> 单文件往返后 ctx 相关结构逐字节不变', () => {
  const dir = tmpDir('v4-roundtrip');
  try {
    const made = makeMultiBatch(dir, { itemCount: 3 });
    const res = mergeBatchDirToSingle(dir, { backup: false });
    assert.equal(res.ok, true, res.error);
    const merged = JSON.parse(fs.readFileSync(path.join(dir, DEFAULT_MANIFEST_NAME), 'utf8'));

    assert.equal(merged.mode, 'single');
    assert.deepEqual(merged.items, made.dataset.items, 'items 应与拆分前逐字节一致（含 ctxDtls / metaCtxs / ctxRaw）');
    assert.deepEqual(merged.usedCtxKeyDefs, made.dataset.usedCtxKeyDefs, 'ctxKey 声明表原样保留');
    assert.deepEqual(merged.reportChannelDefs, made.dataset.reportChannelDefs, '报告渠道声明表原样保留');
    assert.deepEqual(merged.sourceChannelDefs, made.dataset.sourceChannelDefs, '来源渠道声明表原样保留');

    // item 内 ctxDtls 只留 { hits }
    merged.items.forEach((it) => {
      Object.keys(it.ctxDtls || {}).forEach((k) => {
        assert.deepEqual(Object.keys(it.ctxDtls[k]), ['hits'], 'ctxDtls.' + k + ' 只应保留 hits');
      });
    });

    // 规则对象里只有 ctxRaw / metaCtxs，没有 v3 时代的 ctx / ctxs
    const keys = new Set();
    merged.items.forEach((it) => (it.channels || []).forEach((ch) => (ch.sources || []).forEach((s) => (s.fields || []).forEach((f) => {
      ['cmpLeft', 'cmpRight', 'cvtLeft', 'cvtRight', 'vdt'].forEach((k) => {
        if (f[k]) Object.keys(f[k]).forEach((x) => keys.add(x));
      });
    }))));
    assert.equal(keys.has('ctxRaw'), true, '规则应保留 ctxRaw');
    assert.equal(keys.has('metaCtxs'), true, '规则应保留 metaCtxs');
    assert.equal(keys.has('ctx'), false, '不应出现旧键 ctx');
    assert.equal(keys.has('ctxs'), false, '不应出现旧键 ctxs');

    // 合并结果通过当前校验器
    const v = validateDataset(merged);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
