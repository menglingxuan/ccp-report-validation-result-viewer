// 「完整日志」字段定位（日志锚点）回归测试。
//
// 覆盖三层：
//   1. 数据契约：item.logs 的 field 语义（仅 scope="field" 有值，且要求 channel/source 非空）——
//      字段级日志行**只在 item.logs 里存一份**（`fields[]` 不新增任何字段）；
//      js 样例数据 / 校验器 / 迁移工具都按此契约实现。
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

function minimalItem(logs) {
  return {
    tradeId: 'T-1',
    reportDate: '2026-08-16',
    channels: [{
      name: 'HKTR',
      fields: [{ id: '1', name: 'tradeId', userTag: 'contextAssertion', type: 'id' }],
      sources: [{
        name: '来源渠道 A',
        fields: [{ id: '1', result: 'PASSED' }],
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
    ])],
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
    ])],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('只有 scope="field" 的日志行才允许有 field')), JSON.stringify(r.errors));
  // 3 条坏行都触发「field 非空时 channel 与 source 都不能为空」：logs[0] 是 scope=channel 且 source=null，
  // logs[1] 的 source 为空串，logs[2] 的 source 为 null。
  assert.equal(r.errors.filter((e) => e.includes('field 非空时 channel 与 source 都不能为空')).length, 3, JSON.stringify(r.errors));
});

test('数据契约：日志行必须是对象且 text 为字符串', () => {
  const r = validateDataset({
    mode: 'single',
    items: [minimalItem(['纯文本日志'])],
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('必须是对象')), JSON.stringify(r.errors));

  const r2 = validateDataset({
    mode: 'single',
    items: [minimalItem([{ scope: 'field', channel: 'HKTR', source: '来源渠道 A', field: '1' }])],
  });
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some((e) => e.includes('缺少 text 字符串')), JSON.stringify(r2.errors));
});

test('样例数据：字段级日志行只在 item.logs 里，fields[] 不新增任何字段', () => {
  const json = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'report-validation-data-default.json'), 'utf8'));
  assert.ok(json.items.length > 0);
  json.items.forEach((item) => {
    const fieldLines = (item.logs || []).filter((l) => l.scope === 'field');
    assert.ok(fieldLines.length > 0, item.tradeId + ' 缺少 scope="field" 的日志行');
    const byChannel = {};
    item.channels.forEach((ch) => {
      const ids = ch.fields.map((d) => d.id);
      const srcs = ch.sources.map((s) => s.name);
      byChannel[ch.name] = { ids: ids, srcs: srcs };
      ch.sources.forEach((s) => s.fields.forEach((f) => {
        assert.equal(f.id, String(f.id), item.tradeId + ' 字段 id 必须是字符串');
        assert.ok(ids.indexOf(f.id) !== -1, item.tradeId + ' 字段 id 必须存在于渠道注册表');
        // 字段对象不存日志（只有 prints 保留待用）：日志行只存在于 item.logs。
        assert.equal('logs' in f, false, item.tradeId + '/' + ch.name + '/' + s.name + ' 字段不应带 logs（日志只在 item.logs）');
        assert.ok(Array.isArray(f.prints) && f.prints.length > 0, item.tradeId + ' prints 保留待用，仍应保留');
      }));
    });
    // 每条字段级日志行都要能对回真实的渠道 / 来源渠道 / 字段 id（否则锚点定位不到）。
    fieldLines.forEach((l) => {
      const ch = byChannel[l.channel];
      assert.ok(ch, item.tradeId + ' 日志行的 channel 不在该 item 里：' + l.channel);
      assert.ok(ch.srcs.indexOf(l.source) !== -1, item.tradeId + ' 日志行的 source 不在该渠道里：' + l.source);
      assert.ok(ch.ids.indexOf(l.field) !== -1, item.tradeId + ' 日志行的 field 不在该渠道注册表里：' + l.field);
      assert.ok(String(l.text).length > 0, item.tradeId + ' 日志行 text 不应为空');
    });
  });
});

test('迁移工具：旧 prints 生成字段级日志行并只追加进 item.logs', () => {
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
  assert.equal('logs' in field, false, '字段对象不应带 logs（与生成器一致）');
  const migratedFieldLines = item.logs.filter((l) => l.scope === 'field');
  assert.equal(migratedFieldLines.length, 2, '字段日志行只进 item.logs');
  migratedFieldLines.forEach((l) => {
    assert.equal(l.channel, 'HKTR');
    assert.equal(l.source, '来源渠道 A');
    assert.equal(l.field, '1');
  });
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
  assert.match(body, /if \(!fieldLogLines\(it, ch\.name, source, fd\.id\)\.length\) return null;/,
    '没有关联日志行时不可跳转');
  assert.match(bodyOf('function jumpToFieldLog(', 300), /const target = resolveFieldLogTarget\(channel, source, field\);/,
    'jumpToFieldLog 应先用 resolveFieldLogTarget 判定');
});

test('跳转接线：报告字段单击即时开详情页；关联字段双击跳日志、单击延迟判定', () => {
  const block = bodyOf("const jfield = e.target.closest('[data-jump-field]');", 1400);
  assert.match(block, /if \(e\.detail > 1\) \{ cancelFieldClick\(\); jumpToFieldLog\(jch, jsrc, jname\); return; \}/,
    '关联字段双击应跳日志（并取消待执行的单击动作）');
  assert.match(block, /scheduleFieldClick\(function \(\) \{ jumpToFieldRow\(jch, jsrc, jname\); \}, jch, jsrc, jname\);/, 
    '关联字段单击仍跳字段行，但经 scheduleFieldClick 延迟判定');
  // 字段比较的「报告字段」：单击直接开详情页（不再延后、不再有双击手势）。
  const detailBlock = bodyOf("const detail = e.target.closest('[data-detail]');", 600);
  assert.match(detailBlock, /openModal\(loc\.channel, loc\.source, loc\.id\);/, '报告字段单击应直接打开比较详情');
  assert.equal(detailBlock.includes('scheduleFieldClick'), false, '报告字段不应再经过延迟判定（单击立即响应）');
  assert.equal(detailBlock.includes('e.detail > 1'), false, '报告字段不应再有双击分支');
  const sch = bodyOf('function scheduleFieldClick(', 400);
  assert.match(sch, /if \(!canJumpToFieldLog\(channel, source, field\)\) \{ single\(\); return; \}/,
    '不可跳日志的链接应保持即时响应（不引入延迟）');
  assert.match(sch, /setTimeout\(function \(\) \{ FIELD_CLICK_TIMER = 0; single\(\); \}, FIELD_CLICK_DELAY_MS\);/,
    '可跳日志时单击动作延迟到双击判定窗口后执行');
  assert.match(APP, /const FIELD_CLICK_DELAY_MS = 300;/, '双击判定窗口 300ms');
  assert.match(bodyOf('function cancelFieldClick(', 200), /clearTimeout\(FIELD_CLICK_TIMER\)/, '双击应取消待执行的单击动作');
  // 误触保护：刚打开的详情页不因紧跟的双击落在遮罩上而被瞬间关闭。
  const om = bodyOf('function openModal(', 400);
  assert.match(om, /const openedAt = Date\.now\(\);/, 'openModal 应记录打开时刻');
  assert.match(APP, /if \(e\.target === backdrop && Date\.now\(\) - openedAt < BACKDROP_GUARD_MS\) return;/,
    '遮罩点击关闭应带误触保护（刚打开的一小段时间内不关）');
});

test('链接 tooltip：报告字段只说单击（跳日志在详情页 ▸）；关联字段仍点明单击 / 双击', () => {
  assert.match(bodyOf('function fieldCellHTML(', 2500), /esc\(t\('viewCompareDetailTip'\)\)/, '报告字段链接应使用新的 tooltip');
  assert.match(APP, /title="' \+ esc\(t\('jumpToFieldTip'\)\) \+ '">'/, '关联字段链接 tooltip 应转义');
  ['zh-CN', 'zh-HK', 'en'].forEach((lang) => {
    assert.ok(I18N[lang].viewCompareDetailTip.length > 0, lang + '.viewCompareDetailTip 不应为空');
    assert.ok(I18N[lang].jumpToFieldTip.length > 0, lang + '.jumpToFieldTip 不应为空');
    // 报告字段已改为单击即时开详情页：文案不能再提双击（否则用户会去双击）。
    assert.equal(/双击|雙擊|double-click/i.test(I18N[lang].viewCompareDetailTip), false,
      lang + '.viewCompareDetailTip 不应再提双击手势');
  });
  assert.match(I18N['zh-CN'].jumpToFieldTip, /双击/, '关联字段保留双击跳日志，文案需点明');
  assert.match(I18N['en'].jumpToFieldTip, /double-click/i, 'en 关联字段 tooltip 需点明双击');
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
  const body = bodyOf('function fieldLogLines(', 700);
  assert.match(body, /isFieldLogLine\(l\) && l\.channel === channel && l\.source === source && l\.field === fieldId/,
    '应按 channel + source + field 三元组从 item.logs 取行');
  assert.match(body, /return \(\(item && item\.logs\) \|\| \[\]\)\.filter/, '数据源只能是 item.logs');
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
  assert.match(HTML, /\.log-line\.flash-log \{ animation: logLineFlash 1\.8s ease-in-out;/, '日志行高亮类');
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
