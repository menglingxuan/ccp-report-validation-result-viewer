// 数据校验器测试：覆盖单文件/多文件/坏数据场景。
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDataset } from '../lib/validate.js';

test('validateDataset 拒绝非对象顶层', () => {
  assert.equal(validateDataset(null).ok, false);
  assert.equal(validateDataset([1, 2]).ok, false);
  assert.equal(validateDataset('x').ok, false);
});

test('validateDataset 缺少 items 时报错', () => {
  const r = validateDataset({ reportEnv: 'OTCXXX' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('items')));
});

test('validateDataset 通过合法的单文件数据', () => {
  const r = validateDataset({
    mode: 'single',
    reportEnv: 'OTCXXX',
    reportChannelDefs: [{ id: 1, name: 'HKTR', fieldDefs: [{ id: '1', name: 'tradeId', userTag: 'contextAssertion', type: 'id' }] }],
    sourceChannelDefs: [{ id: 1, name: '来源渠道 A', format: 'csv' }],
    items: [{ tradeId: 'T-1', reportDate: '2026-08-16', channels: [{ id: 1, sources: [{ id: 1, fields: [{ id: '1', result: 'PASSED' }] }] }] }],
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

/* ---------------- 声明表与引用（reportChannelDefs / sourceChannelDefs / usedCtxKeyDefs） ---------------- */

// 最小报告渠道声明（含字段定义注册表 fieldDefs）。
function reportChannelDef(over) {
  return Object.assign({
    id: 1, name: 'HKTR', desc: '香港交易资料储存库', format: 'xml',
    fieldDefs: [{ id: '1', name: 'tradeId', userTag: 'contextAssertion', type: 'id' }],
  }, over || {});
}

// 最小合法 item：渠道 / 来源只写 id 引用，字段结果引用 fieldDefs 里的字段 id。
function oneItem(over) {
  return Object.assign({
    tradeId: 'T-1',
    reportDate: '2026-08-16',
    channels: [{ id: 1, sources: [{ id: 1, fields: [{ id: '1', result: 'PASSED' }] }] }],
  }, over || {});
}

// 最小合法单文件数据集（可对 items 做整体替换）。
// 三张顶层声明表是唯一写定义的地方：item 里的引用必须是已声明的。
function oneDataset(items, over) {
  return Object.assign({
    mode: 'single',
    reportEnv: 'OTCXXX',
    reportChannelDefs: [reportChannelDef()],
    sourceChannelDefs: [{ id: 1, name: '来源渠道 A', format: 'csv' }],
    items: items || [oneItem()],
  }, over || {});
}

test('声明表：item 引用的渠道 / 来源渠道 / 字段必须已在顶层声明表里声明', () => {
  assert.equal(validateDataset(oneDataset()).ok, true, '已声明的引用应合法');

  // 声明处（顶层）不允许重复 / 冲突。
  const dupCh = validateDataset(oneDataset(undefined, {
    reportChannelDefs: [reportChannelDef({ id: 1, name: 'HKTR' }), reportChannelDef({ id: 1, name: 'JSFA' })],
  }));
  assert.equal(dupCh.ok, false);
  assert.ok(dupCh.errors.some((e) => e.includes('声明必须唯一')), JSON.stringify(dupCh.errors));

  const dupSrc = validateDataset(oneDataset(undefined, {
    sourceChannelDefs: [{ id: 1, name: '来源渠道 A' }, { id: 1, name: '来源渠道 B' }],
  }));
  assert.equal(dupSrc.ok, false);
  assert.ok(dupSrc.errors.some((e) => e.includes('声明必须唯一')), JSON.stringify(dupSrc.errors));

  // 未声明的渠道 / 来源渠道 / 字段引用 -> 报错（item 里不再接受新定义）。
  const undeclaredCh = validateDataset(oneDataset([oneItem({ channels: [{ id: 9, sources: [] }] })]));
  assert.equal(undeclaredCh.ok, false);
  assert.ok(undeclaredCh.errors.some((e) => e.includes('未在顶层 reportChannelDefs 声明表里声明')), JSON.stringify(undeclaredCh.errors));

  const undeclaredSrc = validateDataset(oneDataset([oneItem({ channels: [{ id: 1, sources: [{ id: 7, fields: [] }] }] })]));
  assert.equal(undeclaredSrc.ok, false);
  assert.ok(undeclaredSrc.errors.some((e) => e.includes('未在顶层 sourceChannelDefs 声明表里声明')), JSON.stringify(undeclaredSrc.errors));

  const undeclaredField = validateDataset(oneDataset([oneItem({ channels: [{ id: 1, sources: [{ id: 1, fields: [{ id: '9' }] }] }] })]));
  assert.equal(undeclaredField.ok, false);
  assert.ok(undeclaredField.errors.some((e) => e.includes('未在报告渠道「HKTR」的 fieldDefs 里声明')), JSON.stringify(undeclaredField.errors));

  // item 里可以重复写名称，但必须与声明一致。
  const agree = validateDataset(oneDataset([oneItem({ channels: [{ id: 1, name: 'HKTR', sources: [{ id: 1, name: '来源渠道 A', fields: [] }] }] })]));
  assert.equal(agree.ok, true, JSON.stringify(agree.errors));
  const disagree = validateDataset(oneDataset([oneItem({ channels: [{ id: 1, name: 'JSFA', sources: [] }] })]));
  assert.equal(disagree.ok, false);
  assert.ok(disagree.errors.some((e) => e.includes('与顶层声明')), JSON.stringify(disagree.errors));
});

test('声明表：旧键名 / 旧结构已移除（channels、sources、item.channels[].fields）', () => {
  const oldRoot = validateDataset({ mode: 'single', channels: [{ id: 1, name: 'HKTR' }], sources: [], items: [] });
  assert.equal(oldRoot.ok, false);
  assert.ok(oldRoot.errors.some((e) => e.includes('channels 已改名')), JSON.stringify(oldRoot.errors));
  assert.ok(oldRoot.errors.some((e) => e.includes('sources 已改名')), JSON.stringify(oldRoot.errors));

  const oldFields = validateDataset(oneDataset([oneItem({ channels: [{ id: 1, fields: [], sources: [] }] })]));
  assert.equal(oldFields.ok, false);
  assert.ok(oldFields.errors.some((e) => e.includes('fields 已迁移到 reportChannelDefs[].fieldDefs')), JSON.stringify(oldFields.errors));

  // 旧形态（定义写在 item 里、顶层无声明）同样不再合法：契约要求引用 ⊆ 声明。
  const legacyShape = validateDataset({ mode: 'single', items: [{ tradeId: 'T-1', reportDate: '2026-08-16', channels: [{ id: 1, name: 'HKTR', sources: [{ id: 1, name: '来源渠道 A', fields: [] }] }] }] });
  assert.equal(legacyShape.ok, false, '旧形态应提示迁移');
  assert.ok(legacyShape.errors.some((e) => e.includes('未在顶层 reportChannelDefs 声明表里声明')), JSON.stringify(legacyShape.errors));
});

test('声明表：字段定义（fieldDefs）结构与渠道内 id 唯一', () => {
  const bad = validateDataset(oneDataset(undefined, {
    reportChannelDefs: [reportChannelDef({ fieldDefs: [{ id: 'x', name: 'a' }, { id: '1', name: 'b' }, { id: '1', name: 'c', userTag: 't', type: 'id' }] })],
  }));
  assert.equal(bad.ok, false);
  const msgs = bad.errors.join('；');
  assert.match(msgs, /fieldDefs\[0\] 缺少数字字符串 id/);
  assert.match(msgs, /fieldDefs\[1\] 缺少 userTag/);
  assert.match(msgs, /fieldDefs\[2\] 字段 id=1 在「HKTR」渠道内重复/);

  // 不同报告渠道各自一套字段定义（同 id 可在不同渠道里指不同字段）。
  const twoChannels = validateDataset(oneDataset([oneItem({ channels: [
    { id: 1, sources: [{ id: 1, fields: [{ id: '1' }] }] },
    { id: 2, sources: [{ id: 1, fields: [{ id: '21' }] }] },
  ] })], {
    reportChannelDefs: [reportChannelDef(), reportChannelDef({ id: 2, name: 'JSFA', fieldDefs: [{ id: '21', name: 'tradeId', userTag: 'contextAssertion', type: 'id' }] })],
  }));
  assert.equal(twoChannels.ok, true, JSON.stringify(twoChannels.errors));
});

test('声明表：usedCtxKeyDefs 结构与 item.ctxDefs 的 id 引用', () => {
  const base = {
    usedCtxKeyDefs: { 'hktr.ctx.default': { id: 1, type: 'builtin', rules: ['fdm'], def: 'HKTR 默认上下文' } },
  };
  const okItem = oneItem({
    ctxDefs: { 'hktr.ctx.default': { id: 1, hits: '命中 3 个映射条目' } },
    channels: [{ id: 1, sources: [{ id: 1, fields: [{ id: '1', cmpRight: { ctxs: [1] } }] }] }],
  });
  assert.equal(validateDataset(oneDataset([okItem], base)).ok, true, '合法的 ctxKey 引用');

  // rules 只能是 fdm / cvt / vdt；id 必须唯一；根上不允许带 hits。
  const badRoot = validateDataset(oneDataset(undefined, {
    usedCtxKeyDefs: {
      a: { id: 1, type: 'builtin', rules: ['x'], hits: '1' },
      b: { id: 1, type: 'weird', rules: ['fdm'] },
    },
  }));
  assert.equal(badRoot.ok, false);
  const msgs = badRoot.errors.join('；');
  assert.match(msgs, /usedCtxKeyDefs\.a 的 rules 必须是 fdm \/ cvt \/ vdt/);
  assert.match(msgs, /usedCtxKeyDefs\.a 不应带 hits/);
  assert.match(msgs, /usedCtxKeyDefs\.b 的 id 与 usedCtxKeyDefs\.a 重复/);
  assert.match(msgs, /usedCtxKeyDefs\.b 的 type 只能是 "builtin" 或 "user"/);

  // item.ctxDefs：id 必须已声明，且不允许再带定义（type / rules / def）。
  const badItem = validateDataset(oneDataset([oneItem({ ctxDefs: { 'hktr.ctx.default': { id: 9, type: 'builtin', rules: ['fdm'], def: 'x' } } })], base));
  assert.equal(badItem.ok, false);
  const imsgs = badItem.errors.join('；');
  assert.match(imsgs, /id=9 未在顶层 usedCtxKeyDefs 声明表里声明/);
  assert.match(imsgs, /不应带 type/);
  assert.match(imsgs, /不应带 rules/);
  assert.match(imsgs, /不应带 def/);
});

test('声明表：规则里的 ctx 引用必须已声明且写在本 item 的 ctxDefs 里', () => {
  const base = { usedCtxKeyDefs: { 'hktr.ctx.default': { id: 1, type: 'builtin', rules: ['fdm'] } } };
  const undeclared = validateDataset(oneDataset([oneItem({
    ctxDefs: { 'hktr.ctx.default': { id: 1 } },
    channels: [{ id: 1, sources: [{ id: 1, fields: [{ id: '1', cmpRight: { ctxs: [7] } }] }] }],
  })], base));
  assert.equal(undeclared.ok, false);
  assert.ok(undeclared.errors.some((e) => e.includes('引用了未在 usedCtxKeyDefs 声明的 ctx id：7')), JSON.stringify(undeclared.errors));

  const notInItem = validateDataset(oneDataset([oneItem({
    channels: [{ id: 1, sources: [{ id: 1, fields: [{ id: '1', cmpRight: { ctxs: [1] } }] }] }],
  })], base));
  assert.equal(notInItem.ok, false);
  assert.ok(notInItem.errors.some((e) => e.includes('未写在本 item 的 ctxDefs 里')), JSON.stringify(notInItem.errors));
});

test('声明表：比较规则的 valueSrcFmt 只能是 csv / xml（srcType 已改名）', () => {
  const ok = validateDataset(oneDataset([oneItem({
    channels: [{ id: 1, sources: [{ id: 1, fields: [{ id: '1', cmpLeft: { valueSrcFmt: 'csv' }, cmpRight: { valueSrcFmt: 'xml' } }] }] }],
  })]));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));

  const bad = validateDataset(oneDataset([oneItem({
    channels: [{ id: 1, sources: [{ id: 1, fields: [{ id: '1', cmpRight: { valueSrcFmt: 'json' } }] }] }],
  })]));
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('valueSrcFmt 只能是 "csv" / "xml"')), JSON.stringify(bad.errors));

  const legacy = validateDataset(oneDataset([oneItem({
    channels: [{ id: 1, sources: [{ id: 1, fields: [{ id: '1', cmpRight: { srcType: 1 } }] }] }],
  })]));
  assert.equal(legacy.ok, false);
  assert.ok(legacy.errors.some((e) => e.includes('srcType 已改名')), JSON.stringify(legacy.errors));
});

test('声明表：旧键 ctxKeyDefs 已改名为 usedCtxKeyDefs（出现即报错）', () => {
  const legacyKey = validateDataset(oneDataset(undefined, { ctxKeyDefs: {} }));
  assert.equal(legacyKey.ok, false, '旧键 ctxKeyDefs 应报错');
  assert.ok(legacyKey.errors.some((e) => e.includes('ctxKeyDefs 已改名（-> usedCtxKeyDefs）')), JSON.stringify(legacyKey.errors));

  // 新键合法：声明表可省略（无引用时），但不能是数组。
  assert.equal(validateDataset(oneDataset(undefined, { usedCtxKeyDefs: {} })).ok, true);
  const notObject = validateDataset(oneDataset(undefined, { usedCtxKeyDefs: [] }));
  assert.equal(notObject.ok, false, 'usedCtxKeyDefs 必须是对象');
  assert.ok(notObject.errors.some((e) => e.includes('usedCtxKeyDefs 必须是对象')), JSON.stringify(notObject.errors));
});

test('item 元数据：旧键 platformTradeId / platformDealId 已改名（出现即报错）', () => {
  assert.equal(validateDataset(oneDataset([oneItem({ platformOriTradeId: 'PT-1', platformOriTradeDealId: 'PD-1' })])).ok, true,
    '新键名合法');
  const legacyTrade = validateDataset(oneDataset([oneItem({ platformTradeId: 'PT-1' })]));
  assert.equal(legacyTrade.ok, false);
  assert.ok(legacyTrade.errors.some((e) => e.includes('platformTradeId 已改名（-> platformOriTradeId）')), JSON.stringify(legacyTrade.errors));
  const legacyDeal = validateDataset(oneDataset([oneItem({ platformDealId: 'PD-1' })]));
  assert.equal(legacyDeal.ok, false);
  assert.ok(legacyDeal.errors.some((e) => e.includes('platformDealId 已改名（-> platformOriTradeDealId）')), JSON.stringify(legacyDeal.errors));
});

test('声明表：渠道 / 来源渠道 id 必填、必须为正整数，且不得与预设冲突', () => {
  const noIds = validateDataset(oneDataset([oneItem({ channels: [{ sources: [{ fields: [] }] }] })]));
  assert.equal(noIds.ok, false);
  assert.ok(noIds.errors.some((e) => e.includes('缺少正整数 id（report channel id）')), JSON.stringify(noIds.errors));
  assert.ok(noIds.errors.some((e) => e.includes('缺少正整数 id（source id）')), JSON.stringify(noIds.errors));

  const badId = validateDataset(oneDataset([oneItem({ channels: [{ id: 0, sources: [{ id: -1, fields: [] }] }] })]));
  assert.equal(badId.ok, false, '0 / 负数不是合法 id');

  const preset = validateDataset(oneDataset(undefined, { reportChannelDefs: [reportChannelDef({ id: 2, name: 'HKTR' })] }));
  assert.equal(preset.ok, false);
  assert.ok(preset.errors.some((e) => e.includes('预设')), JSON.stringify(preset.errors));

  // 两个渠道引用同一个已声明的来源渠道：合法（声明是数据集级的）。
  const reuse = validateDataset(oneDataset([oneItem({ channels: [
    { id: 1, sources: [{ id: 1, fields: [] }] },
    { id: 2, sources: [{ id: 1, fields: [] }] },
  ] })], {
    reportChannelDefs: [reportChannelDef(), reportChannelDef({ id: 2, name: 'JSFA' })],
  }));
  assert.equal(reuse.ok, true, '不同渠道可引用同一个已声明的来源渠道：' + JSON.stringify(reuse.errors));
});

test('启用标记：enabledChannels 已彻底移除，enabled 只允许布尔', () => {
  assert.equal(validateDataset(oneDataset()).ok, true, '基线无 enabledChannels');
  assert.equal(validateDataset(oneDataset(undefined, { enabledChannels: ['HKTR'] })).ok, false, '顶层 enabledChannels 应报错');
  assert.equal(validateDataset(oneDataset([oneItem({ enabledChannels: ['HKTR'] })])).ok, false, 'item 级 enabledChannels 应报错');

  assert.equal(validateDataset(oneDataset([oneItem({ channels: [{ id: 1, enabled: false, sources: [] }] })])).ok, true, 'enabled=false 合法');
  assert.equal(validateDataset(oneDataset([oneItem({ channels: [{ id: 1, enabled: 'no', sources: [] }] })])).ok, false, 'enabled 非布尔应报错');
});

test('消息段（warnings / errors / uncompared）只写名称：必须已声明，且不允许再带 id', () => {
  const okRef = validateDataset(oneDataset([oneItem({
    warnings: [{ channel: 'HKTR', source: '来源渠道 A', type: 't', level: 'WARN' }],
    uncompared: [{ channel: 'HKTR', source: null, type: 1, value: '/x' }],
  })]));
  assert.equal(okRef.ok, true, JSON.stringify(okRef.errors));

  const unknownName = validateDataset(oneDataset([oneItem({ warnings: [{ channel: 'JSFA', type: 't' }] })]));
  assert.equal(unknownName.ok, false);
  assert.ok(unknownName.errors.some((e) => e.includes('channel「JSFA」未在顶层 reportChannelDefs 声明表里声明')), JSON.stringify(unknownName.errors));

  const unknownSource = validateDataset(oneDataset([oneItem({ errors: [{ channel: 'HKTR', source: '来源渠道 Z', type: 't' }] })]));
  assert.equal(unknownSource.ok, false);
  assert.ok(unknownSource.errors.some((e) => e.includes('source「来源渠道 Z」未在顶层 sourceChannelDefs 声明表里声明')), JSON.stringify(unknownSource.errors));

  // source 必须依附于某个已声明的 channel。
  const orphan = validateDataset(oneDataset([oneItem({ errors: [{ source: '来源渠道 A', type: 't' }] })]));
  assert.equal(orphan.ok, false);
  assert.ok(orphan.errors.some((e) => e.includes('source 存在时必须提供 channel')), JSON.stringify(orphan.errors));

  // 消息段带 channelId / sourceId 已移除。
  const withIds = validateDataset(oneDataset([oneItem({ warnings: [{ channel: 'HKTR', channelId: 1, type: 't' }] })]));
  assert.equal(withIds.ok, false);
  assert.ok(withIds.errors.some((e) => e.includes('channelId 已移除')), JSON.stringify(withIds.errors));
});

test('日志行（logs）只写 id：引用必须已声明，field 非空时 id 必填', () => {
  const okLog = validateDataset(oneDataset([oneItem({
    logs: [
      { scope: 'item', channelId: null, sourceId: null, text: '开始' },
      { scope: 'channel', channelId: 1, sourceId: null, text: '渠道级' },
      { scope: 'field', channelId: 1, sourceId: 1, field: '1', text: '字段级' },
    ],
  })]));
  assert.equal(okLog.ok, true, JSON.stringify(okLog.errors));

  const undeclared = validateDataset(oneDataset([oneItem({ logs: [{ scope: 'channel', channelId: 9, text: 'x' }] })]));
  assert.equal(undeclared.ok, false);
  assert.ok(undeclared.errors.some((e) => e.includes('channelId=9 未在顶层 reportChannelDefs 声明表里声明')), JSON.stringify(undeclared.errors));

  const missingId = validateDataset(oneDataset([oneItem({ logs: [{ scope: 'field', field: '1', text: 'x' }] })]));
  assert.equal(missingId.ok, false);
  assert.ok(missingId.errors.some((e) => e.includes('field 非空时 channelId 与 sourceId 都不能为空')), JSON.stringify(missingId.errors));

  const badScope = validateDataset(oneDataset([oneItem({ logs: [{ scope: 'channel', channelId: 1, field: '1', text: 'x' }] })]));
  assert.equal(badScope.ok, false);
  assert.ok(badScope.errors.some((e) => e.includes('只有 scope="field" 的日志行才允许有 field')), JSON.stringify(badScope.errors));
});

test('validateDataset：skippedItems 名称 + id 双写，且 id 必须已声明', () => {
  const base = {
    reportChannelDefs: [reportChannelDef(), reportChannelDef({ id: 2, name: 'JSFA', fieldDefs: [] })],
    sourceChannelDefs: [{ id: 1, name: '来源渠道 A' }, { id: 2, name: '来源渠道 B' }],
  };
  const okSkip = validateDataset(oneDataset(undefined, Object.assign({}, base, {
    skippedItems: [{ itemId: 'T-9', channel: 'JSFA', channelId: 2, source: '来源渠道 B', sourceId: 2, reason: 'r' }],
  })));
  assert.equal(okSkip.ok, true, JSON.stringify(okSkip.errors));

  const undeclared = validateDataset(oneDataset(undefined, {
    skippedItems: [{ itemId: 'T-9', channel: 'JSFA', channelId: 2, reason: 'r' }],
  }));
  assert.equal(undeclared.ok, false);
  assert.ok(undeclared.errors.some((e) => e.includes('skippedItems[0]') && e.includes('未在顶层 reportChannelDefs 声明表里声明')), JSON.stringify(undeclared.errors));

  const mismatch = validateDataset(oneDataset(undefined, Object.assign({}, base, {
    skippedItems: [{ itemId: 'T-9', channel: 'JSFA', channelId: 1, reason: 'r' }],
  })));
  assert.equal(mismatch.ok, false, 'channelId=1 是 HKTR，与 channel=JSFA 矛盾');
  assert.ok(mismatch.errors.some((e) => e.includes('不一致')), JSON.stringify(mismatch.errors));
});

test('validateDataset 单文件缺 channels 报错', () => {
  const r = validateDataset({ mode: 'single', items: [{ tradeId: 'T-1' }] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('channels')));
});

test('validateDataset 多文件模式要求 file 字段', () => {
  const ok = validateDataset({ mode: 'multi', items: [{ tradeId: 'T-1', file: 'T-1.json' }] });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));

  const bad = validateDataset({ mode: 'multi', items: [{ tradeId: 'T-1' }] });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('file')));
});

test('validateDataset 非法 mode 报错', () => {
  const r = validateDataset({ mode: 'weird', items: [] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('mode')));
});

test('validateDataset 接受合法的 creationType / skippedItems（单文件与多文件清单）', () => {
  const skipped = [{ itemId: 'T-9', channel: 'HKTR', source: null, reason: '未找到对应记录' }];
  const single = validateDataset({
    mode: 'single', reportEnv: 'OTCXXX', creationType: 'user', skippedItems: skipped,
    reportChannelDefs: [{ id: 1, name: 'HKTR' }],
    items: [{ tradeId: 'T-1', channels: [] }],
  });
  assert.equal(single.ok, true, JSON.stringify(single.errors));

  const multi = validateDataset({
    mode: 'multi', reportEnv: 'OTCXXX', creationType: 'sample', skippedItems: skipped,
    reportChannelDefs: [{ id: 1, name: 'HKTR' }],
    items: [{ tradeId: 'T-1', file: 'data/items/T-1.json' }],
  });
  assert.equal(multi.ok, true, JSON.stringify(multi.errors));

  // 空数组与缺省都合法（占位数据文件不带这两个字段）。
  assert.equal(validateDataset({ mode: 'multi', skippedItems: [], items: [] }).ok, true);
  assert.equal(validateDataset({ mode: 'single', items: [] }).ok, true);
});

test('validateDataset 显式 null 视为未提供（Java 生成器保留 null）', () => {
  const r = validateDataset({
    mode: 'multi', reportEnv: null, creationType: null, skippedItems: null,
    items: [{ tradeId: 'T-1', file: 'data/items/T-1.json', summary: null }],
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('validateDataset 非法 creationType 报错', () => {
  const r = validateDataset({ mode: 'single', creationType: 'Sample', items: [] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('creationType')), JSON.stringify(r.errors));
});

test('validateDataset 校验 skippedItems 结构与条目字段', () => {
  const notArray = validateDataset({ mode: 'single', skippedItems: {}, items: [] });
  assert.equal(notArray.ok, false);
  assert.ok(notArray.errors.some((e) => e.includes('skippedItems 必须是数组')));

  const r = validateDataset({
    mode: 'multi',
    skippedItems: [ 'x', { reason: 'no itemId' }, { itemId: 'T-9' }, { itemId: 'T-9', reason: 'ok', channel: 7 } ],
    items: [{ tradeId: 'T-1', file: 'f.json' }],
  });
  assert.equal(r.ok, false);
  const msgs = r.errors.join('；');
  assert.match(msgs, /skippedItems\[0\] 必须是对象/);
  assert.match(msgs, /skippedItems\[1\] 缺少 itemId/);
  assert.match(msgs, /skippedItems\[2\] 缺少 reason/);
  assert.match(msgs, /skippedItems\[3\] channel 必须是字符串或 null/);
  assert.equal(r.errors.filter((e) => e.includes('[3]')).length, 1, '第 3 条只应报 channel 类型问题');
});
