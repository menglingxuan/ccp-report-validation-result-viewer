// 多文件模式（mode: "multi"）端到端冒烟验证。
//
// 做三件事：
//   1) 造一个临时 web 根：主清单 + 默认模板清单 + data/items/*.json，
//      外加一个「单文件批次」与一个「多文件批次」，并用 lib/scanner.js 生成批次索引；
//   2) 以 REPORT_VIEWER_WEBROOT 指向该临时根启动 server.js（随机端口，不污染真实数据）；
//   3) 用 HTTP 断言：清单结构、每个 item 文件可按「相对清单目录」加载、默认模板清单存在、
//      批次目录清单的相对路径解析、索引不含 dataMode/cwd、单文件/多文件批次可共存、
//      descriptionEx 只通过 metaUrl 懒加载（索引不含正文）。
//
// 说明：本脚本只做 HTTP 层验证（不依赖浏览器/Playwright）。查看器内部的懒加载/侧栏摘要回退
// 已由 test/sample-multi.test.js 与 docs/DATA_SCHEMA.md 描述；需要人工复核时用 --keep 保留目录。
//
//   node tools/verify-multi-mode.mjs              # 随机端口；跑完自动清理
//   node tools/verify-multi-mode.mjs --keep       # 保留临时目录并打印手工浏览命令
//   node tools/verify-multi-mode.mjs --port 8140  # 指定端口
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDataset, splitToFiles } from '../lib/sample-data.js';
import { validateDataset } from '../lib/validate.js';
import { scan } from '../lib/scanner.js';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.dirname(TOOLS_DIR);
const PUBLIC_DIR = path.join(SRC_ROOT, 'public');
const SERVER_JS = path.join(SRC_ROOT, 'server.js');

const argv = process.argv.slice(2);
const keep = argv.includes('--keep');
const port = argv.includes('--port') ? String(argv[argv.indexOf('--port') + 1]) : '0';

// 生成的数据文件（不复制 public/ 的样例数据，避免误覆盖真实样例）。
const GENERATED_DATA = new Set([
  'report-validation-data.json',
  'report-validation-data-default.json',
  'report-validation-data-init.json',
  'ignore-config-by-platform.json',
  'batches-index.json',
  'favorites.json',
]);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? '  ✔ ' : '  ✖ ') + name + (ok || !detail ? '' : ' -> ' + detail));
}

function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

// 复制静态资源（index.html / app.js / core.js / i18n.json / worker.js / themes.css / 配置 schema…）。
function copyStaticAssets(root) {
  for (const ent of fs.readdirSync(PUBLIC_DIR, { withFileTypes: true })) {
    if (ent.isDirectory()) continue;                    // batches/ 等目录由本脚本自造
    if (GENERATED_DATA.has(ent.name)) continue;         // 数据文件由本脚本生成
    fs.copyFileSync(path.join(PUBLIC_DIR, ent.name), path.join(root, ent.name));
  }
}

function batchMeta(id, items, dataset) {
  return {
    batchId: id,
    batchName: id,
    date: '2026-08-16',
    executedAt: '2026-08-16T10:00:00+08:00',
    formatVersion: 2,
    creationType: 'sample',
    dataUrl: 'report-validation-data.json',
    ignoreUrl: 'ignore-config-by-platform.json',
    summary: { items },
    reportEnv: dataset.reportEnv,
    // 「任务说明」扩展内容（只读，懒加载）：验证 index.metaUrl 可取且内容完整。
    descriptionEx: {
      contentType: 'markDownTable',
      plainContent: '| 序号 | 检查项 |\n| ---: | --- |\n| 1 | 数据接入完整性 |\n| 2 | 字段映射校验 |\n',
    },
  };
}

async function get(url) {
  const r = await fetch(url);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON（html/js） */ }
  return { status: r.status, text, json };
}
const getJSON = (url) => get(url);

async function post(url, body, headers) {
  const r = await fetch(url, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 忽略 */ }
  return { status: r.status, text, json };
}

// 启动 server.js 并从日志中解析实际监听地址（port=0 时由 OS 分配）。
function startServer(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_JS, '--config', 'test', '--port', port, '--no-audit'], {
      cwd: SRC_ROOT,
      env: Object.assign({}, process.env, { REPORT_VIEWER_WEBROOT: root }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('服务器启动超时（30s）：\n' + log));
    }, 30000);
    const onData = (buf) => {
      log += String(buf);
      const m = log.match(/Started: (http:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve({ child, base: m[1].replace(/\/$/, ''), log: () => log });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (code) => {
      if (!log.includes('Started: ')) {
        clearTimeout(timer);
        reject(new Error('服务器退出（code=' + code + '）：\n' + log));
      }
    });
  });
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-multi-verify-'));
  console.log('临时 web 根：' + root);

  // ---------- 1. 造数据 ----------
  copyStaticAssets(root);
  const dataset = buildDataset();
  splitToFiles(dataset, root);
  splitToFiles(dataset, root, 'report-validation-data-default.json');
  writeJSON(path.join(root, 'report-validation-data-init.json'),
    { mode: 'single', reportEnv: dataset.reportEnv, creationType: 'sample', items: [] });
  fs.writeFileSync(path.join(root, 'ignore-config-by-platform.json'), '{}\n', 'utf8');

  const slice = Object.assign({}, dataset, { items: dataset.items.slice(0, 2) });
  const singleBatchDir = path.join(root, 'batches', '2026-08-16', 'batch-verify-single');
  writeJSON(path.join(singleBatchDir, 'report-validation-data.json'),
    { mode: 'single', reportEnv: dataset.reportEnv, creationType: 'sample', items: slice.items });
  writeJSON(path.join(singleBatchDir, 'batch-meta.json'), batchMeta('batch-verify-single', slice.items.length, dataset));

  const multiBatchDir = path.join(root, 'batches', '2026-08-16', 'batch-verify-multi');
  splitToFiles(slice, multiBatchDir);
  writeJSON(path.join(multiBatchDir, 'batch-meta.json'), batchMeta('batch-verify-multi', slice.items.length, dataset));

  const scanRes = await scan({
    basedir: path.join(root, 'batches'),
    out: path.join(root, 'batches-index.json'),
    ignore: [],
    env: null,
  });
  check('离线扫描临时批次目录成功', scanRes.ok === true && scanRes.count === 2, scanRes.error || String(scanRes.count));

  // ---------- 2. 起服务 + 3. HTTP 断言 ----------
  let running = null;
  try {
    running = await startServer(root);
    const base = running.base;

    const page = await get(base + '/');
    check('GET / 返回查看器页面', page.status === 200 && page.text.includes('id="itemCount"'), 'status=' + page.status);

    const cfg = await getJSON(base + '/config.json');
    check('config.json: urls.data 指向主清单', cfg.json && cfg.json.urls && cfg.json.urls.data === 'report-validation-data.json');
    check('config.json: features.revealPath 已注入', !!(cfg.json && cfg.json.features && typeof cfg.json.features.revealPath === 'boolean'));

    const manifestUrl = base + '/report-validation-data.json';
    const manifest = await getJSON(manifestUrl);
    const mItems = (manifest.json && manifest.json.items) || [];
    check('主清单 mode == multi', manifest.json && manifest.json.mode === 'multi');
    check('主清单 items 数量 == ' + dataset.items.length, mItems.length === dataset.items.length, String(mItems.length));
    const validated = validateDataset(manifest.json);
    check('主清单通过 lib/validate.js 校验', validated.ok === true, JSON.stringify(validated.errors));
    check('清单条目均带 file + 预计算 summary（懒加载前侧栏计数回退）',
      mItems.length > 0 && mItems.every((i) => typeof i.file === 'string' && i.summary && typeof i.summary.total === 'number'));
    // 顶层字段：多文件清单与单文件数据集的顶层字段一致（mode / reportEnv / creationType / skippedItems）。
    check('主清单保留 creationType == ' + dataset.creationType,
      manifest.json && manifest.json.creationType === dataset.creationType, String(manifest.json && manifest.json.creationType));
    check('主清单保留 skippedItems（与数据集一致）',
      manifest.json && Array.isArray(manifest.json.skippedItems)
      && manifest.json.skippedItems.length === (dataset.skippedItems || []).length,
      JSON.stringify(manifest.json && manifest.json.skippedItems && manifest.json.skippedItems.length));

    // 每个 item 文件都按「相对清单文件所在目录」解析（与 app.js resolveUrl(DATA_FILE_URL, item.file) 一致）
    const badItems = [];
    for (const it of mItems) {
      const r = await getJSON(new URL(it.file, manifestUrl).href);
      if (r.status !== 200 || !r.json || r.json.tradeId !== it.tradeId
          || !Array.isArray(r.json.channels) || r.json.channels.length === 0
          || !r.json.ctxDefs) badItems.push(it.tradeId);
    }
    check('全部 ' + mItems.length + ' 个 item 文件可懒加载（含 channels/ctxDefs）', badItems.length === 0, badItems.join(','));

    // 默认模板清单：multi 模式下同样必须是清单（回归点）
    const def = await getJSON(base + '/report-validation-data-default.json');
    check('默认模板数据存在且 mode == multi', def.status === 200 && def.json && def.json.mode === 'multi', 'status=' + def.status);
    check('默认模板清单保留 creationType / skippedItems',
      !!def.json && def.json.creationType === dataset.creationType
      && Array.isArray(def.json.skippedItems)
      && def.json.skippedItems.length === (dataset.skippedItems || []).length,
      JSON.stringify(def.json && { c: def.json.creationType, s: def.json.skippedItems && def.json.skippedItems.length }));
    const defFirst = def.json && def.json.items && def.json.items[0];
    if (defFirst) {
      const r = await getJSON(new URL(defFirst.file, base + '/report-validation-data-default.json').href);
      check('默认模板清单引用的 item 文件可解析', r.status === 200 && r.json && r.json.tradeId === defFirst.tradeId);
    } else {
      check('默认模板清单引用的 item 文件可解析', false, 'items 为空');
    }

    // 服务端扫描 + 索引
    const scanApi = await post(base + '/scan');
    check('POST /scan 成功', scanApi.status === 200 && scanApi.json && scanApi.json.ok === true, scanApi.text.slice(0, 120));
    const idxUrl = base + '/batches-index.json';
    const idx = await getJSON(idxUrl);
    const entries = (idx.json && idx.json.batches) || [];
    const ids = entries.map((b) => b.batchId);
    check('索引含两个验证批次（单文件 + 多文件共存）',
      ids.indexOf('batch-verify-single') !== -1 && ids.indexOf('batch-verify-multi') !== -1, ids.join(','));
    check('索引不写 dataMode / cwd（与 lib/scanner.js 一致）',
      entries.length > 0 && entries.every((b) => !('dataMode' in b) && !('cwd' in b)));

    const mEntry = entries.find((b) => b.batchId === 'batch-verify-multi');
    const sEntry = entries.find((b) => b.batchId === 'batch-verify-single');
    if (mEntry && sEntry) {
      // 查看器用 resolveUrl(indexBaseUrl(), entry.dataUrl) 解析批次数据文件
      const batchManifestUrl = new URL(mEntry.dataUrl, idxUrl).href;
      const bm = await getJSON(batchManifestUrl);
      check('多文件批次清单 mode == multi', bm.status === 200 && bm.json && bm.json.mode === 'multi', 'status=' + bm.status + ' url=' + batchManifestUrl);
      check('多文件批次清单保留 creationType / skippedItems（与源数据集一致）',
        !!bm.json && bm.json.creationType === slice.creationType
        && Array.isArray(bm.json.skippedItems)
        && bm.json.skippedItems.length === (slice.skippedItems || []).length,
        JSON.stringify(bm.json && { c: bm.json.creationType, s: bm.json.skippedItems && bm.json.skippedItems.length }));
      check('多文件批次索引 creationType 与清单/元数据一致', mEntry.creationType === slice.creationType, String(mEntry.creationType));
      const bFirst = bm.json && bm.json.items && bm.json.items[0];
      if (bFirst) {
        const itemUrl = new URL(bFirst.file, batchManifestUrl).href;
        const bitem = await getJSON(itemUrl);
        check('批次 item 文件按「相对批次清单」解析可加载',
          bitem.status === 200 && bitem.json && bitem.json.tradeId === bFirst.tradeId
            && Array.isArray(bitem.json.channels) && bitem.json.channels.length > 0, itemUrl);
      } else {
        check('批次 item 文件按「相对批次清单」解析可加载', false, 'items 为空');
      }
      const sm = await getJSON(new URL(sEntry.dataUrl, idxUrl).href);
      check('单文件批次数据仍为 mode=single（两种模式共存）',
        sm.status === 200 && sm.json && sm.json.mode !== 'multi' && Array.isArray(sm.json.items), 'status=' + sm.status);

      // descriptionEx：索引只带 metaUrl（不含内容），查看器按 metaUrl 懒加载 batch-meta.json。
      check('索引条目带 metaUrl 且不含 descriptionEx 正文',
        typeof mEntry.metaUrl === 'string' && !('descriptionEx' in mEntry) && !JSON.stringify(entries).includes('检查项'),
        String(mEntry.metaUrl));
      const metaUrl = new URL(mEntry.metaUrl, idxUrl).href;
      const metaRes = await getJSON(metaUrl);
      const ex = metaRes.json && metaRes.json.descriptionEx;
      check('metaUrl 可取且 descriptionEx 内容可读（markDownTable）',
        metaRes.status === 200 && !!ex && ex.contentType === 'markDownTable'
          && ex.plainContent.indexOf('| 序号 | 检查项 |') === 0, 'status=' + metaRes.status + ' url=' + metaUrl);
    } else {
      check('多文件批次清单 mode == multi', false, '索引缺少 batch-verify-multi');
      check('批次 item 文件按「相对批次清单」解析可加载', false, '索引缺少 batch-verify-multi');
      check('单文件批次数据仍为 mode=single（两种模式共存）', false, '索引缺少 batch-verify-single');
      check('索引条目带 metaUrl 且不含 descriptionEx 正文', false, '索引缺少 batch-verify-multi');
      check('metaUrl 可取且 descriptionEx 内容可读（markDownTable）', false, '索引缺少 batch-verify-multi');
    }

    if (keep) {
      console.log('\n--keep：临时目录保留在 ' + root);
      console.log('手工复核：REPORT_VIEWER_WEBROOT="' + root + '" node server.js --config test --port 8140');
      console.log('         然后打开 ' + base.replace(/:\d+$/, ':8140') + '/');
    }
  } finally {
    if (running && running.child) running.child.kill();
    if (!keep) {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { /* Windows 文件占用时忽略 */ }
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n结果：' + (results.length - failed.length) + '/' + results.length + ' 通过'
    + (failed.length ? '，失败 ' + failed.length + ' 项' : ''));
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('验证失败：' + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
