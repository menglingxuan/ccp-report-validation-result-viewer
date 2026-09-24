#!/usr/bin/env node
// 统一 HTTP 服务：静态站点（查看器）+ 批次扫描 API。
//
//   node server.js              # 启动（默认非租户模式，使用共享数据）
//   node server.js --port 9000  # 覆盖监听端口（优先级最高）
//   node server.js --port 0     # 使用操作系统分配的随机空闲端口
//   node server.js --host 0.0.0.0
//   node server.js --config dev # 使用 config-dev.json
//   node server.js --tenant alice            # 开启租户模式，指定租户 id
//   node server.js --tenant                  # 开启租户模式，租户 id 取当前系统用户名
//   node server.js --no-tenant               # 强制非租户模式（覆盖环境变量）
//   node server.js --data-root C:/data/alice # 指定数据根目录
//   node server.js --audit                   # 启用租户 active 追踪与审查日志
//   node server.js --no-audit                # 关闭（默认关闭，见 config audit）
//
// 接口：
//   GET  /                 查看器首页（public/index.html）
//   GET  /config.json      统一配置（供浏览器读取；urls.batches 会指向租户索引）
//   GET  /tenant[/...]     租户数据（batches-index.json 与批次数据）
//   POST /scan             触发一次完整批次扫描（GET 亦可用，便于浏览器直连）
//   GET  /scan/progress    扫描进度（SSE）
//   GET  /status | /health 服务状态与当前配置
//   GET|POST /api/favorites 收藏夹读写
//   POST /api/ignore        忽略配置回写（按租户隔离）
//   POST /api/batch         批次软删除 / 收藏 / 名称与描述 / 标签
//   POST /api/reveal        在系统文件管理器中打开批次目录
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadConfig, resolveConfigFile } from './lib/config.js';
import { scan, sanitizeTags, MAX_BATCH_NAME_LEN, MAX_BATCH_DESC_LEN } from './lib/scanner.js';
import { validateFile } from './lib/validate.js';
// 「在系统文件管理器中打开目录」：Launcher 用绝对路径解析（不依赖 PATH），失败会如实上抛。
import { openInFileManager } from './lib/reveal.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
// 读取 CLI 参数（--flag value 形式）。
//   --config/--profile 切换配置文件；--port/--host 覆盖监听地址；
//   --tenant[=xxx] 开启租户模式；--data-root 指定数据根目录。
function cliValue(...names) {
  for (const n of names) {
    const i = process.argv.indexOf(n);
    if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  }
  return undefined;
}
// --tenant 后的可选值：不带参数（下一 token 缺失或以 -- 开头）时返回空串（表示取默认用户名）。
function tenantArgValue() {
  const i = process.argv.indexOf('--tenant');
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) return '';
  return next;
}
const cfgName = cliValue('--config', '--profile');
if (cfgName) process.env.REPORT_VIEWER_CONFIG = cfgName;
const dataRootArg = cliValue('--data-root');
if (dataRootArg) process.env.REPORT_VIEWER_DATA_ROOT = dataRootArg;
// audit 开关：--audit 开启 / --no-audit 关闭（布尔旗标，覆盖 config 与环境变量）。
const auditFlag = process.argv.includes('--no-audit') ? false : (process.argv.includes('--audit') ? true : undefined);
// 租户模式开关：--no-tenant 强制关闭；--tenant[=xxx] 开启（缺省值为当前系统用户名）。
const tenantFlag = process.argv.includes('--no-tenant') ? false : (process.argv.includes('--tenant') ? tenantArgValue() : undefined);
const CFG = loadConfig({ host: cliValue('--host'), port: cliValue('--port'), tenant: tenantFlag, audit: auditFlag });
const ACTIVE_CONFIG_FILE = resolveConfigFile();

// 收藏夹服务端持久化：每个租户在自身数据根下拥有独立 favorites.json（多用户互不干扰）。
function resolveFavoritesFile() {
  return path.join(CFG.tenant.dataRoot, 'favorites.json');
}
const FAVORITES_FILE = resolveFavoritesFile();

// 「在系统文件管理器中打开批次目录」开关：features.revealPath 显式设置优先，
// 否则仅在 dev/test 环境默认开启（生产环境不向客户端暴露打开本地目录的能力）。
const REVEAL_ENABLED = (function () {
  const f = CFG.features || {};
  if (typeof f.revealPath === 'boolean') return f.revealPath;
  const rt = String(CFG.runType || '').toLowerCase();
  return rt === 'dev' || rt === 'test';
})();

// 原子写入：先写临时文件再 rename，避免多实例/并发写同一文件时读到半截内容。
function writeFileAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = path.join(path.dirname(filePath), '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8));
  fs.writeFileSync(tmp, data, 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) {}
    // 个别文件系统 rename 覆盖失败时退回直接写入。
    fs.writeFileSync(filePath, data, 'utf8');
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const COMPRESSIBLE = { '.html': 1, '.css': 1, '.js': 1, '.mjs': 1, '.json': 1, '.svg': 1, '.txt': 1 };

// 强 ETag（内容哈希，与静态文件服务同格式）——写回接口用它做乐观并发（If-Match）。
function etagOf(buf) {
  return '"' + crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16) + '"';
}
function etagOfFile(file) {
  try { return etagOf(fs.readFileSync(file)); } catch (e) { return null; }
}

// 写操作通用防护：
//   ① 仅允许同源：浏览器带 Origin 时其 host 必须与请求 Host 一致（无 Origin 的 curl/脚本不受限）；
//   ② 限制请求体大小：按 Content-Length 预判，避免超大写回体拖垮服务。
const MAX_API_BODY = 256 * 1024;
function guardMutation(req, res) {
  const origin = req.headers && req.headers.origin;
  if (origin) {
    let host = '';
    try { host = new URL(origin).host.toLowerCase(); } catch (e) { host = ''; }
    const self = String((req.headers && req.headers.host) || '').toLowerCase();
    if (!host || host !== self) { json(res, 403, { ok: false, error: '跨源请求被拒绝' }); return false; }
  }
  const len = parseInt((req.headers && req.headers['content-length']) || '0', 10) || 0;
  if (len > MAX_API_BODY) { json(res, 413, { ok: false, error: '请求体过大（上限 ' + MAX_API_BODY + ' 字节）' }); return false; }
  return true;
}

function serveFile(req, res, absPath) {
  fs.readFile(absPath, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    // 强 ETag（内容哈希）：不同内容绝不会共享缓存；所有文件一律 no-cache 强制重校验，保证数据绝不陈旧。
    const etag = etagOf(data);
    const inm = req.headers['if-none-match'];
    if (inm && inm === etag) {
      res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'no-cache' });
      res.end();
      return;
    }
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'ETag': etag,
      'Cache-Control': 'no-cache',
    };
    const ae = String(req.headers['accept-encoding'] || '');
    if (COMPRESSIBLE[ext] && ae.indexOf('gzip') !== -1 && data.length > 1024) {
      const gz = zlib.gzipSync(data);
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = gz.length;
      headers['Vary'] = 'Accept-Encoding';
      res.writeHead(200, headers);
      res.end(gz);
    } else {
      headers['Content-Length'] = data.length;
      res.writeHead(200, headers);
      res.end(data);
    }
  });
}

function serveStatic(reqUrl) {
  const urlPath = decodeURIComponent((reqUrl || '/').split('?')[0]);
  let rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const abs = path.resolve(CFG.server.webRootAbs, rel);
  // 路径穿越防护：限定在 webRoot 内
  if (abs !== CFG.server.webRootAbs && !abs.startsWith(CFG.server.webRootAbs + path.sep)) {
    return null;
  }
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null;
}

let STATE = { running: false, last: null, progress: { phase: 'idle', dirCount: 0, batchCount: 0, skipped: 0 } };
const SSE_CLIENTS = new Set();

function readIndexCount() {
  try {
    const idx = JSON.parse(fs.readFileSync(CFG.scan.outAbs, 'utf8'));
    if (typeof idx.count === 'number') return idx.count;
    if (Array.isArray(idx.batches)) return idx.batches.length;
  } catch (e) {}
  return null;
}

function broadcastProgress() {
  const payload = 'data: ' + JSON.stringify(STATE.progress) + '\n\n';
  SSE_CLIENTS.forEach(function (r) {
    try { r.write(payload); } catch (e) { SSE_CLIENTS.delete(r); }
  });
}

async function handleScan(res) {
  if (STATE.running) {
    json(res, 409, { ok: false, error: '已有扫描任务进行中', running: true });
    return;
  }
  STATE.running = true;
  STATE.progress = { phase: 'scanning', dirCount: 0, batchCount: 0, skipped: 0 };
  broadcastProgress();
  const t0 = Date.now();
  let result;
  try {
    const r = await scan({
      basedir: CFG.scan.basedirAbs,
      out: CFG.scan.outAbs,
      ignore: CFG.scan.ignore,
      env: CFG.scan.env,
      onProgress: function (p) {
        STATE.progress = { phase: 'scanning', dirCount: p.dirCount, batchCount: p.batchCount, skipped: p.skipped };
        broadcastProgress();
      },
    });
    result = { ok: r.ok, error: r.ok ? null : r.error, count: r.count, batches: r.batches, skipped: r.skipped };
  } catch (e) {
    result = { ok: false, error: '扫描异常：' + (e && e.message ? e.message : e), count: 0, batches: [], skipped: 0 };
  }
  const durationMs = Date.now() - t0;
  STATE.running = false;
  STATE.progress = { phase: 'done', dirCount: STATE.progress.dirCount, batchCount: result.count, skipped: result.skipped };
  broadcastProgress();
  STATE.last = { at: new Date().toISOString(), ok: result.ok, error: result.error || null, durationMs: durationMs };
  json(res, result.ok ? 200 : 500, {
    ok: result.ok,
    count: result.ok ? readIndexCount() : 0,
    durationMs: durationMs,
    skipped: result.skipped,
    error: result.error || null,
  });
}

// 收藏夹 API（服务端持久化，多用户共享）。
function readFavorites() {
  try {
    const raw = fs.readFileSync(FAVORITES_FILE, 'utf8');
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch (e) {
    return {};
  }
}
function writeFavorites(tree) {
  writeFileAtomic(FAVORITES_FILE, JSON.stringify(tree, null, 2));
}
function handleFavoritesGet(res) {
  // 带上当前 ETag，供客户端写入时做 If-Match 乐观并发。
  json(res, 200, { ok: true, favorites: readFavorites(), etag: etagOfFile(FAVORITES_FILE) });
}

// 忽略配置默认相对路径（config.json 的 urls.ignore）。
function defaultIgnoreUrl() {
  try {
    const cfg = JSON.parse(fs.readFileSync(ACTIVE_CONFIG_FILE, 'utf8')) || {};
    const v = cfg.urls && cfg.urls.ignore;
    if (typeof v === 'string' && v) return v;
  } catch (e) {}
  return 'ignore-config-by-platform.json';
}

// 把「web 相对路径」解析为可写的忽略配置文件路径：
//   租户模式 -> 限定在租户数据根（CFG.tenant.dataRoot）内；否则 -> 限定在 web 根内。
// 仅允许写 ①config.urls.ignore 指向的配置文件，②批次目录（scan.basedirAbs）内的 .json（批次级忽略配置）；
// 拒绝跨域地址、其它协议（file: 等）与路径穿越。/tenant/ 前缀归一化到对应根目录。
// host 为当前请求的 Host，用于校验同源绝对 URL（批次级 ignoreUrl 在浏览器侧可能已是绝对地址）。
function resolveWritableConfigPath(rel, host) {
  let clean = String(rel || '').trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(clean)) {
    try {
      const u = new URL(clean);
      if (!host || u.host.toLowerCase() !== String(host).toLowerCase()) return null;
      clean = u.pathname;
    } catch (e) { return null; }
  } else if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(clean)) {
    return null;
  }
  clean = clean.split('?')[0].split('#')[0].replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean === 'tenant' || clean.startsWith('tenant/')) clean = clean.slice('tenant'.length).replace(/^\/+/, '');
  if (!clean || !/\.json$/i.test(clean)) return null;
  const root = path.resolve(CFG.tenant.enabled ? CFG.tenant.dataRoot : CFG.server.webRootAbs);
  const abs = path.resolve(root, clean);
  if (abs === root || !abs.startsWith(root + path.sep)) return null;
  const configured = path.resolve(root, String(defaultIgnoreUrl()).replace(/^\/+/, '').replace(/^tenant\//, ''));
  if (abs === configured) return abs;
  const batches = path.resolve(CFG.scan.basedirAbs);
  return abs.startsWith(batches + path.sep) ? abs : null;
}

// 忽略配置回写：写入「当前生效的配置文件」（客户端传入自己实际加载的那个 url）。
// 与收藏夹同一套持久化风格：原子写入 + 按租户隔离路径。
function handleIgnorePost(req, res) {
  let body = '';
  req.on('data', function (c) { body += String(c); });
  req.on('end', function () {
    try {
      const data = JSON.parse(body || '{}');
      const cfg = data.config;
      if (cfg === undefined || cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
        json(res, 400, { ok: false, error: 'config 必须是对象' });
        return;
      }
      const rel = (typeof data.url === 'string' && data.url) ? data.url : defaultIgnoreUrl();
      const abs = resolveWritableConfigPath(rel, req.headers && req.headers.host);
      if (!abs) { json(res, 403, { ok: false, error: '不允许写入该路径：' + rel }); return; }
      // 乐观并发：客户端带上它实际加载时的 ETag，与服务端当前文件不一致则拒绝（避免多会话互相覆盖）。
      const want = (typeof data.ifMatch === 'string' && data.ifMatch) || String((req.headers && req.headers['if-match']) || '');
      if (want && want !== '*') {
        const cur = etagOfFile(abs);
        if (!cur || want !== cur) { json(res, 409, { ok: false, error: '配置已被其他会话修改', etag: cur }); return; }
      }
      writeFileAtomic(abs, JSON.stringify(cfg, null, 2));
      json(res, 200, { ok: true, url: abs, etag: etagOfFile(abs) });
    } catch (e) {
      json(res, 500, { ok: false, error: '保存失败：' + (e && e.message ? e.message : e) });
    }
  });
}
function handleFavoritesPost(req, res) {
  let body = '';
  req.on('data', function (c) { body += String(c); });
  req.on('end', function () {
    try {
      const data = JSON.parse(body || '{}');
      const tree = data.favorites;
      if (tree === undefined || tree === null || typeof tree !== 'object' || Array.isArray(tree)) {
        json(res, 400, { ok: false, error: 'favorites 必须是对象' });
        return;
      }
      // 乐观并发：与服务端当前文件不一致则拒绝（客户端先用 GET /api/favorites 拿 etag）。
      const want = (typeof data.ifMatch === 'string' && data.ifMatch) || String((req.headers && req.headers['if-match']) || '');
      if (want && want !== '*') {
        const cur = etagOfFile(FAVORITES_FILE);
        if (!cur || want !== cur) { json(res, 409, { ok: false, error: '收藏夹已被其他会话修改', etag: cur }); return; }
      }
      writeFavorites(tree);
      json(res, 200, { ok: true, etag: etagOfFile(FAVORITES_FILE) });
    } catch (e) {
      json(res, 500, { ok: false, error: '保存失败：' + (e && e.message ? e.message : e) });
    }
  });
}

// 重新扫描并重建批次索引。
// 元数据写回（收藏 / 软删除 / 名称与描述 / 标签）后必须调用：客户端刷新页面时
// 直接读取 batches-index.json，索引不重建就会回退到写回前的旧值。
async function rescanIndex() {
  try {
    await scan({
      basedir: CFG.scan.basedirAbs,
      out: CFG.scan.outAbs,
      ignore: CFG.scan.ignore,
      env: CFG.scan.env,
    });
  } catch (e) {
    console.warn('[report-viewer] 元数据写回后索引重建失败：' + (e && e.message ? e.message : e));
  }
}

// 批次元数据写回：软删除 / 恢复 / 收藏 / 名称与描述 / 标签。
function handleBatchAction(req, res) {
  let body = '';
  req.on('data', function (c) { body += String(c); });
  req.on('end', async function () {
    try {
      const data = JSON.parse(body || '{}');
      const batchId = data.batchId;
      const hasDeleted = typeof data.deleted === 'boolean';
      const hasFavorite = typeof data.favorite === 'boolean';
      const hasTags = Array.isArray(data.tags);
      const hasName = typeof data.batchName === 'string';
      const hasDesc = typeof data.description === 'string';
      if (!batchId) { json(res, 400, { ok: false, error: 'batchId 必填' }); return; }
      // 批次名不允许为空（批次名允许重复：重名只在前端告警，不影响回写）。
      const nextName = hasName ? String(data.batchName).trim().slice(0, MAX_BATCH_NAME_LEN) : null;
      if (hasName && !nextName) { json(res, 400, { ok: false, error: 'batchName 不能为空' }); return; }

      let idx = { batches: [] };
      try { idx = JSON.parse(fs.readFileSync(CFG.scan.outAbs, 'utf8')); } catch (e) {}
      const b = (idx.batches || []).find(function (x) { return x.batchId === batchId; });
      if (!b || !b.path) { json(res, 404, { ok: false, error: '批次不存在：' + batchId }); return; }

      const dir = b.path.split('/').join(path.sep);
      const metaPath = path.join(dir, 'batch-meta.json');
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) || {}; } catch (e) {}
      meta.batchId = meta.batchId || batchId;
      if (hasDeleted) meta.deleted = data.deleted;
      if (hasFavorite) meta.favorite = data.favorite;
      if (hasName) meta.batchName = nextName;
      // 描述：允许多行；空值表示清除该字段。
      if (hasDesc) {
        const desc = String(data.description).replace(/\r\n/g, '\n').trim().slice(0, MAX_BATCH_DESC_LEN);
        if (desc) meta.description = desc;
        else delete meta.description;
      }
      // 标签回写：仅覆盖 tags 字段（空数组表示清除）；其余字段与顺序保持不变。
      if (hasTags) {
        const tags = sanitizeTags(data.tags);
        if (tags.length) meta.tags = tags;
        else delete meta.tags;
      }
      writeFileAtomic(metaPath, JSON.stringify(meta, null, 2));
      // 写回与索引刷新必须成对，否则刷新页面会读到写回前的旧索引。
      await rescanIndex();
      json(res, 200, {
        ok: true,
        batchId: batchId,
        deleted: hasDeleted ? data.deleted : undefined,
        favorite: hasFavorite ? data.favorite : undefined,
        batchName: hasName ? meta.batchName : undefined,
        description: hasDesc ? (meta.description || '') : undefined,
        tags: hasTags ? (meta.tags || []) : undefined,
      });
    } catch (e) {
      json(res, 500, { ok: false, error: '操作失败：' + (e && e.message ? e.message : e) });
    }
  });
}

// 在系统文件管理器中打开批次目录。
// 安全约束：仅当 features.revealPath 开启（dev/test 默认开启，prod 默认关闭）；
// 路径必须位于批次根目录（scan.basedirAbs）内且为已存在的目录（realpath 后再校验一次）。
function handleReveal(req, res) {
  if (!REVEAL_ENABLED) { json(res, 403, { ok: false, error: '当前环境未开启「打开目录」功能' }); return; }
  let body = '';
  req.on('data', function (c) { body += String(c); });
  req.on('end', function () {
    try {
      const data = JSON.parse(body || '{}');
      if (!data.path) { json(res, 400, { ok: false, error: 'path 必填' }); return; }
      const root = path.resolve(CFG.scan.basedirAbs);
      const abs = path.resolve(String(data.path));
      if (abs !== root && !abs.startsWith(root + path.sep)) { json(res, 403, { ok: false, error: '路径不在批次目录内' }); return; }
      let real;
      try { real = fs.realpathSync(abs); } catch (e) { json(res, 404, { ok: false, error: '目录不存在：' + abs }); return; }
      if (real !== root && !real.startsWith(root + path.sep)) { json(res, 403, { ok: false, error: '路径不在批次目录内' }); return; }
      if (!fs.statSync(real).isDirectory()) { json(res, 400, { ok: false, error: '不是目录：' + real }); return; }
      // 启动文件管理器：成功/失败都要如实回应（失败时前端会提示，不再是无声无息）。
      // 错误消息不带前缀，由前端拼接本地化提示（避免「打开目录失败： 打开目录失败：…」重复）。
      openInFileManager(real).then(function (launcher) {
        json(res, 200, { ok: true, path: real.split(path.sep).join('/'), launcher: launcher });
      }).catch(function (e) {
        console.warn('[report-viewer] 打开目录失败：' + (e && e.message ? e.message : e));
        json(res, 500, { ok: false, error: (e && e.message) ? e.message : String(e) });
      });
    } catch (e) {
      json(res, 500, { ok: false, error: (e && e.message) ? e.message : String(e) });
    }
  });
}

function handleStatus(res) {
  json(res, 200, {
    ok: true,
    running: STATE.running,
    version: requireVersion(),
    config: {
      host: CFG.server.host,
      port: CFG.server.port,
      webRoot: CFG.server.webRoot,
      basedir: CFG.scan.basedir,
      out: CFG.scan.out,
      ignore: CFG.scan.ignore,
      env: CFG.scan.env || null,
    },
    tenant: {
      enabled: CFG.tenant.enabled,
      id: CFG.tenant.id,
      dataRoot: CFG.tenant.dataRoot,
      activeFile: CFG.tenant.activeFile,
      activityLog: CFG.tenant.activityLog,
    },
    last: STATE.last,
  });
}

function requireVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(DIR, 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch (e) {
    return null;
  }
}

// 租户数据服务：/tenant 或 /tenant/ -> 租户 batches-index.json；/tenant/<rel> -> 租户数据根下的文件。
// 文件不在租户数据根时回退到共享 web 根（例如忽略配置）。
function serveTenantData(req, res, url) {
  let rel = decodeURIComponent(url.replace(/^\/tenant\/?/, '')).replace(/^\/+/, '');
  if (!rel) {
    serveFile(req, res, CFG.scan.outAbs);
    return;
  }
  const dataRoot = CFG.tenant.dataRoot;
  const candidate = path.resolve(dataRoot, rel);
  if (candidate === dataRoot || candidate.startsWith(dataRoot + path.sep)) {
    try {
      if (fs.statSync(candidate).isFile()) { serveFile(req, res, candidate); return; }
    } catch (e) {}
  }
  const shared = path.resolve(CFG.server.webRootAbs, rel);
  if (shared === CFG.server.webRootAbs || shared.startsWith(CFG.server.webRootAbs + path.sep)) {
    try {
      if (fs.statSync(shared).isFile()) { serveFile(req, res, shared); return; }
    } catch (e) {}
  }
  json(res, 404, { ok: false, error: 'Not Found' });
}

const server = http.createServer(function (req, res) {
  const url = (req.url || '/').split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // 写操作防护（同源 + 体积上限）：/scan 与全部 /api/* POST 统一拦截。
  if (req.method === 'POST' && (url === '/scan' || url.startsWith('/api/'))) {
    if (!guardMutation(req, res)) return;
  }

  if (url === '/scan') {
    handleScan(res).catch(function (e) {
      STATE.running = false;
      json(res, 500, { ok: false, error: '扫描异常：' + (e && e.message ? e.message : e) });
    });
    return;
  }

  if (url === '/api/batch') {
    handleBatchAction(req, res);
    return;
  }

  if (url === '/api/reveal') {
    handleReveal(req, res);
    return;
  }

  if (url === '/api/favorites') {
    if (req.method === 'POST') handleFavoritesPost(req, res);
    else handleFavoritesGet(res);
    return;
  }

  if (url === '/api/ignore') {
    if (req.method === 'POST') handleIgnorePost(req, res);
    else json(res, 405, { ok: false, error: '仅支持 POST（忽略配置由静态文件读取）' });
    return;
  }

  if (url === '/scan/progress') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 1000\n\n');
    SSE_CLIENTS.add(res);
    res.write('data: ' + JSON.stringify(STATE.progress) + '\n\n');
    req.on('close', function () { SSE_CLIENTS.delete(res); });
    return;
  }

  if (url === '/status' || url === '/health') {
    handleStatus(res);
    return;
  }

  if (url === '/config.json') {
    // 租户模式：将 urls.batches 重写为租户索引地址（批次索引与批次数据均按租户隔离）。
    // 非租户模式：保持配置中的 urls.batches（相对 web 根，指向共享批次索引）。
    let servedCfg = {};
    try { servedCfg = JSON.parse(fs.readFileSync(ACTIVE_CONFIG_FILE, 'utf8')) || {}; } catch (e) { servedCfg = {}; }
    servedCfg.urls = servedCfg.urls || {};
    // 把服务端解析后的「打开目录」开关下发给浏览器（未显式配置时也会带上有效值）。
    servedCfg.features = servedCfg.features || {};
    if (typeof servedCfg.features.revealPath !== 'boolean') servedCfg.features.revealPath = REVEAL_ENABLED;
    if (CFG.tenant.enabled) {
      servedCfg.urls.batches = '/tenant/';
      // 忽略配置同样按租户隔离：/tenant/<urls.ignore>（无租户文件时回退到共享默认文件）。
      servedCfg.urls.ignore = '/tenant/' + String(defaultIgnoreUrl()).replace(/^\/+/, '');
    }
    // 本地缓存作用域：下发租户标识（仅 enabled / id，**不含** dataRoot 等服务器路径）。
    // 前端据此把 localStorage 与 IndexedDB 缓存按租户分区，各租户互不影响（清除缓存也只清当前租户）。
    servedCfg.tenant = { enabled: !!CFG.tenant.enabled, id: CFG.tenant.enabled ? CFG.tenant.id : null };
    json(res, 200, servedCfg);
    return;
  }

  if (url === '/tenant' || url.startsWith('/tenant/')) {
    serveTenantData(req, res, url);
    return;
  }

  const abs = serveStatic(url);
  if (abs) {
    serveFile(req, res, abs);
    return;
  }

  json(res, 404, { ok: false, error: 'Not Found' });
});

// 启动时校验默认/主/空占位数据文件（坏数据提前告警，不阻塞启动）。
['report-validation-data.json', 'report-validation-data-default.json', 'report-validation-data-init.json'].forEach(function (f) {
  const abs = path.join(CFG.server.webRootAbs, f);
  if (fs.existsSync(abs)) {
    const r = validateFile(abs);
    if (!r.ok) {
      console.warn('[report-viewer] Data validation failed: ' + f);
      r.errors.forEach(function (e) { console.warn('   - ' + e); });
    }
  }
});

// 首次启动初始化：为租户创建「兼容的空数据/配置」（空批次目录、空索引、空忽略配置），
// 不复制共享样例数据（仅在租户模式且未显式覆盖扫描目录时执行）。
function initTenantData() {
  if (!CFG.tenant.enabled) return; // 非租户模式：直接使用 web 根下的共享批次数据。
  if (process.env.REPORT_VIEWER_BASEDIR || process.env.REPORT_VIEWER_OUT) return;
  try {
    fs.mkdirSync(CFG.scan.basedirAbs, { recursive: true });
    if (!fs.existsSync(CFG.scan.outAbs)) {
      const emptyIndex = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        basedir: CFG.scan.basedirAbs.split(path.sep).join('/'),
        count: 0,
        batches: [],
      };
      writeFileAtomic(CFG.scan.outAbs, JSON.stringify(emptyIndex, null, 2));
    }
    const ignorePath = path.join(CFG.tenant.dataRoot, 'ignore-config-by-platform.json');
    if (!fs.existsSync(ignorePath)) {
      writeFileAtomic(ignorePath, JSON.stringify({}, null, 2));
    }
    console.log('[report-viewer] Initialized empty tenant data: ' + CFG.tenant.dataRoot);
  } catch (e) {
    console.warn('[report-viewer] Init tenant data failed: ' + (e && e.message ? e.message : e));
  }
}

// 租户 active 追踪：心跳文件实时记录当前活跃租户（供审查），活动日志追加启动/停止记录。
// 默认关闭，可通过 config `audit: true`、环境变量 REPORT_VIEWER_AUDIT=1 或 --audit 开启。
const TRACKING_ENABLED = !!CFG.audit;
function writeActiveTenant(actualPort) {
  if (!TRACKING_ENABLED) return;
  try {
    fs.mkdirSync(path.dirname(CFG.tenant.activeFile), { recursive: true });
    writeFileAtomic(CFG.tenant.activeFile, JSON.stringify({
      tenantId: CFG.tenant.id,
      pid: process.pid,
      host: CFG.server.host,
      port: actualPort,
      startedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    }, null, 2));
  } catch (e) {}
}
function refreshActiveTenant(actualPort) {
  if (!TRACKING_ENABLED) return;
  try {
    const cur = JSON.parse(fs.readFileSync(CFG.tenant.activeFile, 'utf8') || '{}');
    cur.lastSeenAt = new Date().toISOString();
    cur.port = actualPort;
    writeFileAtomic(CFG.tenant.activeFile, JSON.stringify(cur, null, 2));
  } catch (e) {}
}
function clearActiveTenant() {
  if (!TRACKING_ENABLED) return;
  try { fs.unlinkSync(CFG.tenant.activeFile); } catch (e) {}
}
function appendActivity(event) {
  if (!TRACKING_ENABLED) return;
  try {
    fs.mkdirSync(path.dirname(CFG.tenant.activityLog), { recursive: true });
    fs.appendFileSync(CFG.tenant.activityLog, '[' + new Date().toISOString() + '] tenant=' + CFG.tenant.id + ' ' + event + '\n', 'utf8');
  } catch (e) {}
}

let SHUTDOWN_DONE = false;
function shutdown() {
  if (SHUTDOWN_DONE) return;
  SHUTDOWN_DONE = true;
  clearActiveTenant();
  appendActivity('stopped pid=' + process.pid);
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.on('exit', function (code) {
  // 进程退出（含异常退出）时同步清理 active 文件；若尚未走 shutdown 则补记一条退出日志。
  try { fs.unlinkSync(CFG.tenant.activeFile); } catch (e) {}
  if (!SHUTDOWN_DONE) {
    try { appendActivity('exited pid=' + process.pid + ' code=' + code); } catch (e) {}
  }
});

// 启动前先通过 /status API 探测目标地址是否已存在服务；若已启动则不重复监听。
function checkAlreadyRunning(host, port, timeoutMs) {
  return new Promise(function (resolve) {
    const req = http.request({
      host: host,
      port: port,
      path: '/status',
      method: 'GET',
      timeout: timeoutMs,
    }, function (res) {
      let data = '';
      res.on('data', function (c) { data += c; });
      res.on('end', function () {
        try {
          const obj = JSON.parse(data);
          resolve(res.statusCode === 200 && obj && obj.ok === true);
        } catch (e) {
          resolve(false);
        }
      });
    });
    req.on('timeout', function () { req.destroy(); resolve(false); });
    req.on('error', function () { resolve(false); });
    req.end();
  });
}

function startServer() {
  server.on('error', function (err) {
    if (err && err.code === 'EADDRINUSE') {
      console.log('[report-viewer] Port already in use: http://' + CFG.server.host + ':' + CFG.server.port);
      process.exit(0);
    }
    console.error('[report-viewer] Failed to start: ' + (err && err.message ? err.message : err));
    process.exit(1);
  });
  // port=0 表示随机端口：由操作系统分配空闲端口，启动后从 server.address() 读取实际端口。
  server.listen(CFG.server.port, CFG.server.host, function () {
    const actualPort = server.address().port;
    writeActiveTenant(actualPort);
    appendActivity('started pid=' + process.pid + ' url=http://' + CFG.server.host + ':' + actualPort);
    // 心跳：每 10 秒刷新 lastSeenAt，实时反映该租户仍处于活跃状态。
    setInterval(function () { refreshActiveTenant(server.address().port); }, 10000).unref();
    console.log('[report-viewer] Started: http://' + CFG.server.host + ':' + actualPort);
    console.log('[report-viewer] Tenant: ' + (CFG.tenant.enabled ? CFG.tenant.id : '(none)'));
    console.log('[report-viewer] Data root: ' + CFG.tenant.dataRoot);
    console.log('[report-viewer] Config: ' + ACTIVE_CONFIG_FILE);
    console.log('[report-viewer] Web root: ' + CFG.server.webRootAbs);
    console.log('[report-viewer] Batches dir: ' + CFG.scan.basedirAbs);
    console.log('[report-viewer] Index output: ' + CFG.scan.outAbs);
    console.log('[report-viewer] Endpoints: POST /scan · GET /status · GET /config.json');
  });
}

const HOST = CFG.server.host;
const PORT = CFG.server.port;
initTenantData();
if (PORT === 0) {
  // 随机端口：无法预知端口，直接启动（端口冲突概率极低，由 EADDRINUSE 兜底）。
  startServer();
} else {
  checkAlreadyRunning(HOST, PORT, 1000).then(function (already) {
    if (already) {
      console.log('[report-viewer] Already running: http://' + HOST + ':' + PORT);
      return;
    }
    startServer();
  });
}
