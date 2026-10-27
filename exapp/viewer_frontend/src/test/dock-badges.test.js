// 批次 dock 方块角标（收藏 ★ / 钉住 / 版本不兼容 / 新批次）回归测试。
//
// 背景：Chromium 会把 <button> 自身的背景绘制在其内部内容（含绝对定位的子元素 / 伪元素）之上，
// 于是 `.bd-chip.fav::before` 星标的右下角会被方块底色盖掉（active 时方块是实心 accent 色，
// 遮挡尤其明显）。修复方式：方块外套一层 `.bd-slot`（position: relative），角标不再是按钮的
// 子元素 / 伪元素，而是 DOM 中位于按钮之后的兄弟节点 —— 同级定位元素按文档顺序绘制，角标因此
// 完整显示在方块上层。
//
// 角位约定：四个角标类型统一挂在方块左上角，且同一时刻最多只显示一个 ——
// 优先级 新增 > 置顶 > 收藏 ★ > 版本不兼容（判定见 core.js 的 dockBadgeOf()）。
// 优先级低的状态不改角位、直接不显示（方块四周挂满标记会显得杂乱）。
// 形状：新增 = 红色实心圆点、置顶 = 实心菱形、收藏 = 金色 ★、不兼容 = 橙色实心圆点。
//
// app.js 的渲染逻辑位于 DOM 闭包内，Node 无法执行，故对 public/ 源码做结构断言；
// 优先级判定本身是纯函数，直接单测真实行为。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dockBadgeOf } from '../public/core.js';

const SRC_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = path.join(SRC_DIR, 'public');
const APP = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

function bodyOf(sig, len = 2000) {
  const i = APP.indexOf(sig);
  assert.notEqual(i, -1, '未找到源码片段：' + sig);
  return APP.slice(i, i + len);
}

test('dock 方块：只渲染一个角标，挂在 .bd-slot 槽位里且不是 <button> 的子元素', () => {
  const dock = bodyOf('function renderBatchDock(', 3600);
  assert.match(dock, /'<span class="bd-slot">'/, '每个方块应包在 .bd-slot 槽位中');
  // 方块按钮必须自闭合（内部只放日号），角标一律拼在按钮之外。
  assert.match(dock, /<\/button>' \+\s*\n\s*dockBadgeHTML\(badge\) \+/,
    '角标必须是按钮之后的兄弟节点（放进 button 内会被 button 背景盖住）');
  assert.equal(/bd-new-dot[^>]*><\/span>' : ''\) \+ '<\/button>'/.test(dock), false,
    '新批次角标不应再放在 <button> 内部');
  // 四个角标 HTML 集中在 dockBadgeHTML() 里，由 dockBadgeOf() 选出一个（旧写法是四个并列三元表达式）。
  const badgeFn = bodyOf('function dockBadgeHTML(', 900);
  ['bd-fav-star', 'bd-pin-dot', 'bd-incompat-dot', 'bd-new-dot'].forEach(function (cls) {
    assert.match(badgeFn, new RegExp('class="' + cls + '"'), '缺少角标：' + cls);
  });
  assert.equal(/has-fav/.test(APP), false, '不应再有 has-fav 角标避让逻辑（低优先级角标直接不显示）');
});

test('dock 方块：角标是装饰（aria-hidden，无 title），状态进方块 aria-label', () => {
  const dock = bodyOf('function renderBatchDock(', 3600);
  const badgeFn = bodyOf('function dockBadgeHTML(', 900);
  ['bd-fav-star', 'bd-pin-dot', 'bd-incompat-dot', 'bd-new-dot'].forEach(function (cls) {
    assert.match(badgeFn, new RegExp('class="' + cls + '" aria-hidden="true"'),
      cls + ' 应加 aria-hidden（否则读屏会单独念出角标内容）');
  });
  // 四个角标都是纯图形（无文字）：文案统一进方块 aria-label，避免不同语言下的宽度差异。
  assert.equal(/bd-new-dot[^>]*>[^<]/.test(badgeFn), false, '新增角标不应含文字（纯圆点，文案只进 aria-label）');
  // pointer-events: none 时 title 永远不会弹，属于死属性（.bd-empty 之类非角标元素不受影响）。
  assert.equal(/class="bd-(fav-star|pin-dot|incompat-dot|new-dot)" title=/.test(APP), false,
    '角标不应再带 title（pointer-events: none 时不会显示）');
  // 状态（收藏 / 置顶 / 版本不兼容 / 新批次）改由 aria-label 承载。
  assert.match(dock, /states\.push\(t\('bdFavAria'\)\)/, '收藏状态应进 aria-label');
  assert.match(dock, /states\.push\(t\('pinTitle'\)\)/, '置顶状态应进 aria-label');
  assert.match(dock, /states\.push\(t\('batchIncompat'\)\)/, '版本不兼容状态应进 aria-label');
  assert.match(dock, /states\.push\(t\('batchNew'\)\)/, '新批次状态应进 aria-label');
  assert.match(dock, /aria-label="' \+ esc\(label\) \+ '"/, 'aria-label 应使用拼好的 label（名称 · 时间 · 状态…）');
});

test('dock 方块角标：定位基准是槽位，且 pointer-events 穿透到方块', () => {
  assert.match(HTML, /\.bd-slot\s*\{[^}]*position:\s*relative[^}]*\}/,
    '.bd-slot 需要 position: relative 作为角标定位基准');
  const baseRe = /\.bd-fav-star,\s*\.bd-pin-dot,\s*\.bd-incompat-dot,\s*\.bd-new-dot\s*\{([^}]*)\}/;
  assert.match(HTML, baseRe, '四个角标应共用一条基础定位样式');
  const base = HTML.match(baseRe)[1];
  assert.match(base, /position:\s*absolute;/, '角标应相对 .bd-slot 绝对定位');
  assert.match(base, /pointer-events:\s*none;/, '点击 / 悬停应穿透到方块');
  assert.match(base, /top:\s*-4px;/, '所有角标统一贴左上角（top: -4px）');
  assert.match(base, /left:\s*-4px;/, '所有角标统一贴左上角（left: -4px）');
  // 单角位：任何角标规则都不应再用 right / bottom（多角位会让方块四周挂满标记）。
  ['fav-star', 'pin-dot', 'incompat-dot', 'new-dot'].forEach(function (name) {
    const re = new RegExp('\\.bd-' + name + '\\s*\\{([^}]*)\\}', 'g');
    let hit;
    while ((hit = re.exec(HTML)) !== null) {
      assert.equal(/\b(right|bottom)\s*:/.test(hit[1]), false, '.bd-' + name + ' 不应再使用 right / bottom（角标统一在左上角）');
    }
  });
  // 旧的伪元素写法会把角标画到 button 背景下面，必须移除。
  assert.equal(/\.bd-chip\.fav::before/.test(HTML), false, '不应再用 .bd-chip.fav::before（会被 button 背景遮挡）');
  assert.equal(/\.bd-chip\.pinned::before/.test(HTML), false, '不应再用 .bd-chip.pinned::before（同上）');
  assert.equal(/\.bd-chip\.incompat::after/.test(HTML), false, '不应再用 .bd-chip.incompat::after（同上）');
  // 方块自身不再需要定位上下文（角标不在它里面），留 position: relative 会误导后来者。
  const chipRule = HTML.match(/\.bd-chip\s*\{([^}]*)\}/);
  assert.ok(chipRule, '应存在 .bd-chip 样式');
  assert.equal(/position:\s*relative/.test(chipRule[1]), false, '.bd-chip 不应再有 position: relative（定位基准是 .bd-slot）');
});

test('dock 方块收藏星标：完整可见（10px + 同色描边，不靠裁剪）', () => {
  const m = HTML.match(/\.bd-fav-star\s*\{([^}]*)\}/);
  assert.ok(m, '应存在 .bd-fav-star 样式');
  assert.match(m[1], /font-size:\s*10px/, '星标字号 10px（9px 太小，压在实心方块上看不清）');
  assert.match(m[1], /text-shadow:[^;]*var\(--card\)/, '应加卡片同色描边，保证压在实心方块上轮廓清晰');
  assert.match(m[1], /color:\s*#eab308/, '星标保持金黄色');
});

test('dock 方块角标：新增/不兼容 = 实心圆点，置顶 = 实心菱形', () => {
  const rule = function (cls) {
    // 选择器必须以行首开始：否则会匹配到 `.bd-fav-star, .bd-pin-dot, … {` 这条基础规则。
    const m = HTML.match(new RegExp('\\n\\s*\\.' + cls + '\\s*\\{([^}]*)\\}'));
    assert.ok(m, '应存在 .' + cls + ' 样式');
    return m[1];
  };
  // 用户明确要求：新增用红色实心圆点（不用文字胶囊），不兼容保持橙色实心圆点。
  const fresh = rule('bd-new-dot');
  assert.match(fresh, /background:\s*var\(--fail\)/, '新增 = 红色实心圆点');
  assert.match(fresh, /border-radius:\s*50%/, '新增应是圆形');
  assert.equal(/font-size|padding/.test(fresh), false, '新增角标不应再是文字胶囊');
  const incompat = rule('bd-incompat-dot');
  assert.match(incompat, /background:\s*var\(--warn\)/, '不兼容 = 橙色实心圆点');
  assert.match(incompat, /border-radius:\s*50%/, '不兼容应是圆形');
  // 新增与不兼容同为圆点（形状相同），只靠填充色区分：两条规则必须各用不同的颜色 token。
  const sizeOf = (body) => (body.match(/width:\s*(\d+(?:\.\d+)?)px/) || [])[1];
  assert.equal(sizeOf(fresh), sizeOf(incompat), '新增与不兼容圆点尺寸应一致');
  const pin = rule('bd-pin-dot');
  assert.match(pin, /transform:\s*rotate\(45deg\)/, '置顶 = 实心菱形（旋转 45° 的方块，形状与圆形不同）');
  assert.match(pin, /background:\s*var\(--accent\)/, '置顶保持主色实心');
  // 三条规则必须互不相同。
  assert.notEqual(fresh, pin);
  assert.notEqual(fresh, incompat);
  assert.notEqual(pin, incompat);
});

test('dock 方块角标优先级：新增 > 置顶 > 收藏 ★ > 版本不兼容，只显示最高优先项', () => {
  assert.equal(dockBadgeOf({ fresh: true, pinned: true, fav: true, compatible: false }), 'new', '新增优先于其它一切状态');
  assert.equal(dockBadgeOf({ fresh: false, pinned: true, fav: true, compatible: false }), 'pin', '置顶优先于收藏 / 不兼容');
  assert.equal(dockBadgeOf({ fresh: false, pinned: false, fav: true, compatible: false }), 'fav', '收藏优先于版本不兼容');
  assert.equal(dockBadgeOf({ fresh: false, pinned: false, fav: false, compatible: false }), 'incompat', '仅不兼容时显示不兼容角标');
  assert.equal(dockBadgeOf({ fresh: false, pinned: false, fav: false, compatible: true }), '', '无状态时无角标');
  // `compatible` 缺省（undefined）不应被当成不兼容。
  assert.equal(dockBadgeOf({}), '');
  assert.equal(dockBadgeOf(null), '');
  // 低优先级状态不回退到其它角位，只是不显示（这里只返回一个值）。
  assert.equal(typeof dockBadgeOf({ pinned: true }), 'string');
  assert.equal(dockBadgeOf({ pinned: true }).indexOf(','), -1, '不应返回多个角标');
});
