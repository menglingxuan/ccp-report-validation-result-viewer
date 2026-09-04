// 服务集成测试：以子进程启动 server.js，验证静态站点 + 扫描 API。
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 20000 + Math.floor(Math.random() * 10000);

function startServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: SRC,
    env: Object.assign({}, process.env, { REPORT_VIEWER_PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server start timeout')), 10000);
    child.stdout.on('data', (d) => {
      out += String(d);
      if (out.includes('已启动')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr.on('data', (d) => { out += String(d); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

test('服务器：静态站点、配置与扫描 API', async () => {
  const child = await startServer();
  try {
    const base = `http://127.0.0.1:${PORT}`;

    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    assert.ok((await home.text()).includes('<script type="module"'));

    const cfgRes = await fetch(base + '/config.json');
    assert.equal(cfgRes.status, 200);
    const cfg = await cfgRes.json();
    assert.ok(cfg.urls && typeof cfg.urls.data === 'string');

    const status = await fetch(base + '/status');
    assert.equal(status.status, 200);
    const st = await status.json();
    assert.equal(st.ok, true);

    const scanRes = await fetch(base + '/scan', { method: 'POST' });
    assert.equal(scanRes.status, 200);
    const scanBody = await scanRes.json();
    assert.equal(scanBody.ok, true);
    assert.ok(scanBody.count >= 0);
  } finally {
    child.kill();
  }
});
