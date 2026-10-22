// 清理仓库根目录的本地构建/运行产物（均可重新生成，不进版本库）。
//
//   node tools/clean.js            # 清理默认列表
//   node tools/clean.js --all      # 额外清理 Maven 的 target/
//
// 默认列表：bin/ build/ .gradle/ generated/ logs/ .apt_generated*/ .apt_generated_tests/
// 说明：generated/ 是 Java 测试的落盘目录（相对 maven 进程 cwd，即仓库根），
//       与 build/ bin/ 一样属于「跑一次就回来」的产物，所以一并清理。
// 注意：本脚本只删上面列出的目录，public/ 与 batches/ 一律不碰。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.dirname(TOOLS_DIR);
// src -> viewer_frontend -> exapp -> <repo root>
const REPO_ROOT = path.resolve(SRC_ROOT, '..', '..', '..');

const DEFAULT_TARGETS = ['bin', 'build', '.gradle', 'generated', 'logs', '.apt_generated', '.apt_generated_tests'];
const ALL_EXTRA = ['target'];

const argv = process.argv.slice(2);
const targets = argv.includes('--all') ? DEFAULT_TARGETS.concat(ALL_EXTRA) : DEFAULT_TARGETS;

function removeDir(dir) {
  if (!fs.existsSync(dir)) return { name: path.basename(dir), removed: false, bytes: 0 };
  const bytes = sizeOf(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  return { name: path.basename(dir), removed: true, bytes };
}

function sizeOf(p) {
  const st = fs.lstatSync(p);
  if (!st.isDirectory()) return st.size;
  let total = 0;
  for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
    const child = path.join(p, entry.name);
    try {
      total += sizeOf(child);
    } catch (e) {
      // 符号链接 / 正在被占用的文件：跳过计数，不影响删除
    }
  }
  return total;
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

let removedCount = 0;
let removedBytes = 0;
for (const name of targets) {
  const res = removeDir(path.join(REPO_ROOT, name));
  if (res.removed) {
    removedCount++;
    removedBytes += res.bytes;
    console.log('  removed  ' + name + '/  (' + mb(res.bytes) + ')');
  }
}
console.log(removedCount ? 'clean: ' + removedCount + ' dir(s), ' + mb(removedBytes) + ' freed' : 'clean: nothing to remove');
