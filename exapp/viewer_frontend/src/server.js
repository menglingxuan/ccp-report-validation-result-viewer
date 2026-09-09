#!/usr/bin/env node
// 统一 HTTP 服务：静态站点（查看器）+ 批次扫描 API。
//
//   node server.js              # 启动（默认读取 config.json）
//   node server.js --port 9000  # 覆盖监听端口（优先级最高）
//   node server.js --port 0     # 使用操作系统分配的随机空闲端口
//   node server.js --host 0.0.0.0
//   node server.js --config dev # 使用 config-dev.json
//   node server.js --tenant alice            # 指定租户 id（默认取系统用户名）
//   node server.js --data-root C:/data/alice # 指定租户数据根目录
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
//   POST /api/batch         批次软删除 / 收藏
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadConfig, resolveConfigFile } from './lib/config.js';
import { scan } from './lib/scanner.js';
import { validateFile } from './lib/validate.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
// 读取 CLI 参数（--flag value 形式）。
//   --config/--profile 切换配置文件；--port/--host 覆盖监听地址；
//   --tenant 指定租户 id；--data-root 指定租户数据根目录。
function cliValue(...names) {
  for (const n of names) {
    const i = process.argv.indexOf(n);
    if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  }
  return undefined;
}
const cfgName = cliValue('--config', '--profile');
if (cfgName) process.env.REPORT_VIEWER_CONFIG = cfgName;
const dataRootArg = cliValue('--data-root');
if (dataRootArg) process.env.REPORT_VIEWER_DATA_ROOT = dataRootArg;
// audit 开关：--audit 开启 / --no-audit 关闭（布尔旗标，覆盖 config 与环境变量）。
const auditFlag = process.argv.includes('--no-audit') ? false : (process.argv.includes('--audit') ? true : undefined);
const CFG = loadConfig({ host: cliValue('--host'), port: cliValue('--port'), tenant: cliValue('--tenant'), audit: auditFlag });
const ACTIVE_CONFIG_FILE = resolveConfigFile();

// 收藏夹服务端持久化：每个租户在自身数据根下拥有独立 favorites.json（多用户互不干扰）。
function resolveFavoritesFile() {
  return path.join(CFG.tenant.dataRoot, 'favorites.json');
}
const FAVORITES_FILE = resolveFavoritesFile();

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

function serveFile(req, res, absPath) {
  fs.readFile(absPath, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    // 强 ETag（内容哈希）：不同内容绝不会共享缓存；所有文件一律 no-cache 强制重校验，保证数据绝不陈旧。
    const etag = '"' + crypto.createHash('sha256').update(data).digest('hex').slice(0, 16) + '"';
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
  json(res, 200, { ok: true, favorites: readFavorites() });
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
      writeFavorites(tree);
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 500, { ok: false, error: '保存失败：' + (e && e.message ? e.message : e) });
    }
  });
}

// 软删除 / 恢复批次：在批次目录的 batch-meta.json 中写入 deleted 标记。
function handleBatchAction(req, res) {
  let body = '';
  req.on('data', function (c) { body += String(c); });
  req.on('end', function () {
    try {
      const data = JSON.parse(body || '{}');
      const batchId = data.batchId;
      const hasDeleted = typeof data.deleted === 'boolean';
      const hasFavorite = typeof data.favorite === 'boolean';
      if (!batchId) { json(res, 400, { ok: false, error: 'batchId 必填' }); return; }

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
      writeFileAtomic(metaPath, JSON.stringify(meta, null, 2));
      json(res, 200, { ok: true, batchId: batchId, deleted: hasDeleted ? data.deleted : undefined, favorite: hasFavorite ? data.favorite : undefined });
    } catch (e) {
      json(res, 500, { ok: false, error: '操作失败：' + (e && e.message ? e.message : e) });
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

  if (url === '/api/favorites') {
    if (req.method === 'POST') handleFavoritesPost(req, res);
    else handleFavoritesGet(res);
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
    // 将 urls.batches 重写为租户索引地址：批次索引与批次数据均按租户隔离。
    try {
      const servedCfg = JSON.parse(fs.readFileSync(ACTIVE_CONFIG_FILE, 'utf8'));
      servedCfg.urls = servedCfg.urls || {};
      servedCfg.urls.batches = '/tenant/';
      json(res, 200, servedCfg);
    } catch (e) {
      serveFile(req, res, ACTIVE_CONFIG_FILE);
    }
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
// 不复制共享样例数据（仅在未显式覆盖扫描目录时执行）。
function initTenantData() {
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
    console.log('[report-viewer] Tenant: ' + CFG.tenant.id);
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
