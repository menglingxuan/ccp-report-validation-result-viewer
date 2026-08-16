// 从 deepseek-validation-result.html 中提取 buildDataset() 并生成 deepseek-validation-data.json
// 用法: node extract-data.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const htmlPath = path.join(__dirname, 'src', 'main', 'deepseek-validation-result.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('未找到 <script> 块');
let src = m[1].replace(/initApp\(\);\s*$/, '');

const sandbox = {
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({
      style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute() {}, getAttribute() { return null; }, appendChild() {}, addEventListener() {}, click() {},
    }),
  },
  window: { addEventListener() {}, innerWidth: 1280, innerHeight: 800 },
  location: { hash: '', href: 'http://localhost/' },
  history: { replaceState() {}, pushState() {} },
  localStorage: { getItem() { return null; }, setItem() {} },
  fetch: () => Promise.reject(new Error('no fetch in extract')),
  FileReader: function () { this.readAsText = function () {}; },
  Blob: function () {},
  URL: { createObjectURL() { return ''; }, revokeObjectURL() {} },
  alert() {},
  navigator: {},
  console,
};

vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'extract.js' });
const data = vm.runInContext('buildDataset()', sandbox);
const outPath = path.join(__dirname, 'src', 'main', 'deepseek-validation-data.json');
fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
console.log('OK items=' + data.items.length + ' -> ' + outPath);
console.log('first item:', JSON.stringify({ id: data.items[0].tradeId, platform: data.items[0].platform, cat: data.items[0].productCategory, product: data.items[0].product }));
