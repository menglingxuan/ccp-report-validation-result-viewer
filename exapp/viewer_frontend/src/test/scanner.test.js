// 批次扫描器测试：扫描 public/batches，输出到临时索引文件。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from '../lib/scanner.js';
import { loadConfig } from '../lib/config.js';

const cfg = loadConfig();

test('扫描批次目录并生成索引', () => {
  const out = path.join(os.tmpdir(), 'batches-index-test-' + Date.now() + '.json');
  try {
    const r = scan({ basedir: cfg.scan.basedirAbs, out, ignore: [], env: null });
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

test('env 过滤只返回指定环境', () => {
  const out = path.join(os.tmpdir(), 'batches-index-env-test-' + Date.now() + '.json');
  try {
    const r = scan({ basedir: cfg.scan.basedirAbs, out, ignore: [], env: 'OTCXXX' });
    assert.equal(r.ok, true, r.error);
    r.batches.forEach((b) => assert.equal(b.reportEnv, 'OTCXXX'));
  } finally {
    try { fs.unlinkSync(out); } catch (e) {}
  }
});

test('标记 deleted 的批次被扫描器跳过（软删除）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-del-'));
  const out = path.join(tmp, 'batches-index.json');
  try {
    const dir = path.join(tmp, 'b1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'batch-meta.json'), JSON.stringify({ batchId: 'b1', batchName: 'deleted-batch', date: '2026-08-16', executedAt: '2026-08-16T00:00:00+08:00', deleted: true, summary: { items: 1 } }), 'utf8');
    fs.writeFileSync(path.join(dir, 'report-validation-data.json'), JSON.stringify({ mode: 'single', reportEnv: 'OTCXXX', items: [{ tradeId: 'T-1', reportDate: '2026-08-16', channels: [] }] }), 'utf8');

    const r = scan({ basedir: tmp, out, ignore: [], env: null });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.count, 0, '已删除批次不应出现在索引中');
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
});
