// i18n 契约测试：三种语言键集必须 1:1，且不存在「代码里从未引用」的死键。
// 覆盖范围：public/ 下的 app.js / index.html / core.js / worker.js（前端所有 i18n 使用点）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const I18N = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'i18n.json'), 'utf8'));
const LANGS = Object.keys(I18N);
const BASE_LANG = 'zh-CN';

// 拼成一份「前端源码」文本，用于判断键是否被引用（'key' / "key" / >key< 三种写法）。
const FRONTEND_SRC = ['app.js', 'index.html', 'core.js', 'worker.js']
  .map((f) => fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8'))
  .join('\n');

test('i18n：语言集合完整（zh-CN / zh-HK / en）', () => {
  assert.deepEqual(LANGS.sort(), ['en', 'zh-CN', 'zh-HK']);
});

test('i18n：各语言键集与 zh-CN 完全一致（1:1）', () => {
  const base = Object.keys(I18N[BASE_LANG]);
  LANGS.forEach((lang) => {
    const keys = Object.keys(I18N[lang]);
    const missing = base.filter((k) => !(k in I18N[lang]));
    const extra = keys.filter((k) => !(k in I18N[BASE_LANG]));
    assert.deepEqual(missing, [], lang + ' 缺少键');
    assert.deepEqual(extra, [], lang + ' 存在多余键');
  });
});

test('i18n：不存在死键（每个键都在前端源码中被引用）', () => {
  const dead = Object.keys(I18N[BASE_LANG]).filter((k) =>
    FRONTEND_SRC.indexOf("'" + k + "'") === -1
    && FRONTEND_SRC.indexOf('"' + k + '"') === -1
    && FRONTEND_SRC.indexOf('>' + k + '<') === -1);
  assert.deepEqual(dead, [], '以下键未被任何前端代码引用（应删除或接线）：' + dead.join(', '));
});

// 反向检查：源码里写死的 t('key') 必须在三种语言中都存在（防止把未定义的键渲染成字面量）。
test('i18n：源码引用的字面量键均已定义', () => {
  const used = new Set();
  const re = /(?<![A-Za-z0-9_$.])t\(\s*(['"])([^'"]+)\1/g;
  let m;
  while ((m = re.exec(FRONTEND_SRC)) !== null) used.add(m[2]);
  assert.ok(used.size > 100, '未解析到足够的 t() 调用，检查解析逻辑');
  LANGS.forEach((lang) => {
    const missing = [...used].filter((k) => !(k in I18N[lang])).sort();
    assert.deepEqual(missing, [], lang + ' 缺少源码引用的键：' + missing.join(', '));
  });
});

test('i18n：任务说明扩展内容（descriptionEx）相关键齐备', () => {
  const need = ['descExLoading', 'descExFilter', 'descExNoMatch',
    'descExSortTitle', 'descExPagerToggle', 'descExUnsupported', 'descExBadTable', 'descExLoadFail',
    'descExTruncated', 'descExRagged', 'descExSkipped'];
  const base = Object.keys(I18N[BASE_LANG]);
  const missing = need.filter((k) => base.indexOf(k) === -1);
  assert.deepEqual(missing, [], '缺少 descriptionEx 相关 i18n 键');
  LANGS.forEach((lang) => need.forEach((k) => {
    assert.equal(typeof I18N[lang][k], 'string', lang + '.' + k + ' 应为字符串');
    assert.ok(I18N[lang][k].length > 0, lang + '.' + k + ' 不应为空');
  }));
});
