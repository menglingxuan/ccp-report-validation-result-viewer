// 生成样例数据文件（单文件 / 多文件模式）。
//
//   node tools/generate-sample-data.js                 # 生成单文件模式
//   node tools/generate-sample-data.js --split         # 生成多文件模式（清单 + 每 item 一个文件）
//   node tools/generate-sample-data.js --only default  # 仅生成默认模板数据文件
//   node tools/generate-sample-data.js --special       # 仅生成三个特殊用途样例批次（单来源 / 分页 / 软删除）
//   node tools/generate-sample-data.js --batch         # 一并更新批次样例数据（通用切片批次 + 多文件批次 + 特殊用途批次）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDataset, splitToFiles } from '../lib/sample-data.js';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.dirname(TOOLS_DIR);
const PUBLIC_DIR = path.join(SRC_ROOT, 'public');

const argv = process.argv.slice(2);
const doSplit = argv.includes('--split');
const doBatch = argv.includes('--batch');
const doSpecial = argv.includes('--special');
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;

// 批次目录根（每个批次目录拥有自己独立的 report-validation-data.json）。
const BATCHES_DIR = path.join(PUBLIC_DIR, 'batches');

function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
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
  writeJSON(path.join(dir, 'batch-meta.json'), {
    reportEnv: dataset.reportEnv,
    creationType: 'sample',
    batchId: path.basename(dir),
    batchName: 'split-20260816',
    date: '2026-08-16',
    executedAt: '2026-08-16T17:00:00+08:00',
    formatVersion: 2,
    dataUrl: 'report-validation-data.json',
    ignoreUrl: 'ignore-config-by-platform.json',
    summary: { items: dataset.items.length, channels: 3 },
    description: '多文件模式演示批次：清单 + 每 item 一个独立文件',
  });
  splitToFiles(dataset, dir);
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
  writeJSON(metaFile, meta);
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
    formatVersion: 2,
    creationType: 'sample',
    dataUrl: 'report-validation-data.json',
    ignoreUrl: 'ignore-config-by-platform.json',
    commandLine: ['java', '-jar', 'ccp-report.jar', '--date=' + def.day],
    summary: { items: items.length, channels: 3 },
    description: def.description,
  };
  if (def.deleted) meta.deleted = true;
  if (Array.isArray(def.tags) && def.tags.length) meta.tags = def.tags;
  writeJSON(path.join(dir, 'batch-meta.json'), meta);
  writeJSON(path.join(dir, 'report-validation-data.json'), {
    mode: 'single',
    reportEnv: dataset.reportEnv,
    creationType: 'sample',
    skippedItems: dataset.skippedItems,
    items: items,
  });
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
    const manifest = splitToFiles(dataset, PUBLIC_DIR);
    console.log('多文件模式：清单 items=' + manifest.items.length);
    console.log('  清单 -> ' + path.join(PUBLIC_DIR, 'report-validation-data.json'));
    console.log('  item 文件 -> ' + path.join(PUBLIC_DIR, 'data', 'items', '<tradeId>.json'));
  } else {
    if (!only || only === 'default') {
      writeJSON(path.join(PUBLIC_DIR, 'report-validation-data-default.json'), dataset);
      console.log('默认模板数据 -> report-validation-data-default.json');
    }
    if (!only) {
      writeJSON(path.join(PUBLIC_DIR, 'report-validation-data.json'), dataset);
      console.log('主数据文件 -> report-validation-data.json');
    }
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
      writeJSON(file, { mode: 'single', reportEnv: dataset.reportEnv, creationType: 'sample', skippedItems: dataset.skippedItems, items });
      syncBatchMetaSummary(dir, items.length);
      console.log('批次数据 -> ' + path.relative(PUBLIC_DIR, file) + '（' + items.length + ' items，已同步 batch-meta.json summary.items）');
    });
    writeMultiBatch(multiBatchDir, { mode: 'single', reportEnv: dataset.reportEnv, skippedItems: dataset.skippedItems, items: dataset.items.slice(0, 4) });
    console.log('多文件批次 -> ' + path.relative(PUBLIC_DIR, multiBatchDir) + '（清单 + data/items/*.json，4 items）');
    writeSpecialBatches();
    if (!dirs.length) {
      console.log('未发现批次目录（需先有 public/batches/<date>/<batch>/batch-meta.json）');
    }
  }
}

main();
