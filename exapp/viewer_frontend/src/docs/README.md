# CCP Report Validation Result Viewer（前端查看器）

金融监管报告比较结果的**单页查看器**与**单一批次扫描服务**，两者已整合进同一个 Node HTTP 服务。

- 技术栈：原生 JavaScript（ES Modules）+ Node.js 内置模块（**零运行时依赖**）
- 运行时：Node.js **>= 24**
- 入口：`server.js`（静态站点 + 批次扫描 API 合二为一）

## 特性

- **保留原有全部 UI 风格**：11 套主题、11 列字段比较表、侧栏虚拟滚动、健康总览、全局搜索、字段对比（Compare）、消息忽略、批次 dock 面板等。
- **单文件 / 多文件数据模式**：
  - 单文件：一个 `report-validation-data.json` 包含全部 item。
  - 多文件：`report-validation-data.json` 为清单（manifest），每个 item 一个独立文件，支持**动态加载**、跨文件**搜索/筛选/统计**。
  - 所有近期功能（typed Ctx 标签/弹框、批次删除/收藏、新增徽章、可配置默认数据源、空数据占位等）均同时适配单文件与多文件模式。
- **每个 item 独立 ctx 定义**：`def` / `hits` / `type` 内联到每个 item（`item.ctxDefs`），不再全局共享。
  - `type`：`1` 字段映射规则 / `2` 值转换规则 / `3` 终值校验规则。
  - 主列表「命中Ctx」列展示所有 type 的 CtxKey，并按 type 着色（1 绿 / 2 青 / 3 紫）；字段详情页各规则 section 分别读取自身 type 的 CtxKey。
  - 「命中Ctx」标签单击即弹出定义/命中详情（主列表与详情页均可，弹框跟随标签，长文本/多行可滚动）。
- **默认数据源可配置**：`urls.defaultDataMode` 取值 `init`（加载 `report-validation-data-init.json`）、`default`（加载 `report-validation-data-default.json`）或某个已扫描批次名（加载该批次数据）；其他值等同 `default`。
  - 加载 init 空占位数据时，「运行环境」显示为空。
- **空占位数据**：`report-validation-data-init.json`（0 个 item）可临时改名为 default 文件，查看器展示友好空状态。
- **批次管理**：批次软删除（元数据 `deleted` 标记），可即时撤销/确认删除；删除后即时以删除样式区分，刷新/重启后不再展示；搜索/筛选/统计只作用于正常批次。
- **收藏夹**：
  - 按「包名」（`aa.bb.cc`）分层折叠收藏批次；入口位于批次 dock（★）。
  - 收藏/取消收藏会**回写批次元数据**（`favorite` 标记），扫描后仍保留。
  - 已收藏批次在批次列表卡片、docker 小卡片与「当前批次」徽章上显式显示 ★ 标记。
  - 记录**收藏时间**（悬停提示）；支持检测被收藏批次是否仍存在（缺失标记）。
  - 收藏超过 8 项时显示搜索框，可按「包名 / 批次名」简易搜索。
  - 收藏弹框默认提示包名示例为 `you.category.nickname`。
  - **收藏与删除互斥**：已收藏批次不能删除（需先取消收藏）；待删除批次不能收藏。
  - 收藏夹面板与批次面板互斥（打开一个自动隐藏另一个）。
- **「当前批次」徽章**：矩形卡片式 + 悬浮/点击弹出完整批次详情（解决长批次名无法完整显示的问题）。
- **可配置帮助入口**：docker 帮助文档 URL 由 `config.json` 的 `urls.help` 配置；帮助图标显隐由 `features.batchHelp`（true/false）控制。
- **配置切换**：`--config dev|test|prod`（或 `REPORT_VIEWER_CONFIG`）分别加载 `config-dev.json` / `config-test.json` / `config-prod.json`。
- **统一配置入口**：`config.json`（服务端 + 浏览器共用）。
- **数据准确性优先的缓存策略**：静态/数据文件统一返回强 `ETag` + `Cache-Control: no-cache`（每次加载强制重校验，304 不返回陈旧数据）；API 响应 `no-store`。前端用 **IndexedDB + ETag 条件请求**（`If-None-Match`）缓存数据文件，任何内容变更都会因 ETag 变化而重新拉取，**杜绝窜数据/错位**。
- **Gzip 压缩**：可压缩资源（HTML/CSS/JS/JSON/SVG/TXT）按需 gzip，`Vary: Accept-Encoding`。
- **扫描进度 SSE**：`GET /scan/progress`（`text/event-stream`）实时推送目录/批次/跳过计数；前端在「刷新批次」时订阅并在按钮上显示进度。
- **收藏夹服务端持久化**：`GET/POST /api/favorites` 共享收藏树（多用户一致，非管理员账号可写 `favorites.json`），localStorage 仅作离线回退。
- **计算 Worker**：健康总览与全局搜索等重计算移到 Web Worker（`worker.js`，复用 `core.js` 纯函数），失败自动回退主线程同步计算。
- **纯函数核心拆分**：`public/core.js` 承载无副作用纯函数（搜索/排序/过滤/差异 diff/忽略 key/健康统计/全局搜索），主线程与 Worker 共用，并由 Node 测试直接导入回归。
- **深链接增强**：URL hash 除 `item/ch/tab/q/result/page` 外，新增 `sort`、`cols`（列可见性）、`filters`（列过滤器 JSON），可完整还原视图状态。
- **键盘导航**：字段表与消息表行可聚焦（↑/↓ 移动、`Enter` 打开字段详情、`Space` 切换忽略）。
- **数据校验**：`lib/validate.js` 校验数据文件顶层结构（单文件/多文件），服务启动时对默认数据文件告警。
- **独立打包部署**：`npm pack` / `npx report-viewer` 即可运行。

## 环境要求

- Node.js >= 24（推荐 LTS）

## 快速开始

```bash
# 开发运行（默认加载 config.json）
node server.js

# 切换配置：dev / test / prod 分别加载 config-dev.json / config-test.json / config-prod.json
node server.js --config dev
node server.js --config test
node server.js --config prod

# 等价于环境变量
REPORT_VIEWER_CONFIG=prod node server.js

# 或通过 npm script
npm start
```

浏览器打开 <http://127.0.0.1:8123>。

### 打包与独立部署

```bash
npm pack                       # 生成 ccp-report-validation-result-viewer-6.0.0.tgz
npm install -g <tgz 文件>       # 全局安装
report-viewer                  # 任意目录启动（内置默认数据）
```

## npm scripts

| 命令 | 说明 |
| --- | --- |
| `npm start` / `npm run dev` | 启动服务（`node server.js`） |
| `npm run scan` | 手动触发一次批次扫描（CLI） |
| `npm run generate` | 重新生成样例数据文件（单文件模式） |
| `npm test` | 运行全部测试（`node --test`） |

## HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/` | 查看器首页 |
| `GET` | `/config.json` | 统一配置 |
| `POST` / `GET` | `/scan` | 触发一次完整批次扫描（同步返回结果） |
| `GET` | `/scan/progress` | 扫描进度 SSE（`text/event-stream`） |
| `POST` | `/api/batch` | 批次标记写回（body：`{ "batchId": "...", "deleted": true }` 或 `{ "batchId": "...", "favorite": true }`） |
| `GET` / `POST` | `/api/favorites` | 收藏夹读取 / 整树保存（body：`{ "favorites": {...} }`） |
| `GET` | `/status` / `/health` | 服务状态与当前配置 |

## 项目结构

```
src/
├── server.js                  # 统一 HTTP 服务入口（静态站点 + 扫描 API）
├── config.json                # 统一配置（服务端 + 浏览器共用）
├── package.json
├── lib/
│   ├── config.js              # 配置加载器（config.json + 环境变量）
│   ├── scanner.js             # 批次扫描器（异步，带 onProgress 进度回调）
│   ├── validate.js            # 数据校验器（validateDataset / validateFile）
│   └── sample-data.js         # 样例数据生成器（buildDataset / splitToFiles）
├── public/                    # Web 根目录（静态资源与数据）
│   ├── index.html             # 查看器页面（UI 结构与样式）
│   ├── app.js                 # 查看器逻辑（ES 模块，UI 与状态）
│   ├── core.js                # 纯函数核心（无副作用，主线程/Worker/测试共用）
│   ├── worker.js              # 计算 Worker（健康总览 / 全局搜索）
│   ├── themes.css / i18n.json / batch-help.json
│   ├── report-validation-data.json            # 主数据文件（单文件或多文件清单）
│   ├── report-validation-data-default.json    # 默认模板数据
│   ├── ignore-config-by-platform.json         # 忽略配置
│   ├── batches-index.json                     # 批次索引（扫描输出）
│   └── batches/               # 批次目录（扫描 basedir）
├── tools/
│   └── generate-sample-data.js
├── test/
│   ├── pure-logic.test.js     # 纯函数回归测试
│   ├── scanner.test.js        # 扫描器测试
│   ├── validate.test.js       # 数据校验器测试
│   └── server.test.js         # 服务集成测试
└── docs/
    ├── README.md
    ├── CONFIG.md
    └── DATA_SCHEMA.md
```

## 配置

统一配置见 `config.json`，完整说明见 [`docs/CONFIG.md`](CONFIG.md)。环境变量（可选覆盖）：

| 环境变量 | 对应配置 |
| --- | --- |
| `REPORT_VIEWER_HOST` / `REPORT_VIEWER_PORT` / `REPORT_VIEWER_WEBROOT` | `server.*` |
| `REPORT_VIEWER_BASEDIR` / `REPORT_VIEWER_OUT` / `REPORT_VIEWER_ENV` / `REPORT_VIEWER_IGNORE` | `scan.*` |

## 数据模式

数据文件结构见 [`docs/DATA_SCHEMA.md`](DATA_SCHEMA.md)。关键点：

- `report-validation-data.json` 顶层 `"mode"` 为 `"single"` 或 `"multi"`。
- 多文件模式：清单中的每个 item 带 `file` 与预计算 `summary`，查看器动态加载 item 文件；搜索/筛选/统计仍作用于全部 item 的合并数据。
- 每个 item 内联 `ctxDefs`（`def` / `hits`）。

## 生成样例数据

```bash
node tools/generate-sample-data.js            # 单文件模式
node tools/generate-sample-data.js --split    # 多文件模式（清单 + data/items/*.json）
```

## License

MIT
