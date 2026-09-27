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
import { hydrateItem, registriesOf, flatFields, itemStatsPure } from '../public/core.js';

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
    // 清单必须保留单文件模式的所有顶层字段（DATA_SCHEMA §2），包括两张登记表：
    // item 文件里只有 id 引用，缺了登记表查看器就补不回名称。
    assert.equal(manifest.reportEnv, dataset.reportEnv);
    assert.equal(manifest.creationType, dataset.creationType);
    assert.deepEqual(manifest.skippedItems, dataset.skippedItems);
    assert.deepEqual(manifest.channels, dataset.channels, '清单应带顶层 channels 登记表');
    assert.deepEqual(manifest.sources, dataset.sources, '清单应带顶层 sources 登记表');

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
    // 定义只在清单的登记表里写一次：item 文件不得重复写 name/desc/format。
    item.channels.forEach((ch) => {
      assert.equal('name' in ch, false, 'item 文件不应重复写渠道 name');
      assert.equal('desc' in ch, false, 'item 文件不应重复写渠道 desc');
      assert.equal('format' in ch, false, 'item 文件不应重复写渠道 format');
      ch.sources.forEach((s) => {
        assert.equal('name' in s, false, 'item 文件不应重复写来源渠道 name');
        assert.ok(Array.isArray(s.fields), 'item 文件应保留来源渠道的 fields');
      });
    });
    // item 文件单独不是合法数据集（引用得不到登记表），但用清单的登记表 hydrate 后可以正常展开。
    const hydrated = hydrateItem(item, registriesOf(manifest));
    assert.equal(flatFields(hydrated).length, itemStatsPure(hydrated, null).total, '口径应一致');
    assert.ok(flatFields(hydrated).length > 0, 'hydrate 后应能展开字段');
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
    assert.equal(j.creationType, dataset.creationType, '默认模板清单同样保留 creationType');
    assert.deepEqual(j.skippedItems, dataset.skippedItems, '默认模板清单同样保留 skippedItems');
    assert.deepEqual(j.channels, dataset.channels, '默认模板清单同样保留 channels 登记表');
    assert.deepEqual(j.sources, dataset.sources, '默认模板清单同样保留 sources 登记表');
    assert.ok(fs.existsSync(path.join(out, j.items[0].file)), '默认模板清单引用的 item 文件同样存在');
    assert.equal(validateDataset(j).ok, true);
  });
});
