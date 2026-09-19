// 纯函数回归测试：直接从 app.js 导入纯逻辑函数并断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
      warnings: [{ channel: 'HKTR', field: 'notional', type: 'platformAssertion', level: 'WARN' }],
      uncomparedXpaths: [{ xpath: '/HKTR/foo', channel: 'HKTR', source: 'IRS', ctx: 'h.ctx' }],
      uncomparedCsvs: [{ value: 'col9', channel: 'HKTR', source: 'IRS' }],
    },
  });
  assert.ok(flat[JSON.stringify(['warn', 'OTC-PLATFORM-A', 'HKTR', '', 'field', 'platformAssertion', 'WARN', 'notional'])]);
  assert.ok(flat[JSON.stringify(['xpath', '/HKTR/foo', 'HKTR', 'OTC-PLATFORM-A', 'IRS', ''])]);
  assert.ok(flat[JSON.stringify(['csv', 'col9', 'HKTR', 'OTC-PLATFORM-A', 'IRS', ''])]);
});

test('忽略配置 schema：product 键已移除，且空配置不产生 key', () => {
  // 运行期会向该文件回写忽略项，因此这里只断言结构（不强制为空），但必须不含失效的 product 键。
  const raw = JSON.parse(readFileSync(new URL('../public/ignore-config-by-platform.json', import.meta.url), 'utf8'));
  assert.ok(raw && typeof raw === 'object' && !Array.isArray(raw), '配置顶层应为对象');
  const entries = [];
  Object.keys(raw).forEach(function (platform) {
    const g = raw[platform] || {};
    ['warnings', 'uncomparedXpaths', 'uncomparedCsvs'].forEach(function (b) {
      (Array.isArray(g[b]) ? g[b] : []).forEach(function (e) { entries.push(e); });
    });
  });
  entries.forEach(function (e) {
    assert.equal(e.product, undefined, 'product 配置键应已移除：' + JSON.stringify(e));
  });
  // 空配置（仓库默认值）→ 无任何扁平 key / 导出仍为空配置
  assert.deepEqual(app.groupedToFlat({}), {});
  assert.deepEqual(app.flatToGrouped({}), {});
});

test('msgIgnoreKey / msgIsIgnored', () => {
  const msg = { channel: 'HKTR', source: '来源渠道 A', scope: 'field', field: 'notional', type: 'platformAssertion', level: 'WARN', platform: 'OTC-PLATFORM-A' };
  const key = app.msgIgnoreKey('warnings', msg);
  assert.equal(key, JSON.stringify(['warn', 'OTC-PLATFORM-A', 'HKTR', '来源渠道 A', 'field', 'platformAssertion', 'WARN', 'notional']));
  T.setIgnoreConfig({});
  assert.equal(app.msgIsIgnored('warnings', msg), false);
  T.setIgnoreConfig({ [key]: true });
  assert.equal(app.msgIsIgnored('warnings', msg), true);
});

test('忽略配置：配置文件 ↔ 运行时 key 往返一致（含 null channel / 空 platform / 空 source）', () => {
  const key = app.msgIgnoreKey;
  const file = {
    'OTC-PLATFORM-A': {
      warnings: [{ channel: 'HKTR', field: 'notional', type: 'platformAssertion', level: 'WARN' }],
      uncomparedXpaths: [{ xpath: '/A/B', channel: 'HKTR', source: 'IRS' }],
      uncomparedCsvs: [{ value: 'src_x', channel: 'CFTC', source: 'IRS' }],
    },
  };
  const flat = app.groupedToFlat(file);
  const item = { platform: 'OTC-PLATFORM-A' };

  // 1) 配置文件里的条目 → 运行时 key 必须命中（platform 从 item 注入，source 条目自带）
  const warnMsg = Object.assign({ channel: 'HKTR', source: '', scope: 'field', field: 'notional', type: 'platformAssertion', level: 'WARN' }, item);
  assert.ok(flat[key('warnings', warnMsg)], '警告条目应命中');
  assert.ok(flat[key('uncompared', Object.assign({ type: 1, value: '/A/B', channel: 'HKTR', source: 'IRS' }, item))], 'XPath 未比较条目应命中');
  assert.ok(flat[key('uncompared', Object.assign({ type: 2, value: 'src_x', channel: 'CFTC', source: 'IRS' }, item))], 'CSV 未比较条目应命中');

  // 1b) source 可能为空（渠道级条目）或为 null：均需归一化为空串后互相命中
  const noSrc = Object.assign({ type: 2, value: 'nosrc_x', channel: 'HKTR', source: '' }, item);
  assert.ok(app.groupedToFlat({ 'OTC-PLATFORM-A': { uncomparedCsvs: [{ value: 'nosrc_x', channel: 'HKTR' }] } })[key('uncompared', noSrc)], '空 source 条目应命中');
  assert.ok(app.groupedToFlat({ 'OTC-PLATFORM-A': { uncomparedCsvs: [{ value: 'nosrc_x', channel: 'HKTR', source: null }] } })[key('uncompared', noSrc)], 'source:null 的文件条目应归一化为空串');

  // 2) 全局未比较条目（channel 为 null）需归一化为空串，否则与配置文件读取结果失配
  const globalMsg = Object.assign({ type: 1, value: '/Global/X', channel: null, source: 'IRS' }, item);
  assert.equal(key('uncompared', globalMsg), JSON.stringify(['xpath', '/Global/X', '', 'OTC-PLATFORM-A', 'IRS', '']));
  assert.ok(app.groupedToFlat({ 'OTC-PLATFORM-A': { uncomparedXpaths: [{ xpath: '/Global/X', channel: null, source: 'IRS' }] } })[key('uncompared', globalMsg)], 'channel:null 的文件条目应命中');

  // 3) 空 platform 不再被写成 'UNKNOWN'，往返后仍能命中
  const noPlat = { type: 1, value: '/No/Plat', channel: 'HKTR', platform: '', source: '' };
  assert.ok(app.groupedToFlat({ '': { uncomparedXpaths: [{ xpath: '/No/Plat', channel: 'HKTR', source: '' }] } })[key('uncompared', noPlat)]);
  assert.deepEqual(Object.keys(app.flatToGrouped({ [key('uncompared', noPlat)]: true })), ['']);

  // 3b) 导出（flat -> grouped）使用 source 字段，且不再输出 kind / ctx 等冗余字段（容器名即类型）
  const exported = app.flatToGrouped({
    [JSON.stringify(['warn', 'P', 'HKTR', 'SRC', 'field', 't', 'WARN', 'f'])]: true,
    [JSON.stringify(['xpath', '/A/B', 'HKTR', 'P', 'SRC', ''])]: true,
    [JSON.stringify(['csv', 'c1', 'HKTR', 'P', '', ''])]: true,
  });
  assert.deepEqual(exported.P.warnings[0], { channel: 'HKTR', source: 'SRC', scope: 'field', type: 't', level: 'WARN', field: 'f' });
  assert.deepEqual(exported.P.uncomparedXpaths[0], { xpath: '/A/B', channel: 'HKTR', source: 'SRC' });
  assert.deepEqual(exported.P.uncomparedCsvs[0], { value: 'c1', channel: 'HKTR', source: '' });

  // 4) 导出（flat -> grouped）后再加载，key 完全不变（往返恒等）
  const round = app.groupedToFlat(app.flatToGrouped(flat));
  assert.deepEqual(Object.keys(round).sort(), Object.keys(flat).sort(), '往返后 key 集合应一致');

  // 5) 端到端：配置文件（含 channel:null 的全局条目）加载为忽略配置后，对应条目应判定为已忽略
  const fileWithGlobal = {
    'OTC-PLATFORM-A': {
      warnings: file['OTC-PLATFORM-A'].warnings,
      uncomparedXpaths: file['OTC-PLATFORM-A'].uncomparedXpaths.concat([{ xpath: '/Global/X', channel: null, source: 'IRS' }]),
      uncomparedCsvs: file['OTC-PLATFORM-A'].uncomparedCsvs,
    },
  };
  T.setIgnoreConfig(app.groupedToFlat(fileWithGlobal));
  assert.equal(app.msgIsIgnored('warnings', warnMsg), true, '警告条目应判定为已忽略');
  assert.equal(app.msgIsIgnored('uncompared', globalMsg), true, 'channel:null 的全局未比较条目应判定为已忽略');
  assert.equal(app.msgIsIgnored('uncompared', { type: 1, value: '/Not/Ignored', channel: 'HKTR', platform: 'OTC-PLATFORM-A', source: 'IRS' }), false, '未在配置中的条目不应当被忽略');
  T.setIgnoreConfig({});
});

test('parseIgnoreImport：只接受分组格式，并识别需要覆盖的部分', () => {
  const grouped = {
    'OTC-PLATFORM-A': {
      warnings: [{ channel: 'HKTR', source: 'S', scope: 'field', type: 't', level: 'WARN', field: 'f' }],
      uncomparedXpaths: [],
      uncomparedCsvs: [],
    },
  };
  const ok = app.parseIgnoreImport(JSON.stringify(grouped));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.kinds.slice().sort(), ['csv', 'warn', 'xpath'], '三部分均在文件中');
  assert.deepEqual(Object.keys(ok.flat), [JSON.stringify(['warn', 'OTC-PLATFORM-A', 'HKTR', 'S', 'field', 't', 'WARN', 'f'])]);
  assert.deepEqual(app.parseIgnoreImport('{}'), { ok: true, flat: {}, kinds: ['warn', 'xpath', 'csv'] }, '{} 即三部分皆空');
  // 分部：文件里只出现 warnings / 只出现 uncomparedCsvs
  const warnOnly = app.parseIgnoreImport(JSON.stringify({ P: { warnings: [] } }));
  assert.deepEqual([warnOnly.ok, warnOnly.kinds, warnOnly.flat], [true, ['warn'], {}]);
  const csvOnly = app.parseIgnoreImport(JSON.stringify({ P: { uncomparedCsvs: [{ value: 'v', channel: 'c', source: 's' }] } }));
  assert.deepEqual(csvOnly.kinds, ['csv']);
  assert.deepEqual(Object.keys(csvOnly.flat), [JSON.stringify(['csv', 'v', 'c', 'P', 's', ''])]);
  const xpathOnly = app.parseIgnoreImport(JSON.stringify({ P: { warnings: [], uncomparedXpaths: [] } }));
  assert.deepEqual(xpathOnly.kinds, ['warn', 'xpath']);
  // 失败情形
  assert.equal(app.parseIgnoreImport('{ not json').reason, 'json', '非法 JSON');
  assert.equal(app.parseIgnoreImport('[]').reason, 'shape', '数组顶层');
  assert.equal(app.parseIgnoreImport('null').reason, 'shape', 'null 顶层');
  const flatLegacy = JSON.stringify({ [JSON.stringify(['warn', 'P', 'C', '', 'field', 't', 'WARN', 'f'])]: true });
  assert.equal(app.parseIgnoreImport(flatLegacy).reason, 'legacy', '旧版扁平格式应被拒绝');
  assert.equal(app.parseIgnoreImport(JSON.stringify({ foo: 'bar' })).reason, 'buckets', '无可识别分组应被拒绝');
});

test('applyIgnoreImport：只覆盖文件包含的部分', () => {
  const warnKey = JSON.stringify(['warn', 'P', 'C', 'S', 'field', 't', 'WARN', 'f']);
  const xpathKey = JSON.stringify(['xpath', '/old', 'C', 'P', 'S', '']);
  const csvKey = JSON.stringify(['csv', 'oldcsv', 'C', 'P', 'S', '']);
  const cur = { [warnKey]: true, [xpathKey]: true, [csvKey]: true };

  // 只导入 warnings：警告被替换，xpath / csv 原样保留
  const r1 = app.parseIgnoreImport(JSON.stringify({ P: { warnings: [{ channel: 'C2', source: 'S2', scope: 'field', type: 't2', level: 'INFO', field: 'f2' }] } }));
  const n1 = app.applyIgnoreImport(cur, r1);
  assert.deepEqual(Object.keys(n1).slice().sort(), [
    csvKey,
    xpathKey,
    JSON.stringify(['warn', 'P', 'C2', 'S2', 'field', 't2', 'INFO', 'f2']),
  ].slice().sort(), '仅警告部分被替换');

  // 只清空 warnings（warnings: []）→ 其它部分保留
  const n2 = app.applyIgnoreImport(cur, app.parseIgnoreImport(JSON.stringify({ P: { warnings: [] } })));
  assert.deepEqual(Object.keys(n2).slice().sort(), [csvKey, xpathKey].slice().sort(), '只清空警告');

  // {} = 三部分全部清空
  assert.deepEqual(app.applyIgnoreImport(cur, app.parseIgnoreImport('{}')), {}, '空文件清空全部');

  // 两个分部分导也可以组合
  const n3 = app.applyIgnoreImport(cur, app.parseIgnoreImport(JSON.stringify({ P: { warnings: [], uncomparedCsvs: [] } })));
  assert.deepEqual(Object.keys(n3), [xpathKey], '只保留未涉及的 XPath 部分');
});

test('警告作用域归一化：scope 缺失时读写两条路径规则一致（可往返）', () => {
  const key = app.msgIgnoreKey;
  // 数据里缺 scope 的警告：运行期 key 按「有 field = field，否则 channel」归一化
  const noScopeField = { channel: 'HKTR', source: 'S', type: 't', level: 'WARN', field: 'notional', platform: 'P' };
  const noScopeChannel = { channel: 'HKTR', source: 'S', type: 't', level: 'WARN', field: '', platform: 'P' };
  assert.equal(key('warnings', noScopeField), JSON.stringify(['warn', 'P', 'HKTR', 'S', 'field', 't', 'WARN', 'notional']));
  assert.equal(key('warnings', noScopeChannel), JSON.stringify(['warn', 'P', 'HKTR', 'S', 'channel', 't', 'WARN', '']));
  // 往返：导出 -> 重新加载后 key 不变，忽略项不会静默失效
  const flat = { [key('warnings', noScopeField)]: true, [key('warnings', noScopeChannel)]: true };
  const round = app.groupedToFlat(app.flatToGrouped(flat));
  assert.deepEqual(Object.keys(round).sort(), Object.keys(flat).sort(), '缺 scope 的警告也应能往返命中');
});

test('sortValue：未比较 Item 表列（itemId / reason）可排序', () => {
  assert.equal(app.sortValue({ itemId: 'T-1' }, 'itemId'), 'T-1');
  assert.equal(app.sortValue({ tradeId: 'T-2' }, 'itemId'), 'T-2', '回退到 tradeId');
  assert.equal(app.sortValue({ reason: 'raison' }, 'reason'), 'raison');
});

test('parseHash：解析/解码/空段容错', () => {
  assert.deepEqual(app.parseHash('#item=T-1&tab=warnings&ch=HKTR'), { item: 'T-1', tab: 'warnings', ch: 'HKTR' });
  assert.deepEqual(app.parseHash(''), {});
  assert.deepEqual(app.parseHash('#a=1&&b='), { a: '1', b: '' });
  assert.deepEqual(app.parseHash('#flag'), { flag: '' }, '无 = 的段视为空值');
  assert.deepEqual(app.parseHash('#q=%E4%B8%AD%E6%96%87'), { q: '中文' }, '应做 URL 解码');
  assert.deepEqual(app.parseHash('#bad=%E4%B8'), { bad: '%E4%B8' }, '解码失败时保留原值');
});

test('深链接往返：stateToHash() -> parseHash() 保持关键字段', () => {
  // 字段比较tab：result 过滤器会写入 hash
  T.setState({
    itemId: 'T-9', channel: 'JSFA', tab: 'fields', search: 'q 1', rowId: 7, page: 3,
    sort: { key: 'field', dir: -1 },
    columns: {},
    colFilter: { result: 'FAILED' },
    itemSearch: 'a b', itemFilter: 'failed', itemPlatforms: ['A'], itemProducts: ['IR'],
    itemTradeIds: ['T-1'], reportDateFilter: '2024-08-14', sidebarPage: 2,
  });
  const p = app.parseHash(app.stateToHash());
  assert.equal(p.item, 'T-9');
  assert.equal(p.ch, 'JSFA');
  assert.equal(p.tab, undefined, 'fields 为默认 tab，不写入 hash');
  assert.equal(p.q, 'q 1');
  assert.equal(p.fr, '7');
  assert.equal(p.page, '3');
  assert.equal(p.sort, 'field:d', '降序应带 :d');
  assert.equal(p.result, 'FAILED');
  assert.equal(p.is, 'a b');
  assert.equal(p.st, 'failed');
  assert.equal(p.pf, 'A');
  assert.equal(p.pd, 'IR');
  assert.equal(p.td, 'T-1');
  assert.equal(p.dt, '2024-08-14');
  assert.equal(p.sp, '2');

  // 非字段tab：tab 写入 hash，且不再写 result（result 仅属于字段表）
  T.setState({
    itemId: 'T-9', channel: 'ALL', tab: 'uncompared', search: '', rowId: -1, page: 1,
    sort: { key: '', dir: 1 }, columns: {}, colFilter: { result: 'FAILED' },
    itemSearch: '', itemFilter: 'ALL', itemPlatforms: [], itemProducts: [], itemTradeIds: [],
    reportDateFilter: '', sidebarPage: 1,
  });
  const p2 = app.parseHash(app.stateToHash());
  assert.equal(p2.tab, 'uncompared');
  assert.equal(p2.result, undefined);
  assert.equal(p2.ch, undefined, 'channel=ALL 不写入 hash');
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

  // items[0] 全 PASSED，不应有错误；改用有失败字段的 item 验证错误筛选。
  T.setState(msgState({ itemId: DATA.items[2].tradeId }));
  assert.ok(app.getMsgRows('errors').length > 0);
});

test('全 PASSED 的 item 不产生关联错误', () => {
  const passedItem = DATA.items[0];
  assert.equal(passedItem.errors.length, 0, '全 PASSED item 的错误数应为 0');
  assert.ok(passedItem.channels.every((ch) =>
    ch.sources.every((s) => s.fields.every((f) => f.result === 'PASSED'))));
});

test('fieldMsgCount 只统计未忽略的警告', () => {
  const wItem = {
    tradeId: 'W-1',
    platform: 'OTC-PLATFORM-A', product: 'IRS',
    channels: [{
      name: 'HKTR',
      fields: [{ id: '1', name: 'notional', userTag: 'productAssertion', type: 'num' }],
      sources: [{ name: '来源渠道 A', fields: [] }],
    }],
    warnings: [
      { channel: 'HKTR', source: '来源渠道 A', scope: 'field', field: 'notional', type: 'productAssertion', level: 'WARN', text: 'w1' },
      { channel: 'HKTR', source: '来源渠道 A', scope: 'field', field: 'notional', type: 'platformAssertion', level: 'WARN', text: 'w2' },
    ],
    errors: [],
  };
  T.setData({ items: [wItem] });
  T.setState(fieldsState({ itemId: 'W-1' }));
  const r = { channel: 'HKTR', source: '来源渠道 A', field: 'notional' };
  T.setIgnoreConfig({});
  assert.equal(app.fieldMsgCount('warnings', r), 2, '未忽略时应统计全部 2 条');
  const key = app.msgIgnoreKey('warnings', { channel: 'HKTR', source: '来源渠道 A', scope: 'field', field: 'notional', type: 'productAssertion', level: 'WARN', platform: 'OTC-PLATFORM-A', product: 'IRS' });
  T.setIgnoreConfig({ [key]: true });
  assert.equal(app.fieldMsgCount('warnings', r), 1, '忽略 1 条后应只剩 1 条');
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

test('rowPageFor 按行ID定位消息行所在页码', () => {
  T.setData(DATA); // 前面测试用 setData 替换过内部 DATA，先还原。
  const rich = DATA.items.slice().sort((a, b) => (b.errors || []).length - (a.errors || []).length)[0];
  T.setState(msgState({ itemId: rich.tradeId, msgPageSize: 5 }));
  const errs = app.getMsgRows('errors');
  assert.ok(errs.length > 6, '应有超过 6 条错误以验证翻页: ' + errs.length);
  const rid = errs[6]._idx; // 稳定行ID = 源数组下标
  assert.equal(app.rowPageFor('errors', rid), 2, '第 7 条错误（0-based 6）应在第 2 页');
});
