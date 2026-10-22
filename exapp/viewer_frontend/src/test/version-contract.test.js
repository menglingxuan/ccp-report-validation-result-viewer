// 契约版本号回归测试：
//   - 数据契约版本（batch-meta.json#formatVersion）与配置结构版本（config.json#configVersion）是两套独立版本号；
//   - 查看器白名单、扫描器默认值、生成器、Java 常量必须一致（这是「两边都设为 3 却报不兼容」的根因）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CURRENT_FORMAT_VERSION, SUPPORTED_FORMAT_VERSIONS,
  CURRENT_CONFIG_VERSION, SUPPORTED_CONFIG_VERSIONS,
  formatVersionSupported, configVersionSupported,
} from '../public/core.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.dirname(TEST_DIR);
const REPO_ROOT = path.resolve(SRC_DIR, '..', '..', '..');

const read = (rel) => fs.readFileSync(path.join(SRC_DIR, rel), 'utf8');

test('数据契约版本：当前版本必须在支持列表内，且 v2 / v3 都兼容', () => {
  assert.equal(SUPPORTED_FORMAT_VERSIONS.includes(CURRENT_FORMAT_VERSION), true,
    'CURRENT_FORMAT_VERSION 必须在 SUPPORTED_FORMAT_VERSIONS 里');
  assert.deepEqual(SUPPORTED_FORMAT_VERSIONS, [2, 3], '当前支持 v2 / v3');
  assert.equal(formatVersionSupported(2), true, 'v2 批次仍可加载');
  assert.equal(formatVersionSupported(3), true, 'v3 批次可加载（本轮修复点）');
  assert.equal(formatVersionSupported(1), false, 'v1 不支持');
  assert.equal(formatVersionSupported(4), false, 'v4（未来版本）不支持，需显式加入白名单');
  assert.equal(formatVersionSupported(undefined), true, '缺省按当前版本处理，视为兼容');
  assert.equal(formatVersionSupported(null), true, 'null 按缺省处理');
});

test('配置结构版本：与数据契约版本解耦，互不影响', () => {
  assert.equal(SUPPORTED_CONFIG_VERSIONS.includes(CURRENT_CONFIG_VERSION), true);
  assert.equal(configVersionSupported(3), true, 'configVersion=3 被支持');
  assert.equal(configVersionSupported(2), true, 'configVersion=2 仍被支持');
  assert.equal(configVersionSupported(99), false, '更高的 configVersion 只告警');
  // 两套版本号互不参与：configVersion 高不代表批次不兼容，反之亦然。
  assert.equal(formatVersionSupported(3), true);
  assert.equal(configVersionSupported(3), true);
});

test('落盘配置：四份 config*.json 的 configVersion 都在支持列表内', () => {
  ['config.json', 'config-dev.json', 'config-test.json', 'config-prod.json'].forEach((name) => {
    const cfg = JSON.parse(read(name));
    assert.equal(configVersionSupported(cfg.configVersion), true, name + ' 的 configVersion 应被支持');
  });
});

test('查看器 / 扫描器 / 生成器都使用 core.js 的版本常量（禁止各自写死）', () => {
  const app = read('public/app.js');
  assert.match(app, /formatVersionSupported\(b && b\.formatVersion\)/,
    'app.js 的 batchCompatible 必须走共享的 formatVersionSupported');
  assert.equal(/const SUPPORTED_FORMAT_VERSIONS = \[/.test(app), false,
    'app.js 不得再自行写死 SUPPORTED_FORMAT_VERSIONS');

  const scanner = read('lib/scanner.js');
  assert.match(scanner, /import \{ CURRENT_FORMAT_VERSION \} from '\.\.\/public\/core\.js'/,
    'scanner.js 应引用 CURRENT_FORMAT_VERSION');
  assert.match(scanner, /formatVersion: typeof meta\.formatVersion === 'number' \? meta\.formatVersion : CURRENT_FORMAT_VERSION/,
    '扫描器缺省 formatVersion 应取当前契约版本');

  ['tools/generate-sample-data.js', 'tools/verify-multi-mode.mjs'].forEach((rel) => {
    const src = read(rel);
    assert.match(src, /CURRENT_FORMAT_VERSION/, rel + ' 应引用 CURRENT_FORMAT_VERSION');
    assert.equal(/formatVersion: 2\b/.test(src), false, rel + ' 不应再写死 formatVersion: 2');
  });
});

test('Java 侧 ContractVersion 与 core.js 保持一致', () => {
  const java = fs.readFileSync(path.join(
    REPO_ROOT, 'src', 'main', 'java', 'com', 'otcc', 'viewer', 'model', 'ContractVersion.java'), 'utf8');
  const num = (name) => {
    const m = java.match(new RegExp('int ' + name + '\\s*=\\s*(\\d+)'));
    return m ? Number(m[1]) : null;
  };
  assert.equal(num('FORMAT_VERSION'), CURRENT_FORMAT_VERSION, 'Java FORMAT_VERSION 必须等于 JS CURRENT_FORMAT_VERSION');
  assert.equal(num('CONFIG_VERSION'), CURRENT_CONFIG_VERSION, 'Java CONFIG_VERSION 必须等于 JS CURRENT_CONFIG_VERSION');
  const listMatch = java.match(/SUPPORTED_FORMAT_VERSIONS\s*=\s*\{([^}]*)\}/);
  assert.ok(listMatch, 'Java 应声明 SUPPORTED_FORMAT_VERSIONS');
  const javaList = listMatch[1].split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
  assert.deepEqual(javaList, SUPPORTED_FORMAT_VERSIONS, 'Java 白名单必须与 JS 白名单一致');
});

test('落盘批次元数据：v2 / v3 可加载，v1 仅作为「版本不兼容」演示夹具存在', () => {
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
    assert.equal([1, 2, 3].includes(v), true, file + ' 的 formatVersion=' + v + ' 不在 1/2/3 之内');
    if (v !== 1) {
      assert.equal(formatVersionSupported(v), true, file + ' 的 formatVersion=' + v + ' 应可加载');
    }
  });
  // v1 是「版本不兼容」UI（红徽章 / 仅看兼容 / 强制加载）的演示夹具，必须保留。
  assert.ok(versions.some((x) => x.v === 1), '应保留至少一个 v1 批次用于演示不兼容状态');
  assert.ok(versions.some((x) => x.v === 3), '应至少有一个 v3 批次（当前契约版本）');
});
