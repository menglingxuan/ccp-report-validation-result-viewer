// 「在系统文件管理器中打开目录」的平台适配。
//
// 关键点：**不要依赖 PATH 查找可执行文件**。
// 某些环境（例如 PATH 中存在形如 `"E:\jdk\bin\server` 的未闭合引号条目）会让
// Node/libuv 的 PATH 搜索整体失效，`spawn('explorer.exe')` 直接报 ENOENT
// （连 `cmd.exe` 也解析不到），而系统本身完全能正常打开目录。
// 因此这里优先使用绝对路径（Windows: %SystemRoot%\explorer.exe）。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 返回「打开目录」可执行文件的候选列表（按优先级）。
 * @param {string} platform process.platform
 * @param {NodeJS.ProcessEnv} env 进程环境变量
 */
export function fileManagerCandidates(platform, env) {
  const e = env || {};
  if (platform === 'win32') {
    const root = e.SystemRoot || e.WINDIR || 'C:\\Windows';
    return [path.join(root, 'explorer.exe')];
  }
  if (platform === 'darwin') return ['/usr/bin/open', 'open'];
  return ['/usr/bin/xdg-open', '/usr/local/bin/xdg-open', 'xdg-open'];
}

/**
 * 选出第一个真实存在的候选；都不存在时回退到首选（让 spawn 报错并向上传递）。
 * @param {string} platform
 * @param {NodeJS.ProcessEnv} env
 * @param {(p: string) => boolean} [exists] 便于测试注入
 */
export function pickFileManager(platform, env, exists) {
  const has = exists || function (p) { try { return fs.existsSync(p); } catch (err) { return false; } };
  const cands = fileManagerCandidates(platform, env);
  for (let i = 0; i < cands.length; i++) {
    try { if (has(cands[i])) return cands[i]; } catch (err) { /* 忽略，继续尝试 */ }
  }
  return cands[0];
}

/**
 * 在文件管理器中打开目录。
 * - 成功（触发 spawn 事件）时 resolve 实际使用的命令；
 * - 失败（error 事件，如 ENOENT/EPERM）时 reject —— 不再静默吞掉错误。
 * @param {string} dir 目录绝对路径
 * @param {{platform?: string, env?: NodeJS.ProcessEnv, exists?: (p: string) => boolean, spawn?: Function}} [opts]
 * @returns {Promise<string>}
 */
export function openInFileManager(dir, opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;
  const env = o.env || process.env;
  const spawnFn = o.spawn || spawn;
  const cmd = pickFileManager(platform, env, o.exists);
  return new Promise(function (resolve, reject) {
    let child;
    try {
      child = spawnFn(cmd, [dir], { detached: true, stdio: 'ignore' });
    } catch (e) {
      reject(e);
      return;
    }
    child.once('error', function (e) { reject(e); });
    child.once('spawn', function () {
      try { child.unref(); } catch (e) { /* 忽略 */ }
      resolve(cmd);
    });
  });
}
