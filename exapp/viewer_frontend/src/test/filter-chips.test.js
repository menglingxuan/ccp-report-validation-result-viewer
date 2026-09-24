// 筛选标签（chips）与「匹配 N 项」小字回归测试（源码级结构断言）。
// 相关逻辑位于 app.js 的 DOM 闭包内（依赖浏览器环境），Node 无法直接执行，因此对 public/ 源码做结构性断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const APP = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const I18N = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'i18n.json'), 'utf8'));

function bodyOf(sig, len = 3000) {
  const i = APP.indexOf(sig);
  assert.notEqual(i, -1, '未找到：' + sig);
  return APP.slice(i, i + len);
}

test('i18n：chipMatchCount 三语齐备且含 {N} 占位', () => {
  ['zh-CN', 'zh-HK', 'en'].forEach((lang) => {
    const v = I18N[lang].chipMatchCount;
    assert.equal(typeof v, 'string', lang + '.chipMatchCount 缺失');
    assert.match(v, /\{N\}/, lang + '.chipMatchCount 应含 {N}');
  });
});

test('侧栏：报告日期以筛选标签展示，清除时同步输入框', () => {
  const body = bodyOf('function renderSidebarChips() {');
  assert.match(body, /if \(state\.reportDateFilter\) \{/, 'renderSidebarChips 应包含报告日期标签');
  assert.match(body, /label: t\('sidebarReportDate'\) \+ ': ' \+ state\.reportDateFilter/, '报告日期标签应显示所选日期');
  assert.match(body, /state\.reportDateFilter = '';/, '清除报告日期标签应重置 state');
  assert.match(body, /input\.value = ''; input\.parentElement\.classList\.remove\('has-value'\)/, '清除报告日期标签应同步输入框');
  // 日期筛选的所有入口都要刷新标签（否则选完日期看不到标签）。
  const picker = bodyOf('function openReportDatePicker(anchor) {', 4000);
  assert.match(picker, /renderSidebar\(\);\s*renderSidebarChips\(\);\s*closePopover\(\);/, '日期选择器应刷新标签');
  const dateInputBlock = APP.slice(APP.indexOf("dateInput.addEventListener('input'"),
    APP.indexOf("document.getElementById('reportDateClear').addEventListener"));
  assert.equal((dateInputBlock.match(/renderSidebarChips\(\);/g) || []).length, 2, '手动输入日期（设置 / 清空）都应在设置标签刷新');
  assert.match(bodyOf("document.getElementById('reportDateClear').addEventListener", 500), /renderSidebarChips\(\);/, '✕ 清除日期应刷新标签');
  assert.match(bodyOf("datePicker.addEventListener('change'", 500), /renderSidebarChips\(\);/, '原生日期选择应刷新标签');
});

test('侧栏：「清除全部」也清除报告日期', () => {
  const body = bodyOf('function clearAllSidebarFilters() {', 900);
  assert.match(body, /state\.reportDateFilter = '';/, 'clearAllSidebarFilters 应清除报告日期');
  assert.match(body, /d\.value = ''; d\.parentElement\.classList\.remove\('has-value'\);/, '应同时清空日期输入框');
});

test('匹配数量小字：仅在存在筛选标签时显示，且用统一的 chipMatchCount 文案', () => {
  const helper = bodyOf('function renderChipMatchCount(', 500);
  assert.match(helper, /filterCount > 0 \? t\('chipMatchCount'\)\.replace\('\{N\}', n\) : ''/, '计数小字应由 chipMatchCount 渲染，无标签时清空');
  assert.match(bodyOf('function renderSidebarChips() {'), /renderChipMatchCount\('sidebarMatchCount', chips\.length, filteredItems\(\)\.length\)/, '侧栏计数 = 匹配到的 item 数');
  assert.match(bodyOf('function renderBatchChips(total) {', 900), /renderChipMatchCount\('batchMatchCount', BATCH_FILTERS\.length, total\)/, '批次计数 = 可见批次数');
  assert.match(bodyOf('function renderBatchList() {', 400), /renderBatchChips\(list\.length\)/, 'renderBatchList 应把可见批次总数传给标签渲染');
  // 承载元素与样式（空文本时自动收起）。
  assert.match(HTML, /<div class="chip-count" id="sidebarMatchCount"><\/div>/, 'index.html 缺少侧栏计数元素');
  assert.match(HTML, /\.chip-count \{[^}]*font-size: 11px/, '.chip-count 应为小字');
  assert.match(HTML, /\.chip-count:empty \{ display: none; \}/, '.chip-count 为空时应收起');
  assert.match(APP, /'<div class="chip-count" id="batchMatchCount"><\/div>'/, '批次面板缺少计数元素');
});

test('布局：侧栏列表的起点要计入计数小字高度（避免首个 item 被遮挡）', () => {
  const body = bodyOf('function layoutSidebarList() {', 800);
  assert.match(body, /const chipCount = document\.getElementById\('sidebarMatchCount'\);/, 'layoutSidebarList 应读取计数元素');
  assert.match(body, /top = Math\.max\(top, chipCount\.offsetTop \+ chipCount\.offsetHeight\)/, '计数小字的高度应计入列表起点');
});

test('批次：指定日期后隐藏「N 个批次日期（有数据）」提示', () => {
  const body = bodyOf('function updateBatchDateHint() {', 700);
  assert.match(body, /if \(BATCH_STATE\.date\.trim\(\)\) \{ el\.textContent = ''; return; \}/, '指定日期时提示应清空');
  assert.match(body, /t\('batchDateHint'\)/, '未指定日期时应显示日期提示');
  // 面板重建与手动输入两条路径都要刷新提示。
  assert.match(bodyOf('function renderBatchPanel() {', 8000), /updateBatchDateHint\(\);/, 'renderBatchPanel 应刷新日期提示');
  assert.match(bodyOf("e.target.id === 'batchDate'", 600), /updateBatchDateHint\(\);/, '手动输入批次日期应立即刷新提示');
  assert.doesNotMatch(APP, /const dateHint = \(function/, '不应再保留旧的内联日期提示实现');
});
