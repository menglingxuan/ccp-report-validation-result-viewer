// 方案 A1（紧凑 JSON 输出）回归测试。
//
// 数据文件的体积由「缩进」白白占掉 40%+（实测样例 4.57 MB → 2.69 MB），而查看器只解析内容；
// 真实数据由 Java 生成器写出（本来就是紧凑的），JS 侧工具此前是 `JSON.stringify(obj, null, 2)`。
// 这里同时守住三件事：
//   1. lib/json-write.js 的单点策略（默认紧凑 + 结尾换行；--pretty / pretty:true 才是缩进版）；
//   2. 仓库里**已提交的样例数据**确实是紧凑的（含多文件清单与 item 文件、批次文件）；
//   3. 所有数据写入方都不再出现 `null, 2`（防回归），但 batch-meta.json 仍保持缩进（与服务端写回一致）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringifyJSON, writeJSON } from '../lib/json-write.js';

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = path.join(SRC, 'public');

// 一个"紧凑 + 结尾换行"的判定：解析回来再紧凑序列化，应当与文件内容逐字节一致。
function assertCompact(file) {
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw, JSON.stringify(JSON.parse(raw)) + '\n', '应为紧凑 JSON 且只以单个换行结尾：' + path.relative(SRC, file));
  return raw;
}

test('json-write：默认紧凑（无缩进）+ 结尾换行，pretty 才缩进，两者内容等价', () => {
  const obj = { a: [1, 2, { b: '中文' }], c: null };
  const compact = stringifyJSON(obj);
  assert.equal(compact, JSON.stringify(obj) + '\n');
  assert.equal(compact.indexOf('\n  ') === -1, true, '紧凑版不应有缩进');
  const pretty = stringifyJSON(obj, { pretty: true });
  assert.equal(pretty, JSON.stringify(obj, null, 2) + '\n');
  assert.match(pretty, /\n {2}"/, '缩进版应有 2 空格缩进');
  assert.deepEqual(JSON.parse(pretty), JSON.parse(compact), '两种输出的解析结果必须一致');
  assert.ok(pretty.length > compact.length * 1.3, '缩进版应明显更大（本例约 1.4 倍）');
});

test('json-write：writeJSON 自动建目录，并回传 UTF-8 字节数与字符数', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-write-'));
  const file = path.join(dir, 'a', 'b', 'out.json');
  const res = writeJSON(file, { 键: '值' });
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw, '{"键":"值"}\n');
  assert.equal(res.chars, raw.length);
  assert.equal(res.bytes, Buffer.byteLength(raw, 'utf8'));
  assert.ok(res.bytes > res.chars, '中文 UTF-8 字节数应大于字符数');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('仓库样例数据：单文件、多文件清单与 item 文件、批次文件都是紧凑 JSON', () => {
  const files = [
    'report-validation-data.json',
    'batches/2026-08-17/batch-20260817-1200/report-validation-data.json',
    'batches/2026-08-16/batch-20260816-1700/report-validation-data.json',        // 多文件批次的清单
    'batches/2026-08-16/batch-20260816-1700/data/items/T-20240814-1001.json',   // 多文件批次的 item
  ];
  files.forEach((rel) => {
    const file = path.join(PUBLIC_DIR, rel);
    assert.ok(fs.existsSync(file), '样例文件缺失：' + rel);
    assertCompact(file);
  });
  // 单文件数据：紧凑后应比缩进版小 35% 以上（实测 41%），以此锁定"确实省下来了"。
  const main = path.join(PUBLIC_DIR, 'report-validation-data.json');
  const compactLen = fs.statSync(main).size;
  const prettyLen = Buffer.byteLength(JSON.stringify(JSON.parse(fs.readFileSync(main, 'utf8')), null, 2), 'utf8');
  assert.ok(compactLen < prettyLen * 0.65, '紧凑体积应小于缩进版的 65%（实测 ' + compactLen + ' vs ' + prettyLen + '）');
});

test('防回归：数据写入方都用 lib/json-write.js，且不再出现 `null, 2`', () => {
  const writers = {
    'tools/generate-sample-data.js': '样例数据生成器',
    'lib/sample-data.js': 'splitToFiles（多文件拆分）',
    'lib/merge-batch.js': '多文件 -> 单文件合并',
    'tools/verify-multi-mode.mjs': '多文件模式验证脚本',
  };
  Object.keys(writers).forEach((rel) => {
    const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
    assert.equal(src.indexOf('null, 2'), -1,
      writers[rel] + ' 仍在写缩进版 JSON（请改用 lib/json-write.js 的 stringifyJSON / writeJSON）');
    assert.match(src, /json-write\.js/, writers[rel] + ' 应引用 lib/json-write.js 的统一策略');
  });
  // 样例生成器：数据走 writeDataset（紧凑，可被 --pretty 覆盖），batch-meta.json 走 writeBatchMeta（始终缩进）。
  const gen = fs.readFileSync(path.join(SRC, 'tools', 'generate-sample-data.js'), 'utf8');
  assert.match(gen, /function writeDataset\(file, obj\) \{\s+return writeJSONFile\(file, obj, OUT_OPTS\);/,
    '数据文件应走 OUT_OPTS（默认紧凑、--pretty 可切换）');
  assert.match(gen, /function writeBatchMeta\(file, obj\) \{\s+return writeJSONFile\(file, obj, \{ pretty: true \}\);/,
    'batch-meta.json 是人工也会编辑的用户态文件，应保持缩进');
  assert.match(gen, /const OUT_OPTS = \{ pretty: argv\.includes\('--pretty'\) \};/, '应提供 --pretty 逃生口');
  assert.match(gen, /--pretty\s+# 输出缩进版/, '用法注释应说明 --pretty');
  // 合并命令同样提供 --pretty。
  assert.match(fs.readFileSync(path.join(SRC, 'tools', 'merge-batch.mjs'), 'utf8'),
    /pretty: has\('--pretty'\)/, '合并命令应把 --pretty 传给 writeMergedDataset');
});

test('例外：索引与用户态小文件仍是缩进版（便于人工编辑 / diff）', () => {
  // batches-index.json 由 viewer 自身维护（几十 KB），保持缩进。
  const idx = fs.readFileSync(path.join(SRC, 'lib', 'scanner.js'), 'utf8');
  assert.match(idx, /JSON\.stringify\(index, null, 2\)/, '索引仍写缩进版');
  // 服务端写回的 favorites / batch-meta / 租户配置同样保持缩进（与生成器的 batch-meta 写法一致）。
  const srv = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');
  ['FAVORITES_FILE', 'metaPath', 'CFG.tenant.activeFile'].forEach((k) => {
    assert.ok(srv.indexOf('writeFileAtomic(' + k + ', JSON.stringify(') !== -1, k + ' 应仍写缩进版 JSON');
  });
});
