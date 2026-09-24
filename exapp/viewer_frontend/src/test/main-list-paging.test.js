// 主列表分页行为回归测试（源码级结构断言）。
// 说明：涉及的行为位于 app.js 的 DOM 闭包内（依赖浏览器环境），Node 单测无法直接执行，
// 因此沿用 boot-safety / i18n 测试的做法，对 public/app.js 做结构性断言，防止回归。
// 关注点：切换选项卡**不重置**当前页码；真正改变数据集的操作仍然重置页码。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const APP = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');

// 取出一段代码：从 sig 开始到第一次出现的 endMarker（含）为止。
function sliceFrom(sig, endMarker, len = 2000) {
  const i = APP.indexOf(sig);
  assert.notEqual(i, -1, '未找到：' + sig);
  const rest = APP.slice(i, i + len);
  const j = rest.indexOf(endMarker);
  return j === -1 ? rest : rest.slice(0, j + endMarker.length);
}

test('切换选项卡：保留当前分页（不再回到第 1 页）', () => {
  const handler = sliceFrom("document.getElementById('tabs').addEventListener", 'renderTabs(); renderChannelTabs(); renderFilterChips(); renderContent();');
  assert.doesNotMatch(handler, /state\.page = 1/, '切换选项卡不应把「字段比较」页码重置为 1');
  assert.doesNotMatch(handler, /state\.msgPage = 1/, '切换选项卡不应把消息类页码重置为 1');
  // 其余切换行为保持不变。
  assert.match(handler, /state\.tab = el\.getAttribute\('data-tab'\)/, '切换选项卡应写入 state.tab');
  assert.match(handler, /state\.rowId = -1/, '切换选项卡仍应清空行选中');
  assert.match(handler, /state\.msgSort = \{ key: '', dir: 1 \}/, '切换选项卡仍应重置消息类排序');
  assert.match(handler, /state\.msgFilter = \{\}/, '切换选项卡仍应重置消息类筛选');
});

test('页码越界自动收敛：字段比较与消息表都调用 clamp', () => {
  const fields = sliceFrom('function computeFieldPage() {', '}', 400);
  assert.match(fields, /if \(state\.page > pages\) state\.page = pages/, '字段比较缺少页码收敛');
  const msg = sliceFrom('function renderMsgTable(', 'if (state.msgPage > pages) state.msgPage = pages;', 6000);
  assert.match(msg, /if \(state\.msgPage > pages\) state\.msgPage = pages/, '消息表缺少页码收敛');
});

test('数据集变化时仍然重置页码（避免保留过期页）', () => {
  // 切换 item：字段比较回到第 1 页。
  assert.match(sliceFrom('async function selectItem(id) {', 'state.sort = { key: \'\', dir: 1 };', 1200),
    /state\.page = 1/, 'selectItem 应重置字段比较页码');
  // 全局搜索：两个页码都回到第 1 页。
  assert.match(APP, /state\.search = e\.target\.value; state\.page = 1; state\.msgPage = 1;/,
    '全局搜索应重置字段比较与消息类页码');
  // 汇总卡片：切换 tab 与过滤结果时回到第 1 页。
  const summary = sliceFrom("document.getElementById('summary').addEventListener", 'render();', 1200);
  assert.match(summary, /state\.page = 1/, '汇总卡片跳转应重置页码');
  // 字段图标的「警告 / 错误」跳转：重建筛选后回到第 1 页。
  assert.match(sliceFrom('function jumpToFieldMsg(', 'state.msgFilter = {};', 800),
    /state\.page = 1/, 'jumpToFieldMsg 应重置页码');
  // 清除全部筛选。
  assert.match(sliceFrom('function clearAllFilters() {', 'render();', 900), /state\.page = 1/, 'clearAllFilters 应重置页码');
});
