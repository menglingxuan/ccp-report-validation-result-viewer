// 纯函数回归测试：直接从 app.js 导入纯逻辑函数并断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as app from '../public/app.js';
import { buildDataset } from '../lib/sample-data.js';

const T = app.__test;
const DATA = buildDataset();
T.setData(DATA);
const item = DATA.items[0];

function fieldsState(over) {
  return Object.assign({
    channel: 'ALL', search: '',
    colFilter: { channel: 'ALL', source: 'ALL', field: '', userTag: 'ALL', eoEl: '', aoEl: '', eoCvtEl: '', aoCvtEl: '', vdtEl: '', type: 'ALL', ctxs: '', eoUnconverted: '', eo: '', aoUnconverted: '', ao: '', result: 'ALL', remarks: '' },
    sort: { key: '', dir: 1 },
    specialFilter: { eo: 'ALL', ao: 'ALL' },
  }, over || {});
}

function msgState(over) {
  return Object.assign({ itemId: item.tradeId, channel: 'ALL', search: '', msgFilter: {}, msgSort: { key: '', dir: 1 } }, over || {});
}

test('groupedToFlat 生成警告与 XPath 的扁平 key', () => {
  const flat = app.groupedToFlat({
    'OTC-PLATFORM-A': {
      warnings: [{ channel: 'HKTR', field: 'notional', type: 'platformAssertion', level: 'WARN', product: 'IRS' }],
      uncomparedXpaths: [{ xpath: '/HKTR/foo', channel: 'HKTR', product: 'IRS', ctx: 'h.ctx' }],
      uncomparedCsvs: [{ value: 'col9', channel: 'HKTR', product: 'IRS' }],
    },
  });
  assert.ok(flat[JSON.stringify(['warn', 'OTC-PLATFORM-A', 'HKTR', '', 'field', 'platformAssertion', 'WARN', 'notional'])]);
  assert.ok(flat[JSON.stringify(['xpath', '/HKTR/foo', 'HKTR', 'OTC-PLATFORM-A', 'IRS', ''])]);
  assert.ok(flat[JSON.stringify(['csv', 'col9', 'HKTR', 'OTC-PLATFORM-A', 'IRS', ''])]);
});

test('msgIgnoreKey / msgIsIgnored', () => {
  const msg = { channel: 'HKTR', source: '来源渠道 A', scope: 'field', field: 'notional', type: 'platformAssertion', level: 'WARN', platform: 'OTC-PLATFORM-A', product: 'IRS' };
  const key = app.msgIgnoreKey('warnings', msg);
  assert.equal(key, JSON.stringify(['warn', 'OTC-PLATFORM-A', 'HKTR', '来源渠道 A', 'field', 'platformAssertion', 'WARN', 'notional']));
  T.setIgnoreConfig({});
  assert.equal(app.msgIsIgnored('warnings', msg), false);
  T.setIgnoreConfig({ [key]: true });
  assert.equal(app.msgIsIgnored('warnings', msg), true);
});

test('filteredFields 计数（ALL=78，HKTR=26，FAILED 过滤）', () => {
  T.setState(fieldsState());
  assert.equal(app.filteredFields(item).length, 78, 'ALL 渠道应为 78 个字段');

  T.setState(fieldsState({ colFilter: Object.assign(fieldsState().colFilter, { result: 'FAILED' }) }));
  assert.ok(app.filteredFields(item).every((r) => r.result === 'FAILED'));

  T.setState(fieldsState({ channel: 'HKTR' }));
  assert.equal(app.filteredFields(item).length, 26, 'HKTR 渠道应为 26 个字段');
});

test('getMsgRows 警告与错误', () => {
  T.setState(msgState());
  assert.ok(app.getMsgRows('warnings').length > 0);

  T.setState(msgState({ search: '配置映射缺失' }));
  assert.ok(app.getMsgRows('warnings').every((w) => JSON.stringify(w).includes('配置映射缺失')));

  T.setState(msgState());
  assert.ok(app.getMsgRows('errors').length > 0);
});

test('diffSegments 基于 LCS 输出删除与新增段', () => {
  const d = app.diffSegments('abc', 'axc');
  const has = { del: false, add: false };
  d.a.forEach((s) => { if (s.t === 1) has.del = true; });
  d.b.forEach((s) => { if (s.t === 2) has.add = true; });
  assert.equal(has.del, true, JSON.stringify(d.a));
  assert.equal(has.add, true, JSON.stringify(d.b));
});

test('每个 item 都有独立的 ctxDefs（需求 9）', () => {
  assert.ok(item.ctxDefs, 'item 应内联 ctxDefs');
  assert.equal(DATA.ctxDefs, undefined, '顶层不应再有 ctxDefs');
  assert.notEqual(
    DATA.items[0].ctxDefs['hktr.ctx.default'].hits,
    DATA.items[1].ctxDefs['hktr.ctx.default'].hits,
    '不同 item 的 ctx hits 定义应不同',
  );
  // 新 ctxDefs 结构：id(int) / scopes(数组) / type(builtin|user)。
  const d0 = DATA.items[0].ctxDefs['hktr.ctx.default'];
  assert.ok(Number.isInteger(d0.id) && d0.id > 0, 'ctxDef 应有正整数 id');
  assert.ok(Array.isArray(d0.scopes) && d0.scopes.length > 0, 'ctxDef 应有 scopes 数组');
  assert.ok(d0.type === 'builtin' || d0.type === 'user', 'ctxDef.type 应为 builtin 或 user');
});

test('字段 ctx 引用为 id 且均定义于 ctxDefs；field 不再有 ctxs', () => {
  const ids = new Set(Object.values(item.ctxDefs).map((d) => d.id));
  item.channels.forEach((ch) => ch.sources.forEach((s) => s.fields.forEach((f) => {
    assert.equal(f.ctxs, undefined, 'field 不应再有 ctxs');
    ['cmpLeft', 'cmpRight', 'cvtLeft', 'cvtRight', 'vdt'].forEach((rk) => {
      const r = f[rk];
      if (!r) return;
      (r.ctxs || []).forEach((cid) => assert.ok(ids.has(cid), rk + '.ctxs 引用未定义 id: ' + cid));
    });
  })));
});

test('字段注册表为 report channel 级别（不再挂在 item）', () => {
  assert.equal(item.fields, undefined, 'item 不应再有 fields 注册表');
  item.channels.forEach((ch) => {
    assert.ok(Array.isArray(ch.fields) && ch.fields.length > 0, 'channel ' + ch.name + ' 应有 fields 注册表');
  });
  T.setState(fieldsState());
  const rows = app.filteredFields(item);
  assert.ok(rows.length > 0, 'flatFields 应产出比较行');
  assert.ok(rows.every((r) => typeof r.field === 'string' && r.field), '每行都应有 field 名');
});

test('ctx 引用：id 引用 + 各规则 ctxs 并集 + key 解析', () => {
  const multi = {
    tradeId: 'M-1',
    reportDate: '2026-09-05',
    ctxDefs: {
      'a.ctx.map': { id: 1, scopes: [1], type: 'builtin', def: '映射', hits: 'h' },
      'a.ctx.conv': { id: 2, scopes: [2], type: 'user', def: '转换', hits: 'h' },
      'a.ctx.val': { id: 3, scopes: [3], type: 'builtin', def: '校验', hits: 'h' },
    },
    channels: [{
      name: 'A', format: 'xml',
      fields: [{ id: '1', name: 'f1', userTag: 'contextAssertion', type: 'text' }],
      sources: [{ name: 'S', fields: [{
        id: '1',
        cmpLeft: { value: 'eo', ctx: 1, ctxs: [1], elRaw: '', el: 'src_f1', srcType: 2 },
        cmpRight: { value: 'ao', ctx: 1, ctxs: [1], elRaw: '', el: '/x', srcType: 1 },
        cvtLeft: { ctx: 2, ctxs: [2], el: '@trim', elRaw: '', raw: 'EO-RAW' },
        cvtRight: null,
        vdt: { ctx: 3, ctxs: [3], el: 'regex:^x$', elRaw: '' },
        result: 'PASSED', remarks: '', resultText: '', resultDetails: [], prints: [],
      }] }],
    }],
  };
  T.setData({ items: [multi] });
  T.setState(fieldsState({ itemId: 'M-1' }));

  const rows = app.filteredFields(multi);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].ctxs, [1, 2, 3], 'ctxs 为各规则 ctxs 的 id 并集');
  assert.deepEqual(rows[0].ctxKeys, ['a.ctx.map', 'a.ctx.conv', 'a.ctx.val'], 'ctxKeys 解析为可读 key');
});
