// 统一配置加载器：config.json + 环境变量覆盖 + 默认值合并。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const SRC_ROOT = path.dirname(LIB_DIR);
const CONFIG_FILE = path.join(SRC_ROOT, 'config.json');

// 解析当前生效的配置文件：
//   环境变量 REPORT_VIEWER_CONFIG=dev|test|prod  -> config-<name>.json
//   未指定或文件不存在时回退到 config.json
export function resolveConfigFile() {
  const name = String(process.env.REPORT_VIEWER_CONFIG || '').trim();
  if (name) {
    const candidate = path.join(SRC_ROOT, 'config-' + name + '.json');
    if (fs.existsSync(candidate)) return candidate;
  }
  return CONFIG_FILE;
}

const DEFAULTS = {
  server: { host: '127.0.0.1', port: 8123, webRoot: 'public' },
  // scan.basedir / scan.out 相对「租户数据根」解析（见 loadConfig），不再是相对 src/。
  scan: { basedir: 'batches', out: 'batches-index.json', ignore: [], env: null },
  runType: 'dev',
  // audit：是否启用租户 active 追踪与审查日志（默认关闭）。
  audit: false,
  // tenants[<id>] = { port?: number, dataRoot?: string }：每个租户可配置独立固定端口与数据根。
  tenants: {},
  urls: {
    data: 'report-validation-data.json',
    defaultData: 'report-validation-data-default.json',
    ignore: 'ignore-config-by-platform.json',
    batches: 'batches-index.json',
    scan: '/scan',
  },
};

function isPlain(o) {
  return o && typeof o === 'object' && !Array.isArray(o);
}

function mergeDeep(base, over) {
  const out = {};
  for (const k of Object.keys(base)) {
    out[k] = isPlain(base[k]) && isPlain(over && over[k]) ? mergeDeep(base[k], over[k]) : (over && over[k] !== undefined ? over[k] : base[k]);
  }
  if (over) for (const k of Object.keys(over)) if (!(k in base)) out[k] = over[k];
  return out;
}

// 租户模式解析（纯函数，便于测试）：返回 { enabled, id }。
//   - 默认（enabled=false）：非租户模式，共享 web 根下的批次数据。
//   - CLI --no-tenant（cliTenant === false）：强制非租户模式（最高优先级）。
//   - CLI --tenant[=xxx]（cliTenant 为字符串）：开启租户模式；空串表示未带参数，id 取当前系统用户名。
//   - 未给 CLI 旗标时由环境变量 REPORT_VIEWER_TENANT（非空）开启。
export function resolveTenant(cliTenant, envTenant, osUsername) {
  if (cliTenant === false) return { enabled: false, id: null };
  if (cliTenant !== undefined && cliTenant !== null) {
    const id = String(cliTenant).trim();
    const fallback = String(osUsername || '').trim() || 'default';
    return { enabled: true, id: id || fallback };
  }
  const env = envTenant === undefined || envTenant === null ? '' : String(envTenant).trim();
  if (env) return { enabled: true, id: env };
  return { enabled: false, id: null };
}

// 端口解析（纯函数，便于测试）：CLI --port > 环境变量 > 租户固定端口 > config 端口 > 默认值。
// 允许 0（随机端口）。
export function resolveServerPort(cliPort, envPort, tenantPort, filePort, fallbackPort) {
  const candidates = [cliPort, envPort, tenantPort, filePort];
  for (const v of candidates) {
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0 && n <= 65535) return n;
  }
  const fb = Number(fallbackPort);
  return Number.isInteger(fb) && fb >= 0 && fb <= 65535 ? fb : 8123;
}

// 租户 id 用作目录/文件名时需清洗非法字符。
export function sanitizeTenant(id) {
  return String(id).replace(/[\\/:*?"<>|]/g, '_');
}

// audit 开关解析（纯函数，便于测试）：CLI --audit/--no-audit > 环境变量 > config audit > 默认值。
export function resolveAudit(cliAudit, envAudit, cfgAudit, fallback) {
  if (cliAudit !== undefined && cliAudit !== null) return !!cliAudit;
  if (envAudit !== undefined && envAudit !== null) return !!envAudit;
  if (cfgAudit !== undefined && cfgAudit !== null) return !!cfgAudit;
  return !!fallback;
}

export function loadConfig(cli) {
  const configFile = resolveConfigFile();
  let fileCfg = {};
  try {
    // 兼容带 BOM 的配置文件（部分 Windows 编辑器/工具会写入 UTF-8 BOM）。
    let raw = fs.readFileSync(configFile, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    fileCfg = JSON.parse(raw) || {};
  } catch (e) {
    // 配置文件缺失或非法时使用默认值
  }

  const cfg = mergeDeep(DEFAULTS, fileCfg);
  const env = process.env;

  // 租户模式：默认非租户（共享 web 根数据）；--tenant[=xxx] / REPORT_VIEWER_TENANT 开启，--no-tenant 强制关闭。
  const tenantRes = resolveTenant(cli && cli.tenant, env.REPORT_VIEWER_TENANT, safeOsUsername());
  const tenantEnabled = tenantRes.enabled;
  const tenantId = tenantRes.id;
  const tenantCfg = tenantEnabled ? ((cfg.tenants && cfg.tenants[tenantId]) || {}) : {};

  // 端口优先级：CLI --port > 环境变量 > 租户固定端口 > config.json server.port > 默认值。
  cfg.server.port = resolveServerPort(cli && cli.port, env.REPORT_VIEWER_PORT, tenantCfg.port, cfg.server.port, DEFAULTS.server.port);
  if (env.REPORT_VIEWER_HOST) cfg.server.host = env.REPORT_VIEWER_HOST;
  if (cli && cli.host) cfg.server.host = String(cli.host);

  // audit 开关优先级：CLI --audit/--no-audit > 环境变量 REPORT_VIEWER_AUDIT > config audit > 默认 false。
  cfg.audit = resolveAudit(cli && cli.audit, parseAuditEnv(env.REPORT_VIEWER_AUDIT), cfg.audit, DEFAULTS.audit);

  if (env.REPORT_VIEWER_WEBROOT) cfg.server.webRoot = env.REPORT_VIEWER_WEBROOT;
  if (env.REPORT_VIEWER_IGNORE) cfg.scan.ignore = env.REPORT_VIEWER_IGNORE.split(',').map((s) => s.trim()).filter(Boolean);
  if (env.REPORT_VIEWER_ENV !== undefined) cfg.scan.env = env.REPORT_VIEWER_ENV;
  if (!Array.isArray(cfg.scan.ignore)) cfg.scan.ignore = [];

  // 数据根：租户模式 = 租户配置 dataRoot > 环境变量 > ~/.report-viewer/<tenant>；
  // 非租户模式 = 环境变量 > 程序 web 根（public，共享批次数据）。
  const dataRoot = path.resolve(String(
    tenantEnabled
      ? (tenantCfg.dataRoot || env.REPORT_VIEWER_DATA_ROOT || path.join(os.homedir(), '.report-viewer', sanitizeTenant(tenantId)))
      : (env.REPORT_VIEWER_DATA_ROOT || path.resolve(SRC_ROOT, cfg.server.webRoot))
  ));
  // active 追踪与活动日志写入「程序自身目录」，便于审查者统一访问（写在租户主目录会因权限无法审查）。
  // 仅当程序目录只读（如安装到 Program Files）时才回退到当前用户主目录。
  const reportHome = reportBaseDir();

  // 扫描目录：环境变量覆盖时保留原始值（绝对路径按原样；相对路径相对租户数据根解析，与 config 一致，
  // 避免把旧式的相对值如 public/batches-index.json 解析到程序目录而绕过租户隔离）。
  if (env.REPORT_VIEWER_BASEDIR) cfg.scan.basedir = env.REPORT_VIEWER_BASEDIR;
  if (env.REPORT_VIEWER_OUT) cfg.scan.out = env.REPORT_VIEWER_OUT;

  cfg.srcRoot = SRC_ROOT;
  cfg.server.webRootAbs = path.resolve(SRC_ROOT, cfg.server.webRoot);
  cfg.scan.basedirAbs = path.isAbsolute(cfg.scan.basedir) ? cfg.scan.basedir : path.resolve(dataRoot, cfg.scan.basedir);
  cfg.scan.outAbs = path.isAbsolute(cfg.scan.out) ? cfg.scan.out : path.resolve(dataRoot, cfg.scan.out);

  // 租户运行时信息：数据根 + active 追踪文件（心跳）+ 审查用活动日志。
  cfg.tenant = {
    enabled: tenantEnabled,
    id: tenantEnabled ? tenantId : null,
    dataRoot: dataRoot,
    activeFile: path.join(reportHome, 'active', sanitizeTenant(tenantEnabled ? tenantId : 'shared') + '.json'),
    activityLog: path.join(reportHome, 'activity.log'),
  };
  return cfg;
}

function safeOsUsername() {
  try {
    const n = os.userInfo().username;
    if (n && typeof n === 'string' && n.trim()) return n.trim();
  } catch (e) {}
  return 'default';
}

// active 追踪根目录：优先程序自身目录（src/.report-viewer），只读时回退用户主目录。
function reportBaseDir() {
  try {
    fs.accessSync(SRC_ROOT, fs.constants.W_OK);
    return path.join(SRC_ROOT, '.report-viewer');
  } catch (e) {
    return path.join(os.homedir(), '.report-viewer');
  }
}

// 解析 REPORT_VIEWER_AUDIT 环境变量为布尔（未设置返回 undefined）。
function parseAuditEnv(v) {
  if (v === undefined || v === null || v === '') return undefined;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export default loadConfig;
