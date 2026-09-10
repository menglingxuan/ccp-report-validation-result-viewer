// 配置解析纯函数回归测试：租户 id / 端口优先级 / audit 开关。
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTenant, resolveServerPort, resolveAudit, sanitizeTenant } from '../lib/config.js';

test('resolveTenant：默认非租户；--tenant[=xxx] 开启；--no-tenant 强制关闭', () => {
  // 默认：非租户模式
  assert.deepEqual(resolveTenant(undefined, undefined, 'bob'), { enabled: false, id: null });
  // --no-tenant 强制关闭（覆盖环境变量）
  assert.deepEqual(resolveTenant(false, 'alice', 'bob'), { enabled: false, id: null });
  // --tenant alice 开启并指定 id
  assert.deepEqual(resolveTenant('alice', undefined, 'bob'), { enabled: true, id: 'alice' });
  // --tenant 不带参数 -> 当前系统用户名
  assert.deepEqual(resolveTenant('', undefined, 'bob'), { enabled: true, id: 'bob' });
  assert.deepEqual(resolveTenant('', undefined, ''), { enabled: true, id: 'default' });
  // 环境变量（非空）开启
  assert.deepEqual(resolveTenant(undefined, 'alice', 'bob'), { enabled: true, id: 'alice' });
  // 环境变量空串不开启
  assert.deepEqual(resolveTenant(undefined, '', 'bob'), { enabled: false, id: null });
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
