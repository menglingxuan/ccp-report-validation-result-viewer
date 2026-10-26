// 收藏夹自愈（纯函数，无 IO）：解决「批次带 ★ 但收藏夹里没有」的双数据源不一致。
//
// 背景（见 docs/README.md「收藏夹」）：
//   - 星标来自 `batch-meta.json` 的 `favorite`（扫描后进 `batches-index.json`）；
//   - 收藏夹内容来自 `favorites.json`（`GET /api/favorites`）。
//   两者分开存储（批次目录 vs 数据根），任何"只写成功一半"或换数据根/迁移目录都会让它们分叉。
//
// 自愈规则（单向，按产品决定）：
//   `favorite === true` 但**不在任何收藏包**里的批次 → 自动补进保留包 `archived`。
//   - 已在其它包里的不重复添加（不猜测用户本来的包名）；
//   - 软删除批次（`deleted === true`）不补（已删除批次不允许收藏，见 app.js addFavorite）；
//   - 幂等：重复执行不会重复添加；
//   - 纯函数：不修改入参，返回新的 tree 与本次新增的 batchId 列表。
export const FAV_ARCHIVE_PKG = 'archived';

// 收集 tree 里出现过的所有 batchId（一个批次可在多个包）。
export function favoriteBatchIds(tree) {
  const ids = new Set();
  Object.keys(tree || {}).forEach(function (pkg) {
    const list = tree[pkg];
    if (!Array.isArray(list)) return;
    list.forEach(function (f) {
      if (f && typeof f.batchId === 'string' && f.batchId) ids.add(f.batchId);
    });
  });
  return ids;
}

// 把「favorite=true 但不在 tree 里」的批次补进 archived 包。
//   tree    : { <pkg>: [ { batchId, batchName, date, executedAt, savedAt }, … ] }
//   batches : 索引里的批次条目（至少需要 batchId / favorite；可选 batchName / date / executedAt / deleted）
//   opts    : { pkg?, now? }（pkg 默认 archived；now 用于 savedAt，默认当前时间）
// 返回 { tree, added }：tree 总是新对象；added 为本次新增的 batchId（顺序与 batches 一致）。
export function reconcileFavoriteTree(tree, batches, opts) {
  const o = opts || {};
  const pkg = o.pkg || FAV_ARCHIVE_PKG;
  const now = o.now || new Date().toISOString();
  const out = {};
  // 深拷贝一层数组 + 条目对象，保证纯函数语义（调用方不会被意外改写）。
  Object.keys(tree || {}).forEach(function (k) {
    const list = Array.isArray(tree[k]) ? tree[k] : [];
    out[k] = list.map(function (f) { return Object.assign({}, f); });
  });
  const known = favoriteBatchIds(out);
  const added = [];
  (Array.isArray(batches) ? batches : []).forEach(function (b) {
    if (!b || b.favorite !== true) return;
    const batchId = typeof b.batchId === 'string' ? b.batchId : '';
    if (!batchId || known.has(batchId)) return;
    if (b.deleted === true) return;   // 已（软）删除的批次不属于收藏夹
    if (!out[pkg]) out[pkg] = [];
    out[pkg].push({
      batchId: batchId,
      batchName: b.batchName || batchId,
      date: b.date || '',
      executedAt: b.executedAt || '',
      savedAt: now,
    });
    known.add(batchId);
    added.push(batchId);
  });
  return { tree: out, added: added };
}
