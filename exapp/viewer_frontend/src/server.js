#!/usr/bin/env node
// 统一 HTTP 服务：静态站点（查看器）+ 批次扫描 API。
//
//   node server.js          # 启动（默认读取 config.json）
//
// 接口：
//   GET  /                 查看器首页（public/index.html）
//   GET  /config.json      统一配置（供浏览器读取）
//   POST /scan             触发一次完整批次扫描（GET 亦可用，便于浏览器直连）
//   GET  /status | /health 服务状态与当前配置
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadConfig, resolveConfigFile } from './lib/config.js';
import { scan } from './lib/scanner.js';
import { validateFile } from './lib/validate.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
// CLI 切换配置：node server.js --config dev|test|prod（也可用环境变量 REPORT_VIEWER_CONFIG）
const cfgIdx = Math.max(process.argv.indexOf('--config'), process.argv.indexOf('--profile'));
if (cfgIdx !== -1 && process.argv[cfgIdx + 1]) process.env.REPORT_VIEWER_CONFIG = process.argv[cfgIdx + 1];
const CFG = loadConfig();
const ACTIVE_CONFIG_FILE = resolveConfigFile();

// 收藏夹服务端持久化（多用户共享，非管理员账号也可写：存放于 src 根目录）。
const FAVORITES_FILE = path.join(DIR, 'favorites.json');

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
  fs.stat(absPath, function (err, st) {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    // 强 ETag（mtime+size）；所有文件一律 no-cache —— 每次加载都必须重新校验，保证数据绝不陈旧。
    const etag = '"' + st.size.toString(16) + '-' + Math.round(st.mtimeMs).toString(16) + '"';
    const inm = req.headers['if-none-match'];
    if (inm && inm === etag) {
      res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'no-cache' });
      res.end();
      return;
    }
    fs.readFile(absPath, function (err2, data) {
      if (err2) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
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
  fs.writeFileSync(FAVORITES_FILE, JSON.stringify(tree, null, 2), 'utf8');
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
      fs.mkdirSync(path.dirname(metaPath), { recursive: true });
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
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
    serveFile(req, res, ACTIVE_CONFIG_FILE);
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
      console.warn('[report-viewer] 数据校验失败：' + f);
      r.errors.forEach(function (e) { console.warn('   - ' + e); });
    }
  }
});

server.listen(CFG.server.port, CFG.server.host, function () {
  console.log('[report-viewer] 已启动：http://' + CFG.server.host + ':' + CFG.server.port);
  console.log('[report-viewer] 配置：' + ACTIVE_CONFIG_FILE);
  console.log('[report-viewer] web 根目录：' + CFG.server.webRootAbs);
  console.log('[report-viewer] 批次目录：' + CFG.scan.basedirAbs);
  console.log('[report-viewer] 索引输出：' + CFG.scan.outAbs);
  console.log('[report-viewer] 接口：POST /scan · GET /status · GET /config.json');
});
