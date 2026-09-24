// 搜索：用户标签（userTag）支持回归测试。
//  1) 限定名 tag: / userTag:（大小写不敏感）与自由文本都能搜到用户标签；
//  2) 用户标签按「原始值」与「当前语言显示标签」双通道匹配（标签映射由调用方传入）；
//  3) 全局搜索结果带 userTag；Worker 与主线程回退传同一 tagLabels 参数。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSearchQuery, makeMatcher, matchRow, flatFields, globalSearchPure } from '../public/core.js';

const PUBLIC_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const APP = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
const WORKER = fs.readFileSync(path.join(PUBLIC_DIR, 'worker.js'), 'utf8');
const I18N = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, 'i18n.json'), 'utf8'));

// 最小可用的单文件数据集：一个渠道 / 一个来源 / 三个字段（分别带不同 userTag）。
function makeItem(tags) {
  return {
    tradeId: 'T-1',
    enabledChannels: ['HKTR'],
    channels: [{
      name: 'HKTR',
      fields: tags.map((tg, i) => ({ id: 'f' + i, name: '字段' + i, userTag: tg, type: 'string' })),
      sources: [{
        name: 'srcA',
        fields: tags.map((tg, i) => ({
          id: 'f' + i, result: 'PASSED',
          cmpLeft: { value: '左' + i, el: '/x/' + i }, cmpRight: { value: '右' + i, el: '/y/' + i },
        })),
      }],
    }],
  };
}

const ITEM = makeItem(['platformAssertion', 'productAssertion', 'contextAssertion']);
const TAGS = { platformAssertion: '平台断言', productAssertion: '产品断言', contextAssertion: '上下文断言' };

test('限定名：tag: / userTag: / TAG: 都解析为 userTagHay', () => {
  assert.deepEqual(parseSearchQuery('tag:平台断言'), { key: 'userTagHay', regex: false, text: '平台断言' });
  assert.equal(parseSearchQuery('userTag:platformAssertion').key, 'userTagHay');
  assert.equal(parseSearchQuery('usertag:x').key, 'userTagHay');
  assert.equal(parseSearchQuery('TAG:x').key, 'userTagHay', '限定名应大小写不敏感');
  assert.equal(parseSearchQuery('tag:regex:平台.*').regex, true, '限定名可与 regex: 叠加');
  // 其它限定名不受影响
  assert.equal(parseSearchQuery('field:金额').key, 'field');
});

test('flatFields：userTag 保留原始值，userTagHay 合并显示标签', () => {
  const withLabels = flatFields(ITEM, TAGS);
  assert.equal(withLabels[0].userTag, 'platformAssertion', 'userTag 仍应是原始值（用于显示 / 排序 / 筛选）');
  assert.equal(withLabels[0].userTagHay, 'platformAssertion 平台断言');
  assert.equal(withLabels[1].userTagHay, 'productAssertion 产品断言');
  const noLabels = flatFields(ITEM);
  assert.equal(noLabels[0].userTagHay, 'platformAssertion', '未传标签映射时 userTagHay 等于原始值');
});

test('匹配：tag: 限定名搜原始值与显示标签；field: 不会误命中标签', () => {
  const rows = flatFields(ITEM, TAGS);
  const m = (expr) => { const pq = parseSearchQuery(expr); return rows.filter(r => matchRow(r, pq, makeMatcher(pq))).length; };
  assert.equal(m('tag:platformAssertion'), 1, 'tag: 应能按原始值命中');
  assert.equal(m('tag:平台断言'), 1, 'tag: 应能按显示标签命中');
  assert.equal(m('tag:断言'), 3, 'tag: 应支持标签子串');
  assert.equal(m('field:平台断言'), 0, 'field: 只搜报告字段，不应命中用户标签');
  assert.equal(m('平台断言'), 1, '自由文本应能按显示标签命中（fieldHay 合并了标签）');
});

test('globalSearchPure：按标签搜索命中并回传 userTag；未传标签映射时只能按原始值搜', () => {
  const hit = globalSearchPure([ITEM], 'tag:平台断言', 200, { tagLabels: TAGS });
  assert.equal(hit.length, 1);
  assert.equal(hit[0].userTag, 'platformAssertion', '结果应带 userTag 供界面显示标签');
  assert.equal(hit[0].fieldId, 'f0');
  assert.equal(globalSearchPure([ITEM], 'tag:平台断言', 200).length, 0, '不传标签映射时标签本身搜不到（契约：标签由调用方解析）');
  assert.equal(globalSearchPure([ITEM], 'tag:platformAssertion', 200).length, 1, '原始值始终可搜');
  assert.equal(globalSearchPure([ITEM], '产品断言', 200, { tagLabels: TAGS }).length, 1, '自由文本 + 标签映射');
});

test('raw 模式契约：空标签映射时只搜原始值（与界面显示原始值一致）', () => {
  const raw = { tagLabels: {} }; // columns.userTag.raw = true 时 searchTagLabels() 返回空对象
  assert.equal(globalSearchPure([ITEM], 'tag:平台断言', 200, raw).length, 0, 'raw 模式下不按显示标签搜');
  assert.equal(globalSearchPure([ITEM], 'tag:platformAssertion', 200, raw).length, 1, 'raw 模式仍按原始值搜');
  assert.equal(globalSearchPure([ITEM], '平台断言', 200, raw).length, 0, 'raw 模式下自由文本也不按标签搜');
  assert.equal(globalSearchPure([ITEM], 'platformAssertion', 200, raw).length, 1);
  // 非 raw 模式（默认）保留双通道能力
  const dual = { tagLabels: TAGS };
  assert.equal(globalSearchPure([ITEM], '平台断言', 200, dual).length, 1);
  assert.equal(globalSearchPure([ITEM], 'platformAssertion', 200, dual).length, 1);
});

test('界面接线：Worker 与主线程回退都传 tagLabels，结果行显示用户标签', () => {
  assert.match(APP, /function searchTagLabels\(\)/, 'app.js 应提供供搜索用的标签映射');
  assert.match(APP, /if \(USER_TAG_RAW\) return m;/, 'raw 模式下不返回标签映射（只搜原始值）');
  assert.match(APP, /function tagSyntaxHelpKey\(\) \{ return USER_TAG_RAW \? 'helpSyntaxTagRaw' : 'helpSyntaxTag'; \}/,
    '帮助面板的标签搜索说明应与 raw 开关联动');
  assert.match(APP, /\['tag:', t\(tagSyntaxHelpKey\(\)\)\]/, '帮助面板应用联动后的文案');
  assert.match(APP, /workerCall\('globalSearch', \{ items: DATA\.items, q: q, limit: APP_LIMITS\.globalSearchLimit, tagLabels: tagLabels \}\)/,
    '全局搜索应把 tagLabels 传给 Worker');
  assert.match(APP, /globalSearchPure\(DATA\.items, q, APP_LIMITS\.globalSearchLimit, \{ tagLabels: tagLabels \}\)/,
    '主线程回退应传同一 tagLabels，保证结果一致');
  assert.match(APP, /flatFields\(item, searchTagLabels\(\)\)/, '主列表字段搜索也应支持按标签搜索');
  assert.match(APP, /\(r\.userTag \? userTagHTML\(r\.userTag\) : ''\)/, '全局搜索结果行应显示用户标签徽章');
  assert.match(WORKER, /globalSearchPure\(p\.items \|\| \[\], p\.q, p\.limit, \{ tagLabels: p\.tagLabels \|\| null \}\)/,
    'worker 应转发 tagLabels');
});

test('文案：三语 tooltip / 占位符都点明用户标签，且两种模式的帮助文案齐备', () => {
  ['zh-CN', 'zh-HK', 'en'].forEach((lang) => {
    assert.equal(typeof I18N[lang].helpSyntaxTag, 'string', lang + '.helpSyntaxTag 缺失');
    assert.equal(typeof I18N[lang].helpSyntaxTagRaw, 'string', lang + '.helpSyntaxTagRaw 缺失');
    assert.match(I18N[lang].helpSyntaxTag, /label|标签|標籤/, lang + '.helpSyntaxTag 应提及显示标签');
    assert.doesNotMatch(I18N[lang].helpSyntaxTagRaw, /label|显示标签|顯示標籤/, lang + '.helpSyntaxTagRaw 不应提及标签');
    assert.match(I18N[lang].globalSearchPlaceholder, /user tag|用户标签|用戶標籤/, lang + '.globalSearchPlaceholder 应包含用户标签');
    assert.match(I18N[lang].toolbarSearch, /user tag|用户标签|用戶標籤/, lang + '.toolbarSearch 应包含用户标签');
  });
});
