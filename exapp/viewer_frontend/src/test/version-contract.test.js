// API（数据契约）版本回归测试：
//   - 唯一配置项是顶层 `compatibleApiVersions`（查看器允许加载的 formatVersion 白名单）；
//   - 写数据的一方（扫描器 / JS / Java 生成器）用代码常量 DEFAULT_API_VERSION / Java API_VERSION，不读配置；
//   - 不存在第二套版本号（configVersion / ContractVersion 均已移除）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_API_VERSION, DEFAULT_COMPATIBLE_API_VERSIONS,
  normalizeCompatibleApiVersions, apiVersionSupported,
} from '../public/core.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.dirname(TEST_DIR);
const REPO_ROOT = path.resolve(SRC_DIR, '..', '..', '..');
const CONFIG_FILES = ['config.json', 'config-dev.json', 'config-test.json', 'config-prod.json'];

const read = (rel) => fs.readFileSync(path.join(SRC_DIR, rel), 'utf8');
const readJava = (...parts) => fs.readFileSync(path.join(REPO_ROOT, 'src', 'main', 'java', 'com', 'otcc', 'viewer', ...parts), 'utf8');

test('默认 API 版本：当前版本在默认白名单内，且默认支持 v2 / v3', () => {
  assert.equal(DEFAULT_COMPATIBLE_API_VERSIONS.includes(DEFAULT_API_VERSION), true,
    'DEFAULT_API_VERSION 必须在 DEFAULT_COMPATIBLE_API_VERSIONS 里');
  assert.deepEqual(DEFAULT_COMPATIBLE_API_VERSIONS, [2, 3], '默认支持 v2 / v3');
  assert.equal(apiVersionSupported(2), true, 'v2 批次可加载');
  assert.equal(apiVersionSupported(3), true, 'v3 批次可加载');
  assert.equal(apiVersionSupported(1), false, 'v1 不支持（演示夹具）');
  assert.equal(apiVersionSupported(4), false, 'v4（未来版本）不支持，需加进白名单');
  assert.equal(apiVersionSupported(undefined), true, '缺省按 DEFAULT_API_VERSION 处理');
  assert.equal(apiVersionSupported(null), true, 'null 按缺省处理');
});

test('normalizeCompatibleApiVersions：配置优先，去重升序，非法 / 缺失回退默认值，并自动补上当前版本', () => {
  assert.deepEqual(normalizeCompatibleApiVersions([3, 5, 5]), [3, 5], '去重 + 升序');
  assert.deepEqual(normalizeCompatibleApiVersions([2, 3]), [2, 3], '已是归一形态时保持原样');
  // 当前版本（生成器写出的 3）不在列表里 -> 自动补上，否则自己生成的数据会被自己判为不兼容
  assert.deepEqual(normalizeCompatibleApiVersions([1]), [1, DEFAULT_API_VERSION]);
  assert.deepEqual(normalizeCompatibleApiVersions(['x', -1, 2]), [2, DEFAULT_API_VERSION], '非法项被过滤');
  // 缺失 / 非法 -> 默认值
  const fallback = DEFAULT_COMPATIBLE_API_VERSIONS.slice();
  assert.deepEqual(normalizeCompatibleApiVersions(undefined), fallback, '未配置 = 默认值');
  assert.deepEqual(normalizeCompatibleApiVersions(null), fallback, 'null = 默认值');
  assert.deepEqual(normalizeCompatibleApiVersions('3'), fallback, '非数组 = 默认值');
  assert.deepEqual(normalizeCompatibleApiVersions([]), fallback, '空数组 = 默认值');
});

test('落盘配置：四份 config*.json 只有顶层 compatibleApiVersions（无 api 段、无 configVersion）', () => {
  CONFIG_FILES.forEach((name) => {
    const cfg = JSON.parse(read(name));
    assert.equal('api' in cfg, false, name + ' 不应有 api 段');
    assert.equal('configVersion' in cfg, false, name + ' 不应再有 configVersion（已移除）');
    assert.equal('compatibleVersions' in cfg, false, name + ' 旧键 compatibleVersions 应已改名');
    assert.equal(Array.isArray(cfg.compatibleApiVersions), true, name + ' 必须有顶层 compatibleApiVersions 数组');
    assert.equal(cfg.compatibleApiVersions.includes(DEFAULT_API_VERSION), true,
      name + ' 的 compatibleApiVersions 必须包含生成器写出的当前版本 ' + DEFAULT_API_VERSION);
    assert.deepEqual(normalizeCompatibleApiVersions(cfg.compatibleApiVersions),
      cfg.compatibleApiVersions.slice().sort((a, b) => a - b), name + ' 的 compatibleApiVersions 应已是归一形态');
  });
});

test('查看器读配置，扫描器 / 生成器用代码常量（Java 读不了也不需要）', () => {
  const app = read('public/app.js');
  assert.match(app, /normalizeCompatibleApiVersions\(cfg\.compatibleApiVersions\)/,
    'app.js 必须从 cfg.compatibleApiVersions 读取白名单');
  assert.match(app, /apiVersionSupported\(v, COMPATIBLE_API_VERSIONS\)/,
    'batchCompatible 必须用配置里的白名单判定');
  assert.equal(/const COMPATIBLE_API_VERSIONS = \[/.test(app), false, 'app.js 不得写死白名单数组');
  assert.equal(/configVersion/.test(app), false, 'app.js 不应再处理 configVersion');

  const scanner = read('lib/scanner.js');
  assert.match(scanner, /import \{ DEFAULT_API_VERSION \} from '\.\.\/public\/core\.js'/, 'scanner.js 应引用代码常量');
  assert.match(scanner, /const apiVersion = DEFAULT_API_VERSION;/, '扫描器缺省版本必须用代码常量，不从配置读');

  const server = read('server.js');
  assert.match(server, /compatibleApiVersions: CFG\.compatibleApiVersions/, '/status 应回显 compatibleApiVersions');
  assert.equal(/configVersion/.test(server), false, 'server 不应再引用 configVersion');

  ['tools/generate-sample-data.js', 'tools/verify-multi-mode.mjs'].forEach((rel) => {
    const src = read(rel);
    assert.match(src, /import \{ DEFAULT_API_VERSION \} from '\.\.\/public\/core\.js'/, rel + ' 应引用代码常量');
    assert.match(src, /formatVersion: API_VERSION/, rel + ' 应写入 API_VERSION');
    assert.equal(/formatVersion: \d/.test(src), false, rel + ' 不应写死 formatVersion 数字');
  });
});

test('Java：ContractVersion 已删除，两个写入类各自声明 API_VERSION 且与 JS 默认值一致', () => {
  const contractVersion = path.join(REPO_ROOT, 'src', 'main', 'java', 'com', 'otcc', 'viewer', 'model', 'ContractVersion.java');
  assert.equal(fs.existsSync(contractVersion), false, 'ContractVersion.java 应已删除');

  const apiVersionOf = (src) => {
    const m = src.match(/int API_VERSION\s*=\s*(\d+)/);
    return m ? Number(m[1]) : null;
  };
  assert.equal(apiVersionOf(readJava('generator', 'ValidationJsonGenerator.java')), DEFAULT_API_VERSION,
    'ValidationJsonGenerator.API_VERSION 必须等于 JS DEFAULT_API_VERSION');
  assert.equal(apiVersionOf(readJava('generator', 'BasicBatchMetaGenerator.java')), DEFAULT_API_VERSION,
    'BasicBatchMetaGenerator.API_VERSION 必须等于 JS DEFAULT_API_VERSION');

  const cfgModel = readJava('model', 'ValidationConfig.java');
  assert.equal(/configVersion/i.test(cfgModel), false, 'Java 配置模型不应再有 configVersion');
  assert.equal(/compatibleApiVersions/i.test(cfgModel), false, 'Java 配置模型不应包含 compatibleApiVersions');
  const generator = readJava('generator', 'ValidationJsonGenerator.java');
  assert.equal(/\.configVersion\(/.test(generator), false, 'Java 生成器不应写 configVersion');
  assert.equal(/\.api\(/.test(generator), false, 'Java 生成器不应写 api 段');
});

test('落盘批次元数据：按配置白名单判定（v1 仅作为「版本不兼容」演示夹具）', () => {
  const shipped = normalizeCompatibleApiVersions(JSON.parse(read('config.json')).compatibleApiVersions);
  const batchesRoot = path.join(SRC_DIR, 'public', 'batches');
  const metas = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'batch-meta.json') metas.push(p);
    }
  })(batchesRoot);
  assert.ok(metas.length > 10, '样例批次数量异常：' + metas.length);
  const versions = metas.map((f) => ({ file: path.relative(SRC_DIR, f), v: JSON.parse(fs.readFileSync(f, 'utf8')).formatVersion }));
  versions.forEach(({ file, v }) => {
    if (shipped.includes(v)) return;
    // 不在白名单内的版本只能是 v1 演示夹具
    assert.equal(v, 1, file + ' 的 formatVersion=' + v + ' 既不在配置白名单内，也不是 v1 演示夹具');
  });
  assert.ok(versions.some((x) => x.v === 1), '应保留至少一个 v1 批次用于演示不兼容状态');
  assert.ok(versions.some((x) => shipped.includes(x.v)),
    '应至少有一个落在配置白名单内的批次');
});
