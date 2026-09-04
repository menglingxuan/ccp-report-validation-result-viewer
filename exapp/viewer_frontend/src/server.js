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
import { fileURLToPath } from 'node:url';
import { loadConfig, resolveConfigFile } from './lib/config.js';
import { scan } from './lib/scanner.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
// CLI 切换配置：node server.js --config dev|test|prod（也可用环境变量 REPORT_VIEWER_CONFIG）
const cfgIdx = Math.max(process.argv.indexOf('--config'), process.argv.indexOf('--profile'));
if (cfgIdx !== -1 && process.argv[cfgIdx + 1]) process.env.REPORT_VIEWER_CONFIG = process.argv[cfgIdx + 1];
const CFG = loadConfig();
const ACTIVE_CONFIG_FILE = resolveConfigFile();

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

function serveFile(res, absPath) {
  fs.readFile(absPath, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(absPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
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

let STATE = { running: false, last: null };

function readIndexCount() {
  try {
    const idx = JSON.parse(fs.readFileSync(CFG.scan.outAbs, 'utf8'));
    if (typeof idx.count === 'number') return idx.count;
    if (Array.isArray(idx.batches)) return idx.batches.length;
  } catch (e) {}
  return null;
}

function runScan() {
  return new Promise(function (resolve) {
    setImmediate(function () {
      try {
        const result = scan({ basedir: CFG.scan.basedirAbs, out: CFG.scan.outAbs, ignore: CFG.scan.ignore, env: CFG.scan.env });
        resolve({ ok: result.ok, error: result.ok ? null : result.error, count: result.count, batches: result.batches, skipped: result.skipped });
      } catch (e) {
        resolve({ ok: false, error: '扫描异常：' + (e && e.message ? e.message : e), count: 0, batches: [], skipped: 0 });
      }
    });
  });
}

async function handleScan(res) {
  if (STATE.running) {
    json(res, 409, { ok: false, error: '已有扫描任务进行中', running: true });
    return;
  }
  STATE.running = true;
  const t0 = Date.now();
  const result = await runScan();
  const durationMs = Date.now() - t0;
  STATE.running = false;
  STATE.last = { at: new Date().toISOString(), ok: result.ok, error: result.error || null, durationMs: durationMs };
  json(res, result.ok ? 200 : 500, {
    ok: result.ok,
    count: result.ok ? readIndexCount() : 0,
    durationMs: durationMs,
    skipped: result.skipped,
    error: result.error || null,
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

  if (url === '/status' || url === '/health') {
    handleStatus(res);
    return;
  }

  if (url === '/config.json') {
    serveFile(res, ACTIVE_CONFIG_FILE);
    return;
  }

  const abs = serveStatic(url);
  if (abs) {
    serveFile(res, abs);
    return;
  }

  json(res, 404, { ok: false, error: 'Not Found' });
});

server.listen(CFG.server.port, CFG.server.host, function () {
  console.log('[report-viewer] 已启动：http://' + CFG.server.host + ':' + CFG.server.port);
  console.log('[report-viewer] 配置：' + ACTIVE_CONFIG_FILE);
  console.log('[report-viewer] web 根目录：' + CFG.server.webRootAbs);
  console.log('[report-viewer] 批次目录：' + CFG.scan.basedirAbs);
  console.log('[report-viewer] 索引输出：' + CFG.scan.outAbs);
  console.log('[report-viewer] 接口：POST /scan · GET /status · GET /config.json');
});
