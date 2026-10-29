// 列启用开关（columns.selector）回归测试：
//  1) 四个配置文件的 userTag / type 默认值（prod：userTag 启用、type 禁用）；
//  2) schema 允许任意布尔列名（新增列无需改 schema）；
//  3) 前端行为：selector === false 的列既不在「列选择」菜单里，也不渲染。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(SRC_DIR, rel), 'utf8'));

const CONFIGS = {
  'config.json': readJson('config.json'),
  'config-dev.json': readJson('config-dev.json'),
  'config-test.json': readJson('config-test.json'),
  'config-prod.json': readJson('config-prod.json'),
};

test('配置文件：userTag 全启用；type 仅 prod 禁用', () => {
  Object.entries(CONFIGS).forEach(([name, cfg]) => {
    const sel = cfg.columns && cfg.columns.selector;
    assert.ok(sel && typeof sel === 'object', name + ' 缺少 columns.selector');
    assert.equal(sel.userTag, true, name + ' 的 columns.selector.userTag 应为 true');
    const expectType = name === 'config-prod.json' ? false : true;
    assert.equal(sel.type, expectType, name + ' 的 columns.selector.type 应为 ' + expectType);
  });
});

test('配置文件：表达式类列保持原有开关（prod 只放开 aoEl / eoUnconverted）', () => {
  const prod = CONFIGS['config-prod.json'].columns.selector;
  ['eoEl', 'eoCvtEl', 'aoCvtEl', 'vdtEl', 'aoUnconverted'].forEach((k) => {
    assert.equal(prod[k], false, 'prod 应禁用 ' + k);
  });
  ['aoEl', 'eoUnconverted'].forEach((k) => {
    assert.equal(prod[k], true, 'prod 应启用 ' + k);
  });
  const dev = CONFIGS['config-dev.json'].columns.selector;
  ['aoEl', 'eoEl', 'eoCvtEl', 'aoCvtEl', 'vdtEl', 'eoUnconverted', 'aoUnconverted'].forEach((k) => {
    assert.equal(dev[k], true, 'dev 应启用 ' + k);
  });
});

test('schema：selector 接受任意布尔列名（新增列无需改 schema）', () => {
  const schema = readJson('public/config.schema.json');
  const sel = schema.properties.columns.properties.selector;
  assert.deepEqual(sel.additionalProperties, { type: 'boolean' }, 'selector 应允许任意布尔键');
  assert.match(sel.description, /type/, 'schema 描述应说明 type 的 prod 默认值');
});

test('前端：selector=false 的列不进菜单也不渲染', () => {
  const app = fs.readFileSync(path.join(SRC_DIR, 'public/app.js'), 'utf8');
  assert.match(app, /function isColSelectable\(c\) \{ return COL_SELECTOR\[c\.key\] !== false; \}/,
    'isColSelectable 默认启用、仅显式 false 才禁用');
  assert.match(app, /return !!state\.columns\[c\.key\] && isColSelectable\(c\);/,
    'isFieldColVisible 必须同时要求「可见」与「已启用」，避免禁用列仍被渲染成无法关闭的列');
  assert.match(app, /const cols = COLUMNS\.filter\(isColSelectable\)/, '「列选择」菜单应只列出已启用的列');
  // 配置读取：columns.selector 覆盖 COL_SELECTOR。
  assert.match(app, /cfg\.columns\.selector[\s\S]{0,160}?COL_SELECTOR\[k\] = !!cfg\.columns\.selector\[k\]/,
    '应从 config.columns.selector 读取列启用开关');
  // 列名常量仍保留 userTag / type（禁用只是不展示，不改变列顺序定义）。
  assert.match(app, /const COLUMNS = \[[\s\S]*?key: 'userTag'[\s\S]*?key: 'type'/, 'COLUMNS 应仍包含 userTag / type');
});

test('前端：不允许把字段比较表的所有列都关掉', () => {
  const app = fs.readFileSync(path.join(SRC_DIR, 'public/app.js'), 'utf8');
  // 兜底函数：全部不可见时恢复首列。
  assert.match(app, /function ensureOneFieldCol\(\) \{\s*if \(COLUMNS\.some\(isFieldColVisible\)\) return false;/,
    'ensureOneFieldCol 应只在「一列都不剩」时动手');
  assert.match(app, /state\.columns\[first\.key\] = true;/, 'ensureOneFieldCol 应恢复首列');
  // 三个入口都要兜底：列选择菜单、深链接 cols=…、localStorage 偏好。
  const menuAt = app.indexOf('function openColumnMenu(');
  assert.match(app.slice(menuAt, menuAt + 2600), /if \(ensureOneFieldCol\(\)\) showToast\(t\('colKeepOne'\)\);/,
    '「列选择」菜单改动后应兜底并提示');
  const hashAt = app.indexOf('function applyHash() {');
  assert.match(app.slice(hashAt, hashAt + 4000), /ensureOneFieldCol\(\);/, 'applyHash 解析 cols= 后应兜底');
  const initAt = app.indexOf('function initState() {');
  assert.match(app.slice(initAt, initAt + 4000), /ensureOneFieldCol\(\);/, 'initState 恢复偏好后应兜底');
});

test('文档：CONFIG.md 说明 selector 的禁用语义与 prod 默认值', () => {
  const doc = fs.readFileSync(path.join(SRC_DIR, 'docs/CONFIG.md'), 'utf8');
  assert.match(doc, /`selector`：列是否在本次部署中\*\*启用\*\*/, 'CONFIG.md 应说明 selector 语义');
  assert.match(doc, /`false` 的列既不出现在「列选择」菜单中，也不渲染/, 'CONFIG.md 应说明 false 不渲染');
  assert.match(doc, /`config-prod\.json` 在表达式类列之外还禁用 `type`/, 'CONFIG.md 应记录 prod 的 type 默认值');
});
