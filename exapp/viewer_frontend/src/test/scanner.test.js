// 批次扫描器测试：扫描 public/batches（共享样例数据），输出到临时索引文件。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan, sanitizeTags } from '../lib/scanner.js';
import { SRC_ROOT } from '../lib/config.js';

// 直接使用共享样例批次目录（扫描器本身与租户无关，由 server.js 传入租户路径）。
const SHARED_BATCHES = path.join(SRC_ROOT, 'public', 'batches');

test('扫描批次目录并生成索引', async () => {
  const out = path.join(os.tmpdir(), 'batches-index-test-' + Date.now() + '.json');
  try {
    const r = await scan({ basedir: SHARED_BATCHES, out, ignore: [], env: null });
    assert.equal(r.ok, true, r.error);
    assert.ok(r.count > 0, '应至少发现一个批次');
    assert.ok(fs.existsSync(out));

    const idx = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(idx.count, r.count);
    assert.ok(Array.isArray(idx.batches));
    idx.batches.forEach((b) => {
      assert.ok(b.batchId);
      assert.ok(b.dataUrl, '每个批次都应有 dataUrl');
    });
  } finally {
    try { fs.unlinkSync(out); } catch (e) {}
  }
});

test('env 过滤只返回指定环境', async () => {
  const out = path.join(os.tmpdir(), 'batches-index-env-test-' + Date.now() + '.json');
  try {
    const r = await scan({ basedir: SHARED_BATCHES, out, ignore: [], env: 'OTCXXX' });
    assert.equal(r.ok, true, r.error);
    r.batches.forEach((b) => assert.equal(b.reportEnv, 'OTCXXX'));
  } finally {
    try { fs.unlinkSync(out); } catch (e) {}
  }
});

test('sanitizeTags：去空白 / 去重 / 限长 / 限量', () => {
  assert.deepEqual(sanitizeTags([' a ', 'a', '', '  ', 'b']), ['a', 'b']);
  assert.deepEqual(sanitizeTags('a'), [], '非数组应返回空数组');
  assert.deepEqual(sanitizeTags(null), [], 'null 应返回空数组');
  assert.deepEqual(sanitizeTags([{ label: 'x' }, { label: '' }, {}]), ['x'], '支持 { label } 对象形式');
  assert.equal(sanitizeTags(['x'.repeat(40)])[0].length, 24, '单个标签长度应受限（24）');
  const many = [];
  for (let i = 0; i < 30; i++) many.push('t' + i);
  assert.equal(sanitizeTags(many).length, 12, '标签数量应受限（12）');
});

test('标记 deleted 的批次仍写入索引并带 deleted 标记（软删除）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-del-'));
  const out = path.join(tmp, 'batches-index.json');
  try {
    const mk = (name, deleted) => {
      const dir = path.join(tmp, name);
      fs.mkdirSync(dir, { recursive: true });
      const meta = { batchId: name, batchName: name, date: '2026-08-16', executedAt: '2026-08-16T00:00:00+08:00', summary: { items: 1 }, tags: [' 回归 ', '回归', ''] };
      if (deleted) meta.deleted = true;
      fs.writeFileSync(path.join(dir, 'batch-meta.json'), JSON.stringify(meta), 'utf8');
      fs.writeFileSync(path.join(dir, 'report-validation-data.json'), JSON.stringify({ mode: 'single', reportEnv: 'OTCXXX', items: [{ tradeId: 'T-1', reportDate: '2026-08-16', channels: [] }] }), 'utf8');
    };
    mk('b1', true);
    mk('b2', false);

    const r = await scan({ basedir: tmp, out, ignore: [], env: null });
    assert.equal(r.ok, true, r.error);
    // 已删除批次保留在索引中（带 deleted 标记），供前端「全部批次(含已删除)」范围展示。
    assert.equal(r.count, 2, '已删除批次也应写入索引');
    const b1 = r.batches.find((b) => b.batchId === 'b1');
    const b2 = r.batches.find((b) => b.batchId === 'b2');
    assert.equal(b1.deleted, true, '已删除批次应带 deleted 标记');
    assert.equal(b2.deleted, undefined, '未删除批次不应带 deleted 标记');
    assert.equal(b1.summary.items, 1);
    assert.deepEqual(b1.tags, ['回归'], '元数据 tags 应清洗后进入索引');
    assert.deepEqual(b2.tags, ['回归']);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
});

test('batch-meta 的 dataUrl 按批次目录解析，而非固定指向 web 根', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-dataurl-'));
  const out = path.join(tmp, 'batches-index.json');
  try {
    const dir = path.join(tmp, 'b1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'batch-meta.json'), JSON.stringify({
      batchId: 'b1', batchName: 'batch-one', date: '2026-08-16', executedAt: '2026-08-16T00:00:00+08:00',
      dataUrl: 'report-validation-data.json', reportEnv: 'OTCXXX', summary: { items: 1 },
    }), 'utf8');
    fs.writeFileSync(path.join(dir, 'report-validation-data.json'), JSON.stringify({ mode: 'single', reportEnv: 'OTCXXX', items: [{ tradeId: 'T-1', reportDate: '2026-08-16', channels: [] }] }), 'utf8');

    const r = await scan({ basedir: tmp, out, ignore: [], env: null });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.count, 1, '应发现一个批次');
    assert.equal(r.batches[0].dataUrl, 'b1/report-validation-data.json',
      'dataUrl 应指向批次目录自身的 report-validation-data.json');
    assert.notEqual(r.batches[0].dataUrl, 'report-validation-data.json',
      'dataUrl 不应固定指向 web 根目录的 report-validation-data.json');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
});
