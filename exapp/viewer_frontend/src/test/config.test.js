// 配置解析纯函数回归测试：租户 id / 端口优先级 / audit 开关。
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTenantId, resolveServerPort, resolveAudit, sanitizeTenant } from '../lib/config.js';

test('resolveTenantId：CLI > 环境变量 > 系统用户名', () => {
  assert.equal(resolveTenantId('alice', undefined, 'bob'), 'alice');
  assert.equal(resolveTenantId(undefined, 'alice', 'bob'), 'alice');
  assert.equal(resolveTenantId(undefined, undefined, 'bob'), 'bob');
  assert.equal(resolveTenantId('', '', ''), 'default');
});

test('resolveServerPort：CLI > 环境变量 > 租户固定端口 > 文件端口 > 默认值', () => {
  // CLI 优先级最高
  assert.equal(resolveServerPort('9001', '9002', '9003', '9004', '9005'), 9001);
  // 环境变量次之
  assert.equal(resolveServerPort(undefined, '9002', '9003', '9004', '9005'), 9002);
  // 租户固定端口
  assert.equal(resolveServerPort(undefined, undefined, '9003', '9004', '9005'), 9003);
  // 文件端口
  assert.equal(resolveServerPort(undefined, undefined, undefined, '9004', '9005'), 9004);
  // 默认值
  assert.equal(resolveServerPort(undefined, undefined, undefined, undefined, '9005'), 9005);
  // 0 表示随机端口，合法
  assert.equal(resolveServerPort('0', undefined, undefined, undefined, '9005'), 0);
  // 非法值忽略，回退默认
  assert.equal(resolveServerPort('abc', undefined, undefined, undefined, '9005'), 9005);
});

test('sanitizeTenant：清洗文件系统非法字符', () => {
  assert.equal(sanitizeTenant('DOMAIN\\user'), 'DOMAIN_user');
  assert.equal(sanitizeTenant('a/b:c'), 'a_b_c');
});

test('resolveAudit：CLI > 环境变量 > config > 默认值（默认关闭）', () => {
  // CLI 优先级最高
  assert.equal(resolveAudit(true, false, false, false), true);
  assert.equal(resolveAudit(false, true, true, true), false);
  // 环境变量次之
  assert.equal(resolveAudit(undefined, true, false, false), true);
  assert.equal(resolveAudit(undefined, false, true, true), false);
  // config
  assert.equal(resolveAudit(undefined, undefined, true, false), true);
  // 默认值
  assert.equal(resolveAudit(undefined, undefined, undefined, false), false);
  assert.equal(resolveAudit(undefined, undefined, undefined, true), true);
});
