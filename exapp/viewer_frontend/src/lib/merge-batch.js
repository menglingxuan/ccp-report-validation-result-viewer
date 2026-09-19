// 批次模式转换核心：把「多文件模式」批次（清单 + 每 item 一个文件）合并为「单文件模式」批次。
//
// 多文件清单结构（见 docs/DATA_SCHEMA.md，与 lib/sample-data.js 的 splitToFiles 互为逆操作）：
//   { mode: 'multi', reportEnv, creationType, skippedItems, items: [{ tradeId, file: 'data/items/x.json', summary, ... }] }
// 合并后：
//   { mode: 'single', reportEnv, creationType, skippedItems, items: [ <item 文件完整内容>, ... ] }
// 说明：
//   - item 文件的 `file` 相对**清单所在目录**（即批次目录）解析；
//   - 清单里除 `mode` / `items` 之外的顶层字段原样保留；
//   - item 顺序与清单一致；清单里的展示用字段（file / summary 等）不会写进合并结果；
//   - 本模块不做任何写入以外的事情（写文件由调用方通过 opts 控制），便于单独测试。
import fs from 'node:fs';
import path from 'node:path';
import { validateDataset } from './validate.js';

// 默认的清单/输出文件名（与 config.urls.data 一致）。
export const DEFAULT_MANIFEST_NAME = 'report-validation-data.json';

// 备份后缀：合并会覆盖清单本身，因此默认先留一份多文件清单备份，便于回退（item 文件不会被删除）。
export const BACKUP_SUFFIX = '.multi.bak';

function readJSON(file) {
  // 兼容带 BOM 的文件（部分 Windows 工具会写入 UTF-8 BOM）。
  let raw = fs.readFileSync(file, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  return JSON.parse(raw);
}

// 在批次目录中找出清单文件：
//   1) 显式传入的 manifestName；
//   2) batch-meta.json 的 dataUrl（相对批次目录；绝对 URL / 绝对路径不参与，避免跨目录写入）；
//   3) 默认 report-validation-data.json。
export function resolveManifestPath(batchDir, manifestName) {
  if (manifestName) return path.join(batchDir, manifestName);
  const metaFile = path.join(batchDir, 'batch-meta.json');
  if (fs.existsSync(metaFile)) {
    let meta = null;
    try { meta = readJSON(metaFile); } catch (e) { meta = null; }
    const url = meta && typeof meta.dataUrl === 'string' ? meta.dataUrl : '';
    if (url && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) && !path.isAbsolute(url)) return path.resolve(batchDir, url);
  }
  return path.join(batchDir, DEFAULT_MANIFEST_NAME);
}

// 纯合并：manifest + 加载好的 item 内容 -> 单文件数据集。
// items 允许为任意值（缺失/非数组时视为空数组并把问题写进 issues）。
export function mergeManifest(manifest, loadedItems) {
  const issues = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, issues: ['清单不是对象'], dataset: null };
  }
  if (manifest.mode !== 'multi') {
    return { ok: false, issues: ['清单 mode 不是 "multi"（当前为：' + String(manifest.mode) + '），无需合并'], dataset: null };
  }
  const list = Array.isArray(manifest.items) ? manifest.items : [];
  if (!Array.isArray(manifest.items)) issues.push('清单缺少 items 数组，按空列表处理');
  if (Array.isArray(loadedItems) && loadedItems.length !== list.length) {
    issues.push('加载到的 item 数量（' + loadedItems.length + '）与清单（' + list.length + '）不一致');
  }

  const dataset = {};
  Object.keys(manifest).forEach(function (k) {
    if (k === 'mode' || k === 'items') return;
    dataset[k] = manifest[k];
  });
  dataset.mode = 'single';
  dataset.items = Array.isArray(loadedItems) ? loadedItems.slice() : [];

  // 逐 item 校验：tradeId 必须存在且与清单一致（不一致会让查看器按错误的 item 展示）。
  dataset.items.forEach(function (it, i) {
    const from = list[i] || {};
    if (!it || typeof it !== 'object') { issues.push('第 ' + (i + 1) + ' 个 item 不是对象'); return; }
    if (!it.tradeId) issues.push('第 ' + (i + 1) + ' 个 item 缺少 tradeId');
    else if (from.tradeId && from.tradeId !== it.tradeId) {
      issues.push('第 ' + (i + 1) + ' 个 item 的 tradeId（' + it.tradeId + '）与清单（' + from.tradeId + '）不一致');
    }
  });
  return { ok: true, issues: issues, dataset: dataset };
}

// 读取批次目录的清单与其 item 文件（不写任何文件）。
// 返回 { ok, error?, issues, dataset?, manifestPath, itemFiles }
export function mergeBatchDir(batchDir, opts) {
  const o = opts || {};
  const manifestPath = o.manifestPath || resolveManifestPath(batchDir, o.manifestName);
  if (!fs.existsSync(manifestPath)) return { ok: false, error: '未找到清单文件：' + manifestPath, issues: [], manifestPath };

  let manifest;
  try {
    manifest = readJSON(manifestPath);
  } catch (e) {
    return { ok: false, error: '清单不是合法 JSON：' + manifestPath + '（' + e.message + '）', issues: [], manifestPath };
  }

  // 先判模式：已是单文件模式（或不是清单）时给出明确提示，避免落到逐 item 的 file 检查里报“缺 file”。
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, error: '清单不是对象：' + manifestPath, issues: [], manifestPath };
  }
  if (manifest.mode !== 'multi') {
    return { ok: false, error: '清单 mode 不是 "multi"（当前为：' + String(manifest.mode) + '），无需合并', issues: [], manifestPath };
  }

  const list = Array.isArray(manifest.items) ? manifest.items : [];
  const itemFiles = [];
  const loaded = [];
  for (let i = 0; i < list.length; i++) {
    const ref = list[i] || {};
    if (typeof ref.file !== 'string' || !ref.file) {
      return { ok: false, error: '第 ' + (i + 1) + ' 个 item 缺少 file 字段（清单不是多文件模式？）', issues: [], manifestPath };
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(ref.file)) {
      return { ok: false, error: '第 ' + (i + 1) + ' 个 item 的 file 是绝对 URL，无法本地合并：' + ref.file, issues: [], manifestPath };
    }
    // item 文件相对「清单所在目录」解析（与查看器/扫描器一致）。
    const abs = path.isAbsolute(ref.file) ? ref.file : path.resolve(path.dirname(manifestPath), ref.file);
    itemFiles.push(abs);
    if (!fs.existsSync(abs)) return { ok: false, error: 'item 文件不存在：' + abs, issues: [], manifestPath };
    try {
      loaded.push(readJSON(abs));
    } catch (e) {
      return { ok: false, error: 'item 文件不是合法 JSON：' + abs + '（' + e.message + '）', issues: [], manifestPath };
    }
  }

  const merged = mergeManifest(manifest, loaded);
  if (!merged.ok) return { ok: false, error: merged.issues.join('；'), issues: merged.issues, manifestPath };
  return { ok: true, issues: merged.issues, dataset: merged.dataset, manifest: manifest, manifestPath: manifestPath, itemFiles: itemFiles };
}

// 把合并结果写到 outputPath：默认先备份原清单（<name><BACKUP_SUFFIX>），再原子写入单文件数据集。
// 返回 { ok, outputPath, backupPath?, bytes, validation }
export function writeMergedDataset(outputPath, dataset, opts) {
  const o = opts || {};
  const backup = o.backup !== false;
  const validation = validateDataset(dataset);
  if (!validation.ok && !o.force) {
    return { ok: false, error: '合并结果校验失败（可用 --force 忽略）：\n   - ' + validation.errors.join('\n   - '), validation: validation };
  }

  const text = JSON.stringify(dataset, null, 2) + '\n';
  // dry-run：只统计与校验，不写任何文件（含备份）。
  if (o.dryRun) return { ok: true, outputPath: outputPath, backupPath: null, bytes: Buffer.byteLength(text, 'utf8'), validation: validation, dryRun: true };

  let backupPath = null;
  if (backup && fs.existsSync(outputPath)) {
    backupPath = outputPath + BACKUP_SUFFIX;
    fs.copyFileSync(outputPath, backupPath);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tmp = outputPath + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    fs.renameSync(tmp, outputPath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (e2) {}
    fs.writeFileSync(outputPath, text, 'utf8');
  }
  return { ok: true, outputPath: outputPath, backupPath: backupPath, bytes: Buffer.byteLength(text, 'utf8'), validation: validation };
}

// 端到端：合并指定批次目录并写入（outName 省略时**原地**覆盖清单，转为单文件模式）。
//   opts: { manifestName?, outName?, backup?, dryRun?, force? }
export function mergeBatchDirToSingle(batchDir, opts) {
  const o = opts || {};
  const merged = mergeBatchDir(batchDir, o);
  if (!merged.ok) return merged;
  const outputPath = o.outName ? path.join(batchDir, o.outName) : merged.manifestPath;
  const written = writeMergedDataset(outputPath, merged.dataset, o);
  return Object.assign({}, merged, written, { outputPath: written.outputPath || outputPath });
}

// 在批次根目录下按批次 id / 目录名查找批次目录（找不到返回 null）。
// 先用 batches-index.json（batchId -> path，最准），失败再退回目录名匹配。
export function findBatchDir(batchesDir, batchId, indexFile) {
  if (!batchId) return null;
  if (indexFile && fs.existsSync(indexFile)) {
    try {
      const idx = readJSON(indexFile);
      const list = Array.isArray(idx.batches) ? idx.batches : [];
      const hit = list.find(function (b) { return b && (b.batchId === batchId || b.batchName === batchId); });
      if (hit && typeof hit.path === 'string' && hit.path) {
        // 索引里的 path 是相对索引文件（web 根）的相对路径。
        const abs = path.resolve(path.dirname(indexFile), hit.path);
        if (fs.existsSync(abs)) return abs;
      }
    } catch (e) {}
  }
  const direct = path.join(batchesDir, batchId);
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) {
    const hit = findDirByName(batchesDir, batchId);
    return hit || direct;
  }
  return findDirByName(batchesDir, batchId);
}

// 递归查找目录名等于 name 的目录（用于 --batch 传目录名而非 batchId 的情况）。
function findDirByName(root, name) {
  if (!fs.existsSync(root)) return null;
  let stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const ent of ents) {
      if (!ent.isDirectory()) continue;
      const p = path.join(dir, ent.name);
      if (ent.name === name) return p;
      stack.push(p);
    }
  }
  return null;
}

// 列出批次根目录下所有批次（供 --list）：{ batchId, dir, mode }
export function listBatchDirs(batchesDir, opts) {
  const o = opts || {};
  const out = [];
  if (!fs.existsSync(batchesDir)) return out;
  const walk = function (dir) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of ents) {
      if (!ent.isDirectory()) continue;
      const p = path.join(dir, ent.name);
      const metaFile = path.join(p, 'batch-meta.json');
      let meta = null;
      try { meta = fs.existsSync(metaFile) ? readJSON(metaFile) : null; } catch (e) { meta = null; }
      const manifestPath = resolveManifestPath(p, o.manifestName);
      let mode = null;
      try { mode = fs.existsSync(manifestPath) ? readJSON(manifestPath).mode : null; } catch (e) { mode = null; }
      const hasManifest = fs.existsSync(manifestPath);
      if (meta || hasManifest) {
        out.push({
          batchId: (meta && (meta.batchId || meta.batchName)) || ent.name,
          dir: p,
          mode: mode || (hasManifest ? 'single' : null),
        });
      }
      walk(p);
    }
  };
  walk(batchesDir);
  return out;
}
