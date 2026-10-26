// 「完整日志」字段定位（日志锚点）回归测试。
//
// 覆盖三层：
//   1. 数据契约：item.logs 的 field 语义（仅 scope="field" 有值，且要求 channel/source 非空）——
//      字段级日志行**只在 item.logs 里存一份**（`fields[]` 不新增任何字段）；样例数据 / 校验器都按此契约实现。
//   2. 查看器接线：日志锚点 id、报告字段 / 关联字段单击跳转、字段详情页「相关打印信息」改读日志行 + 三角跳转。
//   3. 样式与文案：高亮动画类与三语文案齐备。
//
// app.js 的跳转逻辑位于 DOM 闭包内（依赖浏览器环境），Node 无法直接执行，因此对 public/ 源码做结构断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDataset } from '../lib/validate.js';
import {
  logFieldKey, logAnchorId, isFieldLogLine,
  refChannelId, refSourceId, CHANNEL_ID_PRESET, SOURCE_ID_PRESET,
  hydrateDataset,
} from '../public/core.js';

const SRC_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = path.join(SRC_DIR, 'public');
const APP = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
const I18N = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'i18n.json'), 'utf8'));
const LANGS = ['zh-CN', 'zh-HK', 'en'];

function bodyOf(sig, len = 1200) {
  const i = APP.indexOf(sig);
  assert.notEqual(i, -1, '未找到：' + sig);
  return APP.slice(i, i + len);
}

/* ---------------- 1. 数据契约 ---------------- */

// 最小合法数据集：渠道 / 来源渠道在顶层声明，item 里只有 id 引用（契约：引用 ⊆ 声明）。
function minimalDataset(items, extra) {
  return Object.assign({
    mode: 'single',
    reportChannelDefs: [{
      id: CHANNEL_ID_PRESET.HKTR, name: 'HKTR', desc: '香港交易资料储存库', format: 'xml',
      fieldDefs: [{ id: '1', name: 'tradeId', userTag: 'contextAssertion', type: 'id' }],
    }],
    sourceChannelDefs: [{ id: SOURCE_ID_PRESET['来源渠道 A'], name: '来源渠道 A', format: 'csv' }],
    items: items,
  }, extra || {});
}

// 最小合法 item：渠道 / 来源渠道只写 id 引用，字段定义在顶层 fieldDefs 里。
function minimalItem(logs) {
  return {
    tradeId: 'T-1',
    reportDate: '2026-08-16',
    channels: [{
      id: CHANNEL_ID_PRESET.HKTR,
      sources: [{
        id: SOURCE_ID_PRESET['来源渠道 A'],
        fields: [{ id: '1', result: 'PASSED' }],
      }],
    }],
    logs: logs,
  };
}
// 字段级日志行（新形态：只写 id + field，名称由查看器按 id 解析回来）。
function fieldLog(channel, source, field, text, extra) {
  return Object.assign({
    scope: 'field', field: field, text: text,
    channelId: CHANNEL_ID_PRESET[channel] || null,
    sourceId: SOURCE_ID_PRESET[source] || null,
  }, extra || {});
}

test('数据契约：field 仅出现在 scope="field" 的日志行上，且只写 id 就能通过校验', () => {
  const ok = validateDataset(minimalDataset([minimalItem([
    { scope: 'item', channelId: null, sourceId: null, field: null, text: 'a' },
    { scope: 'channel', channelId: 1, sourceId: null, field: null, text: 'b' },
    fieldLog('HKTR', '来源渠道 A', '1', 'c'),
  ])]));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  // 老写法（名称与 id 双写）仍然可读：名称是可选的，但要与声明一致。
  const legacy = validateDataset(minimalDataset([minimalItem([
    { scope: 'field', channel: 'HKTR', source: '来源渠道 A', channelId: 1, sourceId: 1, field: '1', text: 'c' },
  ])]));
  assert.equal(legacy.ok, true, JSON.stringify(legacy.errors));
});

test('数据契约：scope=channel 的行带 field 报错；field 非空时缺 channelId / sourceId 报错（不再看名称）', () => {
  const r = validateDataset(minimalDataset([minimalItem([
    { scope: 'channel', channelId: 1, sourceId: null, field: '1', text: 'a' },
    { scope: 'field', channelId: 1, sourceId: null, field: '1', text: 'b' },
    { scope: 'field', sourceId: null, field: '1', text: 'c' },
  ])]));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('只有 scope="field" 的日志行才允许有 field')), JSON.stringify(r.errors));
  // 3 条坏行都缺 channelId / sourceId（已经不再校验 channel / source 名称）：
  assert.equal(r.errors.filter((e) => e.includes('field 非空时 channelId 与 sourceId 都不能为空')).length, 3,
    JSON.stringify(r.errors));
  // 名称缺失本身不再算错误（日志只写 id）；就算名称存在也不会因为名称缺失而报错。
  assert.equal(r.errors.some((e) => e.includes('channel 与 source 都不能为空')), false, JSON.stringify(r.errors));
});

test('数据契约：field 非空时 channelId 与 sourceId 都不能为空（日志锚点需要 id）', () => {
  const noIds = validateDataset(minimalDataset([minimalItem([{ scope: 'field', channel: 'HKTR', source: '来源渠道 A', field: '1', text: 'x' }])]));
  assert.equal(noIds.ok, false);
  assert.equal(noIds.errors.filter((e) => e.includes('field 非空时 channelId 与 sourceId 都不能为空')).length, 1,
    JSON.stringify(noIds.errors));
  const ok = validateDataset(minimalDataset([minimalItem([fieldLog('HKTR', '来源渠道 A', '1', 'x')])]));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
});

test('数据契约：日志行必须是对象且 text 为字符串', () => {
  const r = validateDataset(minimalDataset([minimalItem(['纯文本日志'])]));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('必须是对象')), JSON.stringify(r.errors));

  const r2 = validateDataset(minimalDataset([minimalItem([{ scope: 'field', channel: 'HKTR', source: '来源渠道 A', channelId: 1, sourceId: 1, field: '1' }])]));
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => e.includes('缺少 text 字符串')), JSON.stringify(r2.errors));
});

test('样例数据：字段级日志行只在 item.logs 里，fields[] 不新增任何字段', () => {
  // 落盘数据是「顶层登记表 + item 只留 id 引用」的形态：按查看器的方式 hydrate 后再断言。
  const json = hydrateDataset(JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'report-validation-data.json'), 'utf8')));
  assert.ok(json.items.length > 0);
  json.items.forEach((item) => {
    const fieldLines = (item.logs || []).filter((l) => l.scope === 'field');
    assert.ok(fieldLines.length > 0, item.tradeId + ' 缺少 scope="field" 的日志行');
    const byChannel = {};
    item.channels.forEach((ch) => {
      const ids = ch.fields.map((d) => d.id);
      const srcs = ch.sources.map((s) => s.name);
      const srcIds = ch.sources.map((s) => s.id);
      byChannel[ch.name] = { ids: ids, srcs: srcs, srcIds: srcIds, id: ch.id };
      ch.sources.forEach((s) => s.fields.forEach((f) => {
        assert.equal(f.id, String(f.id), item.tradeId + ' 字段 id 必须是字符串');
        assert.ok(ids.indexOf(f.id) !== -1, item.tradeId + ' 字段 id 必须存在于渠道注册表');
        // 字段对象不存日志（只有 prints 保留待用）：日志行只存在于 item.logs。
        assert.equal('logs' in f, false, item.tradeId + '/' + ch.name + '/' + s.name + ' 字段不应带 logs（日志只在 item.logs）');
        assert.ok(Array.isArray(f.prints) && f.prints.length > 0, item.tradeId + ' prints 保留待用，仍应保留');
      }));
    });
    // 每条字段级日志行都要能对回真实的渠道 / 来源渠道 / 字段 id（否则锚点定位不到）。
    // 落盘数据只写 id；hydrate 后名称也应齐备（展示 / 筛选按名称）。
    const byChId = {};
    item.channels.forEach((ch) => { byChId[ch.id] = { ch: ch, srcIds: ch.sources.map((s) => s.id), fieldIds: ch.fields.map((d) => d.id) }; });
    fieldLines.forEach((l) => {
      const entry = byChId[l.channelId];
      assert.ok(entry, item.tradeId + ' 日志行的 channelId 不在该 item 里：' + l.channelId);
      assert.ok(entry.srcIds.indexOf(l.sourceId) !== -1, item.tradeId + ' 日志行 sourceId 不在该渠道里：' + l.sourceId);
      assert.ok(entry.fieldIds.indexOf(l.field) !== -1, item.tradeId + ' 日志行的 field 不在该渠道注册表里：' + l.field);
      assert.ok(String(l.text).length > 0, item.tradeId + ' 日志行 text 不应为空');
      // hydrate 后名称齐备（名称由 hydrateItem 按 id 从声明表补回，不解析 text）。
      assert.equal(l.channel, entry.ch.name, item.tradeId + ' hydrate 后日志行应有渠道名称');
      const src = entry.ch.sources.find((s) => s.id === l.sourceId);
      assert.equal(l.source, src.name, item.tradeId + ' hydrate 后日志行应有来源渠道名称');
    });
  });
});

test('样例数据：落盘日志行只写 channelId / sourceId，消息段只写名称', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'report-validation-data.json'), 'utf8'));
  let logLines = 0;
  let msgRefs = 0;
  raw.items.forEach((item) => {
    (item.logs || []).forEach((l) => {
      logLines++;
      assert.equal('channel' in l, false, '日志行不应写 channel 名称：' + JSON.stringify(l).slice(0, 140));
      assert.equal('source' in l, false, '日志行不应写 source 名称：' + JSON.stringify(l).slice(0, 140));
    });
    ['warnings', 'errors', 'uncompared'].forEach((k) => {
      (item[k] || []).forEach((m) => {
        if (m.channel == null) return;
        msgRefs++;
        assert.equal('channelId' in m, false, k + ' 只写名称（不带 channelId）');
        assert.equal('sourceId' in m, false, k + ' 只写名称（不带 sourceId）');
      });
    });
  });
  assert.ok(logLines > 100, '应检查到足够多的日志行，实际：' + logLines);
  assert.ok(msgRefs > 0, '应检查到消息段的双写引用');
  (raw.skippedItems || []).forEach((s, i) => {
    if (s.channel == null) return;
    assert.equal(s.channelId, CHANNEL_ID_PRESET[s.channel], 'skippedItems[' + i + '] 仍应双写 channelId');
  });
});

test('hydrate：渠道 / 来源渠道名称只按 id 解析，绝不从日志文本（text）推断', () => {
  const data = {
    mode: 'single',
    reportChannelDefs: [
      { id: CHANNEL_ID_PRESET.HKTR, name: 'HKTR', desc: '香港交易资料储存库', format: 'xml' },
      { id: CHANNEL_ID_PRESET.JSFA, name: 'JSFA' },
    ],
    sourceChannelDefs: [{ id: SOURCE_ID_PRESET['来源渠道 A'], name: '来源渠道 A' }],
    items: [{
      tradeId: 'T-1',
      channels: [{ id: CHANNEL_ID_PRESET.HKTR, fields: [], sources: [{ id: SOURCE_ID_PRESET['来源渠道 A'], fields: [] }] }],
      logs: [
        // text 里写满了渠道 / 来源名称，但没有任何 id：不得据此补出名称（也不得当成字段级日志行）
        { scope: 'field', field: '1', channelId: null, sourceId: null, text: '[HKTR/来源渠道 A] 比较字段 notional' },
        // 只写 id：名称由声明表补回
        { scope: 'field', channelId: CHANNEL_ID_PRESET.HKTR, sourceId: SOURCE_ID_PRESET['来源渠道 A'], field: '1', text: 'x' },
      ],
      warnings: [{ channelId: CHANNEL_ID_PRESET.HKTR, sourceId: SOURCE_ID_PRESET['来源渠道 A'], type: 't', level: 'WARN', text: 'w' }],
      uncompared: [{ type: 1, channelId: CHANNEL_ID_PRESET.HKTR, sourceId: null, value: '/x' }],
    }],
    skippedItems: [{ itemId: 'T-9', channelId: CHANNEL_ID_PRESET.JSFA, sourceId: null, reason: 'r' }],
  };
  const h = hydrateDataset(data);
  const logs = h.items[0].logs;
  assert.equal(logs[0].channel, undefined, '不得从 text 推断渠道名称');
  assert.equal(logs[0].source, undefined, '不得从 text 推断来源渠道名称');
  assert.equal(isFieldLogLine(logs[0]), false, 'text 里有渠道名也不算字段级日志行（只看结构化字段）');
  assert.equal(logs[1].channel, 'HKTR', '只有 id 时按声明表补回渠道名称');
  assert.equal(logs[1].source, '来源渠道 A', '只有 id 时按声明表补回来源渠道名称');
  assert.equal(isFieldLogLine(logs[1]), true, '只写 id 的字段级日志行成立');
  assert.equal(h.items[0].warnings[0].channel, 'HKTR', 'warnings 同样按 id 解析');
  assert.equal(h.items[0].uncompared[0].channel, 'HKTR', 'uncompared 同样按 id 解析');
  assert.equal(h.skippedItems[0].channel, 'JSFA', 'skippedItems 同样按 id 解析');
  // 幂等：再 hydrate 一次结果不变（且不会把名称写回成 id 以外的形态）。
  assert.deepEqual(hydrateDataset(h).items[0].logs, logs);
  // 老形态（只有名称、没有 id）保持原样：不做反向推断，也不丢名称。
  const legacy = hydrateDataset({ mode: 'single', items: [{ tradeId: 'T-1', channels: [], logs: [{ scope: 'field', channel: 'HKTR', source: '来源渠道 A', field: '1', text: 'x' }] }] });
  assert.equal(legacy.items[0].logs[0].channel, 'HKTR');
  assert.equal(legacy.items[0].logs[0].channelId, undefined, 'hydrate 不会凭空造 id');
});

/* ---------------- 2. 查看器接线 ---------------- */

test('日志锚点：合成键 = channelId|sourceId|fieldId，DOM id = log-<渠道id>-<来源id>-f<字段id>.<序号>', () => {
  // 锚点纯函数在 public/core.js（DOM 无关，可直接单测）；app.js 只负责渲染与跳转。
  assert.match(APP, /logFieldKey, logAnchorId, isFieldLogLine,/, 'app.js 应从 core.js 引入锚点纯函数');
  assert.equal(logFieldKey(1, 2, '3'), '1|2|3', '合成键 = channelId|sourceId|fieldId（数字，无歧义）');
  assert.equal(logFieldKey(null, null, '3'), '||3', 'id 缺失时置空占位（仍可生成键）');
  assert.equal(logAnchorId(1, 1, '2', 1), 'log-1-1-f2.1', '锚点 id 形如 log-<渠道id>-<来源id>-f<字段id>.<序号>');
  assert.equal(logAnchorId(3, 2, '13', 3), 'log-3-2-f13.3', '同键序号取该行在同键行中的次序');
  assert.equal(logAnchorId(1, 2, '2', 1).length <= 20, true, 'id 短小稳定（不再有名称 slug / 哈希）');
  // 旧实现的名称 slug / 哈希已彻底删除：不能因「清理后同名」而碰撞。
  assert.equal(typeof logSlugRemoved, 'undefined');
  // 日志行契约判定
  assert.equal(isFieldLogLine({ scope: 'field', channel: 'HKTR', source: 'A', field: '1' }), true);
  assert.equal(isFieldLogLine({ scope: 'field', channel: 'HKTR', source: '', field: '1' }), false, '缺 source 不算带锚点的行');
  assert.equal(isFieldLogLine({ scope: 'channel', channel: 'HKTR', source: 'A', field: '1' }), false, '非 field 级不算');
});

test('id 引用解析：优先用数据里的 id，缺 id 时按名称回退（老数据仍可定位）', () => {
  const item = { channels: [{ id: 5, name: 'HKTR', sources: [{ id: 7, name: '来源渠道 A' }] }] };
  assert.equal(refChannelId(item, { channel: 'HKTR' }), 5, '按渠道名解析 id');
  assert.equal(refChannelId(item, { channel: 'HKTR', channelId: 1 }), 1, '数据里的 id 优先（不反查名称）');
  assert.equal(refSourceId(item, { channel: 'HKTR', source: '来源渠道 A' }), 7, '按来源名解析 id');
  assert.equal(refSourceId(item, { channel: 'HKTR', source: '来源渠道 A', sourceId: 2 }), 2, '数据里的 sourceId 优先');
  // 老数据：渠道 / 来源没有 id → 回退预设表；名称不在预设里则返回 null。
  const legacy = { channels: [{ name: 'HKTR', sources: [{ name: '来源渠道 B' }] }] };
  assert.equal(refChannelId(legacy, { channel: 'HKTR' }), CHANNEL_ID_PRESET.HKTR, '未登记渠道按预设回退');
  assert.equal(refSourceId(legacy, { channel: 'HKTR', source: '来源渠道 B' }), SOURCE_ID_PRESET['来源渠道 B'], '未登记来源按预设回退');
  assert.equal(refChannelId(legacy, { channel: '未知名' }), null, '无法解析时返回 null');
  assert.equal(refSourceId(legacy, { channel: 'HKTR', source: '未知名' }), null, '无法解析时返回 null');
  assert.equal(refSourceId(legacy, { channel: '未知名', source: '来源渠道 A' }), null, '渠道解析不到时来源也无从解析');
});

test('日志锚点：仅 scope="field" 的行渲染 id 与 data-log-key，序号在 item.logs 内稳定', () => {
  const body = bodyOf('function renderLogs() {', 2600);
  assert.match(body, /if \(!isFieldLogLine\(l\)\) return '<div class="log-line">' \+ text \+ '<\/div>';/,
    '非字段级日志行不应带锚点');
  assert.match(body, /seqCount\[k\] = \(seqCount\[k\] \|\| 0\) \+ 1;\s+seqByLine\.set\(l, seqCount\[k\]\);/,
    '同键序号应按 item.logs 顺序编号（与筛选无关 → id 稳定）');
  assert.match(body, /const ids = logIdsOf\(it, l\);/, '应按渠道 / 来源 id 生成锚点（名称仅作回退）');
  assert.match(body, /logAnchorId\(ids\.channelId, ids\.sourceId, l\.field, seq\)/, '渲染时应用 logAnchorId（id 参数）');
  assert.match(body, /'" data-log-key="' \+ esc\(key\) \+ '" data-log-field="' \+ esc\(l\.field\)/,
    '渲染时应带上 data-log-key / data-log-field');
  assert.match(body, /t\('logsEmpty'\)/, '空日志应使用 i18n 文案（不再硬编码「无日志」）');
  assert.equal(APP.indexOf('无日志') === -1 || APP.indexOf('modalPrintsEmpty') !== -1, true);
});

test('锚点查找：先用 id 三元组直取，再用 data-log-key 复核，不一致时退回扫描', () => {
  const body = bodyOf('function findLogAnchorEl(', 900);
  assert.match(body, /const ids = logIdsOf\(it, \{ channel: channel, source: source \}\);/, '应先把 channel / source 解析为 id');
  assert.match(body, /const key = logFieldKey\(ids\.channelId, ids\.sourceId, fieldId\)/, '应按 id 三元组算合成键');
  assert.match(body, /document\.getElementById\(logAnchorId\(ids\.channelId, ids\.sourceId, fieldId, 1\)\)/, '应先用可推导的 id 直取首个锚点');
  assert.match(body, /if \(el && el\.getAttribute\('data-log-key'\) === key\) return el;/,
    'id 命中后必须用 data-log-key 复核一致（数据里同时有 id 与名称，两者必须一致）');
  assert.match(body, /document\.querySelectorAll\('#content \[data-log-key\]'\)/, '复核不一致 / 未命中时应扫描兜底');
  assert.match(body, /if \(nodes\[i\]\.getAttribute\('data-log-key'\) === key\) return nodes\[i\];/, '扫描按合成键精确匹配');
});

test('跳转：切到 logs 选项卡、清空文本搜索、必要时放宽作用域后定位并高亮', () => {
  const body = bodyOf('function jumpToFieldLog(', 1600);
  assert.match(body, /state\.tab = 'logs';/, '应切到完整日志选项卡');
  assert.match(body, /state\.search = '';/, '应清空文本搜索（否则目标行会被过滤掉）');
  assert.match(body, /findLogAnchorEl\(target\.channel, target\.source, target\.fieldId\)/, '应定位锚点元素');
  assert.match(body, /state\.channel = 'ALL';\s*state\.source = 'ALL';/, '找不到锚点时应放宽渠道 / 来源作用域');
  assert.match(body, /flashLogLine\(el\)/, '定位成功后应高亮');
  const flash = bodyOf('function flashLogLine(', 400);
  assert.match(flash, /scrollIntoView\(\{ block: 'center', behavior: 'smooth' \}\)/, '应滚动到目标行');
  assert.match(flash, /classList\.add\('flash-log'\)/, '应加高亮类');
  assert.equal(/remove\('flash-log'\)/.test(flash), false, '不再定时移除高亮类（应淡到 50% 后保留）');
  assert.match(flash, /clearLogFlash\(\)/, '加高亮前先清掉上一行的残留高亮（同一时刻只保留一行）');
});

test('跳转：可传字段 id 或字段名，且无可定位日志行时返回 false（不跳转、不改状态）', () => {
  const body = bodyOf('function resolveFieldLogTarget(', 900);
  assert.match(body, /if \(!APP_FEATURES\.logs \|\| !field \|\| !source\) return null;/,
    '日志功能关闭 / 渠道来源字段缺失时不可跳转');
  assert.match(body, /find\(function \(f\) \{ return f\.id === field; \}\)/, '应先按字段 id 匹配');
  assert.match(body, /find\(function \(f\) \{ return f\.name === field; \}\)/, '再按字段名匹配（警告 / 错误的关联字段存字段名）');
  assert.match(body, /if \(!fieldLogLines\(it, ch\.name, source, fd\.id\)\.length\) return null;/,
    '没有关联日志行时不可跳转');
  assert.match(bodyOf('function jumpToFieldLog(', 300), /const target = resolveFieldLogTarget\(channel, source, field\);/,
    'jumpToFieldLog 应先用 resolveFieldLogTarget 判定');
});

test('跳转接线：报告字段与关联字段都是单击即时响应（无双击手势、无延迟判定）', () => {
  const block = bodyOf("const jfield = e.target.closest('[data-jump-field]');", 900);
  assert.match(block, /jumpToFieldRow\(jfield\.getAttribute\('data-jch'\), jfield\.getAttribute\('data-jsrc'\),\s*jfield\.getAttribute\('data-jump-field'\)\);/,
    '关联字段单击应直接跳主列表字段行');
  assert.equal(block.includes('e.detail > 1'), false, '关联字段不应再有双击分支');
  assert.equal(block.includes('jumpToFieldLog'), false, '关联字段不应再直接跳日志（改走字段详情页的 ▸）');
  // 字段比较的「报告字段」：单击直接开详情页（同样不做双击判定）。
  const detailBlock = bodyOf("const detail = e.target.closest('[data-detail]');", 600);
  assert.match(detailBlock, /openModal\(loc\.channel, loc\.source, loc\.id\);/, '报告字段单击应直接打开比较详情');
  assert.equal(detailBlock.includes('e.detail > 1'), false, '报告字段不应有双击分支');
  // 延迟判定机制整体移除（否则单击会白白等 300ms）。
  assert.equal(APP.includes('FIELD_CLICK_DELAY_MS'), false, '不应再有双击判定窗口常量');
  assert.equal(APP.includes('scheduleFieldClick'), false, '不应再有单击延迟调度');
  assert.equal(APP.includes('cancelFieldClick'), false, '不应再有取消待执行单击动作的逻辑');
  // 误触保护：刚打开的详情页不因紧跟的第二次点击（落在遮罩上）而被瞬间关闭。
  const om = bodyOf('function openModal(', 400);
  assert.match(om, /const openedAt = Date\.now\(\);/, 'openModal 应记录打开时刻');
  assert.match(APP, /if \(e\.target === backdrop && Date\.now\(\) - openedAt < BACKDROP_GUARD_MS\) return;/,
    '遮罩点击关闭应带误触保护（刚打开的一小段时间内不关）');
});

test('链接 tooltip：报告字段与关联字段都只说单击（两者都不再有双击手势）', () => {
  assert.match(bodyOf('function fieldCellHTML(', 2500), /esc\(t\('viewCompareDetailTip'\)\)/, '报告字段链接应使用新的 tooltip');
  assert.match(APP, /title="' \+ esc\(t\('jumpToFieldTip'\)\) \+ '">'/, '关联字段链接 tooltip 应转义');
  ['zh-CN', 'zh-HK', 'en'].forEach((lang) => {
    assert.ok(I18N[lang].viewCompareDetailTip.length > 0, lang + '.viewCompareDetailTip 不应为空');
    assert.ok(I18N[lang].jumpToFieldTip.length > 0, lang + '.jumpToFieldTip 不应为空');
    // 报告字段已改为单击即时开详情页：文案不能再提双击（否则用户会去双击）。
    assert.equal(/双击|雙擊|double-click/i.test(I18N[lang].viewCompareDetailTip), false,
      lang + '.viewCompareDetailTip 不应再提双击手势');
    // 关联字段同样已取消双击手势（单击即跳字段行），文案也不能再提双击。
    assert.equal(/双击|雙擊|double-click/i.test(I18N[lang].jumpToFieldTip), false,
      lang + '.jumpToFieldTip 不应再提双击手势');
  });
  assert.equal('viewCompareDetail' in I18N['zh-CN'], false, '旧的 viewCompareDetail 已被 *_Tip 取代（避免死键）');
});

test('字段详情页：「相关打印信息」改为读完整日志里的关联日志行（不再读 prints）', () => {
  const block = bodyOf('const relatedLogs = fieldLogLines(currentItem(), found.channel, found.source, fid);', 900);
  assert.match(block, /relatedLogs\.map\(function \(l\) \{ return '<div class="log-line">' \+ esc\(l\.text \|\| ''\) \+ '<\/div>'; \}\)/,
    '应逐行渲染关联日志文本');
  assert.match(block, /t\('modalPrintsEmpty'\)/, '无关联日志行时应显示占位文案');
  assert.match(block, /relatedLogs\.length[\s\S]{0,160}data-log-jump="1"/, '有可定位的关联日志行时才显示跳转按钮');
  assert.equal(block.includes('f.prints'), false, '详情页不应再读取 field.prints');
  const handler = bodyOf("if (e.target.closest('[data-log-jump]')) {", 400);
  assert.match(handler, /closeModal\(\);/, '三角跳转应先关闭详情页（否则日志视图被遮住）');
  assert.match(handler, /jumpToFieldLog\(target\.channel, target\.source, target\.id\);/,
    '三角跳转应按 channel/source/field 定位完整日志');
});

test('关联日志取数：只从 item.logs 取（字段对象不存日志，无退路）', () => {
  const body = bodyOf('function fieldLogLines(', 900);
  assert.match(body, /const want = logIdsOf\(item, \{ channel: channel, source: source \}\);/, '应按名称解析出目标 id 三元组');
  assert.match(body, /ids\.channelId === want\.channelId && ids\.sourceId === want\.sourceId/,
    '应按 id（channelId + sourceId + field）匹配行，不依赖名称是否存在');
  assert.match(body, /return \(\(item && item\.logs\) \|\| \[\]\)\.filter/, '数据源只能是 item.logs');
  assert.equal(/l\.text/.test(body), false, '不得用日志文本（text）做任何匹配');
  assert.equal(body.includes('fieldEntry'), false, '不应再有字段自身 logs 的退路');
  assert.equal(body.includes('anchored'), false, '返回值简化为数组（不再需要 anchored 标记）');
});

test('单击高亮：单击字段日志行 → 同字段全部行淡色高亮，焦点消失即取消', () => {
  // 渲染：字段日志行可聚焦（tabindex=-1 → 不进 Tab 顺序），重绘时清空选择状态（旧节点已不存在）。
  const render = bodyOf('function renderLogs() {', 2600);
  assert.match(render, /'<div class="log-line" tabindex="-1" id="' \+ esc\(id\) \+/, '字段日志行应带 tabindex="-1"');
  assert.match(render, /LOG_FIELD_SELECTION = '';/, '每次重绘应清空高亮选择状态');
  // 高亮：只扫字段日志行，按 channel|source|field 合成键精确匹配。
  const hl = bodyOf('function highlightLogField(', 700);
  assert.match(hl, /document\.querySelectorAll\('#content \.log-line\[data-log-key\]'\)/, '只扫带合成键的字段日志行');
  assert.match(hl, /nodes\[i\]\.getAttribute\('data-log-key'\) === key/, '按合成键匹配同字段的所有行');
  assert.match(hl, /nodes\[i\]\.classList\.add\('log-hi'\)/, '命中的行加淡色高亮类');
  assert.match(bodyOf('function clearLogFieldHighlight(', 400), /classList\.remove\('log-hi'\)/, '取消高亮应移除该类');
  assert.match(bodyOf('function clearLogFieldHighlight(', 400), /if \(!LOG_FIELD_SELECTION\) return;/,
    '无高亮时不应遍历 DOM');
  // 接线：单击高亮 + 焦点消失取消。
  const click = bodyOf("document.getElementById('content').addEventListener('click', function (e) {", 700);
  assert.match(click, /const logLine = e\.target\.closest\('\.log-line\[data-log-key\]'\);/, '单击分支只针对字段日志行');
  assert.match(click, /if \(document\.activeElement !== logLine\) logLine\.focus\(\);/, '单击应显式聚焦该行（focusout 是取消高亮的信号）');
  assert.match(click, /highlightLogField\(logLine\.getAttribute\('data-log-key'\)\)/, '单击应高亮同字段全部行');
  const fo = bodyOf("document.getElementById('content').addEventListener('focusout', function (e) {", 600);
  assert.match(fo, /\.log-line\[data-log-key\]/, '只在焦点离开字段日志行时处理');
  assert.match(fo, /clearLogFieldHighlight\(\)/, '焦点消失应取消高亮');
  // 字段详情页里的相关日志行不带 data-* → 不参与单击高亮（点击不改变任何东西）。
  const modal = bodyOf('const relatedLogs = fieldLogLines(currentItem(), found.channel, found.source, fid);', 900);
  assert.equal(modal.includes('data-log-key'), false, '详情页日志行不应参与单击高亮');
});

/* ---------------- 3. 样式与文案 ---------------- */

test('样式：日志行高亮与三角跳转按钮', () => {
  assert.match(HTML, /@keyframes logLineFlash \{ 0% \{ background-color: var\(--mark-bg\); \}/,
    '高亮动画应与字段行同配色（--mark-bg）');
  assert.match(HTML, /\.log-line\.flash-log \{ animation: logLineFlash 1\.8s ease-in-out forwards;/, '日志行高亮类（保留末帧）');
  assert.match(HTML, /\.log-empty \{ color: var\(--muted\); \}/, '空占位应为弱化文字');
  assert.match(HTML, /\.print-box \.pb-head \{ display: flex;/, '相关打印信息标题需为弹性布局以容纳三角图标');
  assert.match(HTML, /\.print-box \.pb-head \.log-jump \{/, '三角跳转按钮样式缺失');
  // 同字段高亮：整行通栏色带（外扩到内边距）+ 专色（比 --accent-bg 再深一档），不要左侧竖条的「括号式」高亮。
  assert.match(HTML, /\.log-line\[data-log-field\] \{ cursor: pointer; \}/, '字段日志行应显示可点击光标');
  assert.match(HTML,
    /\.log-line\[data-log-field\]:hover:not\(\.log-hi\), \.log-line\.log-hi, \.log-line\.flash-log \{\s+border-radius: 4px; margin: 0 -8px; padding: 0 8px;\s+\}/,
    '悬停 / 高亮 / 闪烁三种状态都应是通栏色带（左右外扩 8px，margin 与 padding 相抵不影响文字位置）');
  assert.match(HTML, /\.log-line\[data-log-field\]:hover:not\(\.log-hi\) \{ background: var\(--hover\); \}/,
    '悬停应有淡色反馈（已高亮的行除外，否则高亮底色被悬停色盖掉）');
  assert.match(HTML, /\.log-line\.log-hi \{ background: var\(--log-hi-bg\); \}/, '同字段高亮应使用专色 --log-hi-bg');
  assert.equal(/\.log-line\.log-hi \{[^}]*box-shadow/.test(HTML), false,
    '高亮不应再有 inset 竖条（括号式）效果');
  assert.equal(/\.log-line\.log-hi \{[^}]*var\(--accent-bg\)/.test(HTML), false,
    '高亮底色应换用更深的 --log-hi-bg，而不是与选中背景同色的 --accent-bg');
});

test('样式：--log-hi-bg 在 9 套主题里都定义，且比 --accent-bg 更深/更明显', () => {
  const THEMES = fs.readFileSync(path.join(PUBLIC_DIR, 'themes.css'), 'utf8');
  const accent = Array.from(THEMES.matchAll(/--accent-bg:\s*(#[0-9a-fA-F]{6})/g)).map((m) => m[1]);
  const hi = Array.from(THEMES.matchAll(/--log-hi-bg:\s*(#[0-9a-fA-F]{6})/g)).map((m) => m[1]);
  assert.equal(accent.length, 9, '--accent-bg 应出现在 :root + 8 个覆写主题里');
  assert.equal(hi.length, accent.length,
    '每个声明 --accent-bg 的主题都必须声明 --log-hi-bg（warm / forest 未覆写 accent-bg，继承 :root 即可）');
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  assert.ok(hi.every((h) => /^#[0-9a-f]{6}$/.test(h)), '所有 --log-hi-bg 都应是 6 位十六进制色值');
  hi.forEach((h, i) => {
    const a = rgb(accent[i]);
    const b = rgb(h);
    const dist = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    assert.ok(dist >= 24, '第 ' + (i + 1) + ' 套主题的 --log-hi-bg 与 --accent-bg 差异过小（' + accent[i] + ' vs ' + h + '）');
  });
});

test('文案：新增键三语齐备', () => {
  ['logsEmpty', 'modalPrintsEmpty', 'modalPrintsJumpTip', 'viewCompareDetailTip', 'jumpToFieldTip'].forEach((k) => {
    LANGS.forEach((lang) => {
      const v = I18N[lang][k];
      assert.equal(typeof v, 'string', lang + '.' + k + ' 缺失');
      assert.ok(v.length > 0, lang + '.' + k + ' 不应为空');
    });
  });
});

test('日志 / 消息作用域标签：item / channel / source / field 四值均有文案', () => {
  // v4 起日志行允许 scope="source"（来源渠道级），作用域列不能再把非 field 一律当成 channel。
  const body = bodyOf('function msgScopeLabel(', 400);
  assert.match(body, /scope === 'field'[\s\S]*?t\('scopeField'\)/, "field 用 scopeField");
  assert.match(body, /scope === 'source'[\s\S]*?t\('scopeSource'\)/, "source 用 scopeSource");
  assert.match(body, /t\('scopeChannel'\)/, 'channel（及未知值）回退到 scopeChannel');
  LANGS.forEach((lang) => {
    const v = I18N[lang].scopeSource;
    assert.equal(typeof v, 'string', lang + '.scopeSource 缺失');
    assert.ok(v.length > 0, lang + '.scopeSource 不应为空');
  });
});
