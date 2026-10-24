// 数据根隔离回归测试（--data-root / REPORT_VIEWER_DATA_ROOT，未开租户）：
//   两个实例共享同一 web 根、各自持有不同数据根时，浏览器必须从**自己的数据根**读取批次索引与批次数据，
//   不能静默回退到 web 根（public/batches）里的共享样例。
// 回归点：/scan 写出的索引在数据根里是对的，但旧实现只把 urls.batches 改写为 /tenant/（仅租户模式），
//         于是 --data-root 实例的浏览器去 web 根取 batches-index.json，显示了别的批次数据。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 20000 + Math.floor(Math.random() * 10000);
const randPort = () => 20000 + Math.floor(Math.random() * 10000);

function startServer(extraEnv, port) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: SRC,
    env: Object.assign({}, process.env, { REPORT_VIEWER_PORT: String(port || PORT), REPORT_VIEWER_AUDIT: '0' }, extraEnv || {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout: ' + out)), 10000);
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

// 造一个最小批次目录（batch-meta + 单文件数据集），数据集复用仓库样例以便通过校验。
function makeBatch(dir, batchId, batchName) {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(SRC, 'public', 'report-validation-data.json'),
    path.join(dir, 'report-validation-data.json'));
  fs.writeFileSync(path.join(dir, 'batch-meta.json'), JSON.stringify({
    batchId,
    batchName,
    date: '2026-02-02',
    executedAt: '2026-02-02T00:00:00+08:00',
    formatVersion: 3,
    dataUrl: 'report-validation-data.json',
    summary: { items: 18, channels: 3 },
  }, null, 2));
}

test('数据根隔离：--data-root 实例的浏览器从数据根（/data-root/）读取索引与批次数据', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-dataroot-'));
  const webRoot = path.join(tmp, 'web');
  const dataRoot = path.join(tmp, 'data');
  fs.mkdirSync(webRoot, { recursive: true });
  // web 根**故意不放** batches-index.json / batches，模拟「共享 web 根 ↔ 独立数据根」
  makeBatch(path.join(dataRoot, 'batches', '2026-02-02', 'only-in-data-root'), 'only-in-data-root', 'DATA-ROOT-ONLY');
  fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>t</title>');

  const child = await startServer({
    REPORT_VIEWER_WEBROOT: webRoot,
    REPORT_VIEWER_DATA_ROOT: dataRoot,
  });
  try {
    const base = `http://127.0.0.1:${PORT}`;

    // 1) 配置下发：批次索引与忽略配置指向 /data-root/（不是 web 根）
    const cfg = await (await fetch(base + '/config.json')).json();
    assert.equal(cfg.urls.batches, '/data-root/', '数据根独立时 urls.batches 必须指向 /data-root/');
    assert.match(String(cfg.urls.ignore), /^\/data-root\//, '忽略配置同样指向数据根路由');
    assert.deepEqual(cfg.tenant, { enabled: false, id: null }, '--data-root 不等于开启租户模式');

    // 2) 扫描写进数据根
    const scan = await fetch(base + '/scan', { method: 'POST' });
    assert.equal(scan.status, 200);
    const scanBody = await scan.json();
    assert.equal(scanBody.count, 1, '数据根下应扫到 1 个批次');

    // 3) /data-root/ -> 数据根的索引（含 only-in-data-root）
    const idx = await fetch(base + '/data-root/');
    assert.equal(idx.status, 200);
    const index = await idx.json();
    assert.deepEqual(index.batches.map((b) => b.batchId), ['only-in-data-root'], '索引必须来自数据根');
    const dataUrl = index.batches[0].dataUrl;

    // 4) 批次数据按索引基准（/data-root/ + dataUrl）可读取
    const batchData = await fetch(base + '/data-root/' + dataUrl);
    assert.equal(batchData.status, 200);
    assert.equal((await batchData.json()).items.length, 18);

    // 5) 关键回归：数据根里不存在的批次路径**不得**回退到 web 根（否则会读到别的实例的数据）
    const missing = await fetch(base + '/data-root/batches/2026-01-01/not-exist/report-validation-data.json');
    assert.equal(missing.status, 404, '/data-root/ 下的缺失批次必须 404，不能回退到 web 根');

    // 6) web 根本身没有索引：浏览器若仍去 web 根取，会 404（证明修复前确实是「读到共享样例」）
    const webIndex = await fetch(base + '/batches-index.json');
    assert.equal(webIndex.status, 404, 'web 根下不应再有可用的 batches-index.json');

    // 7) 忽略配置回写也落在本实例的数据根（/data-root/ 前缀自动剥离），不会写到 web 根或其它实例
    const ignoreCfg = { P: { warnings: [{ channel: 'C', source: 'S', type: 't', level: 'WARN', field: 'f' }], uncomparedXpaths: [], uncomparedCsvs: [] } };
    const w = await fetch(base + '/api/ignore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: '/data-root/ignore-config-by-platform.json', config: ignoreCfg }),
    });
    assert.equal(w.status, 200, '忽略配置应可写回数据根');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataRoot, 'ignore-config-by-platform.json'), 'utf8')), ignoreCfg,
      '回写目标必须是数据根里的忽略配置文件');
  } finally {
    child.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 Windows 占用 */ }
  }
});

test('数据根隔离：忽略配置在数据根缺失时回退共享默认文件（仅限 ignore）', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-dataroot-ignore-'));
  const webRoot = path.join(tmp, 'web');
  const dataRoot = path.join(tmp, 'data');
  fs.mkdirSync(webRoot, { recursive: true });
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(path.join(webRoot, 'ignore-config-by-platform.json'),
    JSON.stringify({ shared: { warnings: [], uncomparedXpaths: [], uncomparedCsvs: [] } }));

  // REPORT_VIEWER_BASEDIR 显式覆盖时服务端不会自动初始化数据根（否则会生成空的 ignore 文件，测不到回退）
  const child = await startServer({
    REPORT_VIEWER_WEBROOT: webRoot,
    REPORT_VIEWER_DATA_ROOT: dataRoot,
    REPORT_VIEWER_BASEDIR: path.join(dataRoot, 'batches'),
  });
  try {
    const base = `http://127.0.0.1:${PORT}`;
    const cfg = await (await fetch(base + '/config.json')).json();
    const shared = await fetch(base + cfg.urls.ignore);
    assert.equal(shared.status, 200, '数据根无忽略配置时应回退到共享默认文件');
    assert.ok(Object.prototype.hasOwnProperty.call(await shared.json(), 'shared'));
  } finally {
    child.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 Windows 占用 */ }
  }
});

test('非租户共享模式（无 --data-root）：行为不变，索引与批次数据都在 web 根', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-shared-'));
  const webRoot = path.join(tmp, 'web');
  fs.mkdirSync(webRoot, { recursive: true });
  makeBatch(path.join(webRoot, 'batches', '2026-03-03', 'shared-only'), 'shared-only', 'SHARED-ONLY');

  const child = await startServer({ REPORT_VIEWER_WEBROOT: webRoot });
  try {
    const base = `http://127.0.0.1:${PORT}`;
    const cfg = await (await fetch(base + '/config.json')).json();
    assert.equal(cfg.urls.batches, 'batches-index.json', '共享模式不改写 urls.batches（仍相对 web 根）');
    assert.deepEqual(cfg.tenant, { enabled: false, id: null });

    assert.equal((await (await fetch(base + '/scan', { method: 'POST' })).json()).count, 1);

    // 索引与批次数据都从 web 根取
    const idx = await (await fetch(base + '/batches-index.json')).json();
    assert.deepEqual(idx.batches.map((b) => b.batchId), ['shared-only']);
    const dataUrl = idx.batches[0].dataUrl;
    assert.equal((await fetch(base + '/' + dataUrl)).status, 200);
    assert.ok(fs.existsSync(path.join(webRoot, 'batches-index.json')), '索引写在 web 根');

    // /data-root/ 是数据根路由的别名：共享模式下数据根==web 根，读到的仍是同一份（不会改变原路径行为）
    const alias = await (await fetch(base + '/data-root/')).json();
    assert.deepEqual(alias.batches.map((b) => b.batchId), ['shared-only']);
  } finally {
    child.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 Windows 占用 */ }
  }
});

test('混合模式：租户实例与共享实例并发启动，彼此看不到对方的批次', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-mixed-'));
  const webRoot = path.join(tmp, 'web');
  const tenantRoot = path.join(tmp, 'tenant-alice');
  fs.mkdirSync(webRoot, { recursive: true });
  makeBatch(path.join(webRoot, 'batches', '2026-04-04', 'shared-batch'), 'shared-batch', 'SHARED-BATCH');
  makeBatch(path.join(tenantRoot, 'batches', '2026-05-05', 'tenant-batch'), 'tenant-batch', 'TENANT-BATCH');

  const portTenant = randPort();
  const portShared = randPort();
  const tenant = await startServer({
    REPORT_VIEWER_WEBROOT: webRoot,
    REPORT_VIEWER_TENANT: 'alice',
    REPORT_VIEWER_DATA_ROOT: tenantRoot,
  }, portTenant);
  const shared = await startServer({ REPORT_VIEWER_WEBROOT: webRoot }, portShared);
  const tBase = `http://127.0.0.1:${portTenant}`;
  const sBase = `http://127.0.0.1:${portShared}`;
  try {
    // 1) 两个实例各自的路由前缀
    assert.equal((await (await fetch(tBase + '/config.json')).json()).urls.batches, '/tenant/');
    assert.equal((await (await fetch(sBase + '/config.json')).json()).urls.batches, 'batches-index.json');

    // 2) 租户实例扫描：只写租户数据根，不碰 web 根索引
    assert.equal((await (await fetch(tBase + '/scan', { method: 'POST' })).json()).count, 1);
    const tIdx = await (await fetch(tBase + '/tenant/')).json();
    assert.deepEqual(tIdx.batches.map((b) => b.batchId), ['tenant-batch']);
    assert.equal(fs.existsSync(path.join(webRoot, 'batches-index.json')), false,
      '租户实例的扫描不得在 web 根生成索引（共享实例的数据不受影响）');
    assert.equal((await fetch(tBase + '/tenant/' + tIdx.batches[0].dataUrl)).status, 200,
      '租户批次数据从租户数据根读取');

    // 3) 共享实例扫描：只写 web 根
    assert.equal((await (await fetch(sBase + '/scan', { method: 'POST' })).json()).count, 1);
    const sIdx = await (await fetch(sBase + '/batches-index.json')).json();
    assert.deepEqual(sIdx.batches.map((b) => b.batchId), ['shared-batch']);

    // 4) 交叉校验：两边索引互不含对方批次；租户路由不得回退读到共享批次
    assert.deepEqual((await (await fetch(tBase + '/tenant/')).json()).batches.map((b) => b.batchId), ['tenant-batch'],
      '共享实例扫描后，租户索引仍只含自己的批次');
    assert.equal((await fetch(tBase + '/tenant/batches/2026-04-04/shared-batch/report-validation-data.json')).status, 404,
      '租户侧不得回退读取 web 根（共享）批次数据');
    assert.equal((await fetch(sBase + '/batches/2026-05-05/tenant-batch/report-validation-data.json')).status, 404,
      '共享侧看不到租户数据根里的批次');
  } finally {
    tenant.kill();
    shared.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 Windows 占用 */ }
  }
});

test('两个 --data-root 实例并发（共用同一 web 根）：各自只看到自己数据根里的批次', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-two-roots-'));
  const webRoot = path.join(tmp, 'web');
  const rootA = path.join(tmp, 'root-a');
  const rootB = path.join(tmp, 'root-b');
  fs.mkdirSync(webRoot, { recursive: true });
  makeBatch(path.join(rootA, 'batches', '2026-06-06', 'alpha-only'), 'alpha-only', 'ROOT-A');
  makeBatch(path.join(rootB, 'batches', '2026-07-07', 'beta-only'), 'beta-only', 'ROOT-B');

  const portA = randPort();
  const portB = randPort();
  const a = await startServer({ REPORT_VIEWER_WEBROOT: webRoot, REPORT_VIEWER_DATA_ROOT: rootA }, portA);
  const b = await startServer({ REPORT_VIEWER_WEBROOT: webRoot, REPORT_VIEWER_DATA_ROOT: rootB }, portB);
  const aBase = `http://127.0.0.1:${portA}`;
  const bBase = `http://127.0.0.1:${portB}`;
  try {
    assert.equal((await (await fetch(aBase + '/config.json')).json()).urls.batches, '/data-root/');
    assert.equal((await (await fetch(bBase + '/config.json')).json()).urls.batches, '/data-root/');

    assert.equal((await (await fetch(aBase + '/scan', { method: 'POST' })).json()).count, 1);
    assert.equal((await (await fetch(bBase + '/scan', { method: 'POST' })).json()).count, 1);

    const aIdx = await (await fetch(aBase + '/data-root/')).json();
    const bIdx = await (await fetch(bBase + '/data-root/')).json();
    assert.deepEqual(aIdx.batches.map((x) => x.batchId), ['alpha-only'], 'A 只看到 root-a 的批次');
    assert.deepEqual(bIdx.batches.map((x) => x.batchId), ['beta-only'], 'B 只看到 root-b 的批次');

    // 各自批次数据可读，且互不可见
    assert.equal((await fetch(aBase + '/data-root/' + aIdx.batches[0].dataUrl)).status, 200);
    assert.equal((await fetch(bBase + '/data-root/' + bIdx.batches[0].dataUrl)).status, 200);
    assert.equal((await fetch(aBase + '/data-root/batches/2026-07-07/beta-only/report-validation-data.json')).status, 404,
      'A 不能读到 B 数据根里的批次');
    assert.equal((await fetch(bBase + '/data-root/batches/2026-06-06/alpha-only/report-validation-data.json')).status, 404,
      'B 不能读到 A 数据根里的批次');

    // 两个实例都没有在 web 根写入索引（共用 web 根保持干净）
    assert.equal(fs.existsSync(path.join(webRoot, 'batches-index.json')), false,
      '数据根独立时不得在共用 web 根写索引');
  } finally {
    a.kill();
    b.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 忽略 Windows 占用 */ }
  }
});
