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
    items: [{ tradeId: 'T-1', reportDate: '2026-08-16', channels: [{ name: 'HKTR', sources: [] }] }],
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
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
