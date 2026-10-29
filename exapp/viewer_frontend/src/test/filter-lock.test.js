// 「锁定过滤」（切换 item 时保留当前字段比较过滤，实现逐 item 查看同一批字段）回归测试。
//
// 设计要点（改代码前先读这里）：
// 1) 锁定 **不是快照**：只是「切 item 时不复位过滤」。因此锁定后改过滤是实时生效的，
//    不会出现「快照过期 → 下次切 item 把用户刚改的条件回退掉」。
// 2) 适用范围：字段比较的过滤（渠道 / 来源渠道 / 搜索词 / 列头过滤 / EO·AO 特殊值）。
//    **不包含**消息类列过滤（切 tab 本就清零）与侧栏 item 过滤器（那会把自己锁死在列表里）。
// 3) 只有渠道 / 来源渠道会「随 item 不适用」（判定在 core.js 的 scopeFilterDrops）；
//    其余过滤最坏结果是 0 条，不算不适用 —— 空表另有提示，不当作 bug。
// 4) 生命周期：手点按钮/「清除全部」/快捷键 L → 解锁；切批次 → initState 重建 state 自动清零；
//    刷新 → 不落 localStorage、不进 hash，自动清零。
//
// app.js 的渲染逻辑在 DOM 闭包里（Node 无法执行），故对源码做结构断言；判定逻辑是纯函数，直接单测。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scopeFilterDrops } from '../public/core.js';

const PUBLIC_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const APP = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const I18N = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'i18n.json'), 'utf8'));

function bodyOf(sig, len = 2000) {
  const i = APP.indexOf(sig);
  assert.notEqual(i, -1, '未找到源码片段：' + sig);
  return APP.slice(i, i + len);
}

// 夹具：HKTR（来源 A/B + 一个禁用来源）、JSFA（来源 A）、一个整体禁用的渠道 CFTC。
const ITEM = {
  channels: [
    { name: 'HKTR', sources: [{ name: '来源渠道 A' }, { name: '来源渠道 B' }, { name: '来源渠道 C', enabled: false }] },
    { name: 'JSFA', sources: [{ name: '来源渠道 A' }] },
    { name: 'CFTC', enabled: false, sources: [{ name: '来源渠道 A' }] },
  ],
};

test('scopeFilterDrops：渠道 / 来源渠道是唯一会「随 item 不适用」的过滤维度', () => {
  assert.deepEqual(scopeFilterDrops(ITEM, 'ALL', 'ALL'), [], '无作用域过滤时无可丢弃');
  assert.deepEqual(scopeFilterDrops(ITEM, '', ''), [], '空值视同 ALL');
  assert.deepEqual(scopeFilterDrops(ITEM, 'HKTR', 'ALL'), [], '渠道存在 → 保留');
  assert.deepEqual(scopeFilterDrops(ITEM, 'HKTR', '来源渠道 B'), [], '来源渠道在所选渠道内 → 保留');
  assert.deepEqual(scopeFilterDrops(ITEM, 'NOPE', 'ALL'), ['channel'], 'item 里没有该渠道 → 丢弃渠道');
  assert.deepEqual(scopeFilterDrops(ITEM, 'CFTC', 'ALL'), ['channel'], '渠道被禁用（enabled:false）也算不存在');
  assert.deepEqual(scopeFilterDrops(ITEM, 'JSFA', '来源渠道 B'), ['source'], '该渠道下没有这个来源 → 丢弃来源');
  assert.deepEqual(
    scopeFilterDrops(ITEM, 'ALL', '来源渠道 B'), [],
    '渠道为 ALL 时来源按全部启用渠道判定（B 存在于 HKTR）');
  assert.deepEqual(
    scopeFilterDrops(ITEM, 'NOPE', '来源渠道 B'), ['channel'],
    '渠道丢弃后来源按全部启用渠道再判 → B 存在，只丢渠道');
  assert.deepEqual(
    scopeFilterDrops(ITEM, 'JSFA', '来源渠道 C'), ['source'],
    '禁用的来源渠道不算存在');
  assert.deepEqual(scopeFilterDrops(ITEM, 'NOPE', 'NOPE-SRC'), ['channel', 'source'], '两个维度都不存在');
  assert.deepEqual(scopeFilterDrops({ channels: [] }, 'HKTR', '来源渠道 A'), ['channel', 'source'], '空 item 全部丢弃');
  assert.deepEqual(scopeFilterDrops(null, 'HKTR', '来源渠道 A'), ['channel', 'source'], 'item 缺失时安全');
});

test('锁定 = 切 item 不复位：复位块只在未锁定分支里', () => {
  const mode = bodyOf('function applyItemFilterMode() {', 900);
  assert.match(mode, /if \(state\.filtersLocked\) return dropInapplicableLockedFilters\(\);/, '锁定分支应保留过滤并只丢不可应用的');
  assert.match(mode, /state\.channel = 'ALL';/, '未锁定分支仍要复位渠道');
  assert.match(mode, /state\.colFilter = \{ channel: 'ALL'/, '未锁定分支仍要整套复位列过滤');
  assert.match(mode, /state\.specialFilter = \{ eo: 'ALL', ao: 'ALL' \};/, '未锁定分支仍要复位特殊值过滤');
  assert.match(mode, /state\.search = '';/, '未锁定分支仍要清搜索词');
  // selectItem 不得再自行复位过滤（否则锁定失效）。
  const sel = bodyOf('async function selectItem(id) {', 900);
  assert.match(sel, /notifyLockDrop\(applyItemFilterMode\(\)\);/, 'selectItem 应统一走 applyItemFilterMode()');
  assert.equal(/state\.colFilter = \{/.test(sel), false, 'selectItem 不应再自行重建 colFilter');
  assert.equal(/state\.channel = 'ALL';/.test(sel), false, 'selectItem 不应再自行复位渠道');
  // 多文件模式必须先取回 item，再做可应用性判定（否则拿不到该 item 的渠道）。
  assert.match(sel, /if \(isMultiMode\(\)\) await ensureItemLoaded\(id\);\s*\n\s*notifyLockDrop/, '应先 hydrate 再判定');
});

test('三条清理路径：手动清除 / 切批次 / 刷新', () => {
  // ① 手动：「清除全部」= 清过滤 + 解锁
  assert.match(bodyOf('function clearAllFilters() {', 900), /state\.filtersLocked = false;/, '清除全部应同时解锁');
  // ② 切批次：initState() 重建 state → filtersLocked 归零（不需要额外代码）
  const init = bodyOf('function initState() {', 2400);
  assert.match(init, /filtersLocked: false,/, 'initState 应把 filtersLocked 置 false（切批次自动清除）');
  assert.match(init, /if \(searchEl\) searchEl\.value = '';/, 'initState 应清空搜索框（否则切批次后输入框留着旧搜索词而过滤已清空）');
  // ③ 刷新：不落盘、不进 URL
  assert.equal(/filtersLocked/.test(bodyOf('function savePrefs() {', 600)), false, '锁定状态不得写入 localStorage');
  assert.equal(/filtersLocked/.test(bodyOf('function stateToHash() {', 2400)), false, '锁定状态不得写入 URL hash');
  assert.equal(/filtersLocked/.test(bodyOf('export function parseHash(raw) {', 600)), false, 'hash 解析不应涉及锁定状态');
});

test('锁定一个空集合会自动解除（避免「已锁定 0 项」）', () => {
  const chips = bodyOf('function renderFilterChips() {', 1800);
  assert.match(chips, /if \(state\.filtersLocked && lockCount === 0\) state\.filtersLocked = false;/,
    '没有可锁定的过滤时应自动解锁');
  assert.match(chips, /const lockCount = lockedFilterKeys\(\)\.length;/, '锁定项数应来自 lockedFilterKeys()');
  assert.match(chips, /data-lock-filters="1"/, '锁定按钮需要 data-lock-filters 钩子');
  assert.match(chips, /aria-pressed="/, '锁定按钮应有 aria-pressed 状态');
  assert.match(chips, /innerHTML = lockBtn \+ html \+ clearAll;/, '锁定按钮应位于过滤标签行首（位置稳定）');
  // 点击接线
  assert.match(bodyOf("document.getElementById('filterChips').addEventListener", 400),
    /if \(e\.target\.closest\('\[data-lock-filters\]'\)\) \{ toggleFilterLock\(\); return; \}/, '应处理锁定按钮的点击');
  // 快捷键 L
  assert.match(bodyOf("if ((e.key === 'l' || e.key === 'L')", 300), /toggleFilterLock\(\)/, 'L 应切换锁定');
});

test('锁定按钮的数字 = 当前 tab 可见的锁定标签数（不会「已锁定 1 却 0 个标签」）', () => {
  const chips = bodyOf('function renderFilterChips() {', 2200);
  assert.match(chips, /const shown = lockedVisibleCount\(\);/, '数字应取自 lockedVisibleCount()');
  assert.match(chips, /esc\(t\('lockFiltersOn'\)\) \+ ' ' \+ shown/, '按钮文案应使用 shown');
  assert.equal(/lockFiltersOn'\)\) \+ ' ' \+ lockCount/.test(chips), false,
    '不得再用锁定总数：列头过滤在消息类 tab 没有对应标签，会出现「已锁定 N 但 0 个标签」');
  // 已锁定但在本 tab 没有可见的锁定标签 → 不渲染按钮（宁可不显示，也不显示一个对不上的数字）
  assert.match(chips, /\(locked \? shown > 0 : \(state\.tab === 'fields' && lockCount > 0\)\)/,
    '按钮出现条件应与可见锁定标签数挂钩');

  const vis = bodyOf('function lockedVisibleCount() {', 900);
  assert.match(vis, /if \(state\.tab === 'fields'\) return ACTIVE_FILTERS\.length;/, '字段比较 tab：锁定的就是当前这组过滤');
  ['state.channel !== ', 'state.source', 'state.search.trim()'].forEach(function (k) {
    assert.ok(vis.indexOf(k) !== -1, '消息类 tab 应只统计共享作用域三项：' + k);
  });
  assert.equal(/msgFilter/.test(vis), false, 'msgFilter 从不锁定，不应计入可见锁定数');
  // 前提：字段 tab 的可见标签与锁定键同源（都用 state.tab === 'fields' 分支）
  assert.match(bodyOf('function activeFilters() {', 3000), /if \(state\.tab === 'fields'\) \{/,
    'activeFilters 的字段过滤标签只在 fields tab 产生，因此 ACTIVE_FILTERS.length 才能直接当锁定项数');
});

test('快捷键 L 仅在「字段比较」tab 生效（其他 tab 按下去既无标签也无按钮）', () => {
  assert.match(bodyOf("if ((e.key === 'l' || e.key === 'L')", 200), /&& state\.tab === 'fields'/,
    'L 应只在字段比较 tab 生效');
});

test('锁定范围：字段比较的过滤都算，消息列过滤与侧栏 item 过滤不算', () => {
  const keys = bodyOf('function lockedFilterKeys() {', 900);
  ['channel', 'source', 'search', 'colFilter', 'specialFilter'].forEach(function (k) {
    assert.ok(keys.indexOf(k) !== -1, '锁定的过滤项应包含 ' + k);
  });
  assert.equal(/msgFilter/.test(keys), false, '消息类列过滤不参与锁定（切 tab 本就清零）');
  assert.equal(/itemFilter|itemSearch|itemPlatforms/.test(keys), false, '侧栏 item 过滤器不参与锁定（否则把自己锁死在列表里）');
});

test('页脚常驻提示 + 空表提示（0 条 ≠ 过滤不可应用）', () => {
  const footer = bodyOf('function fieldsFooterHTML(total, pages) {', 600);
  assert.match(footer, /state\.filtersLocked \? lockedFilterKeys\(\)\.length : 0/, '页脚应显示锁定项数');
  assert.match(footer, /t\('lockFooter'\)\.replace\('\{N\}', lockCount\)/, '页脚提示应使用 lockFooter 文案');
  assert.match(bodyOf('function buildFieldRows(pageRows) {', 900), /esc\(fieldsEmptyHint\(\)\)/, '空表应走 fieldsEmptyHint()');
  assert.match(bodyOf('function fieldsEmptyHint() {', 400), /t\('lockEmptyHint'\)\.replace\('\{N\}', n\)/, '锁定时的空表提示应说明是过滤结果');
});

test('样式与三语文案齐备', () => {
  assert.match(HTML, /\.filter-lock \{[^}]*border-radius: 999px/, '.filter-lock 应为胶囊按钮');
  assert.match(HTML, /\.filter-lock\.on \{[^}]*background: var\(--accent\)/, '锁定中应实心高亮');
  assert.match(HTML, /\.filters \{[^}]*display: flex/, '.filters 仍是 flex 容器（锁定按钮与前后的标签同行）');
  const need = ['lockFilters', 'lockFiltersOn', 'lockFiltersTip', 'lockFiltersOnTip', 'lockDropped', 'lockFooter', 'lockEmptyHint'];
  ['zh-CN', 'zh-HK', 'en'].forEach(function (lang) {
    need.forEach(function (k) {
      assert.equal(typeof I18N[lang][k], 'string', lang + '.' + k + ' 缺失');
      assert.ok(I18N[lang][k].length > 0, lang + '.' + k + ' 不应为空');
    });
    assert.match(I18N[lang].lockDropped, /\{label\}/, lang + '.lockDropped 应含 {label}');
    assert.match(I18N[lang].lockFooter, /\{N\}/, lang + '.lockFooter 应含 {N}');
    assert.match(I18N[lang].lockEmptyHint, /\{N\}/, lang + '.lockEmptyHint 应含 {N}');
  });
});

test('点渠道 tab 只重置作用域两键，不再整体重建 colFilter（否则表现为「锁定失效」）', () => {
  const i = APP.indexOf("const el = e.target.closest('[data-channel]');");
  assert.notEqual(i, -1, '未找到渠道 tab 的点击分支');
  const block = APP.slice(i, i + 700);
  assert.match(block, /state\.colFilter\.channel = state\.channel;/, '应只更新 colFilter.channel');
  assert.match(block, /state\.colFilter\.source = 'ALL';/, '应只更新 colFilter.source');
  assert.equal(/state\.colFilter = \{/.test(block), false, '不得整体重建 colFilter（会连带清掉字段列头过滤器）');
});
