// 批次元数据写回的乐观并发（If-Match）契约测试。
//
// 服务端行为已由 test/server.test.js 用真实 HTTP 覆盖（GET 取 etag / 过期 If-Match → 409 不写入 /
// 重放成功 / 请求头形式 / `*` 不校验）；本文件补两块：
//   1. 服务端源码级断言（路由接线、etag 计算与回传、语义与 /api/ignore、/api/favorites 一致）；
//   2. 前端接线（app.js 是 DOM 闭包，Node 无法直接执行）——统一入口 postBatchMeta 必须覆盖全部写回点，
//      且 409 处理为「提示 + 用服务端最新 etag 重放一次」。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP = fs.readFileSync(path.join(SRC_DIR, 'public', 'app.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(SRC_DIR, 'server.js'), 'utf8');
const I18N = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'public', 'i18n.json'), 'utf8'));
const README = fs.readFileSync(path.join(SRC_DIR, 'docs', 'README.md'), 'utf8');
const DATA_SCHEMA = fs.readFileSync(path.join(SRC_DIR, 'docs', 'DATA_SCHEMA.md'), 'utf8');
const LANGS = ['zh-CN', 'zh-HK', 'en'];

function bodyOf(src, sig, len = 1200) {
  const i = src.indexOf(sig);
  assert.notEqual(i, -1, '未找到：' + sig);
  return src.slice(i, i + len);
}

test('服务端：GET /api/batch 返回元数据与当前 ETag（缺 id 400 / 批次不存在 404）', () => {
  assert.match(SERVER, /if \(url === '\/api\/batch'\) \{\s+if \(req\.method === 'POST'\) handleBatchAction\(req, res\);\s+else handleBatchGet\(res, new URL\(req\.url \|\| '\/', 'http:\/\/localhost'\)\.searchParams\);/,
    '/api/batch 应按方法分发（POST 写回 / 其它读元数据）');
  const get = bodyOf(SERVER, 'function handleBatchGet(', 900);
  assert.match(get, /query\.get\('id'\) \|\| query\.get\('batchId'\)/, 'id / batchId 两种参数名都接受');
  assert.match(get, /json\(res, 400, \{ ok: false, error: 'id 必填' \}\)/, '缺 id 应 400');
  assert.match(get, /json\(res, 404, \{ ok: false, error: '批次不存在：' \+ batchId \}\)/, '未知批次应 404');
  assert.match(get, /etag: etagOfFile\(metaPath\)/, '应回传 batch-meta.json 的强 ETag（文件不存在时为 null）');
  assert.match(get, /meta: meta/, '应回传元数据内容');
  assert.match(bodyOf(SERVER, 'function batchMetaPath(', 500), /idx\.batches \|\| \[\]\)\.find/, '批次路径经索引解析（客户端不能指定任意路径）');
});

test('服务端：POST /api/batch 校验 If-Match（body 或请求头，* 不校验），409 带当前 etag 且不写入', () => {
  const handler = bodyOf(SERVER, 'function handleBatchAction(', 4200);
  assert.match(handler, /const cur = etagOfFile\(metaPath\);/, '写前应取当前文件的 ETag');
  assert.match(handler, /const want = readIfMatch\(data, req\);/, 'ifMatch 来源统一走 readIfMatch');
  assert.match(handler, /if \(want && want !== '\*'\) \{\s+if \(!cur \|\| want !== cur\) \{ json\(res, 409, \{ ok: false, error: '批次元数据已被其他会话修改', etag: cur \}\); return; \}\s+\}/,
    '不一致（或文件已不存在）应 409 且不写入，并回传服务端当前 etag');
  assert.match(handler, /etag: etagOfFile\(metaPath\),/, '成功写回应回传新 etag（客户端无需重新 GET）');
  const helper = bodyOf(SERVER, 'function readIfMatch(', 300);
  assert.match(helper, /data\.ifMatch/, 'body 的 ifMatch 生效');
  assert.match(helper, /req\.headers\['if-match'\]/, 'If-Match 请求头生效（与 /api/ignore、/api/favorites 一致）');
  assert.match(SERVER, /GET  \/api\/batch         批次元数据 \+ 当前 ETag/, '文件头接口注释应登记 GET /api/batch');
});

test('前端：写回统一入口带 If-Match，且 409 时提示并用服务端最新 etag 重放一次', () => {
  const etagFn = bodyOf(APP, 'async function batchMetaEtag(', 700);
  assert.match(etagFn, /fetch\('\/api\/batch\?id=' \+ encodeURIComponent\(batchId\)/, '应先 GET /api/batch 取 etag');
  assert.match(etagFn, /BATCH_META_ETAG\[batchId\] = j\.etag;/, '取到后缓存（同一批次后续写回不再重复 GET）');
  assert.match(etagFn, /return undefined;/, '取不到时返回 undefined（不带 If-Match，行为与旧版一致）');

  const post = bodyOf(APP, 'async function postBatchMeta(', 1400);
  assert.match(post, /if \(ifMatch !== undefined\) body\.ifMatch = ifMatch;/, '应把 etag 作为 ifMatch 发出');
  assert.match(post, /if \(out\.res\.status === 409 && batchId\) \{/, '应识别 409 冲突');
  assert.match(post, /if \(out\.json && typeof out\.json\.etag === 'string'\) BATCH_META_ETAG\[batchId\] = out\.json\.etag;/,
    '应采用服务端 409 响应里的最新 etag');
  assert.match(post, /setBatchNotice\(t\('batchMetaConflict'\)\);/, '应提示冲突');
  assert.match(post, /out = await send\(BATCH_META_ETAG\[batchId\]\);/, '应重放一次');
  assert.match(post, /if \(out\.res\.ok && out\.json && batchId && typeof out\.json\.etag === 'string'\) \{\s+BATCH_META_ETAG\[batchId\] = out\.json\.etag;/,
    '成功后应同步最新 etag');
});

test('前端：三个写回点（软删除 / 收藏 / 编辑弹窗）都走统一入口，无遗留裸 fetch', () => {
  assert.match(APP, /const out = await postBatchMeta\(\{ batchId: id, deleted: true \}\);/, '软删除应走统一入口');
  assert.match(APP, /postBatchMeta\(\{ batchId: batchId, favorite: flag \}\)/, '收藏标记应走统一入口');
  assert.match(APP, /const out = await postBatchMeta\(\{ batchId: batchId, batchName: name, description: descEl\.value, tags: draft \}\);/,
    '编辑弹窗保存应走统一入口');
  const raw = APP.match(/fetch\('\/api\/batch'/g) || [];
  assert.equal(raw.length, 1, '只允许统一入口里出现一处 fetch(\'/api/batch\')，实际：' + raw.length);
});

test('文案与文档：冲突提示三语齐备；README / DATA_SCHEMA 说明 GET /api/batch 与 If-Match', () => {
  LANGS.forEach((lang) => {
    const v = I18N[lang].batchMetaConflict;
    assert.equal(typeof v, 'string', lang + '.batchMetaConflict 缺失');
    assert.ok(v.length > 0, lang + '.batchMetaConflict 不应为空');
  });
  assert.match(README, /`GET` \/ `POST` \| `\/api\/batch` \| 批次元数据读取 \/ 写回/, 'API 表应登记 GET /api/batch');
  assert.match(README, /> \*\*乐观并发\*\*（`\/api\/ignore`、`\/api\/favorites`、`\/api\/batch`）/,
    '乐观并发说明应包含 /api/batch');
  assert.match(DATA_SCHEMA, /`POST \/api\/batch` 为\*\*字段级补丁\*\*/, 'DATA_SCHEMA 应说明字段级补丁 + If-Match 语义');
});
