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
    colFilter: { channel: 'ALL', source: 'ALL', f: '', x: '', aoCsv: '', t: 'ALL', ctx: '', eo: '', ao: '', result: 'ALL', note: '' },
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
    },
  });
  assert.ok(flat[JSON.stringify(['warn', 'OTC-PLATFORM-A', 'HKTR', '', 'field', 'platformAssertion', 'WARN', 'notional'])]);
  assert.ok(flat[JSON.stringify(['xpath', '/HKTR/foo', 'HKTR', 'OTC-PLATFORM-A', 'IRS', 'h.ctx'])]);
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
});

test('ctx type 数组：包含判断与多类型归类', () => {
  const multi = {
    tradeId: 'M-1',
    reportDate: '2026-09-05',
    ctxDefs: {
      'a.ctx.shared': { type: [1, 3], def: '共享', hits: 'h' },
      'a.ctx.conv': { type: [2], def: '转换', hits: 'h' },
      'a.ctx.legacy': { type: 1, def: '旧格式', hits: 'h' },
      'a.ctx.bad': { type: 9, def: '非法', hits: 'h' },
    },
    channels: [],
  };
  T.setData({ items: [multi] });
  T.setState({ itemId: 'M-1' });

  assert.deepEqual(app.ctxTypes('a.ctx.shared'), [1, 3]);
  assert.deepEqual(app.ctxTypes('a.ctx.conv'), [2]);
  assert.deepEqual(app.ctxTypes('a.ctx.legacy'), [1], '旧数据单值 number 归一化为数组');
  assert.deepEqual(app.ctxTypes('a.ctx.bad'), [], '非法 type 归一化为空数组');

  const field = { ctxs: ['a.ctx.shared', 'a.ctx.conv', 'a.ctx.legacy'] };
  assert.deepEqual(app.ctxKeysOfType(field, 1), ['a.ctx.shared', 'a.ctx.legacy']);
  assert.deepEqual(app.ctxKeysOfType(field, 2), ['a.ctx.conv']);
  assert.deepEqual(app.ctxKeysOfType(field, 3), ['a.ctx.shared']);
});
