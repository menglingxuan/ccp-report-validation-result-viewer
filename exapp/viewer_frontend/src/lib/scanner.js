// 批次扫描器：扫描 basedir 下的批次目录，生成 batches-index.json。
// 支持单文件数据（report-validation-data.json）与多文件数据（mode: "multi" 清单）。
//
// 可编程调用（供 server.js 集成）：
//   import { scan } from './lib/scanner.js';
//   const result = scan({ basedir, out, ignore, env });
//
// 也可作为 CLI 使用：
//   node lib/scanner.js [basedir] [--out <path>] [--ignore <regex> ...] [--env <env>]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.dirname(LIB_DIR);

function toWeb(p) {
  return p.split(path.sep).join('/');
}

function walkDirs(dir, acc) {
  acc = acc || [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return acc;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const p = path.join(dir, ent.name);
    acc.push(p);
    walkDirs(p, acc);
  }
  return acc;
}

function readJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

// 从数据文件（单文件或多文件清单）中解析 reportEnv 与 item 数量。
function readDataInfo(dataPath, indexDir) {
  const info = { reportEnv: null, itemCount: 0, mode: 'single' };
  const data = readJSON(dataPath);
  if (!data || typeof data !== 'object') return info;
  if (typeof data.reportEnv === 'string' && data.reportEnv) info.reportEnv = data.reportEnv;
  if (Array.isArray(data.items)) info.itemCount = data.items.length;
  info.mode = data.mode === 'multi' ? 'multi' : 'single';
  return info;
}

/**
 * 扫描批次目录。
 * @param {{basedir: string, out: string, ignore?: string[], env?: string|null}} opts
 * @returns {{ok: boolean, error?: string, count: number, batches: object[], out: string, skipped: number}}
 */
export function scan(opts) {
  const basedir = opts.basedir;
  const out = opts.out;
  const ignoreRes = (opts.ignore || []).map(function (s) {
    try {
      return new RegExp(s, 'i');
    } catch (e) {
      console.warn('忽略无效正则：' + s);
      return null;
    }
  }).filter(Boolean);
  const envFilter = opts.env || null;

  if (!fs.existsSync(basedir)) {
    return { ok: false, error: 'basedir 不存在：' + basedir, count: 0, batches: [], skipped: 0, out };
  }

  const relToIndex = function (abs) { return toWeb(path.relative(path.dirname(out), abs)); };
  const ignored = function (dir) {
    const rel = toWeb(path.relative(basedir, dir));
    return ignoreRes.some(function (re) { return re.test(rel); });
  };

  const batches = [];
  let dirCount = 0;
  let skipped = 0;
  for (const dir of walkDirs(basedir)) {
    dirCount++;
    if (ignored(dir)) { skipped++; continue; }
    const metaPath = path.join(dir, 'batch-meta.json');
    const dataPath = path.join(dir, 'report-validation-data.json');
    const hasData = fs.existsSync(dataPath);
    const meta = readJSON(metaPath) || {};
    if (meta.deleted) { skipped++; continue; }
    if (!hasData && !meta.dataUrl) continue;

    // 运行环境：batch-meta.json 的 reportEnv 优先，回退到数据文件（单/多文件清单）顶层 reportEnv。
    let dataInfo = { reportEnv: null, itemCount: 0, mode: 'single' };
    if (hasData) {
      dataInfo = readDataInfo(dataPath, path.dirname(out));
    } else if (typeof meta.dataUrl === 'string' && meta.dataUrl) {
      const refPath = path.resolve(path.dirname(out), meta.dataUrl);
      if (fs.existsSync(refPath)) dataInfo = readDataInfo(refPath, path.dirname(out));
    }
    const reportEnv = (typeof meta.reportEnv === 'string' && meta.reportEnv)
      ? meta.reportEnv
      : dataInfo.reportEnv;
    if (envFilter && reportEnv !== envFilter) { skipped++; continue; }

    const statSrc = hasData ? dataPath : metaPath;
    const st = fs.statSync(statSrc);
    const executedAt = meta.executedAt || st.mtime.toISOString();
    const date = meta.date || String(executedAt).slice(0, 10);
    const batchId = String(meta.batchId || meta.batchName || path.basename(dir));
    const batchName = String(meta.batchName || batchId);

    const entry = {
      batchId: batchId,
      batchName: batchName,
      date: String(date),
      executedAt: String(executedAt),
      formatVersion: typeof meta.formatVersion === 'number' ? meta.formatVersion : 2,
      dataUrl: meta.dataUrl || relToIndex(dataPath),
      ignoreUrl: meta.ignoreUrl || null,
      path: toWeb(dir),
    };
    if (dataInfo.mode) entry.dataMode = dataInfo.mode;
    if (typeof meta.favorite === 'boolean') entry.favorite = meta.favorite;
    if (typeof meta.commandLine !== 'undefined') entry.commandLine = meta.commandLine;
    if (typeof meta.argv !== 'undefined') entry.argv = meta.argv;
    if (typeof meta.cwd === 'string') entry.cwd = meta.cwd;
    if (typeof meta.description === 'string') entry.description = meta.description;
    if (meta.summary && typeof meta.summary === 'object') {
      entry.summary = Object.assign({ items: dataInfo.itemCount || (meta.summary.items || 0) }, meta.summary);
    } else if (dataInfo.itemCount) {
      entry.summary = { items: dataInfo.itemCount };
    }
    if (reportEnv) entry.reportEnv = reportEnv;
    if (meta.extra && typeof meta.extra === 'object') Object.assign(entry, meta.extra);

    batches.push(entry);
  }
  batches.sort(function (a, b) { return String(b.executedAt).localeCompare(String(a.executedAt)); });

  const index = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    basedir: toWeb(basedir),
    count: batches.length,
    batches: batches,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(index, null, 2), 'utf8');

  return { ok: true, count: batches.length, batches: batches, out, skipped: skipped, dirCount: dirCount };
}

export function main() {
  const argv = process.argv.slice(2);
  const opts = {
    basedir: path.join(SRC_ROOT, 'public', 'batches'),
    out: path.join(SRC_ROOT, 'public', 'batches-index.json'),
    ignore: [],
    env: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = path.resolve(argv[++i]);
    else if (a === '--ignore') opts.ignore.push(String(argv[++i]));
    else if (a === '--env') opts.env = String(argv[++i]);
    else if (a === '--basedir') opts.basedir = path.resolve(argv[++i]);
    else if (!a.startsWith('--')) opts.basedir = path.resolve(a);
  }

  const result = scan(opts);
  if (!result.ok) {
    console.error(result.error);
    process.exit(1);
  }
  console.log('OK: 扫描 ' + (result.dirCount || 0) + ' 个目录（跳过 ' + result.skipped + '），发现 ' + result.count + ' 个批次 -> ' + result.out);
  result.batches.forEach(function (b) {
    console.log(' - ' + b.batchId + ' | ' + b.executedAt + ' | v' + b.formatVersion + ' | env=' + (b.reportEnv || '-') + (b.dataMode ? ' | mode=' + b.dataMode : '') + ' | ' + b.dataUrl);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
