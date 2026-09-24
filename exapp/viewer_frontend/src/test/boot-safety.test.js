// 启动/回退健壮性回归测试（源码级结构断言）。
// 说明：本文件覆盖的两处缺陷都在 app.js 的 DOM 闭包内、依赖浏览器环境，Node 单测无法直接执行，
// 因此沿用 i18n 测试的做法，对 public/ 源码做结构性断言，防止回归时又变回旧写法。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const APP = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const I18N = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'i18n.json'), 'utf8'));

// 取出以 4 空格缩进结尾的函数体（app.js 内所有顶层函数均为该缩进）。
function bodyOf(sig) {
  const i = APP.indexOf(sig);
  assert.notEqual(i, -1, '未找到：' + sig);
  const rest = APP.slice(i);
  const m = rest.match(/\n {4}\}/);
  return m ? rest.slice(0, m.index) : rest;
}

test('回退默认数据：loadDefaultReport 不在空 items 上解引用', () => {
  const body = bodyOf('async function loadDefaultReport() {');
  assert.match(body, /isMultiMode\(\) && DATA\.items\.length/, 'loadDefaultReport 缺少 items 长度保护');
  assert.doesNotMatch(body, /if \(isMultiMode\(\)\) await ensureItemLoaded\(DATA\.items\[0\]/,
    'loadDefaultReport 又回到无保护地读取 DATA.items[0]');
});

test('回退默认数据：统一入口吞掉异常且保证提示可见', () => {
  const body = bodyOf('async function fallbackToDefaultReport(notice) {');
  assert.match(body, /try \{/, 'fallbackToDefaultReport 缺少 try');
  assert.match(body, /catch \(e\)/, 'fallbackToDefaultReport 缺少 catch');
  assert.match(body, /setBatchNotice\(notice \|\| \(ok \? '' : t\('batchLoadError'\)\)\)/,
    'fallbackToDefaultReport 必须保证提示语在回退之后写入');
});

test('回退默认数据：两个入口都经由 fallbackToDefaultReport', () => {
  const onHash = bodyOf('async function onHashChange() {');
  assert.match(onHash, /await fallbackToDefaultReport\(msg\)/, 'onHashChange 未使用安全回退入口');
  assert.doesNotMatch(onHash, /await loadDefaultReport\(\);/, 'onHashChange 仍在直接 await loadDefaultReport()');
  assert.match(APP, /getElementById\('batchBackDefault'\)\.addEventListener\('click', function \(\) \{ fallbackToDefaultReport\(\); \}\)/,
    '「返回默认数据」按钮未使用安全回退入口');
});

test('启动失败：initApp 必须兜底且移除骨架层', () => {
  assert.match(APP, /initApp\(\)\.catch\(bootFailed\)/, 'initApp 调用未挂 .catch');
  const body = bodyOf('function bootFailed(err) {');
  assert.match(body, /boot\.remove\(\)/, 'bootFailed 必须移除 #boot 骨架层');
  assert.match(body, /t\('bootError'\)/, 'bootFailed 必须展示 bootError 提示');
  assert.match(body, /document\.body \|\| document\.documentElement/, 'bootFailed 不应依赖可能缺失的页面容器');
});

test('启动失败提示：「或 回到主页」指向 web 根（无查询参数 / 深链接）', () => {
  const body = bodyOf('function bootFailed(err) {');
  assert.match(body, /t\('bootErrorOr'\)/, '缺少「或」连接词');
  assert.match(body, /t\('bootErrorHome'\)/, '缺少「回到主页」链接文案');
  assert.match(body, /createElement\('a'\)/, '「回到主页」应为超链接');
  assert.match(body, /home\.href = webRootUrl\(\)/, '「回到主页」应指向 web 根（复用 webRootUrl）');
  assert.doesNotMatch(body, /location\.(search|hash)/, '提示条不应自己拼查询参数 / 深链接');
  // 站点根实现：origin + pathname，不带查询参数与 hash（顶栏「主页」按钮共用）。
  const helper = bodyOf('function webRootUrl() {');
  assert.match(helper, /location\.origin \+ location\.pathname/, 'webRootUrl 应为 origin + pathname');
  assert.doesNotMatch(helper, /location\.(search|hash)/, 'webRootUrl 不应携带查询参数 / 深链接');
  assert.match(HTML, /\.boot-error-home \{/, 'index.html 缺少 .boot-error-home 样式');
});

test('启动失败提示：样式与三语文案齐备', () => {
  assert.match(HTML, /\.boot-error \{/, 'index.html 缺少 .boot-error 样式');
  assert.match(HTML, /\.boot-error \{[^}]*bottom: 14px/, '提示条应贴底显示');
  ['zh-CN', 'zh-HK', 'en'].forEach((lang) => {
    ['bootError', 'bootErrorOr', 'bootErrorHome'].forEach((k) => {
      assert.equal(typeof I18N[lang][k], 'string', lang + '.' + k + ' 缺失');
      assert.ok(I18N[lang][k].length > 0, lang + '.' + k + ' 不应为空');
    });
  });
});
