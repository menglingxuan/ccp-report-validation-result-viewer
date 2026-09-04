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
