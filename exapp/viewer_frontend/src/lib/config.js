// 统一配置加载器：config.json + 环境变量覆盖 + 默认值合并。
import fs from 'node:fs';
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
  scan: { basedir: 'public/batches', out: 'public/batches-index.json', ignore: [], env: null },
  runType: 'dev',
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

export function loadConfig() {
  const configFile = resolveConfigFile();
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(fs.readFileSync(configFile, 'utf8')) || {};
  } catch (e) {
    // 配置文件缺失或非法时使用默认值
  }

  const cfg = mergeDeep(DEFAULTS, fileCfg);
  const env = process.env;

  if (env.REPORT_VIEWER_HOST) cfg.server.host = env.REPORT_VIEWER_HOST;
  if (env.REPORT_VIEWER_PORT) cfg.server.port = Number(env.REPORT_VIEWER_PORT);
  if (env.REPORT_VIEWER_WEBROOT) cfg.server.webRoot = env.REPORT_VIEWER_WEBROOT;
  if (env.REPORT_VIEWER_BASEDIR) cfg.scan.basedir = env.REPORT_VIEWER_BASEDIR;
  if (env.REPORT_VIEWER_OUT) cfg.scan.out = env.REPORT_VIEWER_OUT;
  if (env.REPORT_VIEWER_IGNORE) cfg.scan.ignore = env.REPORT_VIEWER_IGNORE.split(',').map((s) => s.trim()).filter(Boolean);
  if (env.REPORT_VIEWER_ENV !== undefined) cfg.scan.env = env.REPORT_VIEWER_ENV;
  if (!Array.isArray(cfg.scan.ignore)) cfg.scan.ignore = [];

  cfg.srcRoot = SRC_ROOT;
  cfg.server.webRootAbs = path.resolve(SRC_ROOT, cfg.server.webRoot);
  cfg.scan.basedirAbs = path.resolve(SRC_ROOT, cfg.scan.basedir);
  cfg.scan.outAbs = path.resolve(SRC_ROOT, cfg.scan.out);
  return cfg;
}

export default loadConfig;
