// 方案 A2（静态资源 brotli 压缩）回归测试。
//
// 服务端对可压缩的静态资源（.html/.css/.js/.mjs/.json/.svg/.txt）按 Accept-Encoding 选 br > gzip，
// 并按 ETag 缓存压缩结果。实测样例数据（紧凑后 2.69 MB）：
//   gzip ≈ 208 KB、brotli q9 ≈ 75 KB（21 ms）、q11 ≈ 65 KB 但要 2125 ms —— 因此固定用 q9。
// 这里用原始 http 请求（不用 fetch：它会自动解压并隐藏 Content-Encoding）逐项验证。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDataset } from '../lib/sample-data.js';
import { writeJSON } from '../lib/json-write.js';

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 20000 + Math.floor(Math.random() * 10000);

function startServer(extraEnv) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: SRC,
    env: Object.assign({}, process.env, { REPORT_VIEWER_PORT: String(PORT), REPORT_VIEWER_AUDIT: '0' }, extraEnv || {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 15000);
    child.stdout.on('data', (d) => {
      out += String(d);
      if (out.includes('Started:')) { clearTimeout(timer); resolve(child); }
    });
    child.stderr.on('data', (d) => { out += String(d); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

// 原始请求：返回 { status, headers, body: Buffer }
function rawGet(pathname, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: 'GET', headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('静态资源压缩：br > gzip > 不压缩，按 ETag 缓存，且与 304 协商共存', async () => {
  // 临时 web 根：写入真实结构的紧凑数据集 + 一个极小的 txt（低于阈值）+ 一个二进制文件。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-compress-'));
  const data = buildDataset();
  writeJSON(path.join(tmp, 'report-validation-data.json'), data);
  const dataBytes = fs.statSync(path.join(tmp, 'report-validation-data.json')).size;
  fs.writeFileSync(path.join(tmp, 'tiny.txt'), 'ok\n', 'utf8');
  fs.writeFileSync(path.join(tmp, 'blob.bin'), Buffer.alloc(4096, 7));

  const child = await startServer({ REPORT_VIEWER_WEBROOT: tmp, REPORT_VIEWER_DATA_ROOT: tmp });
  try {
    // 1) 客户端支持 br：下发 brotli，体积远小于原文件，解压后内容一致
    const br = await rawGet('/report-validation-data.json', { 'Accept-Encoding': 'br' });
    assert.equal(br.status, 200);
    assert.equal(br.headers['content-encoding'], 'br', 'Accept-Encoding: br 时应下发 brotli');
    assert.equal(br.headers['vary'], 'Accept-Encoding', '必须下发 Vary，避免中间缓存投毒');
    assert.equal(Number(br.headers['content-length']), br.body.length, 'Content-Length 应为压缩后长度');
    assert.equal(fs.statSync(path.join(tmp, 'report-validation-data.json')).size, dataBytes, '服务端不应改写数据文件');
    const brJson = JSON.parse(zlib.brotliDecompressSync(br.body).toString('utf8'));
    assert.equal(brJson.items.length, data.items.length, '解压后应与原数据集一致');
    assert.ok(br.body.length < dataBytes / 5, 'brotli 后体积应不足原来的 1/5（实测约 1/35）');

    // 2) 只支持 gzip：下发 gzip，且 brotli 更小（据此确定编码优先级）
    const gz = await rawGet('/report-validation-data.json', { 'Accept-Encoding': 'gzip' });
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.equal(Number(gz.headers['content-length']), gz.body.length);
    assert.equal(JSON.parse(zlib.gunzipSync(gz.body).toString('utf8')).items.length, data.items.length);
    assert.ok(br.body.length < gz.body.length, 'brotli 应小于 gzip（实测 ' + br.body.length + ' < ' + gz.body.length + '）');

    // 3) 不带 Accept-Encoding：不压缩但要带 Vary
    const id = await rawGet('/report-validation-data.json', {});
    assert.equal(id.headers['content-encoding'], undefined, '未协商压缩时不应下发 Content-Encoding');
    assert.equal(id.headers['vary'], 'Accept-Encoding');
    assert.equal(id.body.length, dataBytes, '不压缩时应是原文件字节数');

    // 4) 显式拒绝 br（q=0）：退回 gzip
    const q0 = await rawGet('/report-validation-data.json', { 'Accept-Encoding': 'br;q=0, gzip' });
    assert.equal(q0.headers['content-encoding'], 'gzip', 'q=0 表示客户端拒绝 br');

    // 5) 低于阈值的小文件不压缩（避免"越压越大"）
    const tiny = await rawGet('/tiny.txt', { 'Accept-Encoding': 'br' });
    assert.equal(tiny.headers['content-encoding'], undefined);
    assert.equal(tiny.body.toString('utf8'), 'ok\n');

    // 6) 不可压缩类型（二进制）即使声明支持 br 也不压缩
    const bin = await rawGet('/blob.bin', { 'Accept-Encoding': 'br' });
    assert.equal(bin.headers['content-encoding'], undefined);
    assert.equal(bin.body.length, 4096);

    // 7) 压缩与 ETag/304 协商共存：带 If-None-Match 时应 304 且无 body
    const etag = br.headers['etag'];
    assert.ok(etag, '应下发 ETag');
    const cached = await rawGet('/report-validation-data.json', { 'Accept-Encoding': 'br', 'If-None-Match': etag });
    assert.equal(cached.status, 304);
    assert.equal(cached.body.length, 0, '304 不应带 body');

    // 8) 按 ETag 缓存：重复请求字节一致（缓存命中不会改变行为）
    const again = await rawGet('/report-validation-data.json', { 'Accept-Encoding': 'br' });
    assert.equal(again.headers['content-encoding'], 'br');
    assert.ok(again.body.equals(br.body), '同一 ETag 的压缩结果应稳定（可缓存）');
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('压缩策略注解：brotli 质量取自实测拐点 q9，并覆盖可压缩类型清单', () => {
  const srv = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');
  assert.match(srv, /const BROTLI_QUALITY = 9;/, 'brotli 质量应为实测拐点 9（q11 快 100 倍只大 13%）');
  assert.match(srv, /const COMPRESS_MIN_BYTES = 1024;/, '低于阈值不压缩');
  assert.match(srv, /const COMPRESS_CACHE_MAX = 32;/, '压缩结果按 ETag 缓存，且有上限');
  assert.match(srv, /zlib\.constants\.BROTLI_PARAM_QUALITY/, '应显式传质量参数（默认 q11 太慢）');
  assert.match(srv, /const COMPRESSIBLE = \{ '\.html': 1, '\.css': 1, '\.js': 1, '\.mjs': 1, '\.json': 1, '\.svg': 1, '\.txt': 1 \};/,
    '可压缩类型应显式列白名单');
  assert.match(srv, /function pickEncoding\(acceptEncoding\)/, '应有独立的编码选择函数（br > gzip，尊重 q=0）');
  assert.match(srv, /headers\['Vary'\] = 'Accept-Encoding';/, '无论是否压缩都要下发 Vary');
});
