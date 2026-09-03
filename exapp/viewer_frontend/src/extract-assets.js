// 从 report-validation-result.html 抽离 I18N → i18n.json、主题配色 → themes.css，并回写 HTML。
// 用法: node extract-assets.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, 'src', 'engine');
const htmlPath = path.join(dir, 'report-validation-result.html');
let html = fs.readFileSync(htmlPath, 'utf8');

// ---- 1. 计算所有边界（基于原始 html） ----
const i18nStartMark = 'const I18N = {';
const i18nStart = html.indexOf(i18nStartMark);
if (i18nStart < 0) throw new Error('未找到 const I18N');
const langsIdx = html.indexOf('const LANGS', i18nStart);
if (langsIdx < 0) throw new Error('未找到 const LANGS');
const i18nEnd = html.lastIndexOf('};', langsIdx);
if (i18nEnd < 0) throw new Error('未找到 I18N 结束');

const rootStart = html.indexOf(':root {');
if (rootStart < 0) throw new Error('未找到 :root');
const rootEnd = html.indexOf('\n    }', rootStart) + 5;
if (rootEnd < 5) throw new Error('未找到 :root 结束');

const themeMark = '/* 主题配色 */';
const themeStart = html.indexOf(themeMark);
if (themeStart < 0) throw new Error('未找到 主题配色');
const themeEndMark = '/* Ctx 列拖拽调宽 */';
const themeEnd = html.indexOf(themeEndMark, themeStart);
if (themeEnd < 0) throw new Error('未找到 主题结束');

// ---- 2. 生成 i18n.json ----
const i18nEq = html.indexOf('=', i18nStart);
const i18nLiteral = html.slice(i18nEq + 1, i18nEnd + 1).trim();
const I18N = vm.runInNewContext('(' + i18nLiteral + ')');
fs.writeFileSync(path.join(dir, 'i18n.json'), JSON.stringify(I18N, null, 2) + '\n');

// ---- 3. 生成 themes.css ----
const rootBlock = html.slice(rootStart, rootEnd).trim();
const themeBlock = html.slice(themeStart, themeEnd).trim();
fs.writeFileSync(path.join(dir, 'themes.css'), rootBlock + '\n\n' + themeBlock + '\n');

// ---- 4. 回写 HTML（从后往前删除，避免索引偏移） ----
const i18nStub =
  "const I18N_URL = 'i18n.json';\n" +
  "    let I18N = { 'zh-CN': {} };\n" +
  "    async function loadI18n() {\n" +
  "      try {\n" +
  "        const res = await fetch(I18N_URL, { cache: 'no-store' });\n" +
  "        if (!res.ok) return;\n" +
  "        const d = await res.json();\n" +
  "        if (d && typeof d === 'object') I18N = d;\n" +
  "      } catch (e) {}\n" +
  "    }";

// i18n（最靠后）
html = html.slice(0, i18nStart) + i18nStub + html.slice(i18nEnd + 2);
// 主题块
html = html.slice(0, themeStart) + html.slice(themeEnd);
// :root
html = html.slice(0, rootStart) + html.slice(rootEnd);

fs.writeFileSync(htmlPath, html);
console.log('OK: 已生成 i18n.json 与 themes.css，并回写 HTML');
console.log('i18n keys:', Object.keys(I18N).join(', '));
console.log('themes.css bytes:', fs.statSync(path.join(dir, 'themes.css')).size);
