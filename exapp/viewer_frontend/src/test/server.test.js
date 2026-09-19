// 服务集成测试：以子进程启动 server.js，验证静态站点 + 扫描 API。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

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
    const timer = setTimeout(() => reject(new Error('server start timeout')), 10000);
    child.stdout.on('data', (d) => {
      out += String(d);
      if (out.includes('Started:')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', (d) => { out += String(d); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

test('服务器：静态站点、配置与扫描 API', async () => {
  // 隔离扫描目录：避免测试污染 tracked 的 public/batches 与 batches-index.json。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-srv-'));
  const child = await startServer({
    REPORT_VIEWER_BASEDIR: tmp,
    REPORT_VIEWER_OUT: path.join(tmp, 'batches-index.json'),
  });
  try {
    const base = `http://127.0.0.1:${PORT}`;

    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    assert.ok((await home.text()).includes('<script type="module"'));

    const cfgRes = await fetch(base + '/config.json');
    assert.equal(cfgRes.status, 200);
    const cfg = await cfgRes.json();
    assert.ok(cfg.urls && typeof cfg.urls.data === 'string');
    assert.equal(typeof cfg.features.revealPath, 'boolean', 'config.json 应下发 features.revealPath 的有效值');

    const status = await fetch(base + '/status');
    assert.equal(status.status, 200);
    const st = await status.json();
    assert.equal(st.ok, true);

    const scanRes = await fetch(base + '/scan', { method: 'POST' });
    assert.equal(scanRes.status, 200);
    const scanBody = await scanRes.json();
    assert.equal(scanBody.ok, true);
    assert.ok(scanBody.count >= 0);

    // 批次标签回写：POST /api/batch { tags } -> 写入 batch-meta.json（去空白 / 去重）
    const batchDir = path.join(tmp, '2026-09-19', 'b-tags');
    fs.mkdirSync(batchDir, { recursive: true });
    fs.writeFileSync(path.join(batchDir, 'batch-meta.json'), JSON.stringify({ batchId: 'b-tags', batchName: 'b-tags', date: '2026-09-19', executedAt: '2026-09-19T00:00:00+08:00', summary: { items: 1 } }), 'utf8');
    fs.writeFileSync(path.join(batchDir, 'report-validation-data.json'), JSON.stringify({ mode: 'single', reportEnv: 'OTCXXX', items: [{ tradeId: 'T-1', reportDate: '2026-09-19', channels: [] }] }), 'utf8');
    await fetch(base + '/scan', { method: 'POST' });

    const metaFile = path.join(batchDir, 'batch-meta.json');
    const tagRes = await fetch(base + '/api/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchId: 'b-tags', tags: [' 回归 ', '回归', '', 'v2'] }) });
    assert.equal(tagRes.status, 200);
    assert.deepEqual((await tagRes.json()).tags, ['回归', 'v2'], '返回清洗后的标签');
    assert.deepEqual(JSON.parse(fs.readFileSync(metaFile, 'utf8')).tags, ['回归', 'v2'], '应回写元数据');
    const idx = JSON.parse(fs.readFileSync(path.join(tmp, 'batches-index.json'), 'utf8'));
    assert.deepEqual(idx.batches.find((b) => b.batchId === 'b-tags').tags, ['回归', 'v2'], '写回后索引应立即重建并带上 tags');

    const clearRes = await fetch(base + '/api/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchId: 'b-tags', tags: [] }) });
    assert.equal(clearRes.status, 200);
    assert.deepEqual((await clearRes.json()).tags, [], '空数组表示清除标签');
    assert.equal(JSON.parse(fs.readFileSync(metaFile, 'utf8')).tags, undefined, '清除后元数据不应残留 tags');

    // 批次名 / 描述回写（批次名允许重复：重名仅前端告警，服务端不拦截）
    const nameRes = await fetch(base + '/api/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchId: 'b-tags', batchName: '  重命名批次  ', description: '第一行\r\n第二行' }) });
    assert.equal(nameRes.status, 200);
    const nameBody = await nameRes.json();
    assert.equal(nameBody.batchName, '重命名批次', '批次名应去除首尾空白');
    assert.equal(nameBody.description, '第一行\n第二行', '描述换行应统一为 \\n');
    const meta2 = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    assert.equal(meta2.batchName, '重命名批次', '应回写 batchName');
    assert.equal(meta2.description, '第一行\n第二行', '应回写 description');

    const emptyName = await fetch(base + '/api/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchId: 'b-tags', batchName: '   ' }) });
    assert.equal(emptyName.status, 400, '空批次名应被拒绝');

    const clearDesc = await fetch(base + '/api/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchId: 'b-tags', description: '' }) });
    assert.equal(clearDesc.status, 200);
    assert.equal(JSON.parse(fs.readFileSync(metaFile, 'utf8')).description, undefined, '空描述应清除字段');

    // 回归：元数据写回后索引必须立即重建，否则刷新页面会读到旧值
    // （典型症状：收藏某批次后刷新，收藏标记消失）。
    const favRes = await fetch(base + '/api/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchId: 'b-tags', favorite: true }) });
    assert.equal(favRes.status, 200);
    const idxEntry = JSON.parse(fs.readFileSync(path.join(tmp, 'batches-index.json'), 'utf8')).batches.find((b) => b.batchId === 'b-tags');
    assert.equal(idxEntry.favorite, true, '写回收藏后索引应立即可见 favorite');
    assert.equal(idxEntry.batchName, '重命名批次', '写回批次名后索引应立即可见新值');
    assert.equal(idxEntry.tags, undefined, '清除标签后索引应立即可见');

    // 打开目录接口：拒绝批次根目录之外的路径（不触发真实打开行为）
    const revealRes = await fetch(base + '/api/reveal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: os.tmpdir() }) });
    assert.equal(revealRes.status, 403, '批次目录之外的路径应被拒绝');
    const revealBad = await fetch(base + '/api/reveal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    assert.equal(revealBad.status, 400, '缺少 path 应返回 400');
  } finally {
    child.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }
});
