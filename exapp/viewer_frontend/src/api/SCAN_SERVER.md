# scan-server —— 批次自动扫描接口

前端「最近批次」面板 / 左侧 docker 点击 **重新扫描（⟳）** 时，会先调用本接口；
本接口内部自动执行 `scan-batches.js` 扫描批次目录，扫描完成后前端再重新读取 `batches-index.json`。

## 文件清单

| 文件 | 说明 |
| --- | --- |
| `scan-server.js` | HTTP 接口服务（零依赖，仅用 Node 内置模块） |
| `scan-server.config.json` | 服务配置（含 scan-batches.js 的选项） |
| `scan-batches.js` | 既有批次扫描脚本 |
| `engine/batches-index.json` | 扫描输出（前端读取） |
| `engine/report-validation-config.json` | 前端配置，`urls.scan` 指向本接口 |

## 服务配置

`scan-server.config.json` 里的配置项（**服务配置，非接口参数**）对应 `scan-batches.js` 的选项：

| 配置项 | 对应脚本选项 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `scanScript` | - | `scan-batches.js` | 扫描脚本文件名 |
| `basedir` | `--basedir` | `test/batches` | 批次根目录（相对 `viewer_frontend/`） |
| `out` | `--out` | `engine/batches-index.json` | 索引输出路径（相对 `viewer_frontend/`） |
| `ignore` | `--ignore` | `[]` | 排除目录的正则数组（可多个） |
| `env` | `--env` | `null` | 仅扫描指定 `reportEnv` 的批次；null = 全部 |
| `host` | - | `127.0.0.1` | 监听地址 |
| `port` | - | `8123` | 监听端口 |
| `timeoutMs` | - | `120000` | 单次扫描超时（毫秒） |

> `scanScript` / `basedir` / `out` 均支持**绝对路径**（如 `E:/repos/.../test/batches`）或相对路径
> （相对路径以 `viewer_frontend/` 为基准）。服务与扫描脚本内部均使用 `path.resolve` 处理，
> 传入绝对路径时会原样使用，不会被拼接前缀。

### 环境变量覆盖

配置优先级：**环境变量 > 配置文件 > 内置默认值**。

| 环境变量 | 对应配置项 |
| --- | --- |
| `SCAN_SERVER_HOST` | `host` |
| `SCAN_SERVER_PORT` | `port` |
| `SCAN_SERVER_BASEDIR` | `basedir` |
| `SCAN_SERVER_OUT` | `out` |
| `SCAN_SERVER_ENV` | `env` |
| `SCAN_SERVER_IGNORE` | `ignore`（逗号分隔，追加到配置项） |
| `SCAN_SERVER_TIMEOUT` | `timeoutMs` |

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` / `GET` | `/scan` | 触发一次完整扫描（同步等待扫描完成，返回结果） |
| `GET` | `/status` | 服务状态 + 当前配置 + 上次扫描结果 |

`POST /scan` 成功返回示例：

```json
{
  "ok": true,
  "exitCode": 0,
  "durationMs": 187,
  "count": 20,
  "stdout": "扫描 basedir：...\nOK: 扫描 20 个目录...",
  "stderr": "",
  "error": null
}
```

已有扫描进行中时返回 `409`；扫描失败返回 `500` 并带 `error`。

## 部署与启动

在 `exapp/viewer_frontend/` 目录下执行：

### 1. 前台运行（开发调试）

```powershell
node scan-server.js
```

看到 `[scan-server] 已启动：http://127.0.0.1:8123` 即成功。

### 2. 后台运行（Windows）

```powershell
Start-Process -WindowStyle Hidden node -ArgumentList "scan-server.js"
```

### 3. 后台运行（Linux / macOS）

```bash
nohup node scan-server.js > scan-server.log 2>&1 &
```

### 4. 开机自启（Windows，可选）

用 [nssm](https://nssm.cc/) 注册为服务：

```powershell
nssm install ScanServer "C:\path\to\node.exe" "C:\path\to\scan-server.js"
nssm set ScanServer AppDirectory "C:\path\to\exapp\viewer_frontend"
nssm start ScanServer
```

### 5. 进程守护（可选）

用 pm2：

```bash
pm2 start scan-server.js --name scan-server
pm2 save
```

## 前端如何接入

`engine/report-validation-config.json` 中 `urls.scan` 已配置为 `http://127.0.0.1:8123/scan`。
前端 `reloadBatchesIndex()` 会：

1. `POST` 到 `urls.scan`，等待接口内部完成扫描；
2. 再重新读取 `batches-index.json` 并刷新面板 / docker；
3. 若接口未启动（请求失败），会显示「自动扫描失败」提示，并**仍会重新读取现有索引**，不阻塞正常查看。

> 注意：接口需在扫描脚本能正确产出 `engine/batches-index.json` 的目录下运行，
> 即 `basedir` / `out` 配置应与 `scan-batches.js` 的实际输出位置一致。
