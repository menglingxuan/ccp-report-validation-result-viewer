// 生成样例数据文件（单文件 / 多文件模式）。
//
//   node tools/generate-sample-data.js                 # 生成单文件模式
//   node tools/generate-sample-data.js --split         # 生成多文件模式（清单 + 每 item 一个文件）
//   node tools/generate-sample-data.js --only default  # 仅生成默认模板数据文件
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDataset, splitToFiles } from '../lib/sample-data.js';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.dirname(TOOLS_DIR);
const PUBLIC_DIR = path.join(SRC_ROOT, 'public');

const argv = process.argv.slice(2);
const doSplit = argv.includes('--split');
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;

function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function main() {
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
}

main();
