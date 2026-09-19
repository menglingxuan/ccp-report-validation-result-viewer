// 「管理忽略配置」纯函数测试：扁平 key 解析 / 按类型列出 / 关键字过滤 / 删除（纯函数）。
// 渲染与回写（modal、POST /api/ignore）由浏览器验证；本文件锁定解析与删除语义。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIgnoreKey, listIgnoreEntries, filterIgnoreEntries, removeIgnoreKeys, groupedToFlat,
  countIgnoredByKey, cycleSort, filterRowsByRules, FILTER_EMPTY, IGNORE_KINDS,
} from '../public/core.js';

const K_WARN = JSON.stringify(['warn', 'P1', 'HKTR', 'A', 'field', 't1', 'L1', 'f1']);
const K_WARN2 = JSON.stringify(['warn', 'P2', 'JSFA', '', 'channel', 't2', 'L2', '']);
const K_XPATH = JSON.stringify(['xpath', '/a/b', 'HKTR', 'P1', 'A', '']);
const K_CSV = JSON.stringify(['csv', 'v1', 'JSFA', 'P2', '', '']);
const FLAT = Object.fromEntries([K_WARN, K_WARN2, K_XPATH, K_CSV].map((k) => [k, true]));

test('parseIgnoreKey：三种类型的槽位解析（与 groupedToFlat 一致）', () => {
  assert.deepEqual(IGNORE_KINDS, ['warn', 'xpath', 'csv']);

  const w = parseIgnoreKey(K_WARN);
  assert.deepEqual(
    { kind: w.kind, platform: w.platform, channel: w.channel, source: w.source, scope: w.scope, type: w.type, level: w.level, field: w.field, value: w.value },
    { kind: 'warn', platform: 'P1', channel: 'HKTR', source: 'A', scope: 'field', type: 't1', level: 'L1', field: 'f1', value: '' });

  const x = parseIgnoreKey(K_XPATH);
  assert.deepEqual(
    { kind: x.kind, platform: x.platform, channel: x.channel, source: x.source, value: x.value },
    { kind: 'xpath', platform: 'P1', channel: 'HKTR', source: 'A', value: '/a/b' });

  const c = parseIgnoreKey(K_CSV);
  assert.deepEqual(
    { kind: c.kind, platform: c.platform, channel: c.channel, source: c.source, value: c.value },
    { kind: 'csv', platform: 'P2', channel: 'JSFA', source: '', value: 'v1' });

  assert.equal(parseIgnoreKey('not-json'), null);
  assert.equal(parseIgnoreKey(JSON.stringify(['unknown', 'x'])), null);
  assert.equal(parseIgnoreKey(JSON.stringify({ a: 1 })), null);
});

test('parseIgnoreKey：与 groupedToFlat 往返一致（写出的 key 能被解析回同样条目）', () => {
  const grouped = { P1: { warnings: [{ channel: 'HKTR', source: 'A', scope: 'field', type: 't1', level: 'L1', field: 'f1' }], uncomparedXpaths: [{ xpath: '/a/b', channel: 'HKTR', source: 'A' }], uncomparedCsvs: [] } };
  const flat = groupedToFlat(grouped);
  const entries = listIgnoreEntries(flat);
  assert.equal(entries.length, 2);
  assert.deepEqual({ kind: entries[0].kind, platform: entries[0].platform, channel: entries[0].channel, source: entries[0].source, scope: entries[0].scope, type: entries[0].type, level: entries[0].level, field: entries[0].field },
    { kind: 'warn', platform: 'P1', channel: 'HKTR', source: 'A', scope: 'field', type: 't1', level: 'L1', field: 'f1' });
  assert.deepEqual({ kind: entries[1].kind, value: entries[1].value, platform: entries[1].platform }, { kind: 'xpath', value: '/a/b', platform: 'P1' });
});

test('listIgnoreEntries：按类型筛选 + 排序（平台 -> 渠道 -> 来源 -> 值/字段）', () => {
  assert.deepEqual(listIgnoreEntries(FLAT, 'warn').length, 2);
  assert.deepEqual(listIgnoreEntries(FLAT, 'xpath').length, 1);
  assert.deepEqual(listIgnoreEntries(FLAT, 'csv').length, 1);
  assert.deepEqual(listIgnoreEntries(FLAT).length, 4, '不传类型则全部列出');
  assert.deepEqual(listIgnoreEntries(FLAT, 'warn').map((e) => e.platform), ['P1', 'P2'], '按平台排序');
  assert.deepEqual(listIgnoreEntries({}), []);
  assert.deepEqual(listIgnoreEntries({ [K_WARN]: false }, 'warn'), [], '值为假视为未忽略');
});

test('filterIgnoreEntries：匹配任意展示字段，大小写不敏感', () => {
  const all = listIgnoreEntries(FLAT);
  assert.equal(filterIgnoreEntries(all, '').length, 4);
  assert.deepEqual(filterIgnoreEntries(all, 'hktr').map((e) => e.kind), ['warn', 'xpath']);
  assert.deepEqual(filterIgnoreEntries(all, '/a/b').map((e) => e.kind), ['xpath']);
  assert.deepEqual(filterIgnoreEntries(all, '不存在的关键字'), []);
});

test('countIgnoredByKey：统计每个忽略 key 实际命中的条数（仅已忽略项）', () => {
  const warn = (over) => Object.assign({ platform: 'P1', channel: 'HKTR', source: 'A', type: 't1', level: 'L1', field: 'f1' }, over);
  const list = [
    warn({}),                                  // 命中 K_WARN（字段级）
    warn({ field: 'f2' }),                     // 未忽略 -> 不计
    warn({ source: 'B' }),                     // 来源不同 -> 另一个 key，未忽略
    { platform: 'P2', channel: 'JSFA', source: '', type: 't2', level: 'L2', field: '' },   // 命中 K_WARN2（渠道级）
    { platform: 'P2', channel: 'JSFA', source: '', type: 't2', level: 'L2', field: '' },   // 同一 key 的第 2 条 -> 累加
  ];
  assert.deepEqual(countIgnoredByKey('warnings', list, FLAT), { [K_WARN]: 1, [K_WARN2]: 2 }, '同一 key 命中多条时累加');
  assert.deepEqual(countIgnoredByKey('warnings', list, {}), {}, '空配置不计任何条目');
  assert.deepEqual(countIgnoredByKey('errors', list, FLAT), {}, '不支持的类型返回空');

  const unc = [
    { value: '/a/b', channel: 'HKTR', platform: 'P1', source: 'A', type: 1 },
    { value: 'v1', channel: 'JSFA', platform: 'P2', source: '', type: 2 },
    { value: 'v2', channel: 'JSFA', platform: 'P2', source: '', type: 2 },
  ];
  assert.deepEqual(countIgnoredByKey('uncompared', unc, FLAT), { [K_XPATH]: 1, [K_CSV]: 1 }, '未比较按 xpath/csv 分别成 key（v2 未忽略不计）');
});

test('removeIgnoreKeys：删除后返回新集合（不修改入参）', () => {
  const before = Object.keys(FLAT).length;
  const after = removeIgnoreKeys(FLAT, [K_WARN, K_CSV]);
  assert.deepEqual(Object.keys(after).sort(), [K_WARN2, K_XPATH].sort());
  assert.equal(Object.keys(FLAT).length, before, '原集合保持不变（纯函数）');
  assert.deepEqual(Object.keys(removeIgnoreKeys(FLAT, ['not-a-key'])).length, 4, '不存在的 key 不影响结果');
  assert.deepEqual(Object.keys(removeIgnoreKeys(FLAT, [])).length, 4, '空删除列表返回等价集合');
  assert.deepEqual(Object.keys(removeIgnoreKeys({}, [K_WARN])).length, 0);
});

test('cycleSort：同一列 升序 → 降序 → 原序；换列从升序开始', () => {
  let s = { col: -1, dir: 1 };
  s = cycleSort(s, 3);
  assert.deepEqual(s, { col: 3, dir: 1 }, '首次点击：升序');
  s = cycleSort(s, 3);
  assert.deepEqual(s, { col: 3, dir: -1 }, '再次点击：降序');
  s = cycleSort(s, 3);
  assert.deepEqual(s, { col: -1, dir: 1 }, '第三次：回到原序');
  s = cycleSort({ col: 5, dir: -1 }, 3);
  assert.deepEqual(s, { col: 3, dir: 1 }, '换列时从升序开始');
  assert.deepEqual(cycleSort(undefined, 0), { col: 0, dir: 1 }, '空状态也能处理');
});

test('filterRowsByRules：下拉精确匹配 + 字段列包含匹配（列间 AND）', () => {
  const R = (text, cls) => ({ text: text, cls: cls || '' });
  const rows = [
    [R('P1'), R('HKTR'), R(''), R('渠道')],
    [R('P1'), R('JSFA'), R('来源渠道 B'), R('字段级')],
    [R('P2'), R('JSFA'), R(''), R('字段级')],
  ];
  assert.equal(filterRowsByRules(rows, []).length, 3, '无规则不过滤');
  assert.equal(filterRowsByRules(rows, [{ col: 0, mode: 'exact', value: '' }]).length, 3, '空值表示不限制');

  const exact = filterRowsByRules(rows, [{ col: 1, mode: 'exact', value: 'JSFA' }]);
  assert.equal(exact.length, 2, '精确匹配（不命中 P1/HKTR 行）');
  assert.equal(filterRowsByRules(rows, [{ col: 1, mode: 'exact', value: 'J' }]).length, 0, '精确匹配不做子串命中');
  assert.equal(filterRowsByRules(rows, [{ col: 1, mode: 'exact', value: 'jsfa' }]).length, 2, '大小写不敏感');

  assert.equal(filterRowsByRules(rows, [{ col: 2, mode: 'exact', value: FILTER_EMPTY }]).length, 2, '空值哨兵匹配空单元格');
  assert.equal(filterRowsByRules(rows, [{ col: 2, mode: 'contains', value: '来源' }]).length, 1, '字段列（关联字段 / 元素）仍为包含匹配');

  const and = filterRowsByRules(rows, [
    { col: 1, mode: 'exact', value: 'JSFA' },
    { col: 0, mode: 'exact', value: 'P2' },
  ]);
  assert.equal(and.length, 1, '多列 AND');
  assert.equal(and[0][3].text, '字段级');
});
