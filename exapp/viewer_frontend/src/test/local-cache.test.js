// 本地缓存作用域测试（纯函数）：
//   - localCacheKeys：租户模式给全部 5 个基名加 @<tenantId> 后缀；
//   - clearLocalCacheStorage：只清当前作用域，不影响其它租户 / 非租户 / 其它应用的键；
//   - idbKeyInScope：IndexedDB 缓存 key 的租户前缀判定（清除时按此逐个判断，不删库）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { localCacheKeys, clearLocalCacheStorage, idbKeyInScope } from '../public/app.js';

const PUBLIC_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const APP_SRC = fs.readFileSync(path.join(PUBLIC_DIR, 'app.js'), 'utf8');
const HTML_SRC = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

const BASES = [
  'reportValidationPrefs.v1',
  'reportValidationBatch.v1',
  'reportValidationPin.v1',
  'reportValidationIgnoreConfig.v1',
  'reportValidationFavorites.v1',
];

// 假 storage：app.js 只用到 getItem / setItem / removeItem。
function fakeStorage(init) {
  const map = new Map(Object.entries(init || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    keys: () => [...map.keys()].sort(),
  };
}

test('localCacheKeys：非租户模式返回 5 个历史键名', () => {
  assert.deepEqual(localCacheKeys(null), BASES);
  assert.deepEqual(localCacheKeys(''), BASES, '空 id 视为非租户');
});

test('localCacheKeys：租户模式全部键带 @<tenantId> 后缀', () => {
  const keys = localCacheKeys('alice');
  assert.deepEqual(keys, BASES.map((k) => k + '@alice'));
  assert.deepEqual(localCacheKeys('bob'), BASES.map((k) => k + '@bob'));
});

test('clearLocalCacheStorage：只清当前租户，其它租户/非租户/其它应用的键保留', () => {
  const st = fakeStorage({
    'reportValidationPrefs.v1@alice': '{"theme":"dark"}',
    'reportValidationBatch.v1@alice': '{"id":"b1"}',
    'reportValidationPrefs.v1@bob': '{"theme":"light"}',
    'reportValidationIgnoreConfig.v1@bob': '{}',
    'reportValidationPrefs.v1': '{"theme":"warm"}',
    'otherApp.key': 'keep',
  });
  const removed = clearLocalCacheStorage(st, 'alice');
  assert.deepEqual(removed.sort(), ['reportValidationBatch.v1@alice', 'reportValidationPrefs.v1@alice']);
  assert.deepEqual(st.keys(), [
    'otherApp.key',
    'reportValidationIgnoreConfig.v1@bob',
    'reportValidationPrefs.v1',
    'reportValidationPrefs.v1@bob',
  ]);
});

test('clearLocalCacheStorage：非租户模式只清历史键，不动任何租户键', () => {
  const st = fakeStorage({
    'reportValidationFavorites.v1': '{"pkg":[]}',
    'reportValidationPin.v1': '"b1"',
    'reportValidationFavorites.v1@alice': '{"pkg":[]}',
    'otherApp.key': 'keep',
  });
  const removed = clearLocalCacheStorage(st, null);
  assert.deepEqual(removed.sort(), ['reportValidationFavorites.v1', 'reportValidationPin.v1']);
  assert.deepEqual(st.keys(), ['otherApp.key', 'reportValidationFavorites.v1@alice']);
});

test('clearLocalCacheStorage：无键时返回空数组且不抛错', () => {
  assert.deepEqual(clearLocalCacheStorage(fakeStorage(), 'alice'), []);
  assert.deepEqual(clearLocalCacheStorage(fakeStorage(), null), []);
  // 隐私模式：storage 抛错时静默跳过（不阻断其余键的清理）。
  const throwing = {
    getItem: () => { throw new Error('blocked'); },
    removeItem: () => { throw new Error('blocked'); },
  };
  assert.deepEqual(clearLocalCacheStorage(throwing, 'alice'), []);
});

test('idbKeyInScope：租户模式只认本租户前缀', () => {
  assert.equal(idbKeyInScope('tenant:alice:report-validation-data.json', 'alice'), true);
  assert.equal(idbKeyInScope('tenant:bob:report-validation-data.json', 'alice'), false);
  assert.equal(idbKeyInScope('report-validation-data.json', 'alice'), false, '非租户项不属于本租户');
  assert.equal(idbKeyInScope('tenant:alice', 'alice'), false, '仅前缀相同但无冒号分隔不算');
});

test('idbKeyInScope：非租户模式清理全部非租户项', () => {
  assert.equal(idbKeyInScope('report-validation-data.json', null), true);
  assert.equal(idbKeyInScope('batches/x/report-validation-data.json', null), true);
  assert.equal(idbKeyInScope('tenant:alice:x', null), false, '不误删租户项');
  assert.equal(idbKeyInScope(null, null), true, '异常 key 视为非租户项');
});

// 入口与交互：源码级结构断言（DOM 实际行为由浏览器冒烟覆盖）。
test('入口：顶栏新增「清除偏好记忆」与「主页」，dock 入口与确认弹窗已移除', () => {
  // 顺序：帮助 → 清除偏好记忆 → 主页（用 indexOf 比较，避免受内联 SVG 长度影响）。
  const iHelp = HTML_SRC.indexOf('id="helpBtn"');
  const iClear = HTML_SRC.indexOf('id="clearPrefsBtn"');
  const iHome = HTML_SRC.indexOf('id="homeBtn"');
  assert.ok(iHelp !== -1 && iClear !== -1 && iHome !== -1 && iHelp < iClear && iClear < iHome,
    '两个按钮应位于顶栏帮助按钮之后（顺序：帮助 → 清除偏好记忆 → 主页）');
  assert.match(HTML_SRC, /class="help-btn" id="clearPrefsBtn"/, '清除按钮应与帮助按钮同风格（.help-btn）');
  assert.match(HTML_SRC, /class="help-btn" id="homeBtn"/, '主页按钮应与帮助按钮同风格（.help-btn）');
  assert.match(HTML_SRC, /id="clearPrefsBtn"[\s\S]{0,400}?<svg/, '清除按钮应使用内联 SVG 图标（与帮助按钮视觉一致）');
  assert.match(HTML_SRC, /id="homeBtn"[\s\S]{0,400}?<svg/, '主页按钮应使用内联 SVG 图标');
  assert.match(HTML_SRC, /\.help-btn svg \{ width: 15px; height: 15px/, '内联 SVG 图标尺寸应统一为 15×15');
  assert.doesNotMatch(APP_SRC, /clearCacheBtn/, 'dock 入口应已移除');
  assert.doesNotMatch(APP_SRC, /openClearCacheDialog/, '确认弹窗应已移除');
  assert.match(APP_SRC, /getElementById\('clearPrefsBtn'\)[\s\S]{0,200}?addEventListener\('click'/, '清除按钮应直接执行（无弹窗）');
  assert.match(APP_SRC, /history\.replaceState\(null, '', webRootUrl\(\)\)/, '主页按钮应先去掉 query/hash');
  assert.match(APP_SRC, /getElementById\('homeBtn'\)[\s\S]{0,700}?location\.reload\(\)/, '主页按钮应重新加载做全新加载');
  assert.match(APP_SRC, /function webRootUrl\(\)/, '站点根地址应复用统一实现（启动失败提示同源）');
  assert.match(APP_SRC, /showToast\(/, '清除完成应有反馈');
  // 两个按钮的启用状态均可配置（默认 dev/test 开、prod 关）。
  assert.match(APP_SRC, /clearLocalCache: flag\('clearLocalCache'\)/, '清除按钮应由 features.clearLocalCache 控制');
  assert.match(APP_SRC, /homeButton: flag\('homeButton'\)/, '主页按钮应由 features.homeButton 控制');
  assert.match(APP_SRC, /clearPrefsBtn\.hidden = true; clearPrefsBtn\.style\.display = 'none'/, '开关关闭时清除按钮应隐藏（.help-btn 会盖掉 [hidden]，须同时置 display:none）');
  assert.match(APP_SRC, /homeBtn\.hidden = true; homeBtn\.style\.display = 'none'/, '开关关闭时主页按钮应隐藏（同上）');
  assert.match(HTML_SRC, /\.help-btn\[hidden\]\s*\{\s*display:\s*none;\s*\}/, '应显式补回 .help-btn[hidden] 的 display:none');
  // 三个图标必须同规格（16×16 画布 + 1.5 描边），且房子不能画在过小的内框里（曾出现「视觉上比另两个小」）。
  const iconSvgs = HTML_SRC.match(/<button class="help-btn" id="(?:clearPrefsBtn|homeBtn)"[\s\S]*?<\/svg>/g) || [];
  assert.equal(iconSvgs.length, 2, '应能取到两个图标按钮的内联 SVG');
  iconSvgs.forEach((svg) => {
    assert.match(svg, /viewBox="0 0 16 16"/, '图标画布应统一为 16×16');
    assert.match(svg, /stroke-width="1.5"/, '图标描边应统一为 1.5');
  });
  const homeSvg = iconSvgs.find((s) => s.indexOf('homeBtn') !== -1) || '';
  const coords = (homeSvg.match(/d="([^"]+)"/g) || [])
    .flatMap((attr) => (attr.match(/-?\d+(?:\.\d+)?/g) || []).map(Number));
  assert.ok(coords.length > 0, '房子图标应含路径坐标');
  // 房子图标只用直线段（无弧线），因此原始数值即真实坐标范围：应铺满画布（≥ 13.4）而不是缩在内框。
  assert.ok(Math.max.apply(null, coords) >= 13.4, '房子图标应铺满 16×16 画布（避免看起来比其它图标小）');
  assert.ok(Math.min.apply(null, coords) <= 2.2, '房子图标左/上边应贴近画布边缘');
});
