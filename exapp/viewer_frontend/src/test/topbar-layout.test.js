// 顶栏（.topbar）布局回归测试：
// 英文界面 + 长批次名在宽屏下曾把右侧控件组（当前批次 / 环境 / 主题 / 语言 / 按钮）挤到第二行，
// 这里锁定修复后的关键约束：左侧可压缩、右侧靠右且不压缩、标题单行省略。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.dirname(TEST_DIR);
const html = fs.readFileSync(path.join(SRC_DIR, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(SRC_DIR, 'public', 'app.js'), 'utf8');

test('顶栏左侧可压缩：.topbar-left 有 min-width:0 与显式 flex-basis', () => {
  assert.match(html, /\.topbar-left\s*\{[^}]*min-width:\s*0[^}]*\}/,
    '.topbar-left 必须允许压缩（min-width: 0），否则长标题会把右侧控件组挤到第二行');
  assert.match(html, /\.topbar-left\s*\{[^}]*flex:\s*1\s+1\s+\d+px[^}]*\}/,
    '.topbar-left 的 flex-basis 必须是固定值（而非 auto），避免按内容宽度参与换行计算');
});

test('顶栏右侧控件组：不压缩、始终靠右（换行时也不会贴左边缘）', () => {
  const m = html.match(/\.topbar-right\s*\{([^}]*)\}/);
  assert.ok(m, '应存在 .topbar-right 样式');
  assert.match(m[1], /flex:\s*0\s+0\s+auto/, '.topbar-right 不应被压缩（否则控件会被挤压变形）');
  assert.match(m[1], /margin-left:\s*auto/, '.topbar-right 应靠右对齐（换行时也不会贴左边缘）');
  assert.match(m[1], /display:\s*flex/, '.topbar-right 仍应为 flex 横排');
});

test('顶栏标题 / 副标题：单行 + 省略号，且悬停可看全文', () => {
  assert.match(html, /\.topbar-title,\s*\.topbar-sub\s*\{[^}]*text-overflow:\s*ellipsis[^}]*\}/,
    '标题与副标题应单行省略，而不是撑开顶栏');
  assert.match(html, /\.topbar-title,\s*\.topbar-sub\s*\{[^}]*white-space:\s*nowrap[^}]*\}/,
    '标题与副标题应 nowrap');
  assert.match(app, /titleEl\.title = t\('appTitle'\)/, 'appTitle 应同步 title 属性（悬停显示全文）');
  assert.match(app, /subEl\.title = t\('appSub'\)/, 'appSub 应同步 title 属性（悬停显示全文）');
});
