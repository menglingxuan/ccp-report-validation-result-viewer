// 扫描 basedir 下所有批次目录，生成 batches-index.json（供 report-validation-result.html 的「最近批次」面板使用）
// 用法：
//   node scan-batches.js [basedir] [--out <输出路径>] [--ignore <正则> ...] [--env <环境>]
// 默认 basedir = src/test/batches，输出 = src/engine/batches-index.json
//
// 选项：
//   --out <path>      指定索引输出路径（默认 src/engine/batches-index.json）
//   --ignore <regex>  排除匹配的目录（可重复；按相对 basedir 的 web 路径匹配，不区分大小写）
//   --env <env>       仅扫描运行环境（reportEnv）等于指定值的批次；缺省扫描全部发现的批次
//
// 批次目录判定：目录内存在 batch-meta.json 或 report-validation-data.json。
// batch-meta.json 可选字段：
//   batchId, batchName, date, executedAt, formatVersion, dataUrl, ignoreUrl,
//   commandLine[], argv[], cwd, description, summary{}, reportEnv, 以及任意 extra 字段
// 运行环境（reportEnv）解析：batch-meta.json 的 reportEnv 优先；
//   若 batch-meta.json 缺失或未提供 reportEnv，则回退到 report-validation-data.json 顶层的 reportEnv；
//   若批次目录内无数据文件，则按 dataUrl 解析并读取所引用数据文件的 reportEnv；
//   均未提供时该批次不写 reportEnv。
// dataUrl / ignoreUrl 未提供时：若目录内存在 report-validation-data.json 则自动使用它；
//   提供的 dataUrl 按「相对 batches-index.json 所在目录（即 web 根目录）」解释。

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

function parseArgs(argv) {
  const args = { basedir: path.join(ROOT, 'src', 'test', 'batches'), out: path.join(ROOT, 'src', 'engine', 'batches-index.json'), ignore: [], env: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') { args.out = path.resolve(argv[++i]); }
    else if (a === '--ignore') { args.ignore.push(String(argv[++i])); }
    else if (a === '--env') { args.env = String(argv[++i]); }
    else if (a === '--basedir') { args.basedir = path.resolve(argv[++i]); }
    else if (!a.startsWith('--')) { args.basedir = path.resolve(a); }
  }
  return args;
}
const ARGS = parseArgs(process.argv.slice(2));
const OUT = ARGS.out;
const BASEDIR = ARGS.basedir;
const IGNORE_RES = ARGS.ignore.map(function (s) { try { return new RegExp(s, 'i'); } catch (e) { console.warn('忽略无效正则：' + s); return null; } }).filter(Boolean);

function walkDirs(dir, acc) {
  acc = acc || [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const p = path.join(dir, ent.name);
    acc.push(p);
    walkDirs(p, acc);
  }
  return acc;
}

function toWeb(p) { return p.split(path.sep).join('/'); }
function relToIndex(abs) { return toWeb(path.relative(path.dirname(OUT), abs)); }
function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
function ignored(dir) {
  const rel = toWeb(path.relative(BASEDIR, dir));
  return IGNORE_RES.some(function (re) { return re.test(rel); });
}

function scan() {
  if (!fs.existsSync(BASEDIR)) {
    console.error('basedir 不存在：' + BASEDIR);
    process.exit(1);
  }
  console.log('扫描 basedir：' + BASEDIR + (IGNORE_RES.length ? '（忽略 ' + IGNORE_RES.length + ' 个规则）' : '') + (ARGS.env ? '（仅 env=' + ARGS.env + '）' : ''));
  const batches = [];
  let dirCount = 0, skipped = 0;
  for (const dir of walkDirs(BASEDIR)) {
    dirCount++;
    if (ignored(dir)) { skipped++; continue; }
    const metaPath = path.join(dir, 'batch-meta.json');
    const dataPath = path.join(dir, 'report-validation-data.json');
    const hasData = fs.existsSync(dataPath);
    const meta = readJSON(metaPath) || {};
    if (!hasData && !meta.dataUrl) continue;

    // 运行环境：batch-meta.json 的 reportEnv 优先，回退到数据 JSON 顶层 reportEnv；
    // 若目录内无数据文件，则按 dataUrl 解析并读取所引用数据文件的 reportEnv
    let data = hasData ? (readJSON(dataPath) || {}) : {};
    if (!hasData && typeof meta.dataUrl === 'string' && meta.dataUrl) {
      const refPath = path.resolve(path.dirname(OUT), meta.dataUrl);
      if (fs.existsSync(refPath)) data = readJSON(refPath) || {};
    }
    const reportEnv = (typeof meta.reportEnv === 'string' && meta.reportEnv)
      ? meta.reportEnv
      : ((typeof data.reportEnv === 'string' && data.reportEnv) ? data.reportEnv : null);
    if (ARGS.env && reportEnv !== ARGS.env) { skipped++; continue; }

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
    if (Array.isArray(meta.commandLine)) entry.commandLine = meta.commandLine;
    if (Array.isArray(meta.argv)) entry.argv = meta.argv;
    if (typeof meta.cwd === 'string') entry.cwd = meta.cwd;
    if (typeof meta.description === 'string') entry.description = meta.description;
    if (meta.summary && typeof meta.summary === 'object') entry.summary = meta.summary;
    if (reportEnv) entry.reportEnv = reportEnv;
    if (meta.extra && typeof meta.extra === 'object') Object.assign(entry, meta.extra);

    batches.push(entry);
  }
  batches.sort(function (a, b) { return String(b.executedAt).localeCompare(String(a.executedAt)); });

  const index = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    basedir: toWeb(BASEDIR),
    count: batches.length,
    batches: batches,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(index, null, 2), 'utf8');
  console.log('OK: 扫描 ' + dirCount + ' 个目录（跳过 ' + skipped + '），发现 ' + batches.length + ' 个批次 -> ' + OUT);
  batches.forEach(function (b) {
    console.log(' - ' + b.batchId + ' | ' + b.executedAt + ' | v' + b.formatVersion + ' | env=' + (b.reportEnv || '-') + ' | ' + b.dataUrl);
  });
}

scan();
