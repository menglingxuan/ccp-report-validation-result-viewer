// lib/reveal.js 单元测试：Launcher 解析（不依赖 PATH）与错误传播（不真正启动文件管理器）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fileManagerCandidates, pickFileManager, openInFileManager } from '../lib/reveal.js';

test('fileManagerCandidates：Windows 用 SystemRoot 绝对路径（不依赖 PATH）', () => {
  assert.deepEqual(fileManagerCandidates('win32', { SystemRoot: 'D:\\Win' }), ['D:\\Win\\explorer.exe']);
  assert.deepEqual(fileManagerCandidates('win32', { WINDIR: 'C:\\WINDOWS' }), ['C:\\WINDOWS\\explorer.exe']);
  assert.deepEqual(fileManagerCandidates('win32', {}), ['C:\\Windows\\explorer.exe']);
  assert.deepEqual(fileManagerCandidates('darwin', {}), ['/usr/bin/open', 'open']);
  assert.ok(fileManagerCandidates('linux', {}).includes('/usr/bin/xdg-open'));
});

test('pickFileManager：选第一个存在的候选，都不存在时回退首选', () => {
  assert.equal(pickFileManager('darwin', {}, (p) => p === '/usr/bin/open'), '/usr/bin/open');
  assert.equal(pickFileManager('linux', {}, () => false), '/usr/bin/xdg-open');
  assert.equal(pickFileManager('win32', { SystemRoot: 'D:\\Win' }, (p) => p === 'D:\\Win\\explorer.exe'), 'D:\\Win\\explorer.exe');
});

test('openInFileManager：成功时 resolve 实际使用的命令、detached 且 unref', async () => {
  let captured = null;
  const fakeSpawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.unref = () => { child.__unref = true; };
    captured = { cmd, args, opts, child };
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
  const used = await openInFileManager('E:\\batches\\b1', {
    platform: 'win32', env: { SystemRoot: 'D:\\Win' }, exists: () => true, spawn: fakeSpawn,
  });
  assert.equal(used, 'D:\\Win\\explorer.exe');
  assert.deepEqual(captured.args, ['E:\\batches\\b1']);
  assert.equal(captured.opts.detached, true);
  assert.equal(captured.child.__unref, true, '应 unref 以免阻塞进程退出');
});

test('openInFileManager：spawn 报错（如 ENOENT）时 reject，不再静默吞掉', async () => {
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.unref = () => {};
    queueMicrotask(() => child.emit('error', new Error('spawn explorer.exe ENOENT')));
    return child;
  };
  await assert.rejects(
    () => openInFileManager('E:\\batches\\b1', { spawn: fakeSpawn, exists: () => true }),
    /ENOENT/,
  );
});

test('openInFileManager：spawn 同步抛异常时 reject', async () => {
  await assert.rejects(
    () => openInFileManager('E:\\batches\\b1', { spawn: () => { throw new Error('boom'); }, exists: () => true }),
    /boom/,
  );
});
