// 数据 JSON 输出策略（单点，避免各工具各写一套）。
//
// 为什么默认**紧凑**（无缩进）：
//   缩进只服务于人类阅读，却要占文件体积的 40%~45%（实测样例 4.57 MB → 2.69 MB），
//   而真实数据由 Java 生成器写出（`MAPPER.writeValueAsString`，本来就是紧凑的），
//   JS 侧工具此前用 `JSON.stringify(obj, null, 2)`，导致同一种数据两种体积。
//   查看器只解析内容、不看缩进；排查时可用 `--pretty` 生成缩进版（或 `node -e` 格式化）。
//
// 例外：`batches-index.json`（索引，几十 KB、人也会看）、`favorites.json` / `batch-meta.json` /
// 租户配置等**用户态小文件**仍由各自实现写成缩进版，便于手工编辑与 diff。
import fs from 'node:fs';
import path from 'node:path';

// 序列化为文件内容：紧凑 + 结尾换行（POSIX 习惯，git 不报 "no newline at end of file"）。
export function stringifyJSON(obj, opts) {
  const pretty = !!(opts && opts.pretty);
  return (pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj)) + '\n';
}

// 写入文件（自动建目录）。返回写入的 UTF-8 字节数与字符数，便于工具打印体积。
export function writeJSON(file, obj, opts) {
  const text = stringifyJSON(obj, opts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  return { bytes: Buffer.byteLength(text, 'utf8'), chars: text.length };
}
