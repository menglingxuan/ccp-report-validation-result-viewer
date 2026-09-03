// WCAG 对比度自动校验：解析 HTML 中各主题的 CSS 变量，计算前景/背景对比度。
// 用法: node check-contrast.js
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'src', 'engine', 'report-validation-result.html'), 'utf8');

function parseVars(block) {
  const out = {};
  const re = /--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  let m;
  while ((m = re.exec(block))) out[m[1]] = m[2];
  return out;
}

const blocks = {};
const root = html.match(/:root\s*\{([^}]*)\}/);
if (root) blocks.light = parseVars(root[1]);
const themeRe = /^body\.theme-([a-z]+)\s*\{([^}]*)\}/gm;
let tm;
while ((tm = themeRe.exec(html))) blocks[tm[1]] = Object.assign({}, blocks.light, parseVars(tm[2]));

function lum(hex) {
  let c = hex.replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  if (c.length === 8) c = c.slice(0, 6); // 去掉 alpha
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const f = v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const la = lum(a), lb = lum(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const pairs = [
  ['text', 'bg', 4.5, '正文/背景'],
  ['text', 'card', 4.5, '正文/卡片'],
  ['text', 'surface', 4.5, '正文/表面'],
  ['muted', 'bg', 4.5, '次要文字/背景'],
  ['muted', 'card', 4.5, '次要文字/卡片'],
  ['muted', 'surface', 4.5, '次要文字/表面'],
  ['accent', 'bg', 4.5, '链接/背景'],
  ['accent', 'surface', 4.5, '链接/表面'],
  ['pass', 'pass-bg', 4.5, '通过徽章'],
  ['fail', 'fail-bg', 4.5, '失败徽章'],
  ['warn', 'warn-bg', 4.5, '警告徽章'],
];

let failCount = 0;
Object.keys(blocks).forEach(function (theme) {
  const v = blocks[theme];
  console.log('\n=== ' + theme + ' ===');
  pairs.forEach(function ([fg, bg, thr, label]) {
    if (!v[fg] || !v[bg]) return;
    const r = contrast(v[fg], v[bg]);
    const ok = r >= thr;
    if (!ok) failCount++;
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + r.toFixed(2).padStart(5) + ':1  ' + label + '  (' + v[fg] + ' on ' + v[bg] + ')');
  });
});

console.log('\n合计 FAIL: ' + failCount + ' 处');
process.exit(failCount ? 1 : 0);
