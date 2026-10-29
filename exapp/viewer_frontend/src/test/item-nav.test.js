// 「上一个 / 下一个 item」常驻导航（详情标题栏、「统计图表」图标左侧）回归测试。
//
// 设计（最终形态）：
// 1) 位置：`.item-bar` 里、`#reportCats`（◔/▤/📄 三个图标）之前 → 紧贴「统计图表」左侧；
// 2) 显隐：**常驻**，仅当（筛选后的）item 总数 <= 1 时隐藏（没有可切换的目标）；
// 3) 位置数字 `N / M` 取（筛选后）侧栏列表，与 J/K、moveItem 同源；当前 item 被筛掉时显示 – / M；
// 4) 与侧栏标题处 hover 浮出的箭头共用 itemNavState() / itemNavButtonHTML()，口径与置灰规则一致；
// 5) 点击由 `#itemNavBar` 自己的委托处理（它不在侧栏内，侧栏的委托覆盖不到）。
//
// 历史：曾试过「侧栏底部常驻条（可视行数 < 3 显示）」与「>= 8 显示」两个方案，均因依赖侧栏高度而容易被
// 主列表高度带偏（.table-wrap 有 max-height: 65vh），最终改为放在详情标题栏、与高度无关的常驻导航。
//
// app.js 在 DOM 闭包里（Node 无法执行），因此对 public/ 源码做结构断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const APP = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const I18N = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'i18n.json'), 'utf8'));

function bodyOf(sig, len = 2000) {
  const i = APP.indexOf(sig);
  assert.notEqual(i, -1, '未找到源码片段：' + sig);
  return APP.slice(i, i + len);
}

test('结构：#itemNavBar 与 #reportCats 同在一个右对齐容器里，且排在图标之前', () => {
  const bar = HTML.match(/<div class="item-bar">[\s\S]*?<button class="top-collapse"/);
  assert.ok(bar, 'index.html 缺少 .item-bar');
  const block = bar[0];
  const wrap = block.match(/<div class="item-bar-right">[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(wrap, '导航与图标组应包在 .item-bar-right 里（否则会被 margin-left:auto 拉开）');
  assert.match(wrap[0], /<div class="item-nav-bar" id="itemNavBar" hidden><\/div>/, '导航组应默认 hidden');
  const navAt = wrap[0].indexOf('id="itemNavBar"');
  const catsAt = wrap[0].indexOf('id="reportCats"');
  assert.ok(navAt !== -1 && catsAt !== -1 && navAt < catsAt, '导航组应紧贴 #reportCats（统计图表等图标）左侧');
  // 旧的两版「侧栏内的条子」结构必须彻底移除
  assert.equal(/id="sidebarNav"/.test(HTML), false, 'index.html 不应再有 #sidebarNav（已移到详情标题栏）');
  assert.equal(/class="side-col"|id="sideCol"/.test(HTML), false, 'index.html 不应再有 .side-col 列容器');
  assert.equal(/\bsidebarNav\b|\bsideCol\b/.test(APP), false, 'app.js 不应再引用 sidebarNav / sideCol（注意 sideCollapse 不算）');
});

test('样式：右对齐容器承载、隐藏态显式 display:none、位置数字等宽', () => {
  assert.match(HTML, /\.item-bar-right \{ margin-left: auto; display: inline-flex; align-items: center; gap: 10px; \}/,
    '.item-bar-right 应 margin-left:auto 把「导航 + 图标」整体推到右侧');
  const cats = HTML.match(/\n\s*\.report-cats \{([^}]*)\}/);
  assert.ok(cats, '缺少 .report-cats 样式');
  assert.equal(/margin-left/.test(cats[1]), false, '.report-cats 不应再自带 margin-left:auto（改由容器承担，否则两者会被拉开）');
  assert.match(HTML, /\.item-nav-bar \{ display: inline-flex; align-items: center; gap: 4px; \}/, '.item-nav-bar 应为行内 flex');
  assert.match(HTML, /\.item-nav-bar\[hidden\] \{ display: none; \}/, 'hidden 必须显式 display:none（inline-flex 会盖掉 UA 的 hidden）');
  assert.match(HTML, /\.item-nav-bar \.nav-pos \{[^}]*font-variant-numeric: tabular-nums/, '位置数字应等宽（避免按钮左右跳动）');
  // 旧的卡片外窄条样式不应残留（它会与 .item-nav-bar 冲突）
  assert.equal(/\.sidebar-nav \{[^}]*border-radius: 10px/.test(HTML), false, '不应残留 .sidebar-nav 窄条样式');
});

test('显隐：常驻，仅当 item 总数 <= 1 时隐藏（与侧栏高度无关）', () => {
  const nav = bodyOf('function updateItemNav() {', 900);
  assert.match(nav, /const nav = document\.getElementById\('itemNavBar'\);/, '应操作 #itemNavBar');
  assert.match(nav, /nav\.hidden = !\(s\.all\.length > 1\);/, '常驻：仅总数 <= 1 时隐藏');
  // 不能再有「按可视行数/阈值」的判定，也不能再重排侧栏
  assert.equal(/SIDEBAR_ROW_H|clientHeight|offsetHeight|layoutSidebarList/.test(nav), false,
    '导航显隐不应再依赖侧栏高度（历史上两次尝试都因此被主列表高度带偏）');
  assert.equal(/SIDEBAR_NAV_MIN_ROWS/.test(APP), false, '阈值常量应已删除');
});

test('位置口径：与 J/K、moveItem 同源，标题箭头与常驻导航共用生成器', () => {
  const state = bodyOf('function itemNavState() {', 600);
  assert.match(state, /const all = \(state\._sidebarAll && state\._sidebarAll\.length\) \? state\._sidebarAll : filteredItems\(\);/, '位置取自侧栏当前列表');
  assert.match(state, /atFirst: all\.length <= 1 \|\| idx === 0/, '首项时上一个置灰');
  assert.match(state, /atLast: all\.length <= 1 \|\| \(idx >= 0 && idx >= all\.length - 1\)/, '末项时下一个置灰');
  const nav = bodyOf('function updateItemNav() {', 900);
  assert.match(nav, /const pos = \(s\.idx >= 0 \? String\(s\.idx \+ 1\) : '–'\) \+ ' \/ ' \+ s\.all\.length;/, '位置文案 = 序号 / 总数');
  assert.match(nav, /itemNavButtonHTML\(-1, t\('prevItem'\), s\.atFirst\)/, '上一个按钮复用统一生成器');
  assert.match(nav, /itemNavButtonHTML\(1, t\('nextItem'\), s\.atLast\)/, '下一个按钮复用统一生成器');
  assert.match(bodyOf('function itemNavHTML() {', 300), /itemNavState\(\)/, '侧栏标题箭头同源');
  assert.match(bodyOf('function itemNavButtonHTML(', 400), /\(disabled \? ' disabled' : ''\)/, '禁用态由 itemNavButtonHTML 统一处理');
});

test('点击接线：#itemNavBar 自己的委托 → moveItem；侧栏委托仍留在 #sidebar', () => {
  assert.match(bodyOf("document.getElementById('itemNavBar').addEventListener('click'", 500),
    /moveItem\(parseInt\(nav\.getAttribute\('data-item-nav'\), 10\)\)/, '常驻导航应调用 moveItem');
  const sidebar = bodyOf("document.getElementById('sidebar').addEventListener('click'", 1600);
  assert.match(sidebar, /const nav = e\.target\.closest\('\[data-item-nav\]'\);/, '侧栏标题箭头仍由侧栏委托处理');
  assert.match(sidebar, /selectItem\(el\.getAttribute\('data-id'\)\)/, '侧栏 item 点击仍应走 selectItem');
});

test('重算时机：渲染（含筛选标签）后刷新常驻导航', () => {
  const rs = bodyOf('function renderSidebar() {', 3000);
  assert.ok((rs.match(/updateItemNav\(\);/g) || []).length >= 2, 'renderSidebar 的两个分支都要刷新');
  assert.match(bodyOf('function renderSidebarChips() {', 4200), /updateItemNav\(\);/, '筛选标签变化（总数变化）后要刷新');
  // 删掉的旧调用不应残留
  assert.equal(/requestAnimationFrame\(updateItemNav\)/.test(APP), false, '常驻导航与高度无关，不需要 rAF 兜首帧');
});

test('默认选中「侧栏列表第一项」，而不是数据文件里的第一项', () => {
  const init = bodyOf('function initState() {', 2600);
  assert.equal(/itemId: DATA\.items\.length \? DATA\.items\[0\]\.tradeId/.test(init), false,
    '不应再用数据文件里的第一项（侧栏按报告日期倒序，两者顺序不同）');
  assert.match(init, /const first = filteredItems\(\)\[0\];/, '应按侧栏（排序 + 筛选后）列表取首项');
  assert.match(init, /if \(first\) state\.itemId = first\.tradeId;/, '默认 itemId = 侧栏首项');
  // 多文件模式的预加载也要跟着走，否则选中项还没 hydrate
  assert.match(bodyOf('async function ensureHashItemLoaded(', 600), /const fallback = \(state && state\.itemId\)/,
    'hash 里没有有效 item 时应回退到当前选中项');
});

test('i18n：位置提示三语齐备', () => {
  ['zh-CN', 'zh-HK', 'en'].forEach(function (lang) {
    const v = I18N[lang].itemNavPosTitle;
    assert.equal(typeof v, 'string', lang + '.itemNavPosTitle 缺失');
    assert.ok(v.length > 0, lang + '.itemNavPosTitle 不应为空');
  });
});
