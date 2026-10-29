// 悬停提示里的快捷键后缀（对齐工具栏「健康总览（H）」「全局搜索（G）」的惯例）回归测试。
//
// 覆盖三类入口：
//   a) item 导航（侧栏标题 hover 箭头 + 详情标题栏常驻 ‹ N / M ›）→ 上一个 K / 下一个 J；
//   b) 字段详情页的字段导航按钮 → 上一个 ← / 下一个 →（弹窗内 keydown 真正绑定的是 ArrowLeft/ArrowRight）；
//   c) 主列表「报告字段」链接 → 单击打开详情页（键盘路径：聚焦行后 Enter）；
//      原来的括号内容「（详情页 ▸ 可定位关联日志行）」已移除，避免提示过长。
//
// 三语文案都要带后缀；app.js 侧只做接线断言（提示文本来自 i18n，不用再拼接）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const APP = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
const I18N = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'i18n.json'), 'utf8'));
const LANGS = ['zh-CN', 'zh-HK', 'en'];

function bodyOf(sig, len = 2000) {
  const i = APP.indexOf(sig);
  assert.notEqual(i, -1, '未找到源码片段：' + sig);
  return APP.slice(i, i + len);
}

test('a) item 导航提示带 J / K（两处入口共用同一份文案）', () => {
  LANGS.forEach(function (lang) {
    assert.match(I18N[lang].prevItem, /[（(]K[）)]/, lang + '.prevItem 应带 (K) 后缀');
    assert.match(I18N[lang].nextItem, /[（(]J[）)]/, lang + '.nextItem 应带 (J) 后缀');
  });
  // 两处入口都通过 itemNavButtonHTML 渲染 title/aria-label → 自动带上后缀
  const btn = bodyOf('function itemNavButtonHTML(', 400);
  assert.match(btn, /title="' \+ esc\(label\) \+ '"/, 'title 直接用传入的 label（i18n 文案）');
  assert.match(btn, /aria-label="' \+ esc\(label\) \+ '"/, 'aria-label 同步');
  assert.match(bodyOf('function updateItemNav() {', 900), /t\('prevItem'\)/, '常驻导航用同一份 prevItem 文案');
  // 快捷键本身仍然是 J / K（避免文案与实现漂移）
  assert.match(bodyOf("if (e.key === 'j' || e.key === 'J')", 300), /moveItem\(1\)/, 'J = 下一个 item');
  assert.match(bodyOf("if (e.key === 'k' || e.key === 'K')", 300), /moveItem\(-1\)/, 'K = 上一个 item');
});

test('b) 字段详情页导航提示带 ← / →，且弹窗内确实绑定 ArrowLeft / ArrowRight', () => {
  LANGS.forEach(function (lang) {
    assert.match(I18N[lang].modalPrevField, /←/, lang + '.modalPrevField 应带 ← 后缀');
    assert.match(I18N[lang].modalNextField, /→/, lang + '.modalNextField 应带 → 后缀');
  });
  const navBtns = bodyOf("'<button class=\"modal-nav\" data-modal-nav=\"prev\"", 400);
  assert.match(navBtns, /title="' \+ t\('modalPrevField'\) \+ '"/, '上一个字段按钮用 modalPrevField');
  assert.match(navBtns, /title="' \+ t\('modalNextField'\) \+ '"/, '下一个字段按钮用 modalNextField');
  assert.match(bodyOf("if (e.key === 'ArrowLeft' || e.key === 'ArrowRight')", 400),
    /const dir = e\.key === 'ArrowLeft' \? 'prev' : 'next';/, '弹窗内 ← / → 应触发字段切换');
});

test('c) 报告字段链接：提示改为单击 + Enter，不再保留原括号说明', () => {
  LANGS.forEach(function (lang) {
    const tip = I18N[lang].viewCompareDetailTip;
    assert.match(tip, /Enter/, lang + '.viewCompareDetailTip 应带 Enter 后缀');
    assert.equal(/▸/.test(tip), false, lang + '.viewCompareDetailTip 不应再描述详情页的 ▸ 跳转');
    assert.equal(/双击|雙擊|double-click/i.test(tip), false, lang + '.viewCompareDetailTip 不应提双击');
  });
  assert.match(bodyOf('function fieldCellHTML(', 2500),
    /title="' \+ esc\(t\('viewCompareDetailTip'\)\) \+ '"/, '报告字段链接应使用该提示');
  // Enter 的键盘路径：聚焦字段行后 Enter 打开详情页
  assert.match(bodyOf("if (fid) { const loc = parseFieldLoc(fid);", 200),
    /openModal\(loc\.channel, loc\.source, loc\.id\)/, '聚焦行 Enter 应打开字段详情');
});

test('帮助面板的快捷键清单包含新增的两条', () => {
  const HELP = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'batch-help.json'), 'utf8'));
  LANGS.forEach(function (lang) {
    const sections = HELP[lang].sections;
    const kbd = sections.filter(function (s) { return /快捷键|快捷鍵|Keyboard/i.test(s.h); })[0];
    assert.ok(kbd, lang + ' 缺少键盘快捷键小节');
    const text = (kbd.items || []).join('\n');
    assert.match(text, /Enter/, lang + ' 快捷键小节应提到 Enter');
    assert.match(text, /←|→/, lang + ' 快捷键小节应提到 ← / →');
  });
});
