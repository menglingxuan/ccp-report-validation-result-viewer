// 「额外输入文件」（item.channels[].files.other，UI 标签 EX）回归测试。
//
// 契约：`files.other` 与 `files.eo` / `files.ao` 同形（`[{ name, path }]`，也接受文件名数组），可省略；
// 查看器「输入 / 配置文件」把它与 EO / AO 用同一套展示与交互渲染，只是标签与配色不同（EX / ftag-ex）。
//
// app.js 的渲染逻辑位于 DOM 闭包内，Node 无法执行，故对 public/ 源码做结构断言；
// 校验器行为（接受 / 拒绝哪些形状）直接单测真实函数。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDataset } from '../lib/validate.js';
import { hydrateItem, hoistRegistries, registriesOf } from '../public/core.js';
import { splitToFiles } from '../lib/sample-data.js';
import { mergeBatchDirToSingle } from '../lib/merge-batch.js';

const SRC_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = path.join(SRC_DIR, 'public');
const APP = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const I18N = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'i18n.json'), 'utf8'));
const SAMPLE = fs.readFileSync(path.join(SRC_DIR, 'lib', 'sample-data.js'), 'utf8');
const JAVA_FILES = fs.readFileSync(path.join(SRC_DIR, '..', '..', '..', 'src', 'main', 'java', 'com', 'otcc', 'viewer', 'model', 'ChannelFiles.java'), 'utf8');
const JAVA_GEN = fs.readFileSync(path.join(SRC_DIR, '..', '..', '..', 'src', 'main', 'java', 'com', 'otcc', 'viewer', 'generator', 'ValidationJsonGenerator.java'), 'utf8');
const JAVA_BASIC = fs.readFileSync(path.join(SRC_DIR, '..', '..', '..', 'src', 'main', 'java', 'com', 'otcc', 'viewer', 'generator', 'BasicDataGenerator.java'), 'utf8');
const JAVA_MINIMAL = fs.readFileSync(path.join(SRC_DIR, '..', '..', '..', 'src', 'main', 'java', 'com', 'otcc', 'viewer', 'generator', 'MinimalDataGenerator.java'), 'utf8');

// 最小合法数据集（带一张声明表），可按需替换 channel.files。
// item 里同名重复写 name / format 是允许的（必须与声明一致），这样 hoistRegistries 也能补出完整声明表。
function dataset(files) {
  const channel = { id: 1, name: 'HKTR', format: 'xml', sources: [{ id: 1, name: '来源渠道 A', fields: [] }] };
  if (files !== undefined) channel.files = files;
  return {
    mode: 'single',
    reportChannelDefs: [{ id: 1, name: 'HKTR', format: 'xml', fieldDefs: [] }],
    sourceChannelDefs: [{ id: 1, name: '来源渠道 A', format: 'csv' }],
    items: [{ tradeId: 'T-1', reportDate: '2026-08-16', channels: [channel] }],
  };
}

test('files.other：省略 / 合法形状都通过校验', () => {
  assert.equal(validateDataset(dataset()).ok, true, '没有 files 也应合法');
  const ok = validateDataset(dataset({
    eo: [{ name: 'a.csv', path: 'data/eo/a.csv' }],
    ao: [{ name: 'b.xml', path: 'data/ao/b.xml' }],
    other: [{ name: 'c.csv', path: 'data/other/c.csv' }, { name: 'd.txt', path: 'data/other/d.txt' }],
    excel: { file: 'mapping.xlsx', sheet: 'HKTR', path: 'data/excel/mapping.xlsx' },
  }));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  // 文件名数组也是合法形态（查看器同样支持，与 eo / ao 一致）
  assert.equal(validateDataset(dataset({ other: ['e.csv'] })).ok, true);
});

test('files.other：形状错误会被报出来', () => {
  const notArray = validateDataset(dataset({ other: { name: 'c.csv' } }));
  assert.equal(notArray.ok, false);
  assert.ok(notArray.errors.some((e) => e.includes('files.other 必须是数组')), JSON.stringify(notArray.errors));

  const noName = validateDataset(dataset({ other: [{ path: 'data/other/c.csv' }] }));
  assert.equal(noName.ok, false);
  assert.ok(noName.errors.some((e) => e.includes('缺少 name')), JSON.stringify(noName.errors));

  const badPath = validateDataset(dataset({ other: [{ name: 'c.csv', path: 42 }] }));
  assert.equal(badPath.ok, false);
  assert.ok(badPath.errors.some((e) => e.includes('path 必须是字符串')), JSON.stringify(badPath.errors));

  const emptyName = validateDataset(dataset({ other: ['   '] }));
  assert.equal(emptyName.ok, false);
  assert.ok(emptyName.errors.some((e) => e.includes('文件名不能为空')), JSON.stringify(emptyName.errors));

  // files 本身必须是对象
  const badFiles = validateDataset(dataset([{ name: 'x' }]));
  assert.equal(badFiles.ok, false);
  assert.ok(badFiles.errors.some((e) => e.includes('files 必须是对象')), JSON.stringify(badFiles.errors));
});

test('多文件模式：files.other 随 item 走（hydrate / hoist / 拆分+合并都不丢）', () => {
  const files = {
    eo: [{ name: 'a.csv', path: 'data/eo/a.csv' }],
    ao: [{ name: 'b.xml', path: 'data/ao/b.xml' }],
    other: [{ name: 'c.csv', path: 'data/other/c.csv' }],
    excel: { file: 'mapping.xlsx', sheet: 'HKTR', path: 'data/excel/mapping.xlsx' },
  };
  const single = dataset(files);

  // ① 多文件懒加载：item 文件（只有 id 引用）经 hydrateItem 补回名称后，files.other 原样保留
  const manifest = { reportChannelDefs: single.reportChannelDefs, sourceChannelDefs: single.sourceChannelDefs, usedCtxKeyDefs: {} };
  const reg = registriesOf(manifest);
  const hydrated = hydrateItem(single.items[0], reg);
  assert.deepEqual(hydrated.channels[0].files.other, files.other, 'hydrateItem 不应丢 files.other');
  assert.deepEqual(Object.keys(hydrated.channels[0].files), ['eo', 'ao', 'other', 'excel'], 'files 键顺序应保持');

  // ② 单文件 -> 多文件：hoistRegistries 只搬定义，files 仍留在 item 里
  const hoisted = hoistRegistries({ mode: 'multi', ...single, items: single.items });
  assert.deepEqual(hoisted.items[0].channels[0].files.other, files.other, 'hoistRegistries 不应丢 files.other');
  assert.equal(hoisted.reportChannelDefs[0].files, undefined, 'files 不应被提到声明表');

  // ③ 拆分 -> 合并往返：多文件写盘再合回单文件，files.other 逐字节不变
  //    （splitToFiles 要求三张声明表齐备，② 的 hoistRegistries 结果正好满足）
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'files-other-'));
  try {
    splitToFiles(hoisted, dir);
    const itemFile = path.join(dir, 'data', 'items', 'T-1.json');
    const written = JSON.parse(fs.readFileSync(itemFile, 'utf8'));
    assert.deepEqual(written.channels[0].files.other, files.other, '多文件 item 文件应写入 files.other');
    const merged = mergeBatchDirToSingle(dir, { backup: false });
    assert.equal(merged.ok, true, merged.error);
    const back = JSON.parse(fs.readFileSync(path.join(dir, 'report-validation-data.json'), 'utf8'));
    assert.deepEqual(back.items[0].channels[0].files.other, files.other, '合并回单文件后 files.other 应保持不变');
    assert.equal(validateDataset(back).ok, true, JSON.stringify(validateDataset(back).errors));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('「输入 / 配置文件」把 files.other 渲染为 EX（与 EO / AO 同一套行与链接）', () => {
  const body = APP.slice(APP.indexOf('function renderFiles('), APP.indexOf('function renderTaskNote('));
  assert.match(body, /ch\.files\.other/, 'renderFiles 应读取 ch.files.other');
  assert.match(body, /fileRowHTML\('EX', 'ftag-ex', stripColon\(t\('filesOther'\)\), v\)/,
    'EX 行应用与 EO / AO 相同的 fileRowHTML（标签 + 类名 + i18n 提示）');
  // 渲染顺序：EO → AO → EX → XL（额外输入排在映射配置之前）
  const order = ['eoRows', 'aoRows', 'exRows', 'xlRow'].map((k) => body.indexOf(k + ' +'));
  assert.ok(order.every((i, idx) => i >= 0 && (idx === 0 || i > order[idx - 1])), '三行顺序应为 EO → AO → EX → XL');
  // 链接打开方式与 EO / AO 相同：仍走 fileLinkHTML（点击即打开 target=_blank）
  assert.match(APP, /function fileLinkHTML\(v\)[\s\S]{0,320}target="_blank"/, '文件链接应可直接打开（与 EO / AO 一致）');
});

test('EX 标签样式、i18n 与生成器都齐备', () => {
  assert.match(HTML, /\.ftag-ex\s*\{[^}]*background:\s*var\(--chip-code-bg\)/, '.ftag-ex 应使用 chip-code 配色');
  assert.match(HTML, /\.ftag-ex\s*\{[^}]*color:\s*var\(--chip-code-fg\)/);
  Object.keys(I18N).forEach((lang) => {
    assert.equal(typeof I18N[lang].filesOther, 'string', lang + ' 缺少 filesOther');
    assert.ok(I18N[lang].filesOther.indexOf('EX') === 0, lang + ' 的 filesOther 应以 EX 开头：' + I18N[lang].filesOther);
  });
  // 落盘样例生成器：JS 与 Java 都要写 other（否则两边数据不同构）
  assert.match(SAMPLE, /other:\s*\[\{\s*name:\s*otherNameA/, 'JS 生成器应写出 files.other');
  assert.match(JAVA_FILES, /List<FileEntry> other;/, 'Java ChannelFiles 应有 other 字段');
  assert.match(JAVA_GEN, /\.other\(other\)/, 'Java 生成器应写入 files.other');
  // Java 侧不靠 NON_NULL 省略：没有额外文件时写空列表（生成的 JSON 里永远不会出现 "other":null）
  assert.equal(/@JsonInclude[\s\S]{0,80}?private List<FileEntry> other/.test(JAVA_FILES), false,
    'ChannelFiles.other 不应再带 @JsonInclude（空时应是空列表而不是省略/null）');
  assert.match(JAVA_BASIC, /\.other\(List\.of\(\)\)/, 'BasicDataGenerator 应显式给 other 空列表');
  assert.match(JAVA_MINIMAL, /\.other\(List\.of\(\)\)/, 'MinimalDataGenerator 应显式给 other 空列表');
});
