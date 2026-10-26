// 收藏夹自愈 + 写入顺序（消除半成功）回归测试。
//
// 背景：星标来自 batch-meta.favorite（扫描后进索引），收藏夹内容来自 favorites.json，
// 两者分开存储；一旦只写成功一半（或换数据根 / 迁移目录），就会出现
// 「批次带 ★ 但收藏夹里没有」。自愈规则：favorite=true 且不在任何收藏包里 →
// 自动补进保留包 `archived`（不猜原包名；软删除批次不补；幂等）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileFavoriteTree, favoriteBatchIds, FAV_ARCHIVE_PKG } from '../lib/favorites.js';

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SERVER = fs.readFileSync(path.join(SRC, 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(SRC, 'public', 'app.js'), 'utf8');
const I18N = JSON.parse(fs.readFileSync(path.join(SRC, 'public', 'i18n.json'), 'utf8'));

const NOW = '2026-10-27T00:00:00.000Z';

test('自愈：favorite=true 但不在收藏树里 → 补进 archived 包', () => {
  const tree = { work: [{ batchId: 'b-1', batchName: 'B1' }] };
  const batches = [
    { batchId: 'b-1', batchName: 'B1', favorite: true },                       // 已在 work 包里 → 不动
    { batchId: 'b-2', batchName: 'B2', favorite: true, date: '2026-08-16', executedAt: '2026-08-16T10:00:00.000Z' },
    { batchId: 'b-3', batchName: 'B3', favorite: false },                      // favorite 非 true → 不加
    { batchId: 'b-4', batchName: 'B4' },                                       // 无 favorite 字段 → 不加
  ];
  const { tree: out, added } = reconcileFavoriteTree(tree, batches, { now: NOW });
  assert.deepEqual(added, ['b-2'], '只有 b-2 需要补');
  assert.deepEqual(out[FAV_ARCHIVE_PKG], [{
    batchId: 'b-2', batchName: 'B2', date: '2026-08-16', executedAt: '2026-08-16T10:00:00.000Z', savedAt: NOW,
  }], '条目字段与客户端 addFavorite 一致');
  assert.deepEqual(out.work, [{ batchId: 'b-1', batchName: 'B1' }], '已有收藏包原样保留');
  // 纯函数：入参不被改写
  assert.equal(FAV_ARCHIVE_PKG in tree, false, '不得修改入参 tree');
});

test('自愈：软删除批次不补；重复执行幂等', () => {
  const batches = [
    { batchId: 'b-1', batchName: 'B1', favorite: true },
    { batchId: 'b-2', batchName: 'B2', favorite: true, deleted: true },
  ];
  const first = reconcileFavoriteTree({}, batches, { now: NOW });
  assert.deepEqual(first.added, ['b-1'], '软删除批次不允许收藏，跳过');
  assert.equal(first.tree[FAV_ARCHIVE_PKG].length, 1);

  const second = reconcileFavoriteTree(first.tree, batches, { now: NOW });
  assert.deepEqual(second.added, [], '第二次执行不应重复添加');
  assert.equal(second.tree[FAV_ARCHIVE_PKG].length, 1);
});

test('自愈：batchName 缺失时回退 batchId；favoriteBatchIds 覆盖多个包', () => {
  const { tree, added } = reconcileFavoriteTree({}, [{ batchId: 'b-x', favorite: true }], { now: NOW });
  assert.deepEqual(added, ['b-x']);
  assert.equal(tree[FAV_ARCHIVE_PKG][0].batchName, 'b-x', '没有名称时回退 batchId');
  assert.deepEqual(
    [...favoriteBatchIds({ a: [{ batchId: '1' }], b: [{ batchId: '2' }, { batchId: '1' }], c: [] })].sort(),
    ['1', '2'],
  );
});

test('服务端接线：启动 / 扫描后 / 元数据写回后都会对账并写回 favorites.json', () => {
  assert.match(SERVER, /import \{[^}]*reconcileFavoriteTree[^}]*\} from '\.\/lib\/favorites\.js'/,
    'server.js 应引用纯函数模块');
  assert.match(SERVER, /function reconcileFavoritesFile\(reason\)/, '应对账函数');
  assert.match(SERVER, /writeJsonAtomic\(FAVORITES_FILE, res\.tree\)/, '自愈结果写回 favorites.json');
  assert.match(SERVER, /reconcileFavoritesFile\('startup'\)/, '启动时对账');
  assert.match(SERVER, /if \(result\.ok\) reconcileFavoritesFile\('scan'\)/, '扫描成功后对账');
  assert.match(SERVER, /reconcileFavoritesFile\('meta write-back'\)/, '元数据写回、索引重建后对账');
  assert.match(SERVER, /const indexRebuilt = await rescanIndex\(\)/, '索引重建结果要能回传客户端');
  assert.match(SERVER, /indexRebuilt: indexRebuilt/, '/api/batch 响应带 indexRebuilt');
});

test('客户端：先保存收藏树成功、才回写 favorite 标记（不再半成功）', () => {
  const save = APP.slice(APP.indexOf('function saveFavorites()'), APP.indexOf('function favPkgList()'));
  assert.match(save, /return fetch\('\/api\/favorites'/, 'saveFavorites 应返回 Promise');
  assert.match(save, /return true;/, '成功时 resolve true');
  assert.match(save, /return false;/, '冲突 / 网络失败 resolve false');

  const add = APP.slice(APP.indexOf('function addFavorite('), APP.indexOf('function removeFavorite('));
  assert.match(add, /const snapshot = JSON\.parse\(JSON\.stringify\(FAVORITES\)\)/, '保存前留回滚快照');
  assert.match(add,
    /saveFavorites\(\)\.then\(function \(ok\) \{\s*if \(!ok\) \{ FAVORITES = snapshot; refreshFavoriteViews\(\); return; \}\s*setBatchFavoriteFlag\(batchId, true\);/,
    '只有收藏树落库成功才写 meta favorite=true');

  const remove = APP.slice(APP.indexOf('function removeBatchFromFavorites('), APP.indexOf('function openRemoveFavoriteDialog('));
  assert.match(remove,
    /saveFavorites\(\)\.then\(function \(ok\) \{\s*if \(!ok\) \{ FAVORITES = snapshot; refreshFavoriteViews\(\); return; \}\s*if \(favoriteCountFor\(batchId\) === 0\) setBatchFavoriteFlag\(batchId, false\);/,
    '只有收藏树落库成功才清 meta favorite');

  const flag = APP.slice(APP.indexOf('function setBatchFavoriteFlag('), APP.indexOf('function isBatchFavorited('));
  assert.match(flag, /if \(!out \|\| !out\.res \|\| !out\.res\.ok\) throw new Error/, 'meta 写回失败要当成失败');
  assert.match(flag, /if \(b\) b\.favorite = prev;/, '失败时回滚内存里的 favorite');
});

test('文案：两处失败提示三语齐备', () => {
  ['zh-CN', 'zh-HK', 'en'].forEach((lang) => {
    ['favSaveFailed', 'favFlagFailed'].forEach((k) => {
      const v = I18N[lang] && I18N[lang][k];
      assert.equal(typeof v, 'string', lang + '.' + k + ' 缺失');
      assert.ok(v.length > 0, lang + '.' + k + ' 不应为空');
    });
  });
});
