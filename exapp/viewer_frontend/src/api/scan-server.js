#!/usr/bin/env node
/**
 * scan-server —— 批次「重新扫描」HTTP 接口（零依赖，仅用 Node 内置模块）
 *
 * 作用：前端批次面板 / docker 点击「重新扫描」时，先调用本接口；
 *       本接口内部执行 scan-batches.js（自动扫描批次目录），
 *       扫描完成后前端再自行重新读取 batches-index.json。
 *
 * 服务配置（非接口参数）支持 scan-batches.js 的全部选项：
 *   --basedir  <目录>   -> 配置项 basedir
 *   --out      <路径>   -> 配置项 out
 *   --ignore   <正则>   -> 配置项 ignore（数组，可多个）
 *   --env      <环境>   -> 配置项 env
 *
 * 配置来源优先级：环境变量 > scan-server.config.json > 内置默认值。
 *
 * 接口：
 *   POST /scan   触发一次完整扫描（同步等待扫描完成，返回结果）
 *   GET  /scan   同 POST（便于浏览器直接访问）
 *   GET  /status 查看服务状态与当前配置
 *
 * 启动：
 *   node scan-server.js
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'scan-server.config.json');

/* ---------- 配置加载 ---------- */
function loadConfig() {
  let fileCfg = {};
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    fileCfg = JSON.parse(raw) || {};
  } catch (e) {
    // 配置文件缺失或非法时使用默认值
  }

  const env = process.env;
  let ignore = Array.isArray(fileCfg.ignore) ? fileCfg.ignore.slice() : [];
  if (env.SCAN_SERVER_IGNORE) {
    ignore = ignore.concat(
      env.SCAN_SERVER_IGNORE.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
    );
  }

  const envVal = env.SCAN_SERVER_ENV !== undefined ? env.SCAN_SERVER_ENV : (fileCfg.env !== undefined ? fileCfg.env : null);

  return {
    host: env.SCAN_SERVER_HOST || fileCfg.host || '127.0.0.1',
    port: Number(env.SCAN_SERVER_PORT || fileCfg.port || 8123),
    scanScript: fileCfg.scanScript || 'scan-batches.js',
    basedir: env.SCAN_SERVER_BASEDIR || fileCfg.basedir || 'test/batches',
    out: env.SCAN_SERVER_OUT || fileCfg.out || 'engine/batches-index.json',
    ignore: ignore,
    env: envVal,
    timeoutMs: Number(env.SCAN_SERVER_TIMEOUT || fileCfg.timeoutMs || 120000),
  };
}

const CFG = loadConfig();

/* ---------- 构建 scan-batches.js 参数 ---------- */
function buildArgs() {
  const args = [];
  if (CFG.basedir) args.push('--basedir', path.resolve(ROOT, CFG.basedir));
  if (CFG.out) args.push('--out', path.resolve(ROOT, CFG.out));
  (CFG.ignore || []).forEach(function (re) { args.push('--ignore', String(re)); });
  if (CFG.env) args.push('--env', String(CFG.env));
  return args;
}

/* ---------- 运行状态 ---------- */
const STATE = { running: false, last: null };

function readIndexCount() {
  try {
    const outPath = path.resolve(ROOT, CFG.out);
    const idx = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    if (typeof idx.count === 'number') return idx.count;
    if (Array.isArray(idx.batches)) return idx.batches.length;
    return null;
  } catch (e) {
    return null;
  }
}

function runScan() {
  return new Promise(function (resolve) {
    const script = path.resolve(ROOT, CFG.scanScript);
    const args = buildArgs();
    let stdout = '';
    let stderr = '';

    let child;
    try {
      child = spawn(process.execPath, [script].concat(args), { cwd: ROOT, windowsHide: true });
    } catch (e) {
      resolve({ ok: false, error: '无法启动扫描进程：' + e.message, exitCode: -1, stdout: '', stderr: '' });
      return;
    }

    const timer = setTimeout(function () {
      try { child.kill(); } catch (e) {}
      resolve({ ok: false, error: '扫描超时（' + CFG.timeoutMs + 'ms）', exitCode: null, stdout: stdout, stderr: stderr });
    }, CFG.timeoutMs);

    child.stdout.on('data', function (d) { stdout += String(d); });
    child.stderr.on('data', function (d) { stderr += String(d); });
    child.on('error', function (err) {
      clearTimeout(timer);
      resolve({ ok: false, error: '无法启动扫描脚本：' + err.message, exitCode: -1, stdout: stdout, stderr: stderr });
    });
    child.on('close', function (code) {
      clearTimeout(timer);
      const ok = code === 0;
      resolve({ ok: ok, error: ok ? null : '扫描脚本退出码 ' + code, exitCode: code, stdout: stdout, stderr: stderr });
    });
  });
}

/* ---------- HTTP 工具 ---------- */
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

  STATE.last = {
    at: new Date().toISOString(),
    ok: result.ok,
    exitCode: result.exitCode,
    durationMs: durationMs,
    error: result.error || null,
  };

  json(res, result.ok ? 200 : 500, {
    ok: result.ok,
    exitCode: result.exitCode,
    durationMs: durationMs,
    count: readIndexCount(),
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error || null,
  });
}

function handleStatus(res) {
  json(res, 200, {
    ok: true,
    running: STATE.running,
    config: {
      scanScript: CFG.scanScript,
      basedir: CFG.basedir,
      out: CFG.out,
      ignore: CFG.ignore,
      env: CFG.env || null,
      timeoutMs: CFG.timeoutMs,
    },
    last: STATE.last,
  });
}

/* ---------- 服务启动 ---------- */
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

  if (url === '/status' || url === '/health' || url === '/') {
    handleStatus(res);
    return;
  }

  json(res, 404, { ok: false, error: 'Not Found' });
});

server.listen(CFG.port, CFG.host, function () {
  console.log('[scan-server] 已启动：http://' + CFG.host + ':' + CFG.port);
  console.log('[scan-server] 扫描脚本：' + path.resolve(ROOT, CFG.scanScript));
  console.log('[scan-server] basedir = ' + CFG.basedir);
  console.log('[scan-server] out     = ' + CFG.out);
  console.log('[scan-server] ignore  = ' + (CFG.ignore.length ? JSON.stringify(CFG.ignore) : '(无)'));
  console.log('[scan-server] env     = ' + (CFG.env || '(全部)'));
  console.log('[scan-server] 接口：POST /scan · GET /status');
});
