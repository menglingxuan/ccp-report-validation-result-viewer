// 「完整日志」字段定位（日志锚点）回归测试。
//
// 覆盖三层：
//   1. 数据契约：item.logs 的 field 语义（仅 scope="field" 有值，且要求 channel/source 非空）
//      与 fields[].logs（字段自身冗余的日志行）；js 样例数据 / 校验器 / 迁移工具都按此契约实现。
//   2. 查看器接线：日志锚点 id、字段比较 / 关联字段双击跳转、字段详情页「相关打印信息」改读日志行 + 三角跳转。
//   3. 样式与文案：高亮动画类与三语文案齐备。
//
// app.js 的跳转逻辑位于 DOM 闭包内（依赖浏览器环境），Node 无法直接执行，因此对 public/ 源码做结构断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDataset } from '../lib/validate.js';
import { migrateDataset } from '../tools/migrate-legacy-data.js';
import { logFieldKey, logAnchorId, logSlug, logHash, isFieldLogLine } from '../public/core.js';

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

function minimalItem(logs, fieldLogs) {
  return {
    tradeId: 'T-1',
    reportDate: '2026-08-16',
    channels: [{
      name: 'HKTR',
      fields: [{ id: '1', name: 'tradeId', userTag: 'contextAssertion', type: 'id' }],
      sources: [{
        name: '来源渠道 A',
        fields: [{ id: '1', result: 'PASSED', logs: fieldLogs }],
      }],
    }],
    logs: logs,
  };
}

test('数据契约：field 仅出现在 scope="field" 的日志行上，且要求 channel/source 非空', () => {
  const ok = validateDataset({
    mode: 'single',
    items: [minimalItem([
      { scope: 'item', channel: null, source: null, field: null, text: 'a' },
      { scope: 'channel', channel: 'HKTR', source: null, field: null, text: 'b' },
      { scope: 'field', channel: 'HKTR', source: '来源渠道 A', field: '1', text: 'c' },
    ], [{ scope: 'field', channel: 'HKTR', source: '来源渠道 A', field: '1', text: 'c' }])],
  });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
});

test('数据契约：scope=channel 的行带 field / field 缺 channel 或 source 都报错', () => {
  const r = validateDataset({
    mode: 'single',
    items: [minimalItem([
      { scope: 'channel', channel: 'HKTR', source: null, field: '1', text: 'a' },
      { scope: 'field', channel: 'HKTR', source: '', field: '1', text: 'b' },
      { scope: 'field', channel: 'HKTR', source: null, field: '1', text: 'c' },
    ], [])],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('只有 scope="field" 的日志行才允许有 field')), JSON.stringify(r.errors));
  // 3 条坏行都触发「field 非空时 channel 与 source 都不能为空」：logs[0] 是 scope=channel 且 source=null，
  // logs[1] 的 source 为空串，logs[2] 的 source 为 null。
  assert.equal(r.errors.filter((e) => e.includes('field 非空时 channel 与 source 都不能为空')).length, 3, JSON.stringify(r.errors));
});

test('数据契约：fields[].logs 的 field / channel / source 必须与所属字段一致', () => {
  const r = validateDataset({
    mode: 'single',
    items: [minimalItem([], [
      { scope: 'field', channel: 'HKTR', source: '来源渠道 A', field: '9', text: 'a' },
      { scope: 'field', channel: 'JSFA', source: '来源渠道 B', field: '1', text: 'b' },
    ])],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('field 必须等于所属字段的 id')), JSON.stringify(r.errors));
  assert.ok(r.errors.some((e) => e.includes('channel 必须等于所属渠道')), JSON.stringify(r.errors));
  assert.ok(r.errors.some((e) => e.includes('source 必须等于所属来源渠道')), JSON.stringify(r.errors));
});

test('数据契约：日志行必须是对象且 text 为字符串', () => {
  const r = validateDataset({
    mode: 'single',
    items: [minimalItem(['纯文本日志'], [{ scope: 'field', channel: 'HKTR', source: '来源渠道 A', field: '1' }])],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('必须是对象')), JSON.stringify(r.errors));
  assert.ok(r.errors.some((e) => e.includes('缺少 text 字符串')), JSON.stringify(r.errors));
});

test('样例数据：每个 item 都有字段级日志行，且与 fields[].logs 一一对应', () => {
  const json = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'report-validation-data-default.json'), 'utf8'));
  assert.ok(json.items.length > 0);
  json.items.forEach((item) => {
    const fieldLines = (item.logs || []).filter((l) => l.scope === 'field');
    assert.ok(fieldLines.length > 0, item.tradeId + ' 缺少 scope="field" 的日志行');
    let fieldEntryLines = 0;
    item.channels.forEach((ch) => {
      const ids = ch.fields.map((d) => d.id);
      ch.sources.forEach((s) => s.fields.forEach((f) => {
        assert.equal(f.id, String(f.id), item.tradeId + ' 字段 id 必须是字符串');
        assert.ok(ids.indexOf(f.id) !== -1, item.tradeId + ' 字段 id 必须存在于渠道注册表');
        assert.ok(Array.isArray(f.logs) && f.logs.length > 0, item.tradeId + '/' + ch.name + '/' + s.name + ' 字段缺少 logs');
        assert.ok(Array.isArray(f.prints) && f.prints.length > 0, item.tradeId + ' prints 保留待用，仍应保留');
        f.logs.forEach((l) => {
          assert.equal(l.scope, 'field');
          assert.equal(l.channel, ch.name);
          assert.equal(l.source, s.name);
          assert.equal(l.field, f.id);
        });
        fieldEntryLines += f.logs.length;
      }));
    });
    assert.equal(fieldEntryLines, fieldLines.length, item.tradeId + ' item.logs 与 fields[].logs 的字段日志条数应一致');
  });
});

test('迁移工具：旧 prints 迁移为 fields[].logs 并追加进 item.logs', () => {
  const migrated = migrateDataset({
    items: [{
      tradeId: 'T-1',
      ctxDefs: {},
      channels: [{
        name: 'HKTR',
        sources: [{
          name: '来源渠道 A',
          fields: [{ f: 'notional', t: 'productAssertion', k: 'num', result: 'PASSED', prints: ['[INFO] 第一行', '[INFO] 第二行'] }],
        }],
      }],
      overviewLogs: ['开始比较'],
    }],
  });
  const item = migrated.items[0];
  const ch = item.channels[0];
  const field = ch.sources[0].fields[0];
  assert.equal(field.id, '1');
  assert.deepEqual(field.prints, ['[INFO] 第一行', '[INFO] 第二行'], 'prints 保留');
  assert.equal(field.logs.length, 2);
  field.logs.forEach((l) => {
    assert.equal(l.scope, 'field');
    assert.equal(l.channel, 'HKTR');
    assert.equal(l.source, '来源渠道 A');
    assert.equal(l.field, '1');
  });
  const migratedFieldLines = item.logs.filter((l) => l.scope === 'field');
  assert.equal(migratedFieldLines.length, 2, '字段日志行也要进 item.logs（否则无法在完整日志中定位）');
  assert.equal(validateDataset(migrated).ok, true, JSON.stringify(validateDataset(migrated).errors));
});

/* ---------------- 2. 查看器接线 ---------------- */

test('日志锚点：短标识 log-<渠道>-s<来源序号>-f<字段id>.<同键序号>（键仍记在 data-log-key）', () => {
  // 锚点纯函数在 public/core.js（DOM 无关，可直接单测）；app.js 只负责渲染与跳转。
  assert.match(APP, /logFieldKey, logAnchorId, isFieldLogLine,/, 'app.js 应从 core.js 引入锚点纯函数');
  assert.equal(logFieldKey('HKTR', '来源渠道 A', '2'), 'HKTR|来源渠道 A|2', '合成键 = channel|source|field');
  // 渠道 / 字段 id 是 ASCII 标识符 → 直接用；含中文 / 空白的名称 → 整串退化为 36 进制短哈希（确定性）
  assert.equal(logSlug('HKTR'), 'HKTR');
  assert.equal(logSlug('2'), '2');
  assert.match(logSlug('来源渠道 A'), /^x[0-9a-z]{1,8}$/, '非 ASCII 名称应退化为短哈希');
  assert.equal(logSlug('来源渠道 A'), logSlug('来源渠道 A'), '哈希必须确定性');
  assert.notEqual(logSlug('来源渠道 A'), logSlug('来源渠道 B'), '不同名称不得碰撞（不做部分清洗）');
  assert.notEqual(logSlug('渠道 A'), logSlug('面 A'), '「清洗后只剩 A」类名称必须区分开');
  assert.equal(logHash('x'), logHash('x'), 'logHash 应确定性');
  const item = { channels: [{ name: 'HKTR', sources: [{ name: '来源渠道 A' }, { name: '来源渠道 B' }] }] };
  assert.equal(logAnchorId(item, 'HKTR', '来源渠道 A', '2', 1), 'log-HKTR-s1-f2.1', '锚点 id 应短且可读');
  assert.equal(logAnchorId(item, 'HKTR', '来源渠道 B', '13', 3), 'log-HKTR-s2-f13.3', '同键序号取该行在同键行中的次序');
  assert.match(logAnchorId(item, 'HKTR', '未登记来源', '2', 1), /^log-HKTR-sx[0-9a-z]+-f2\.1$/, '未登记来源退化为 sx<hash>');
  const cn = { channels: [{ name: '渠道 A', sources: [{ name: '来源渠道 A' }] }] };
  assert.match(logAnchorId(cn, '渠道 A', '来源渠道 A', '2', 1), /^log-x[0-9a-z]+-s1-f2\.1$/, '中文渠道名退化为哈希（id 保持 ASCII）');
  assert.ok(logAnchorId(item, 'HKTR', '来源渠道 A', '2', 1).length <= 20, 'id 应保持短小（旧实现是 47 字符的整串编码）');
  // 日志行契约判定
  assert.equal(isFieldLogLine({ scope: 'field', channel: 'HKTR', source: 'A', field: '1' }), true);
  assert.equal(isFieldLogLine({ scope: 'field', channel: 'HKTR', source: '', field: '1' }), false, '缺 source 不算带锚点的行');
  assert.equal(isFieldLogLine({ scope: 'channel', channel: 'HKTR', source: 'A', field: '1' }), false, '非 field 级不算');
});

test('日志锚点：仅 scope="field" 的行渲染 id 与 data-log-key，序号在 item.logs 内稳定', () => {
  const body = bodyOf('function renderLogs() {', 2600);
  assert.match(body, /if \(!isFieldLogLine\(l\)\) return '<div class="log-line">' \+ text \+ '<\/div>';/,
    '非字段级日志行不应带锚点');
  assert.match(body, /seqCount\[k\] = \(seqCount\[k\] \|\| 0\) \+ 1;\s+seqByLine\.set\(l, seqCount\[k\]\);/,
    '同键序号应按 item.logs 顺序编号（与筛选无关 → id 稳定）');
  assert.match(body, /const id = logAnchorId\(it, l\.channel, l\.source, l\.field, seq\);/, '渲染时应用 logAnchorId');
  assert.match(body, /'" data-log-key="' \+ esc\(key\) \+ '" data-log-field="' \+ esc\(l\.field\)/,
    '渲染时应带上 data-log-key / data-log-field');
  assert.match(body, /t\('logsEmpty'\)/, '空日志应使用 i18n 文案（不再硬编码「无日志」）');
  assert.equal(APP.indexOf('无日志') === -1 || APP.indexOf('modalPrintsEmpty') !== -1, true);
});

test('锚点查找：id 直取 + data-log-key 复核，不一致时退回扫描（防 slug/哈希碰撞）', () => {
  const body = bodyOf('function findLogAnchorEl(', 800);
  assert.match(body, /const key = logFieldKey\(channel, source, fieldId\);/, '应按三元组算合成键');
  assert.match(body, /document\.getElementById\(logAnchorId\(currentItem\(\), channel, source, fieldId, 1\)\)/, '应先用可推导的 id 直取首个锚点');
  assert.match(body, /if \(el && el\.getAttribute\('data-log-key'\) === key\) return el;/,
    'id 命中后必须用 data-log-key 复核一致（slug/哈希理论上有碰撞）');
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
  assert.match(flash, /setTimeout\(function \(\) \{ el\.classList\.remove\('flash-log'\); \}, 1800\);/,
    '1.8s 后移除高亮类');
});

test('跳转：可传字段 id 或字段名，且无可定位日志行时返回 false（不跳转、不改状态）', () => {
  const body = bodyOf('function resolveFieldLogTarget(', 900);
  assert.match(body, /if \(!APP_FEATURES\.logs \|\| !field \|\| !source\) return null;/,
    '日志功能关闭 / 渠道来源字段缺失时不可跳转');
  assert.match(body, /find\(function \(f\) \{ return f\.id === field; \}\)/, '应先按字段 id 匹配');
  assert.match(body, /find\(function \(f\) \{ return f\.name === field; \}\)/, '再按字段名匹配（警告 / 错误的关联字段存字段名）');
  assert.match(body, /if \(!fieldLogLines\(it, ch\.name, source, fd\.id, fd\)\.anchored\) return null;/,
    '没有来自完整日志的关联日志行时不可跳转');
  assert.match(bodyOf('function jumpToFieldLog(', 300), /const target = resolveFieldLogTarget\(channel, source, field\);/,
    'jumpToFieldLog 应先用 resolveFieldLogTarget 判定');
});

test('跳转接线：字段比较「报告字段」与关联字段链接双击跳日志，单击行为延迟判定', () => {
  const block = bodyOf("const jfield = e.target.closest('[data-jump-field]');", 1400);
  assert.match(block, /if \(e\.detail > 1\) \{ cancelFieldClick\(\); jumpToFieldLog\(jch, jsrc, jname\); return; \}/,
    '关联字段双击应跳日志（并取消待执行的单击动作）');
  assert.match(block, /scheduleFieldClick\(function \(\) \{ jumpToFieldRow\(jch, jsrc, jname\); \}, jch, jsrc, jname\);/,
    '关联字段单击仍跳字段行，但经 scheduleFieldClick 延迟判定');
  assert.match(block, /if \(e\.detail > 1\) \{ cancelFieldClick\(\); jumpToFieldLog\(loc\.channel, loc\.source, loc\.id\); return; \}/,
    '报告字段双击应跳日志');
  assert.match(block, /scheduleFieldClick\(function \(\) \{ openModal\(loc\.channel, loc\.source, loc\.id\); \}, loc\.channel, loc\.source, loc\.id\);/,
    '报告字段单击仍打开比较详情，但经 scheduleFieldClick 延迟判定');
  const sch = bodyOf('function scheduleFieldClick(', 400);
  assert.match(sch, /if \(!canJumpToFieldLog\(channel, source, field\)\) \{ single\(\); return; \}/,
    '不可跳日志的链接应保持即时响应（不引入延迟）');
  assert.match(sch, /setTimeout\(function \(\) \{ FIELD_CLICK_TIMER = 0; single\(\); \}, FIELD_CLICK_DELAY_MS\);/,
    '可跳日志时单击动作延迟到双击判定窗口后执行');
  assert.match(bodyOf('function cancelFieldClick(', 200), /clearTimeout\(FIELD_CLICK_TIMER\)/, '双击应取消待执行的单击动作');
});

test('链接 tooltip 点明单击 / 双击两种行为', () => {
  assert.match(bodyOf('function fieldCellHTML(', 2500), /esc\(t\('viewCompareDetailTip'\)\)/, '报告字段链接应使用新的 tooltip');
  assert.match(APP, /title="' \+ esc\(t\('jumpToFieldTip'\)\) \+ '">'/, '关联字段链接 tooltip 应转义');
  ['zh-CN', 'zh-HK', 'en'].forEach((lang) => {
    assert.ok(I18N[lang].viewCompareDetailTip.length > 0, lang + '.viewCompareDetailTip 不应为空');
    assert.ok(I18N[lang].jumpToFieldTip.length > 0, lang + '.jumpToFieldTip 不应为空');
  });
  assert.equal('viewCompareDetail' in I18N['zh-CN'], false, '旧的 viewCompareDetail 已被 *_Tip 取代（避免死键）');
});

test('字段详情页：「相关打印信息」读关联日志行（不再读 prints），标题后带三角跳转按钮', () => {
  const block = bodyOf('const relatedLogs = fieldLogLines(currentItem(), found.channel, found.source, fid, f);', 900);
  assert.match(block, /relatedLogs\.lines\.map\(function \(l\) \{ return '<div class="log-line">' \+ esc\(l\.text \|\| ''\) \+ '<\/div>'; \}\)/,
    '应逐行渲染关联日志文本');
  assert.match(block, /t\('modalPrintsEmpty'\)/, '无关联日志行时应显示占位文案');
  assert.match(block, /relatedLogs\.anchored[\s\S]{0,120}data-log-jump="1"/, '仅当日志行来自完整日志（有锚点）时才显示跳转按钮');
  assert.equal(block.includes('f.prints'), false, '详情页不应再读取 field.prints');
  const handler = bodyOf("if (e.target.closest('[data-log-jump]')) {", 400);
  assert.match(handler, /closeModal\(\);/, '三角跳转应先关闭详情页（否则日志视图被遮住）');
  assert.match(handler, /jumpToFieldLog\(target\.channel, target\.source, target\.id\);/,
    '三角跳转应按 channel/source/field 定位完整日志');
});

test('关联日志取数：优先 item.logs（有锚点），退回字段自身 logs（无锚点）', () => {
  const body = bodyOf('function fieldLogLines(', 700);
  assert.match(body, /isFieldLogLine\(l\) && l\.channel === channel && l\.source === source && l\.field === fieldId/,
    '应按 channel + source + field 三元组从 item.logs 取行');
  assert.match(body, /if \(hit\.length\) return \{ lines: hit, anchored: true \};/, '命中 item.logs 时标记 anchored');
  assert.match(body, /fieldEntry\.logs/, '未命中时退回字段自身 logs');
  assert.match(body, /return \{ lines: own, anchored: false \};/, '退回字段自身 logs 时 anchored=false');
});

/* ---------------- 3. 样式与文案 ---------------- */

test('样式：日志行高亮与三角跳转按钮', () => {
  assert.match(HTML, /@keyframes logLineFlash \{ 0% \{ background-color: var\(--mark-bg\); \}/,
    '高亮动画应与字段行同配色（--mark-bg）');
  assert.match(HTML, /\.log-line\.flash-log \{ animation: logLineFlash 1\.8s ease-in-out;/, '日志行高亮类');
  assert.match(HTML, /\.log-empty \{ color: var\(--muted\); \}/, '空占位应为弱化文字');
  assert.match(HTML, /\.print-box \.pb-head \{ display: flex;/, '相关打印信息标题需为弹性布局以容纳三角图标');
  assert.match(HTML, /\.print-box \.pb-head \.log-jump \{/, '三角跳转按钮样式缺失');
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
