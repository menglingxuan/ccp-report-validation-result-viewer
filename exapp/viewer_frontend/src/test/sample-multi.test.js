// 多文件模式（mode: "multi"）样例数据生成测试：
// 1) splitToFiles 写出的清单 + data/items/*.json 结构正确，且清单能通过数据校验器；
// 2) 清单可指定文件名——多文件模式下「默认模板数据」同样是清单（否则 urls.defaultData 缺文件）；
// 3) 清单条目的 file 为相对路径，与查看器「item 文件相对清单所在目录解析」的实现一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDataset, splitToFiles } from '../lib/sample-data.js';
import { validateDataset } from '../lib/validate.js';

function withTmpOut(fn) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-multi-'));
  try {
    return fn(out);
  } finally {
    // Windows 下偶发文件占用，清理失败不影响断言结果。
    try { fs.rmSync(out, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }
}

test('多文件模式：清单 + 每 item 一个文件，清单可通过数据校验', () => {
  const dataset = buildDataset();
  withTmpOut((out) => {
    const manifest = splitToFiles(dataset, out);

    assert.equal(manifest.mode, 'multi');
    assert.equal(manifest.items.length, dataset.items.length);

    const first = manifest.items[0];
    assert.equal(first.file, 'data/items/' + first.tradeId + '.json', 'file 必须是相对清单目录的路径');
    assert.ok(fs.existsSync(path.join(out, first.file)), 'item 文件应存在：' + first.file);
    assert.ok(first.summary && typeof first.summary.total === 'number', '清单条目应带 summary（懒加载前的计数回退）');

    const r = validateDataset(manifest);
    assert.equal(r.ok, true, JSON.stringify(r.errors));

    // item 文件内容是完整 item（含 channels/ctxDefs），供查看器按需加载。
    const item = JSON.parse(fs.readFileSync(path.join(out, first.file), 'utf8'));
    assert.equal(item.tradeId, first.tradeId);
    assert.ok(Array.isArray(item.channels) && item.channels.length > 0, 'item 文件含完整 channels');
  });
});

test('多文件模式：默认模板数据也是清单（可指定清单文件名）', () => {
  const dataset = buildDataset();
  withTmpOut((out) => {
    splitToFiles(dataset, out, 'report-validation-data-default.json');

    const main = path.join(out, 'report-validation-data.json');
    const def = path.join(out, 'report-validation-data-default.json');
    assert.ok(!fs.existsSync(main), '指定清单名时不应额外写出 report-validation-data.json');
    assert.ok(fs.existsSync(def), '默认模板清单应写出');

    const j = JSON.parse(fs.readFileSync(def, 'utf8'));
    assert.equal(j.mode, 'multi');
    assert.equal(j.items.length, dataset.items.length);
    assert.ok(fs.existsSync(path.join(out, j.items[0].file)), '默认模板清单引用的 item 文件同样存在');
    assert.equal(validateDataset(j).ok, true);
  });
});
