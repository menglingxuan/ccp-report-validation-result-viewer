// 纯函数回归自测：从 report-validation-result.html 中加载脚本（vm），
// 直接对 filteredFields / getMsgRows / msgIgnoreKey / groupedToFlat / diffSegments 等做断言。
// 用法: node test-pure-logic.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const htmlPath = path.join(__dirname, 'src', 'engine', 'report-validation-result.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error('未找到 <script> 块');
let src = m[1].replace(/initApp\(\);\s*$/, '');

src += `
; (function () {
  const results = [];
  const assert = function (name, cond, extra) {
    results.push({ name: name, ok: !!cond, extra: extra || '' });
    if (!cond) throw new Error('ASSERT FAIL: ' + name + (extra ? ' (' + extra + ')' : ''));
  };

  DATA = buildDataset();
  const item = DATA.items[0];

  // 1. groupedToFlat
  const flat = groupedToFlat({
    'OTC-PLATFORM-A': {
      warnings: [{ channel: 'HKTR', field: 'notional', type: 'platformAssertion', level: 'WARN', product: 'IRS' }],
      uncomparedXpaths: [{ xpath: '/HKTR/foo', channel: 'HKTR', product: 'IRS', ctx: 'h.ctx' }],
    },
  });
  assert('groupedToFlat warn key', !!flat[JSON.stringify(['warn', 'HKTR', 'notional', 'platformAssertion', 'WARN', 'OTC-PLATFORM-A', 'IRS'])]);
  assert('groupedToFlat xpath key', !!flat[JSON.stringify(['xpath', '/HKTR/foo', 'HKTR', 'OTC-PLATFORM-A', 'IRS', 'h.ctx'])]);

  // 2. msgIgnoreKey / msgIsIgnored
  const msg = { channel: 'HKTR', field: 'notional', type: 'platformAssertion', level: 'WARN', platform: 'OTC-PLATFORM-A', product: 'IRS' };
  const key = msgIgnoreKey('warnings', msg);
  assert('msgIgnoreKey format', key === JSON.stringify(['warn', 'HKTR', 'notional', 'platformAssertion', 'WARN', 'OTC-PLATFORM-A', 'IRS']));
  assert('msgIsIgnored initially false', !msgIsIgnored('warnings', msg));
  IGNORE_CONFIG = {};
  IGNORE_CONFIG[key] = true;
  assert('msgIsIgnored after set', msgIsIgnored('warnings', msg));

  // 3. filteredFields
  state = { channel: 'ALL', search: '', colFilter: { channel: 'ALL', source: 'ALL', f: '', x: '', aoCsv: '', t: 'ALL', ctx: '', eo: '', ao: '', result: 'ALL', note: '' }, sort: { key: '', dir: 1 }, specialFilter: { eo: 'ALL', ao: 'ALL' } };
  assert('filteredFields ALL count 78', filteredFields(item).length === 78, 'got ' + filteredFields(item).length);
  state.colFilter.result = 'FAILED';
  assert('filteredFields result=FAILED all failed', filteredFields(item).every(function (r) { return r.result === 'FAILED'; }));
  state.colFilter.result = 'ALL';
  state.channel = 'HKTR';
  assert('filteredFields channel=HKTR count 26', filteredFields(item).length === 26, 'got ' + filteredFields(item).length);

  // 4. getMsgRows
  state = { itemId: item.tradeId, channel: 'ALL', search: '', msgFilter: {}, msgSort: { key: '', dir: 1 } };
  assert('getMsgRows warnings > 0', getMsgRows('warnings').length > 0);
  state.search = '配置映射缺失';
  assert('getMsgRows search filter', getMsgRows('warnings').every(function (w) { return JSON.stringify(w).indexOf('配置映射缺失') !== -1; }));
  state.search = '';
  assert('getMsgRows errors > 0', getMsgRows('errors').length > 0);

  // 5. diffSegments（LCS 差异）
  const d = diffSegments('abc', 'axc');
  const has = { del: false, add: false };
  d.a.forEach(function (s) { if (s.t === 1) has.del = true; });
  d.b.forEach(function (s) { if (s.t === 2) has.add = true; });
  assert('diffSegments has del in a', has.del, JSON.stringify(d.a));
  assert('diffSegments has add in b', has.add, JSON.stringify(d.b));

  globalThis.__TEST_RESULTS__ = results;
})();
`;

const sandbox = {
  document: {
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, setAttribute() {}, getAttribute() { return null; }, appendChild() {}, addEventListener() {}, click() {} }),
  },
  window: { addEventListener() {}, innerWidth: 1280, innerHeight: 800 },
  location: { hash: '', href: 'http://localhost/' },
  history: { replaceState() {}, pushState() {} },
  localStorage: { getItem() { return null; }, setItem() {} },
  fetch: () => Promise.reject(new Error('no fetch')),
  FileReader: function () { this.readAsText = function () {}; },
  Blob: function () {},
  URL: { createObjectURL() { return ''; }, revokeObjectURL() {} },
  alert() {}, navigator: {}, console,
};

vm.createContext(sandbox);
try {
  vm.runInContext(src, sandbox, { filename: 'test-pure-logic.js' });
  const results = sandbox.__TEST_RESULTS__ || [];
  let fail = 0;
  results.forEach(function (r) {
    console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.extra ? '  ' + r.extra : ''));
    if (!r.ok) fail++;
  });
  console.log('\n' + (results.length - fail) + '/' + results.length + ' passed');
  process.exit(fail ? 1 : 0);
} catch (e) {
  console.error('ERROR:', e.message);
  process.exit(1);
}
