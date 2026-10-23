// 生成样例数据文件（单文件 / 多文件模式）。
//
//   node tools/generate-sample-data.js                 # 生成单文件模式
//   node tools/generate-sample-data.js --split         # 生成多文件模式（清单 + 每 item 一个文件）
//   node tools/generate-sample-data.js --special       # 仅生成三个特殊用途样例批次（单来源 / 分页 / 软删除）
//   node tools/generate-sample-data.js --batch         # 一并更新批次样例数据（通用切片批次 + 多文件批次 + 特殊用途批次）
//   node tools/generate-sample-data.js --pretty        # 输出缩进版（仅供人工排查；默认紧凑，体积约为一半）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDataset, splitToFiles } from '../lib/sample-data.js';
import { writeJSON as writeJSONFile } from '../lib/json-write.js';
import { DEFAULT_API_VERSION } from '../public/core.js';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.dirname(TOOLS_DIR);
const PUBLIC_DIR = path.join(SRC_ROOT, 'public');

// 写进 batch-meta.json 的 formatVersion 用代码常量（不从 config.json 读）。
const API_VERSION = DEFAULT_API_VERSION;

const argv = process.argv.slice(2);
const doSplit = argv.includes('--split');
const doBatch = argv.includes('--batch');
const doSpecial = argv.includes('--special');
const OUT_OPTS = { pretty: argv.includes('--pretty') };

// 批次目录根（每个批次目录拥有自己独立的 report-validation-data.json）。
const BATCHES_DIR = path.join(PUBLIC_DIR, 'batches');

function writeDataset(file, obj) {
  return writeJSONFile(file, obj, OUT_OPTS);
}

// 切片 / 特殊批次的数据集顶层字段必须与完整数据集保持一致：
// **三张声明表（reportChannelDefs / sourceChannelDefs / usedCtxKeyDefs）一定要带上**，
// 否则 item 里的 id 引用无从解析（顶层没有声明表 → lib/validate.js 报错，
// 查看器 hydrate 也补不出名称，见 docs/DATA_SCHEMA.md §3.1）。
// 键顺序与生成器一致：`…声明表 → usedCtxKeyDefs → skippedItems → items`。
function batchDataset(dataset, items) {
  return {
    mode: 'single',
    reportEnv: dataset.reportEnv,
    creationType: 'sample',
    reportChannelDefs: dataset.reportChannelDefs,
    sourceChannelDefs: dataset.sourceChannelDefs,
    usedCtxKeyDefs: dataset.usedCtxKeyDefs,
    skippedItems: dataset.skippedItems,
    items: items,
  };
}
// batch-meta.json 是人工也会编辑/查看的用户态小文件（服务端写回时也用缩进版），保持缩进。
function writeBatchMeta(file, obj) {
  return writeJSONFile(file, obj, { pretty: true });
}

// 递归收集 public/batches 下所有含 batch-meta.json 的批次目录（按路径排序）。
function collectBatchDirs(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const p = path.join(root, ent.name);
    if (fs.existsSync(path.join(p, 'batch-meta.json'))) out.push(p);
    else out.push(...collectBatchDirs(p));
  }
  return out.sort();
}

// 写一个多文件模式批次：batch-meta.json + 清单 report-validation-data.json（mode=multi）+ data/items/*.json。
function writeMultiBatch(dir, dataset) {
  writeBatchMeta(path.join(dir, 'batch-meta.json'), {
    reportEnv: dataset.reportEnv,
    creationType: 'sample',
    batchId: path.basename(dir),
    batchName: 'split-20260816',
    date: '2026-08-16',
    executedAt: '2026-08-16T17:00:00+08:00',
    formatVersion: API_VERSION,
    dataUrl: 'report-validation-data.json',
    ignoreUrl: 'ignore-config-by-platform.json',
    summary: { items: dataset.items.length, channels: 3 },
    description: '多文件模式演示批次：清单 + 每 item 一个独立文件',
    descriptionEx: { contentType: 'markDownTable', plainContent: descExSampleTable() },
  });
  splitToFiles(dataset, dir, undefined, OUT_OPTS);
}

// 同步批次的 batch-meta.json 与写入的数据文件一致（summary.items = 实际 item 数量）。
// 批次数据是按完整数据集切片的（2 / 4 个 item），而 batch-meta.json 的 summary.items
// 历史上写的是完整数据集大小，导致「声明数量 ≠ 实际 items 数量」。
function syncBatchMetaSummary(dir, itemCount) {
  const metaFile = path.join(dir, 'batch-meta.json');
  if (!fs.existsSync(metaFile)) return;
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (e) { return; }
  if (meta.summary && meta.summary.items === itemCount) return;
  meta.summary = Object.assign({}, meta.summary, { items: itemCount });
  writeBatchMeta(metaFile, meta);
}

// 任务说明扩展内容（descriptionEx）的 Markdown 表格示例（3 列，渲染统一左对齐）：
// 覆盖 `\|` 转义、空单元格、最小内联格式，以及超过阈值的行数
// （18 行 → 每页 5 行共 4 页 > 3，因此表头排序/筛选图标与页码控件都会展示）。
function descExSampleTable() {
  return [
    '| 序号 | 检查项 | 说明 |',
    '| --- | --- | --- |',
    '| 1 | 数据接入完整性 | 覆盖 `HKTR` / `JSFA` / `CFTC` |',
    '| 2 | 字段映射校验 | 含 **EO/AO** 双侧比对 |',
    '| 3 | 上下文命中率 | 命中率 92% |',
    '| 4 | 转换规则回归 | 含转义演示：a \\| b |',
    '| 5 | 未比较项核对 | 与上一批次对齐 |',
    '| 6 | 已知差异确认 | 见任务说明 |',
    '| 7 | 报表汇总 |  |',
    '| 8 | 监管报表抽取 | 全量 |',
    '| 9 | 渠道口径复核 | 仅 HKTR |',
    '| 10 | 边界值校验 | 多行文本演示 |',
    '| 11 | 金额精度校验 | 保留 2 位小数 |',
    '| 12 | 结果归档 | 归档至 `generated/` |',
    '| 13 | 报表口径复核 | 与 HKTR 口径一致 |',
    '| 14 | 汇总校验 | 含 **汇总** 双跑 |',
    '| 15 | 抽样复核 | 抽样 10% |',
    '| 16 | 异常清单确认 | 见 `notes/` 附件 |',
    '| 17 | 上线前检查 | 发布窗口 22:00 |',
    '| 18 | 归档与签名 | SHA256 校验 |',
    '',
  ].join('\n');
}

// ---------- 特殊用途样例批次 ----------
// 这些批次各自拥有独立的 item 数量与测试用途，**不参与下面的「通用切片」循环**
// （否则每次 --batch 都会被覆盖成 2 / 4 个 item 的通用切片）。
const SPECIAL_BATCHES = [
  {
    day: '2026-08-17',
    batchId: 'batch-20260817-0900',
    executedAt: '2026-08-17T09:00:00+08:00',
    batchName: 'single-source-20260817-单一来源渠道测试',
    tags: ['单一来源', '渠道测试'],
    description: '单一来源渠道测试：全部 item 仅含 1 个来源渠道（sourceCount=1），用于验证「来源渠道」相关展示与筛选在单来源场景下的表现。',
    build: function () { return buildDataset({ singleSource: true }); },
  },
  {
    day: '2026-08-17',
    batchId: 'batch-20260817-1200',
    executedAt: '2026-08-17T12:00:00+08:00',
    batchName: 'paging-20260817-批次分页测试-28items',
    tags: ['分页测试', '28items'],
    description: '批次分页测试：本批次含 28 个 item，用于验证 item 列表分页（每页 8 → 4 页）与字段 / 消息表分页（每页 20 → 多页）。',
    // 任务说明扩展内容（只读）：Markdown 表格示例（查看器渲染为带搜索/排序/分页的表格）。
    descriptionEx: { contentType: 'markDownTable', plainContent: descExSampleTable() },
    build: function () { return buildDataset({ itemCount: 28 }); },
  },
  {
    day: '2026-08-17',
    batchId: 'batch-20260817-1500',
    executedAt: '2026-08-17T15:00:00+08:00',
    batchName: 'deleted-20260817-批次软删除测试',
    tags: ['软删除', '分页测试'],
    description: '批次软删除测试：batch-meta.json 默认带 deleted 标记；默认范围不展示该批次，需切到「全部批次(含已删除)」范围查看（仅供查看，不可加载 / 收藏 / 删除 / 钉住），用于验证软删除标记与删除 / 恢复流程。',
    itemCount: 1,
    deleted: true,
    build: function () { return buildDataset(); },
  },
];
const SPECIAL_BATCH_IDS = SPECIAL_BATCHES.map(function (b) { return b.batchId; });

// 写一个特殊用途样例批次：batch-meta.json + 单文件数据（dataUrl 指向同目录数据文件）。
function writeSpecialBatch(def) {
  const dir = path.join(BATCHES_DIR, def.day, def.batchId);
  const dataset = def.build();
  const items = def.itemCount ? dataset.items.slice(0, def.itemCount) : dataset.items;
  const meta = {
    batchId: def.batchId,
    batchName: def.batchName,
    date: def.day,
    executedAt: def.executedAt,
    formatVersion: API_VERSION,
    creationType: 'sample',
    dataUrl: 'report-validation-data.json',
    ignoreUrl: 'ignore-config-by-platform.json',
    commandLine: ['java', '-jar', 'ccp-report.jar', '--date=' + def.day],
    summary: { items: items.length, channels: 3 },
    description: def.description,
  };
  if (def.deleted) meta.deleted = true;
  if (Array.isArray(def.tags) && def.tags.length) meta.tags = def.tags;
  if (def.descriptionEx) meta.descriptionEx = def.descriptionEx;
  writeBatchMeta(path.join(dir, 'batch-meta.json'), meta);
  writeDataset(path.join(dir, 'report-validation-data.json'), batchDataset(dataset, items));
  console.log('特殊批次 -> ' + path.relative(PUBLIC_DIR, path.join(dir, 'report-validation-data.json'))
    + '（' + items.length + ' items' + (def.deleted ? '，deleted 标记' : '') + '）');
}

function writeSpecialBatches() {
  SPECIAL_BATCHES.forEach(writeSpecialBatch);
}

function main() {
  if (doSpecial) {
    writeSpecialBatches();
    return;
  }
  const dataset = buildDataset();
  console.log('生成数据集：items=' + dataset.items.length + ' reportEnv=' + dataset.reportEnv);

  if (doSplit) {
    const manifest = splitToFiles(dataset, PUBLIC_DIR, undefined, OUT_OPTS);
    console.log('多文件模式：清单 items=' + manifest.items.length);
    console.log('  清单 -> ' + path.join(PUBLIC_DIR, 'report-validation-data.json'));
    console.log('  item 文件 -> ' + path.join(PUBLIC_DIR, 'data', 'items', '<tradeId>.json'));
  } else {
    writeDataset(path.join(PUBLIC_DIR, 'report-validation-data.json'), dataset);
    console.log('主数据文件 -> report-validation-data.json');
  }

  if (doBatch) {
    // 多文件模式演示批次（单独目录，清单 + data/items/*.json），与其它单文件批次混合共存。
    const multiBatchDir = path.join(BATCHES_DIR, '2026-08-16', 'batch-20260816-1700');
    // 通用切片循环：排除多文件批次与特殊用途批次（它们各自维护自己的数据与元数据）。
    const dirs = collectBatchDirs(BATCHES_DIR)
      .filter((d) => path.resolve(d) !== path.resolve(multiBatchDir))
      .filter((d) => SPECIAL_BATCH_IDS.indexOf(path.basename(d)) === -1);
    dirs.forEach((dir, i) => {
      // 每个批次取数据集的不同切片：从偶数下标开始、取 2 或 4 个 item，
      // 使互为对手方的 item（(0,1)(2,3)… 成对）始终在同一批次内，避免「对手方 item」显示为无。
      const n = (i % 2 === 0) ? 2 : 4;
      const start = (i * 2) % dataset.items.length;
      const items = [];
      for (let k = 0; k < n; k++) items.push(dataset.items[(start + k) % dataset.items.length]);
      const file = path.join(dir, 'report-validation-data.json');
      writeDataset(file, batchDataset(dataset, items));
      syncBatchMetaSummary(dir, items.length);
      console.log('批次数据 -> ' + path.relative(PUBLIC_DIR, file) + '（' + items.length + ' items，已同步 batch-meta.json summary.items）');
    });
    writeMultiBatch(multiBatchDir, batchDataset(dataset, dataset.items.slice(0, 4)));
    console.log('多文件批次 -> ' + path.relative(PUBLIC_DIR, multiBatchDir) + '（清单 + data/items/*.json，4 items）');
    writeSpecialBatches();
    if (!dirs.length) {
      console.log('未发现批次目录（需先有 public/batches/<date>/<batch>/batch-meta.json）');
    }
  }
}

main();
