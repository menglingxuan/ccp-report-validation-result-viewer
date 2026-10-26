// 「版本升级后旧批次变为不兼容」在收藏夹 / 置顶上的行为回归测试。
//
// 需求：
//   1. 收藏夹中若某批次版本不兼容 → 与「缺失」同样的徽章位显示「不兼容」，且「缺失」优先于「不兼容」；
//   2. 若置顶批次变为不兼容 → 强制清除置顶（不兼容批次不能被默认加载）。
//   租户 / 非租户模式都要求生效：置顶存储在 localStorage，键由 storageKey() 拼租户后缀。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { favoriteStateOf, apiVersionSupported } from '../public/core.js';

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP = fs.readFileSync(path.join(SRC, 'public', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(SRC, 'public', 'index.html'), 'utf8');
const I18N = JSON.parse(fs.readFileSync(path.join(SRC, 'public', 'i18n.json'), 'utf8'));
const LANGS = ['zh-CN', 'zh-HK', 'en'];

test('收藏项状态：缺失优先于不兼容', () => {
  // 批次不存在 / 已软删除 → missing（优先于版本判断）
  assert.equal(favoriteStateOf(null, false), 'missing');
  assert.equal(favoriteStateOf(undefined, true), 'missing');
  assert.equal(favoriteStateOf({ batchId: 'b', deleted: true }, true), 'missing', '已删除批次即便版本兼容也算缺失');
  assert.equal(favoriteStateOf({ batchId: 'b', deleted: true }, false), 'missing', '缺失优先于不兼容');
  // 存在且未删除：看版本
  assert.equal(favoriteStateOf({ batchId: 'b' }, true), 'ok');
  assert.equal(favoriteStateOf({ batchId: 'b' }, false), 'incompat', '版本不在白名单 → 不兼容');
  // 与版本判定口径一致：升级后旧版本号不在 compatibleApiVersions 内
  assert.equal(apiVersionSupported(3, [4]), false);
  assert.equal(favoriteStateOf({ batchId: 'b', formatVersion: 3 }, apiVersionSupported(3, [4])), 'incompat');
});

test('收藏夹渲染：两个列表都按状态出徽章，且不再各自硬编码 missing 判定', () => {
  const fn = (sig, endSig) => {
    const i = APP.indexOf(sig);
    assert.notEqual(i, -1, '未找到：' + sig);
    return APP.slice(i, APP.indexOf(endSig, i));
  };
  const items = fn('function favItemsHTML(', 'function favTreeHTML(');
  const search = fn('function favSearchResultsHTML(', 'function renderFavoritesPanel(');
  [items, search].forEach((body, idx) => {
    const label = idx === 0 ? 'favItemsHTML' : 'favSearchResultsHTML';
    assert.match(body, /const state = favBatchState\(f\.batchId\)/, label + ' 应统一走 favBatchState');
    assert.match(body, /favStateBadgeHTML\(state\)/, label + ' 应统一出徽章');
    assert.equal(/favoriteBatchExists\(f\.batchId\)/.test(body), false, label + ' 不应再自行判缺失');
  });
  assert.match(APP, /function favStateBadgeHTML\(state\)/, '应有统一的徽章渲染');
  assert.match(APP, /fav-missing-badge/, '缺失徽章');
  assert.match(APP, /fav-incompat-badge/, '不兼容徽章');
  assert.match(APP, /return favoriteStateOf\(b, !!b && batchCompatible\(b\)\)/, '状态判定走 core.js 的纯函数');
});

test('样式：不兼容徽章与缺失徽章同位（warn 色系，虚线区分）', () => {
  assert.match(HTML, /\.fav-item\.incompat\s*\{[^}]*opacity/, '.fav-item.incompat 弱化');
  assert.match(HTML, /\.fav-incompat-badge\s*\{[^}]*var\(--warn\)/, '不兼容徽章用 warn 色');
  assert.match(HTML, /\.fav-incompat-badge\s*\{[^}]*dashed/, '与「缺失」用虚线边框区分');
});

test('置顶：批次变为不兼容时强制清除，且租户 / 非租户都走 storageKey 作用域', () => {
  const i = APP.indexOf('function prunePinnedBatch()');
  assert.notEqual(i, -1, '应有 prunePinnedBatch');
  const body = APP.slice(i, APP.indexOf('function toggleBatchPanel(', i));
  assert.match(body, /const b = BATCHES_INDEX\.batches\.find\(function \(x\) \{ return x\.batchId === PINNED_BATCH_ID && !x\.deleted; \}\)/,
    '先按 id + 未删除找批次');
  assert.match(body, /if \(!b\) \{ PINNED_BATCH_ID = null; savePinnedId\(\); return; \}/, '批次不存在 / 已删除 → 清除');
  assert.match(body, /if \(!batchCompatible\(b\)\) \{[\s\S]*?PINNED_BATCH_ID = null;[\s\S]*?savePinnedId\(\);[\s\S]*?setBatchNotice\(t\('pinClearedIncompat'\)\);/,
    '不兼容 → 清除并提示');
  // 默认加载入口也要再挡一层，防止 prune 之前就被用于启动加载。
  const restore = APP.slice(APP.indexOf('function restorePinnedBatch()'), i);
  assert.match(restore, /if \(b && b\.dataUrl && batchCompatible\(b\)\)/, 'restorePinnedBatch 只接受兼容批次');
  // 存储键带租户后缀 → 两种模式各管各自的置顶。
  assert.match(APP, /function storageKey\(base\) \{ return TENANT_ID \? base \+ '@' \+ TENANT_ID : base; \}/);
  assert.match(APP, /localStorage\.removeItem\(storageKey\(PIN_STORAGE_KEY\)\)/, '清除置顶走作用域键');
  assert.match(APP, /localStorage\.setItem\(storageKey\(PIN_STORAGE_KEY\)/, '写入置顶走作用域键');
});

test('文案：不兼容徽章与置顶清除提示三语齐备', () => {
  LANGS.forEach((lang) => {
    ['favIncompat', 'pinClearedIncompat'].forEach((k) => {
      const v = I18N[lang] && I18N[lang][k];
      assert.equal(typeof v, 'string', lang + '.' + k + ' 缺失');
      assert.ok(v.length > 0, lang + '.' + k + ' 不应为空');
    });
  });
});
