// 批次模式转换命令：把指定的「多文件模式」批次合并为「单文件模式」批次。
//
//   node tools/merge-batch.mjs --list                       # 列出批次（含当前模式）
//   node tools/merge-batch.mjs --batch <batchId>            # 原地合并（自动备份多文件清单）
//   node tools/merge-batch.mjs --batch <batchId> --dry-run  # 只检查与统计，不写任何文件
//   node tools/merge-batch.mjs --batch <目录绝对值>          # 也可直接给批次目录
//
// 常用选项：
//   --manifest <name>   指定清单文件名（默认取 batch-meta.json 的 dataUrl，再退回 report-validation-data.json）
//   --out <name>        合并结果写到批次目录内的另一个文件（默认原地覆盖清单）
//   --no-backup         不生成 <清单名>.multi.bak 备份
//   --force             合并结果校验失败时仍然写入
//   --no-scan           不刷新 batches-index.json（默认会刷新，使 mode/summary 立即生效）
//   --tenant[=id] / --no-tenant   租户模式开关（与非租户模式的批次根/索引均按 config 解析）
//   --config dev|test|prod / --data-root <dir>       与 server.js 一致
//
// 说明：合并只覆盖清单文件，**不删除** data/items/*.json（原多文件内容仍可回退/重新拆分）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.js';
import { scan } from '../lib/scanner.js';
import { mergeBatchDirToSingle, findBatchDir, listBatchDirs } from '../lib/merge-batch.js';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const value = (...names) => {
  for (const n of names) {
    const i = argv.indexOf(n);
    if (i !== -1 && argv[i + 1]) return argv[i + 1];
  }
  return undefined;
};
// --tenant 的可选值：下一个 token 缺失或以 -- 开头时视为「未带参数」（取默认用户名）。
function tenantArgValue() {
  const i = argv.indexOf('--tenant');
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) return '';
  return next;
}

if (has('--help') || has('-h')) {
  const self = path.relative(process.cwd(), fileURLToPath(import.meta.url));
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 19).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  console.log('\n（脚本路径：' + self + '）');
  process.exit(0);
}

const cfgName = value('--config', '--profile');
if (cfgName) process.env.REPORT_VIEWER_CONFIG = cfgName;
const dataRootArg = value('--data-root');
if (dataRootArg) process.env.REPORT_VIEWER_DATA_ROOT = dataRootArg;

const tenantFlag = has('--no-tenant') ? false : (has('--tenant') ? tenantArgValue() : undefined);
const CFG = loadConfig({ tenant: tenantFlag });
const BATCHES_DIR = CFG.scan.basedirAbs;
const INDEX_FILE = CFG.scan.outAbs;

function printContext() {
  console.log('[merge-batch] 租户：' + (CFG.tenant.enabled ? CFG.tenant.id : '(非租户)'));
  console.log('[merge-batch] 数据根：' + CFG.tenant.dataRoot);
  console.log('[merge-batch] 批次根：' + BATCHES_DIR);
  console.log('[merge-batch] 索引：' + INDEX_FILE);
}

function fmtMode(mode) {
  if (!mode) return '(无数据文件)';
  return mode === 'multi' ? '多文件' : (mode === 'single' ? '单文件' : String(mode));
}

// ---------- --list ----------
if (has('--list')) {
  printContext();
  const all = listBatchDirs(BATCHES_DIR, { manifestName: value('--manifest') });
  if (!all.length) {
    console.log('[merge-batch] 未在批次根下找到任何批次目录');
    process.exit(0);
  }
  const multi = all.filter((b) => b.mode === 'multi');
  console.log('[merge-batch] 共 ' + all.length + ' 个批次（多文件 ' + multi.length + ' 个）：');
  all.forEach(function (b) {
    console.log('  - ' + b.batchId + '  [' + fmtMode(b.mode) + ']  ' + b.dir);
  });
  process.exit(0);
}

// ---------- 参数校验 ----------
const batchArg = value('--batch');
if (!batchArg) {
  console.error('[merge-batch] 缺少 --batch <batchId|批次目录>（可用 --list 查看候选）');
  process.exit(1);
}
const dryRun = has('--dry-run');

let batchDir = null;
if (path.isAbsolute(batchArg) && fs.existsSync(batchArg) && fs.statSync(batchArg).isDirectory()) {
  batchDir = batchArg;
} else {
  batchDir = findBatchDir(BATCHES_DIR, batchArg, INDEX_FILE);
}
if (!batchDir) {
  printContext();
  console.error('[merge-batch] 未找到批次：' + batchArg + '（可用 --list 查看候选）');
  process.exit(1);
}

// ---------- 合并 ----------
printContext();
console.log('[merge-batch] 批次目录：' + batchDir + (dryRun ? '（dry-run：不写文件）' : ''));

const res = mergeBatchDirToSingle(batchDir, {
  manifestName: value('--manifest'),
  outName: value('--out'),
  backup: !has('--no-backup'),
  dryRun: dryRun,
  force: has('--force'),
});

if (!res.ok) {
  console.error('[merge-batch] 失败：' + res.error);
  process.exit(1);
}

console.log('[merge-batch] 清单：' + res.manifestPath);
console.log('[merge-batch] 合并 item：' + res.dataset.items.length + ' 个（已读取 ' + res.itemFiles.length + ' 个 item 文件）');
if (res.issues && res.issues.length) res.issues.forEach(function (m) { console.warn('[merge-batch] 提示：' + m); });
console.log('[merge-batch] 输出：' + res.outputPath + '（' + res.bytes + ' 字节，mode=single）');
if (res.backupPath) console.log('[merge-batch] 多文件清单备份：' + res.backupPath);
if (dryRun) {
  console.log('[merge-batch] dry-run 结束：未写入任何文件');
  process.exit(0);
}

// ---------- 刷新索引 ----------
if (has('--no-scan')) {
  console.log('[merge-batch] 已跳过索引刷新（--no-scan）：查看器需执行「刷新批次」才会看到新模式');
  process.exit(0);
}
const scanned = await scan({ basedir: BATCHES_DIR, out: INDEX_FILE, ignore: CFG.scan.ignore, env: CFG.scan.env });
if (!scanned.ok) {
  console.error('[merge-batch] 索引刷新失败：' + scanned.error);
  process.exit(1);
}
const entry = (scanned.batches || []).find(function (b) { return b.batchId === batchArg || b.batchId === path.basename(batchDir); });
console.log('[merge-batch] 索引已刷新：共 ' + scanned.count + ' 个批次' + (entry ? '，本批次 summary.items=' + ((entry.summary || {}).items ?? '-') : ''));
if (entry && entry.validationErrors) {
  console.warn('[merge-batch] 注意：索引中该批次仍有校验告警：');
  entry.validationErrors.forEach(function (e) { console.warn('   - ' + e); });
}
console.log('[merge-batch] 完成。');
