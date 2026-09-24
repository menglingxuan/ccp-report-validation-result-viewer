// 侧栏「按状态筛选」回归测试。
//  1) 纯函数：多文件清单的 item summary 归一化（缺失 / 非数字不得泄露 undefined）；
//  2) 源码级结构断言（筛选判定、下拉回写）—— 相关逻辑在 app.js 的 DOM 闭包内，Node 无法直接执行。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeItemSummary } from '../public/core.js';

const PUBLIC_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const APP = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');

test('normalizeItemSummary：完整 summary 原样返回（键与顺序固定）', () => {
  const raw = { total: 78, passed: 78, failed: 0, rate: 100, warnings: 7, warningsIgnored: 1, errors: 2, uncompared: 3, logs: 4 };
  assert.deepEqual(normalizeItemSummary(raw), raw);
});

test('normalizeItemSummary：缺失 / 非对象 -> 全 0（不返回 undefined）', () => {
  const zero = { total: 0, passed: 0, failed: 0, rate: 0, warnings: 0, warningsIgnored: 0, errors: 0, uncompared: 0, logs: 0 };
  assert.deepEqual(normalizeItemSummary(undefined), zero);
  assert.deepEqual(normalizeItemSummary(null), zero);
  assert.deepEqual(normalizeItemSummary('x'), zero);
  assert.deepEqual(normalizeItemSummary([]), zero);
});

test('normalizeItemSummary：字段缺失 / 非数字 / NaN -> 0，且忽略多余键', () => {
  const r = normalizeItemSummary({ total: 66, failed: undefined, rate: '80', warnings: NaN, extra: 9 });
  assert.equal(r.total, 66);
  assert.equal(r.failed, 0, 'failed 缺失或非数字必须归一为 0');
  assert.equal(r.rate, 0, '字符串数字不采用（避免隐式转换歧义）');
  assert.equal(r.warnings, 0);
  assert.equal(r.passed, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(r, 'extra'), false, '多余键不应带出');
  assert.equal(Object.keys(r).length, 9);
});

test('侧栏筛选：状态判定基于 failed / warnings，全部通过不含失败项', () => {
  const i = APP.indexOf('function filteredItems()');
  assert.notEqual(i, -1, '未找到 filteredItems');
  const body = APP.slice(i, i + 1200);
  assert.match(body, /state\.itemFilter === 'PASSED' && s\.failed !== 0/, '「全部通过」应排除有失败的 item');
  assert.match(body, /state\.itemFilter === 'FAILED' && s\.failed === 0/, '「存在失败」应排除 0 失败的 item');
  assert.match(body, /state\.itemFilter === 'WARN' && s\.warnings === 0/, '「存在警告」应排除 0 警告的 item');
  // 多文件模式未加载的 item 走 summary，必须经过归一化（否则 undefined 会进 筛选 / 卡片）。
  const stats = APP.slice(APP.indexOf('function itemStatsAll(item)'), APP.indexOf('function itemStatsAll(item)') + 400);
  assert.match(stats, /return normalizeItemSummary\(item\.summary\)/, 'itemStatsAll 应使用 normalizeItemSummary 兜底');
});

test('深链接：st=… 生效时状态筛选下拉必须同步（不能停在「全部状态」）', () => {
  const i = APP.indexOf("if (p.st === 'PASSED'");
  assert.notEqual(i, -1, '未找到 st= 解析');
  assert.match(APP, /statusSel\.value = state\.itemFilter \|\| 'ALL'/, 'applyHash 应把状态写回 #itemFilter');
  // 与其它筛选控件的回写保持在同一处（applyHash 尾部）。
  const tail = APP.slice(APP.indexOf("const itemSearchEl = document.getElementById('itemSearch')"), APP.indexOf("const itemSearchEl = document.getElementById('itemSearch')") + 700);
  assert.match(tail, /itemSearchEl\.value = state\.itemSearch/, 'itemSearch 回写仍在');
  assert.match(tail, /dateInput\.value = state\.reportDateFilter/, 'reportDateFilter 回写仍在');
});
