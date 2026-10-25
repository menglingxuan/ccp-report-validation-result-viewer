// 批次 dock 方块角标（收藏 ★ / 钉住 / 版本不兼容 / 新批次）回归测试。
//
// 背景：Chromium 会把 <button> 自身的背景绘制在其内部内容（含绝对定位的子元素 / 伪元素）之上，
// 于是 `.bd-chip.fav::before` 星标的右下角会被方块底色盖掉（active 时方块是实心 accent 色，
// 遮挡尤其明显）。修复方式：方块外套一层 `.bd-slot`（position: relative），角标不再是按钮的
// 子元素 / 伪元素，而是 DOM 中位于按钮之后的兄弟节点 —— 同级定位元素按文档顺序绘制，角标因此
// 完整显示在方块上层。
//
// app.js 的渲染逻辑位于 DOM 闭包内，Node 无法执行，故对 public/ 源码做结构断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = path.join(SRC_DIR, 'public');
const APP = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

function bodyOf(sig, len = 2000) {
  const i = APP.indexOf(sig);
  assert.notEqual(i, -1, '未找到源码片段：' + sig);
  return APP.slice(i, i + len);
}

test('dock 方块：角标挂在 .bd-slot 槽位里，且不是 <button> 的子元素', () => {
  const dock = bodyOf('function renderBatchDock(', 3600);
  assert.match(dock, /'<span class="bd-slot">'/, '每个方块应包在 .bd-slot 槽位中');
  // 方块按钮必须自闭合（内部只放日号），角标一律拼在按钮之外。
  assert.match(dock, /<\/button>' \+\s*\n\s*\(fav \? '<span class="bd-fav-star"/,
    '收藏 ★ 角标必须是按钮之后的兄弟节点（放进 button 内会被 button 背景盖住）');
  assert.equal(/<span class="bd-new-dot"[^>]*><\/span>' : ''\) \+ '<\/button>'/.test(dock), false,
    '新批次圆点不应再放在 <button> 内部');
  ['bd-fav-star', 'bd-pin-dot', 'bd-incompat-dot', 'bd-new-dot'].forEach(function (cls) {
    assert.match(dock, new RegExp("class=\"" + cls + "\""), '缺少角标：' + cls);
  });
});

test('dock 方块：角标是装饰（aria-hidden，无 title），状态进方块 aria-label', () => {
  const dock = bodyOf('function renderBatchDock(', 3600);
  ['bd-fav-star', 'bd-pin-dot', 'bd-incompat-dot', 'bd-new-dot'].forEach(function (cls) {
    assert.match(dock, new RegExp('class="' + cls + '" aria-hidden="true"'),
      cls + ' 应加 aria-hidden（否则读屏会单独念出 ★）');
  });
  // pointer-events: none 时 title 永远不会弹，属于死属性（.bd-empty 之类非角标元素不受影响）。
  assert.equal(/class="bd-(fav-star|pin-dot|incompat-dot|new-dot)" title=/.test(dock), false,
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
  assert.match(HTML, /\.bd-fav-star,\s*\.bd-pin-dot,\s*\.bd-incompat-dot,\s*\.bd-new-dot\s*\{\s*position:\s*absolute;\s*pointer-events:\s*none;\s*\}/,
    '四个角标都应是绝对定位（相对 .bd-slot）且 pointer-events: none（点击 / 悬停仍落到方块上）');
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
