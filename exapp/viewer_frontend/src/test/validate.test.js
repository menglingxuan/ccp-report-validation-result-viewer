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
    channels: [{ id: 1, name: 'HKTR' }],
    items: [{ tradeId: 'T-1', reportDate: '2026-08-16', channels: [{ id: 1, sources: [] }] }],
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

/* ---------------- 渠道 / 来源渠道 id 与启用标记（契约新增） ---------------- */

// 最小合法 item：渠道 / 来源都只写 id 引用（声明在顶层，见下面的 oneDataset）。
function oneItem(over) {
  return Object.assign({
    tradeId: 'T-1',
    reportDate: '2026-08-16',
    channels: [{ id: 1, sources: [{ id: 1, fields: [] }] }],
  }, over || {});
}

// 最小合法单文件数据集（可对 items 做整体替换）。
// 顶层声明表（channels / sources）是唯一写定义的地方：item 里的引用必须是已声明的。
function oneDataset(items) {
  return {
    mode: 'single',
    reportEnv: 'OTCXXX',
    channels: [{ id: 1, name: 'HKTR', desc: '香港交易资料储存库', format: 'xml' }],
    sources: [{ id: 1, name: '来源渠道 A' }],
    items: items || [oneItem()],
  };
}

test('validateDataset：item 引用的渠道 / 来源渠道必须已在顶层声明表里声明', () => {
  // 基线：引用与声明一致。
  assert.equal(validateDataset(oneDataset()).ok, true, '已声明的引用应合法');
  // 声明处（顶层）不允许重复 / 冲突。
  const dupDecl = validateDataset(Object.assign(oneDataset(), {
    channels: [{ id: 1, name: 'HKTR' }, { id: 1, name: 'JSFA' }],
  }));
  assert.equal(dupDecl.ok, false);
  assert.ok(dupDecl.errors.some((e) => e.includes('声明必须唯一')), JSON.stringify(dupDecl.errors));

  // 未声明的渠道 / 来源渠道引用 -> 报错（item 里不再接受新定义）。
  const undeclaredCh = validateDataset(oneDataset([{ tradeId: 'T-1', reportDate: '2026-08-16', channels: [{ id: 9, fields: [], sources: [] }] }]));
  assert.equal(undeclaredCh.ok, false);
  assert.ok(undeclaredCh.errors.some((e) => e.includes('未在顶层 channels 声明表里声明')), JSON.stringify(undeclaredCh.errors));

  const undeclaredSrc = validateDataset(oneDataset([{ tradeId: 'T-1', reportDate: '2026-08-16', channels: [{ id: 1, fields: [], sources: [{ id: 7, fields: [] }] }] }]));
  assert.equal(undeclaredSrc.ok, false);
  assert.ok(undeclaredSrc.errors.some((e) => e.includes('未在顶层 sources 声明表里声明')), JSON.stringify(undeclaredSrc.errors));

  // item 里可以重复写名称，但必须与声明一致。
  const agree = validateDataset(oneDataset([{ tradeId: 'T-1', reportDate: '2026-08-16', channels: [{ id: 1, name: 'HKTR', fields: [], sources: [{ id: 1, name: '来源渠道 A', fields: [] }] }] }]));
  assert.equal(agree.ok, true, JSON.stringify(agree.errors));
  const disagree = validateDataset(oneDataset([{ tradeId: 'T-1', reportDate: '2026-08-16', channels: [{ id: 1, name: 'JSFA', fields: [], sources: [] }] }]));
  assert.equal(disagree.ok, false);
  assert.ok(disagree.errors.some((e) => e.includes('与顶层声明')), JSON.stringify(disagree.errors));

  // 旧形态（定义写在 item 里、顶层无声明）不再合法：契约要求引用 ⊆ 声明。
  const legacyShape = validateDataset({ mode: 'single', items: [{ tradeId: 'T-1', reportDate: '2026-08-16', channels: [{ id: 1, name: 'HKTR', sources: [{ id: 1, name: '来源渠道 A', fields: [] }] }] }] });
  assert.equal(legacyShape.ok, false, '旧形态应提示迁移');
  assert.ok(legacyShape.errors.some((e) => e.includes('未在顶层 channels 声明表里声明')), JSON.stringify(legacyShape.errors));
});

test('validateDataset：渠道 / 来源渠道 id 必填、必须为正整数', () => {
  const noIds = validateDataset(oneDataset([{ tradeId: 'T-1', reportDate: '2026-08-16', channels: [{ name: 'HKTR', sources: [{ name: '来源渠道 A', fields: [] }] }] }]));
  assert.equal(noIds.ok, false);
  assert.ok(noIds.errors.some((e) => e.includes('缺少正整数 id（report channel id）')), JSON.stringify(noIds.errors));
  assert.ok(noIds.errors.some((e) => e.includes('缺少正整数 id（source id）')), JSON.stringify(noIds.errors));

  const badId = validateDataset(oneDataset([{ tradeId: 'T-1', reportDate: '2026-08-16', channels: [{ id: 0, name: 'HKTR', sources: [{ id: -1, name: '来源渠道 A', fields: [] }] }] }]));
  assert.equal(badId.ok, false, '0 / 负数不是合法 id');

  // 声明表里的预设 id 不允许被其它渠道占用。
  const preset = validateDataset(Object.assign(oneDataset(), { channels: [{ id: 2, name: 'HKTR' }] }));
  assert.equal(preset.ok, false);
  assert.ok(preset.errors.some((e) => e.includes('预设')), JSON.stringify(preset.errors));
});

test('validateDataset：来源渠道声明表 id / 名称都数据集级唯一', () => {
  const dup = validateDataset(Object.assign(oneDataset(), {
    sources: [{ id: 1, name: '来源渠道 A' }, { id: 1, name: '来源渠道 B' }],
  }));
  assert.equal(dup.ok, false);
  assert.ok(dup.errors.some((e) => e.includes('声明必须唯一')), JSON.stringify(dup.errors));

  // 两个渠道引用同一个已声明的来源渠道：合法（声明是数据集级的）。
  const reuse = validateDataset(Object.assign(oneDataset([oneItem({ channels: [
    { id: 1, fields: [], sources: [{ id: 1, fields: [] }] },
    { id: 2, fields: [], sources: [{ id: 1, fields: [] }] },
  ] })]), { channels: [{ id: 1, name: 'HKTR' }, { id: 2, name: 'JSFA' }] }));
  assert.equal(reuse.ok, true, '不同渠道可引用同一个已声明的来源渠道：' + JSON.stringify(reuse.errors));
});

test('validateDataset：enabledChannels 已彻底移除（顶层与 item 级都报错），enabled 只允许布尔', () => {
  const top = validateDataset(oneDataset());
  assert.equal(top.ok, true, '基线无 enabledChannels');
  assert.equal(validateDataset(Object.assign(oneDataset(), { enabledChannels: ['HKTR'] })).ok, false, '顶层 enabledChannels 应报错');
  assert.equal(validateDataset(oneDataset([oneItem({ enabledChannels: ['HKTR'] })])).ok, false, 'item 级 enabledChannels 应报错');

  assert.equal(validateDataset(oneDataset([oneItem({ channels: [{ id: 1, enabled: false, fields: [], sources: [] }] })])).ok, true, 'enabled=false 合法');
  assert.equal(validateDataset(oneDataset([oneItem({ channels: [{ id: 1, enabled: 'no', fields: [], sources: [] }] })])).ok, false, 'enabled 非布尔应报错');
});

test('validateDataset：warnings / errors / uncompared / logs 的名称与 id 双写必须相互一致', () => {
  const okRef = validateDataset(oneDataset([oneItem({
    warnings: [{ channel: 'HKTR', channelId: 1, source: '来源渠道 A', sourceId: 1, type: 't', level: 'WARN' }],
  })]));
  assert.equal(okRef.ok, true, JSON.stringify(okRef.errors));

  const badName = validateDataset(oneDataset([oneItem({ warnings: [{ channel: 'JSFA', channelId: 1, type: 't' }] })]));
  assert.equal(badName.ok, false);
  assert.ok(badName.errors.some((e) => e.includes('不一致')), JSON.stringify(badName.errors));

  const dangling = validateDataset(oneDataset([oneItem({ uncompared: [{ channel: 'HKTR', channelId: 9, type: 1 }] })]));
  assert.equal(dangling.ok, false);
  assert.ok(dangling.errors.some((e) => e.includes('未在数据集内登记')), JSON.stringify(dangling.errors));

  const orphan = validateDataset(oneDataset([oneItem({ errors: [{ source: '来源渠道 A', sourceId: 1, type: 't' }] })]));
  assert.equal(orphan.ok, false, 'sourceId 没有 channelId 无法定位到渠道');
  assert.ok(orphan.errors.some((e) => e.includes('sourceId 存在时必须提供 channelId')), JSON.stringify(orphan.errors));

  const badType = validateDataset(oneDataset([oneItem({ warnings: [{ channel: 'HKTR', channelId: '1', type: 't' }] })]));
  assert.equal(badType.ok, false, 'channelId 必须是数字');
});

test('validateDataset：skippedItems 引用的渠道 / 来源渠道同样必须在声明表里', () => {
  // 被跳过的 item 不在 items 里，但它引用的渠道 / 来源渠道仍需在顶层声明（生成器会把它们补进声明表）。
  const okSkip = validateDataset(Object.assign(oneDataset(), {
    sources: [{ id: 1, name: '来源渠道 A' }, { id: 2, name: '来源渠道 B' }],
    channels: [{ id: 1, name: 'HKTR' }, { id: 2, name: 'JSFA' }],
    skippedItems: [{ itemId: 'T-9', channel: 'JSFA', channelId: 2, source: '来源渠道 B', sourceId: 2, reason: 'r' }],
  }));
  assert.equal(okSkip.ok, true, JSON.stringify(okSkip.errors));

  // 未声明的渠道 id -> 报错。
  const undeclared = validateDataset(Object.assign(oneDataset(), {
    skippedItems: [{ itemId: 'T-9', channel: 'JSFA', channelId: 2, reason: 'r' }],
  }));
  assert.equal(undeclared.ok, false);
  assert.ok(undeclared.errors.some((e) => e.includes('skippedItems[0]') && e.includes('未在数据集内登记')), JSON.stringify(undeclared.errors));

  // 声明的 id 与名称矛盾 -> 报错。
  const badSkip = validateDataset(Object.assign(oneDataset(), {
    channels: [{ id: 1, name: 'HKTR' }, { id: 2, name: 'JSFA' }],
    skippedItems: [{ itemId: 'T-9', channel: 'JSFA', channelId: 1, reason: 'r' }],
  }));
  assert.equal(badSkip.ok, false, 'channelId=1 是 HKTR，与 channel=JSFA 矛盾');
  assert.ok(badSkip.errors.some((e) => e.includes('不一致')), JSON.stringify(badSkip.errors));
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
    items: [{ tradeId: 'T-1', channels: [] }],
  });
  assert.equal(single.ok, true, JSON.stringify(single.errors));

  const multi = validateDataset({
    mode: 'multi', reportEnv: 'OTCXXX', creationType: 'sample', skippedItems: skipped,
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
