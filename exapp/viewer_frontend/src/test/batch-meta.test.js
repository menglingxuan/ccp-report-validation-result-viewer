// 样例批次数据一致性回归测试。
// 背景：tools/generate-sample-data.js 会把完整数据集切片写入各批次（2 / 4 个 item），
// 若不同步更新该批次的 batch-meta.json 的 summary.items，就会出现「声明数量 ≠ 实际 items 数量」的 bug。
// 本测试遍历 public/batches 下的所有 batch-meta.json，断言 summary.items 与数据文件实际 item 数一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const BATCHES_DIR = path.join(TEST_DIR, '..', 'public', 'batches');

function collectMetaFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    const p = path.join(root, ent.name);
    if (ent.isDirectory()) out.push(...collectMetaFiles(p));
    else if (ent.name === 'batch-meta.json') out.push(p);
  }
  return out;
}

test('样例批次 batch-meta.json 的 summary.items 与实际数据一致', () => {
  const metas = collectMetaFiles(BATCHES_DIR);
  assert.ok(metas.length > 0, '未发现样例批次目录：' + BATCHES_DIR);
  const bad = [];
  for (const metaFile of metas) {
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const dir = path.dirname(metaFile);
    const dataFile = path.join(dir, meta.dataUrl ? meta.dataUrl : 'report-validation-data.json');
    const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const actual = (data.items ? data.items : []).length;
    const declared = meta.summary ? meta.summary.items : undefined;
    if (declared !== actual) {
      bad.push(path.relative(BATCHES_DIR, metaFile) + '（声明=' + declared + ' 实际=' + actual + '）');
    }
  }
  assert.deepEqual(bad, [], '以下批次 batch-meta.json 的 summary.items 与实际数据不一致：\n' + bad.join('\n'));
});
