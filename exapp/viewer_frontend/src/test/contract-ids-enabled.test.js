// 渠道 / 来源渠道稳定标识（id）与启用口径（channels[].enabled）契约测试。
//
// 对应本轮 5 项改动，逐项锁死：
//   1. 启用口径单点化：所有展开 / 计数 / 统计都经 core.js 的 enabledChannelsOf（同一份判断）；
//   2. 启用标记下沉到 channels[].enabled（缺省 = 启用）；
//   3. 新增 channels[].id 与 channels[].sources[].id（预设 HKTR=1 / JSFA=2 / CFTC=3、来源渠道 A=1 / B=2）+ 契约校验；
//   4. enabledChannels 彻底移除（查看器 / 生成器 / Java 源码 / 落盘样例数据里都不允许再出现）；
//   5. warnings / errors / uncompared / logs / skippedItems 的名称 + id **双写**，且 id 引用可校验。
//
// id 只作稳定标识：日志锚点、内部 locator、跨 item 关联；
// URL / 深链接 / 忽略配置 / 界面展示仍以**名称**为准（老链接与已有忽略配置不失效）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHANNEL_ID_PRESET, SOURCE_ID_PRESET,
  channelIdOf, sourceIdOf, isChannelEnabled, enabledChannelsOf, enabledChannelIds,
  channelIdByName, channelNameById, channelNameMap, refChannelId, refSourceId,
  flatFields, itemStatsPure, computeHealthPure, globalSearchPure,
  logFieldKey, logAnchorId, msgIgnoreKey,
  hydrateDataset, hoistRegistries, channelRegistryMap,
} from '../public/core.js';
import { validateDataset } from '../lib/validate.js';

const SRC_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = path.join(SRC_DIR, 'public');
const LIB_DIR = path.join(SRC_DIR, 'lib');
const TOOLS_DIR = path.join(SRC_DIR, 'tools');
const JAVA_SRC_DIR = path.join(SRC_DIR, '..', '..', '..', 'src', 'main', 'java');

const read = (p) => fs.readFileSync(p, 'utf8');
const APP = read(path.join(PUBLIC_DIR, 'app.js'));
const SAMPLE_DATA = read(path.join(LIB_DIR, 'sample-data.js'));

function walkFiles(dir, ext) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p, ext));
    else if (e.name.endsWith(ext)) out.push(p);
  });
  return out;
}

// 「彻底移除」要断言的是**代码里不再引用**，注释里的历史说明（为何把名单下沉到 channels[].enabled）应保留。
// 因此在检查前把注释剥掉：行注释 + 块注释（本项目代码无字符串内含 `//` 的用例）。
// 用 \benabledChannels\b 精确匹配被移除的字段名：合法的 `enabledChannelsOf(...)` 辅助函数不受影响。
const REMOVED_FIELD = /\benabledChannels\b/;
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '');
}

/* ---------------- 1. 预设与 id 解析 ---------------- */

test('预设：HKTR=1 / JSFA=2 / CFTC=3，来源渠道 A=1 / B=2（JS 与 Java 必须一致）', () => {
  assert.deepEqual(CHANNEL_ID_PRESET, { HKTR: 1, JSFA: 2, CFTC: 3 });
  assert.deepEqual(SOURCE_ID_PRESET, { '来源渠道 A': 1, '来源渠道 B': 2 });
  const javaGen = read(path.join(JAVA_SRC_DIR, 'com', 'otcc', 'viewer', 'generator', 'ValidationJsonGenerator.java'));
  assert.match(javaGen, /Map\.of\("HKTR", 1, "JSFA", 2, "CFTC", 3\)/, 'Java 渠道预设必须与 JS 一致');
  assert.match(javaGen, /Map\.of\("来源渠道 A", 1, "来源渠道 B", 2\)/, 'Java 来源预设必须与 JS 一致');
});

test('id 取值：数据里的 id 优先 -> 预设表 -> 按出现顺序兜底；名称互通可解析', () => {
  assert.equal(channelIdOf({ name: 'HKTR' }, 0), 1, '按预设解析');
  assert.equal(channelIdOf({ name: 'XXX' }, 4), 5, '未登记渠道按序号兜底（index + 1）');
  assert.equal(channelIdOf({ id: 9, name: 'HKTR' }, 0), 9, '数据里的 id 优先（不反查名称）');
  assert.equal(channelIdOf(null, 2), 3, '缺渠道对象时只靠序号');
  assert.equal(sourceIdOf({ name: '来源渠道 B' }, 0), 2);
  assert.equal(sourceIdOf({ name: '未知来源' }, 1), 2, '未登记来源按序号兜底');
  assert.equal(sourceIdOf({ id: 7, name: '来源渠道 A' }, 0), 7);

  const item = { channels: [{ id: 3, name: 'CFTC', sources: [{ id: 5, name: '来源渠道 A' }] }] };
  assert.equal(channelIdByName(item, 'CFTC'), 3, '名称 -> id');
  assert.equal(channelIdByName(item, 'JSFA'), 2, '未登记名称回退预设表');
  assert.equal(channelIdByName(item, '不存在'), null);
  assert.equal(channelNameById(item, 3), 'CFTC', 'id -> 名称');
  assert.equal(channelNameById(item, 1), 'HKTR', '未登记 id 回退预设表');
  assert.equal(channelNameById(item, 99), '', '无法解析时返回空串（展示层直接可见）');
  assert.equal(channelNameMap([item])[3], 'CFTC', '数据集级 id->名称映射（键是 id）');
  assert.equal(channelNameMap([item])[1], 'HKTR', '预设打底，保证 skippedItems 这类数据集外引用也能展示名称');
});

/* ---------------- 2. 启用口径单点化 ---------------- */

test('isChannelEnabled / enabledChannelsOf：缺省启用，enabled=false 才排除', () => {
  assert.equal(isChannelEnabled(undefined), true, '缺渠道对象视为启用');
  assert.equal(isChannelEnabled({}), true, '缺 enabled 视为启用');
  assert.equal(isChannelEnabled({ enabled: null }), true, 'null 视为启用（Java 生成器可能写出 null）');
  assert.equal(isChannelEnabled({ enabled: true }), true);
  assert.equal(isChannelEnabled({ enabled: false }), false);

  const item = {
    channels: [
      { id: 1, name: 'HKTR' },
      { id: 2, name: 'JSFA', enabled: false },
      { id: 3, name: 'CFTC', enabled: true },
    ],
  };
  assert.deepEqual(enabledChannelsOf(item).map((e) => e.ch.name), ['HKTR', 'CFTC']);
  assert.deepEqual(enabledChannelIds(item), [1, 3]);
});

// 口径一致性夹具：3 个渠道，其中 JSFA 被禁用（字段 / 消息 / 日志都挂在 JSFA 上）。
function mixedItem() {
  const field = (id, result) => ({ id: id, result: result, cmpLeft: { value: 'a' }, cmpRight: { value: result === 'PASSED' ? 'a' : 'b' } });
  return {
    tradeId: 'T-MIX',
    reportDate: '2026-08-16',
    platform: 'P-1',
    channels: [
      { id: 1, name: 'HKTR', fields: [{ id: '1', name: 'f1', userTag: 'platformAssertion', type: 'text' }], sources: [{ id: 1, name: '来源渠道 A', fields: [field('1', 'PASSED'), field('2', 'FAILED')] }] },
      { id: 2, name: 'JSFA', enabled: false, fields: [{ id: '1', name: 'f1', userTag: 'platformAssertion', type: 'text' }], sources: [{ id: 1, name: '来源渠道 A', fields: [field('1', 'FAILED'), field('2', 'FAILED'), field('3', 'FAILED')] }] },
      { id: 3, name: 'CFTC', fields: [{ id: '1', name: 'f1', userTag: 'platformAssertion', type: 'text' }], sources: [{ id: 1, name: '来源渠道 A', fields: [field('1', 'PASSED')] }] },
    ],
    warnings: [
      { channel: 'HKTR', channelId: 1, source: '来源渠道 A', sourceId: 1, type: 'productAssertion', level: 'WARN', text: 'w1' },
      { channel: 'JSFA', channelId: 2, source: '来源渠道 A', sourceId: 1, type: 'productAssertion', level: 'WARN', text: 'w2（渠道已禁用，不应计数）' },
    ],
    errors: [
      { channel: 'HKTR', channelId: 1, source: '来源渠道 A', sourceId: 1, type: 'mappingError', level: 'ERROR', text: 'e1' },
      { channel: 'JSFA', channelId: 2, source: '来源渠道 A', sourceId: 1, type: 'mappingError', level: 'ERROR', text: 'e2（渠道已禁用，不应计数）' },
    ],
    uncompared: [
      { type: 1, channel: 'CFTC', channelId: 3, source: null, sourceId: null, value: '/x' },
      { type: 1, channel: 'JSFA', channelId: 2, source: null, sourceId: null, value: '/y（渠道已禁用，不应计数）' },
    ],
    logs: [
      { scope: 'item', channel: null, source: null, channelId: null, sourceId: null, field: null, text: '开始' },
      { scope: 'channel', channel: 'HKTR', source: null, channelId: 1, sourceId: null, field: null, text: 'hk' },
      { scope: 'channel', channel: 'JSFA', source: null, channelId: 2, sourceId: null, field: null, text: 'js（渠道已禁用）' },
      { scope: 'field', channel: 'HKTR', source: '来源渠道 A', channelId: 1, sourceId: 1, field: '1', text: 'f1' },
    ],
  };
}

test('口径一致：字段表 / 侧栏卡片统计 / 健康总览三处的字段数必须完全一致（禁用渠道不计）', () => {
  const item = mixedItem();
  const rows = flatFields(item);
  const stats = itemStatsPure(item, null);
  const health = computeHealthPure([item], null, 'ALL', null);
  assert.equal(rows.length, 3, '只展开启用渠道的字段：HKTR 2 + CFTC 1');
  assert.equal(stats.total, rows.length, '侧栏卡片 total 必须等于字段表行数');
  assert.equal(health.total, rows.length, '健康总览 total 必须等于字段表行数');
  assert.equal(stats.failed, 1);
  assert.equal(stats.rate, 67);
  // 字段行也带 id（内部 locator / 锚点用）。
  assert.deepEqual(rows.map((r) => [r.channelId, r.sourceId, r.id]), [[1, 1, '1'], [1, 1, '2'], [3, 1, '1']]);
});

test('口径一致：禁用渠道的消息 / 日志既不计入统计，也不出现在字段相关统计里', () => {
  const item = mixedItem();
  const stats = itemStatsPure(item, null);
  const health = computeHealthPure([item], null, 'ALL', null);
  assert.equal(stats.warnings, 1, 'JSFA 上的警告被排除');
  assert.equal(stats.errors, 1, 'JSFA 上的错误被排除');
  assert.equal(stats.uncompared, 1, 'JSFA 上的未比较条目被排除');
  assert.equal(stats.logs, 3, 'item 级 + HKTR 渠道级 + 字段级在作用域内，JSFA 渠道级排除');
  assert.equal(health.warnings, stats.warnings);
  assert.equal(health.errors, stats.errors);
  assert.equal(health.perItem[0].failed, stats.failed);
});

test('口径一致：全局搜索只搜启用渠道的字段（禁用渠道永远搜不到）', () => {
  const results = globalSearchPure([mixedItem()], 'f1', 50, null);
  assert.equal(results.length, 2, 'HKTR + CFTC 各 1 行，JSFA 被排除');
  assert.deepEqual(results.map((r) => r.channelId).sort(), [1, 3]);
  assert.equal(results.every((r) => typeof r.channelId === 'number' && typeof r.sourceId === 'number'), true,
    '搜索结果带 id，供跨 item 关联 / 跳转使用');
});

test('口径一致：警告是否被忽略的 key 仍按名称计算（忽略配置与批次无关，不能改成 id）', () => {
  const item = mixedItem();
  const w = item.warnings[0];
  const key = msgIgnoreKey('warnings', Object.assign({}, w, { platform: item.platform }));
  assert.ok(key.includes('HKTR'), '忽略 key 里必须是渠道名（老配置才继续生效）');
  assert.equal(key.includes('"1"'), false, '忽略 key 不得使用渠道 id');
  const stats = itemStatsPure(item, { [key]: true });
  assert.equal(stats.warningsIgnored, 1, '命中忽略 key 的警告计入 warningsIgnored');
  assert.equal(stats.warnings, 0);
});

/* ---------------- 3. 老数据兼容 ---------------- */

test('老数据（无 id / 无 enabled）等价于「渠道全启用 + 预设 id」', () => {
  const legacy = {
    tradeId: 'T-OLD',
    channels: [{
      name: 'HKTR',
      fields: [{ id: '1', name: 'f1', userTag: 'platformAssertion', type: 'text' }],
      sources: [{ name: '来源渠道 B', fields: [{ id: '1', result: 'PASSED' }] }],
    }],
    warnings: [{ channel: 'HKTR', source: '来源渠道 B', type: 't', level: 'WARN', text: 'w' }],
  };
  assert.deepEqual(enabledChannelIds(legacy), [1], '缺 enabled 视为启用，id 取预设');
  const rows = flatFields(legacy);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channelId, 1);
  assert.equal(rows[0].sourceId, 2, '来源 id 取预设（来源渠道 B = 2）');
  assert.equal(itemStatsPure(legacy, null).total, 1);
  assert.equal(refChannelId(legacy, legacy.warnings[0]), CHANNEL_ID_PRESET.HKTR, '消息只用名称时按预设解析');
  assert.equal(refSourceId(legacy, legacy.warnings[0]), SOURCE_ID_PRESET['来源渠道 B']);
});

/* ---------------- 4. enabledChannels 彻底移除 ---------------- */

test('enabledChannels 已彻底移除：查看器 / 生成器 / 迁移工具都不再引用', () => {
  assert.equal(REMOVED_FIELD.test(stripComments(APP)), false, 'app.js 不得再引用 enabledChannels');
  assert.equal(REMOVED_FIELD.test(stripComments(SAMPLE_DATA)), false, 'lib/sample-data.js 不得再写 enabledChannels');
  const validator = read(path.join(LIB_DIR, 'validate.js'));
  assert.match(validator, /enabledChannels 已移除/, '校验器必须对残留的 enabledChannels 报错');
  // 迁移工具允许出现该词（它负责把老数据里的 enabledChannels 迁移掉），但必须删除该键。
  const migrate = read(path.join(TOOLS_DIR, 'migrate-legacy-data.js'));
  assert.ok(REMOVED_FIELD.test(migrate), '迁移工具需要读取旧数据里的字段名');
  assert.match(migrate, /delete out\.enabledChannels/, '迁移工具必须删除 enabledChannels');
  assert.match(migrate, /ch\.enabled = false/, '迁移工具必须把名单转换为 channels[].enabled');
});

test('enabledChannels 已彻底移除：Java 模型 / 生成器里不再有该字段', () => {
  const files = walkFiles(JAVA_SRC_DIR, '.java');
  assert.ok(files.length > 0, '应能找到 Java 源码：' + JAVA_SRC_DIR);
  const hits = files.filter((f) => REMOVED_FIELD.test(stripComments(read(f))));
  assert.deepEqual(hits.map((f) => path.basename(f)), [], 'Java 源码不得再出现 enabledChannels（注释里的历史说明不计）');
  const channel = read(path.join(JAVA_SRC_DIR, 'com', 'otcc', 'viewer', 'model', 'Channel.java'));
  const source = read(path.join(JAVA_SRC_DIR, 'com', 'otcc', 'viewer', 'model', 'Source.java'));
  assert.match(channel, /private Integer id;/, 'Channel 必须有 id 字段');
  assert.match(channel, /private Boolean enabled;/, 'Channel 必须有 enabled 字段');
  assert.match(channel, /JsonInclude\.Include\.NON_NULL[\s\S]{0,80}private Boolean enabled;/, 'enabled 缺省不写进 JSON');
  assert.match(source, /private Integer id;/, 'Source 必须有 id 字段');
});

test('enabledChannels 已彻底移除：落盘样例数据里也没有，且全部通过新契约校验', () => {
  ['report-validation-data.json', 'report-validation-data-default.json'].forEach((name) => {
    const raw = read(path.join(PUBLIC_DIR, name));
    assert.equal(REMOVED_FIELD.test(raw), false, name + ' 不得再出现 enabledChannels');
    const json = JSON.parse(raw);
    const r = validateDataset(json);
    assert.equal(r.ok, true, name + ' 必须通过契约校验：' + JSON.stringify(r.errors.slice(0, 5)));
    json.items.forEach((it) => {
      it.channels.forEach((ch) => {
        assert.equal(Number.isInteger(ch.id) && ch.id > 0, true, it.tradeId + '/' + ch.id + ' 缺少正整数 id');
        assert.equal(ch.enabled === undefined || typeof ch.enabled === 'boolean', true, 'enabled 只能是布尔或缺省');
        ch.sources.forEach((s) => {
          assert.equal(Number.isInteger(s.id) && s.id > 0, true, it.tradeId + '/' + ch.id + '/' + s.id + ' 缺少正整数 id');
        });
      });
    });
  });
});

/* ---------------- 4.1 顶层登记表（channels / sources） ---------------- */

test('登记表形态：定义只在顶层写一次（id/name/desc/format），item 里只留 id 引用', () => {
  const json = JSON.parse(read(path.join(PUBLIC_DIR, 'report-validation-data.json')));
  assert.ok(Array.isArray(json.channels) && json.channels.length >= 3, '顶层 channels 登记表应存在');
  assert.ok(Array.isArray(json.sources) && json.sources.length >= 2, '顶层 sources 登记表应存在');
  // 登记表字段齐全，且与预设一致。
  json.channels.forEach((c) => {
    assert.equal(Number.isInteger(c.id) && c.id > 0, true, '登记表渠道必须有正整数 id');
    assert.ok(c.name, '登记表渠道必须有 name');
    assert.ok(['xml', 'csv'].includes(c.format), '登记表渠道必须有 format');
    assert.equal(CHANNEL_ID_PRESET[c.name], c.id, '登记表渠道 ' + c.name + ' 的 id 应为预设值');
  });
  json.sources.forEach((s) => {
    assert.equal(Number.isInteger(s.id) && s.id > 0, true, '登记表来源渠道必须有正整数 id');
    assert.ok(s.name, '登记表来源渠道必须有 name');
    assert.equal(SOURCE_ID_PRESET[s.name], s.id, '登记表来源渠道 ' + s.name + ' 的 id 应为预设值');
    assert.equal('fields' in s, false, '登记表的来源渠道不应带 fields（fields 属于 item 内的比较结果）');
  });
  // item 里只应有 id 引用：name/desc/format 不得重复出现（否则就是两份定义）。
  json.items.forEach((it) => {
    it.channels.forEach((ch) => {
      assert.equal('name' in ch, false, it.tradeId + ' 的 item 渠道不应重复写 name');
      assert.equal('desc' in ch, false, it.tradeId + ' 的 item 渠道不应重复写 desc');
      assert.equal('format' in ch, false, it.tradeId + ' 的 item 渠道不应重复写 format');
      ch.sources.forEach((s) => {
        assert.equal('name' in s, false, it.tradeId + ' 的 item 来源渠道不应重复写 name');
        assert.ok(Array.isArray(s.fields), 'item 来源渠道必须保留 fields（比较结果）');
      });
      assert.ok(Array.isArray(ch.fields), 'item 渠道必须保留 fields（字段注册表）');
    });
  });
});

test('登记表形态：hydrate 后名称被补回（渲染 / 搜索 / 忽略配置仍按名称工作）', () => {
  const json = JSON.parse(read(path.join(PUBLIC_DIR, 'report-validation-data.json')));
  const hydrated = hydrateDataset(json);
  const it = hydrated.items[0];
  const chReg = channelRegistryMap(json);
  it.channels.forEach((ch) => {
    assert.equal(ch.name, chReg[ch.id].name, '渠道名应从登记表补回');
    assert.equal(ch.format, chReg[ch.id].format, 'format 应从登记表补回');
    ch.sources.forEach((s) => { assert.ok(s.name, '来源渠道名应从登记表补回'); });
  });
  // hydrate 后的数据集能正常展开字段（flatFields 依赖渠道 / 来源名称）。
  assert.ok(flatFields(it).length > 0, 'hydrate 后应能展开字段行');
  assert.ok(itemStatsPure(it, null).total > 0, 'hydrate 后统计口径应正常');
  // 反向：把定义重新提到顶层应得到等价结构（可逆变换）。  assert.deepEqual(hoistRegistries(hydrated), json, 'hoist(hydrate(x)) 应等于 x');
});

/* ---------------- 5. 名称 + id 引用（消息双写，日志只写 id） ---------------- */

test('引用：messages / uncompared / skippedItems 名称 + id 双写，logs 只写 id（hydrate 后名称齐备）', () => {
  const json = hydrateDataset(JSON.parse(read(path.join(PUBLIC_DIR, 'report-validation-data.json'))));
  let checked = 0;
  json.items.forEach((it) => {
    const byChId = {};
    const chIdByName = {};
    it.channels.forEach((ch) => {
      byChId[ch.id] = ch;
      chIdByName[ch.name] = ch.id;
      ch.sources.forEach((s) => {
        assert.equal(chIdByName[ch.name], ch.id);
        assert.equal(byChId[ch.id].sources.filter((x) => x.id === s.id).length, 1, '同渠道内来源 id 必须唯一');
      });
    });
    const checkRef = (m, label) => {
      if (m.channel == null) {
        // 日志行只写 id：无名称是正常形态（名称由 hydrate 按 id 补回）。
        if (!label.includes('.logs[')) {
          assert.equal(m.channelId == null || m.channelId === undefined, true, label + ' 无渠道名时不应有 channelId');
        }
        return;
      }
      assert.equal(m.channelId, chIdByName[m.channel], label + ' channelId 与名称不一致');
      if (m.source != null && m.source !== '') {
        const src = byChId[m.channelId].sources.find((x) => x.name === m.source);
        assert.ok(src, label + ' source 名称必须存在于该渠道');
        assert.equal(m.sourceId, src.id, label + ' sourceId 与名称不一致');
      }
      checked++;
    };
    (it.warnings || []).forEach((m, i) => checkRef(m, it.tradeId + '.warnings[' + i + ']'));
    (it.errors || []).forEach((m, i) => checkRef(m, it.tradeId + '.errors[' + i + ']'));
    (it.uncompared || []).forEach((m, i) => checkRef(m, it.tradeId + '.uncompared[' + i + ']'));
    (it.logs || []).forEach((m, i) => checkRef(m, it.tradeId + '.logs[' + i + ']'));
  });
  (json.skippedItems || []).forEach((s, i) => {
    if (s.channel == null) return;
    assert.equal(s.channelId, CHANNEL_ID_PRESET[s.channel], 'skippedItems[' + i + '] channelId 应取预设');
    checked++;
  });
  assert.ok(checked > 100, '应校验到足够多的双写引用，实际：' + checked);
});

test('字段级日志行：名称与 id 齐备，且 id 就是渠道 / 来源 / 字段的稳定标识', () => {
  const json = hydrateDataset(JSON.parse(read(path.join(PUBLIC_DIR, 'report-validation-data.json'))));
  let lines = 0;
  json.items.forEach((it) => {
    const byChId = {};
    it.channels.forEach((ch) => { byChId[ch.id] = ch; });
    (it.logs || []).filter((l) => l.scope === 'field').forEach((l) => {
      const ch = byChId[l.channelId];
      assert.ok(ch, it.tradeId + ' 字段日志行的 channelId 必须能解析');
      assert.equal(ch.name, l.channel, '通道名必须与 id 指向同一渠道');
      const src = ch.sources.find((s) => s.id === l.sourceId);
      assert.ok(src, it.tradeId + ' 字段日志行的 sourceId 必须该渠道内存在');
      assert.equal(src.name, l.source);
      assert.ok(ch.fields.some((d) => d.id === l.field), 'field 必须是该渠道注册表里的字段 id');
      lines++;
    });
  });
  assert.ok(lines > 100, '应有大量字段级日志行，实际：' + lines);
});

/* ---------------- 6. 日志锚点：id 合成键与跨 item 稳定性 ---------------- */

test('日志锚点：合成键用 id，因此跨 item / 改名都不影响定位（seq 区分同一字段的多行）', () => {
  // 同一个渠道 / 来源 / 字段，在两个不同 item 里得到**同一个键**（名称不必参与）。
  const keyA = logFieldKey(CHANNEL_ID_PRESET.HKTR, SOURCE_ID_PRESET['来源渠道 A'], '2');
  const keyB = logFieldKey(channelIdOf({ name: 'HKTR' }, 0), sourceIdOf({ name: '来源渠道 A' }, 0), '2');
  assert.equal(keyA, keyB);
  assert.equal(keyA, '1|1|2');
  assert.equal(logAnchorId(1, 1, '2', 1), 'log-1-1-f2.1', 'DOM id 形如 log-<渠道id>-<来源id>-f<字段id>.<序号>');
  assert.equal(logAnchorId(1, 1, '2', 2), 'log-1-1-f2.2', '同键多行靠序号区分');
  assert.ok(logAnchorId(1, 1, '2', 1).length <= 20, '锚点 id 短小稳定');
  // 渠道改名（id 不变）不会导致锚点漂移：这正是引入 id 的目的。
  const renamed = { channels: [{ id: 1, name: 'HKTR-NEW' }] };
  assert.equal(logFieldKey(channelIdOf(renamed.channels[0], 0), 1, '2'), logFieldKey(1, 1, '2'));
  assert.equal(logAnchorId(channelIdOf(renamed.channels[0], 0), 1, '2', 1), 'log-1-1-f2.1');
});
