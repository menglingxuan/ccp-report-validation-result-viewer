// 生成样例数据文件（单文件 / 多文件模式）。
//
//   node tools/generate-sample-data.js                 # 生成单文件模式
//   node tools/generate-sample-data.js --split         # 生成多文件模式（清单 + 每 item 一个文件）
//   node tools/generate-sample-data.js --only default  # 仅生成默认模板数据文件
//   node tools/generate-sample-data.js --single       # 仅生成「单一来源渠道」样例数据文件
//   node tools/generate-sample-data.js --batch         # 一并更新批次示例数据（单文件批次 + 一个多文件模式批次）
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
const doSingle = argv.includes('--single');
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

function main() {
  if (doSingle) {
    const ds = buildDataset({ singleSource: true });
    writeJSON(path.join(PUBLIC_DIR, 'report-validation-data-single-source.json'), ds);
    console.log('单一来源渠道样例 -> report-validation-data-single-source.json（items=' + ds.items.length + '，全部 item 仅 1 个来源渠道）');
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
    const dirs = collectBatchDirs(BATCHES_DIR)
      .filter((d) => path.resolve(d) !== path.resolve(multiBatchDir));
    dirs.forEach((dir, i) => {
      // 每个批次取数据集的不同切片（2..5 个 item），确保不同批次展示不同数据。
      const n = 2 + (i % 4);
      const start = (i * 3) % dataset.items.length;
      const items = [];
      for (let k = 0; k < n; k++) items.push(dataset.items[(start + k) % dataset.items.length]);
      const file = path.join(dir, 'report-validation-data.json');
      writeJSON(file, { mode: 'single', reportEnv: dataset.reportEnv, items });
      console.log('批次数据 -> ' + path.relative(PUBLIC_DIR, file) + '（' + items.length + ' items）');
    });
    writeMultiBatch(multiBatchDir, { mode: 'single', reportEnv: dataset.reportEnv, items: dataset.items.slice(0, 3) });
    console.log('多文件批次 -> ' + path.relative(PUBLIC_DIR, multiBatchDir) + '（清单 + data/items/*.json，3 items）');
    if (!dirs.length) {
      console.log('未发现批次目录（需先有 public/batches/<date>/<batch>/batch-meta.json）');
    }
  }
}

main();
