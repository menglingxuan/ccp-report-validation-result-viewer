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
  - 所有近期功能（typed Ctx 标签/弹框、批次删除/收藏、新增徽章、可配置默认数据源、空数据占位、来源渠道筛选、字段详情左右导航与规则折叠等）均同时适配单文件与多文件模式。
- **每个 item 独立 ctx 定义**：`id` / `scopes` / `type` / `def` / `hits` 内联到每个 item（`item.ctxDefs`），不再全局共享。
  - `scopes` 为**数组**：`[1]` 字段映射规则 / `[2]` 值转换规则 / `[3]` 终值校验规则；同一 ctx 可配置在多种规则中；`type` 为 `builtin`（内置）/ `user`（用户自定义）。
  - 主列表「命中Ctx」列展示各规则 `ctxs` 的 id 并集（解析为 CtxKey），统一使用主题配色标签；字段详情页各规则 section 直接展示各自 `ctxs` 的 id 引用。
  - 「命中Ctx」标签单击即弹出定义/命中详情（主列表与详情页均可，弹框跟随标签，长文本/多行可滚动），命中详情内展示该 CtxKey 的**全部 scopes** 徽章。
- **字段定义注册表在 report channel 级别**：`channel.fields`（`id` / `name` / `userTag` / `type`）每个报告渠道各自维护（不同渠道的字段定义不同）；比较字段通过 `id` 关联所在渠道的注册表。
- **默认数据源可配置**：`urls.defaultDataMode` 取值 `init`（加载 `report-validation-data-init.json`）、`default`（加载 `report-validation-data-default.json`）或某个已扫描批次名（加载该批次数据）；其他值等同 `default`。
  - 加载 init 空占位数据时，「运行环境」显示为空。
- **空占位数据**：`report-validation-data-init.json`（0 个 item）可临时改名为 default 文件，查看器展示友好空状态。
- **批次管理**：批次软删除（元数据 `deleted` 标记），可即时撤销/确认删除；删除后即时以删除样式区分，刷新/重启后默认不再展示；搜索/筛选/统计默认只作用于正常批次。
  - 批次面板右上角的范围按钮为**三态循环**：`≡` 全部批次 → `✓` 仅看兼容 → `🗑` 全部批次(含已删除) → `≡`。
  - 「全部批次(含已删除)」范围会展示带 `deleted` 标记的批次（批次名置灰 + 「已删除」徽章），可查看详情、参与排序/搜索/筛选，但**不支持加载 / 收藏 / 删除 / 钉住**等操作。
  - 扫描器不再跳过 `deleted` 批次，而是带上 `deleted` 标记写入 `batches-index.json`（因此服务端 `POST /api/batch { deleted: false }` 可恢复）。
- **批次标签（`tags`）**：`batch-meta.json` 的 `tags` 字符串数组（去空白 / 去重 / 单个 ≤ 24 字符 / 最多 12 个），在列表卡片与详情中展示（卡片中位于 item 数量标签之前）。
  - 筛选面板在「报告环境」下方新增「按标签筛选」下拉（选项从当前范围的批次标签去重收集）。
- **批次编辑（✎，仅兼容批次）**：列表卡片提供铅笔入口，可同时编辑**批次名 / 批次描述（多行）/ 标签**，保存后经 `POST /api/batch` 直接回写 `batch-meta.json`（不兼容与已删除批次不提供该入口，也拒绝保存）。
  - **批次名允许重复**：若输入的名称与其它批次重名，编辑器仅给出告警（列出同名批次 ID）且**不阻止保存**——与 `urls.defaultDataMode` 按批次名解析时取首个匹配的现状一致；批次名为空则不提交（服务端也返回 400）。
- **批次目录双击打开**：批次详情中的「批次目录」支持双击，经 `POST /api/reveal` 在系统文件管理器中打开该目录（`features.revealPath`：dev/test 默认开启，prod 默认关闭；路径限定在批次根目录内）。Launcher 用**系统绝对路径**解析（Windows 用 `%SystemRoot%\explorer.exe`，不依赖 `PATH` —— 某些环境下 `PATH` 含畸形条目会让 Node 的 PATH 查找整体失效，`spawn('explorer.exe')` 直接 ENOENT）；启动失败会如实返回 500 并在页面上提示，不再无声无息。
- **版本兼容性合并到版本号标签**：批次列表卡片、dock 悬停小卡片与批次详情的标签行统一由 `batchBadgesHTML` 渲染，不再单独展示「版本兼容 / 版本不兼容」标签，兼容性以版本号标签的配色 + title 提示表达；详情标签与卡片一致（仅不含 item 数量标签）。
- **Item 关联属性浮层（hover 展示）**：主列表「报告日期」左侧的 item id **鼠标悬停**即弹出（原为点击），移出后延迟收起；鼠标进入浮层内部保持展开，便于点击复制。浮层首行为带标签的 `Item ID` 行并附复制按钮（其余行为对手方 Item ID / 平台 Trade ID / 平台 Trade Deal ID，均带复制按钮）。
- **激活筛选标签（chips）与「清除全部」**：
  - Item 列表（左栏）与批次列表都会在列表上方显示当前激活的筛选标签（Item：状态 / 平台 / 产品 / TradeId；批次：名称 / 命令行 / 描述 / 日期 / 环境 / 标签），主列表字段筛选同样沿用该样式。批次标签位于列表上方的**独立区域**（在拖动标记之上，不随列表高度拖拽变化，无标签时自动收起）。
  - 标签数 **> 1** 时额外显示「清除全部」，一键清除全部标签并重置对应筛选状态与分页；单个标签仍可用自身 ✕ 移除。
  - Item 列表的标签区高度变化后会自动重算列表起始位置（`renderSidebarChips` → `layoutSidebarList`），避免首个 item 被标签遮挡。
- **收藏夹**：
  - 按「包名」（`aa.bb.cc`）分层折叠收藏批次；入口位于批次 dock（★）。
  - 收藏/取消收藏会**回写批次元数据**（`favorite` 标记），扫描后仍保留。
  - 已收藏批次在批次列表卡片、docker 小卡片与「当前批次」徽章上显式显示 ★ 标记。
  - 记录**收藏时间**（悬停提示）；支持检测被收藏批次是否仍存在（缺失标记）。
  - 收藏超过 8 项时显示搜索框，可按「包名 / 批次名」简易搜索。
  - 收藏弹框默认提示包名示例为 `you.category.nickname`。
  - 列表卡片的 ★/☆ 按钮是**开关**：未收藏时弹出「收藏批次」（选择包名）；已收藏时弹出**取消收藏二次确认**（列出该批次所在的收藏包，确认后从所有收藏包移除，取消则不改动）。
  - 收藏夹条目交互：**单击查看详情**（在侧边弹出，与批次列表一致，默认出现在右侧；含版本 / 环境 / 自定义标签等徽章与字段信息），**双击加载**该批次。
  - 批次改名后，收藏夹中缓存的批次名快照同步更新（保存编辑时随 `POST /api/favorites` 一并回写）。
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
- **忽略配置服务端持久化**：忽略 / 取消忽略 / 批量忽略 / 导入会 `POST /api/ignore` 回写到当前生效的 `ignore-config-by-platform.json`（默认空配置，可按租户隔离；与收藏夹同一套原子写入机制）。「导入」为**分部覆盖**语义（以文件为准，只覆盖文件里出现的部分：警告 / 未比较 XPath / 未比较 CSV，其余保持不变；只接受分组格式），「导出」产物可直接重新导入。
- **计算 Worker**：健康总览与全局搜索等重计算移到 Web Worker（`worker.js`，复用 `core.js` 纯函数），失败自动回退主线程同步计算。
- **纯函数核心拆分**：`public/core.js` 承载无副作用纯函数（搜索/排序/过滤/差异 diff/忽略 key/健康统计/全局搜索），主线程与 Worker 共用，并由 Node 测试直接导入回归。
- **深链接增强**：URL hash 除 `item/ch/tab/q/result/page` 外，新增 `sort`、`cols`（列可见性）、`filters`（列过滤器 JSON），可完整还原视图状态。
- **键盘导航**：字段表与消息表行可聚焦（↑/↓ 移动、`Enter` 打开字段详情、`Space` 切换忽略）。
- **数据校验**：`lib/validate.js` 校验数据文件结构（顶层 / ctxDefs / 字段注册表 / 比较字段；可选规则对象 `cvtLeft`·`cvtRight`·`vdt` 允许为 `null`），服务启动时对默认数据文件告警。
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

# 覆盖监听地址（优先级：命令行 > 环境变量 > 租户固定端口 > config.json > 内置默认值）
node server.js --port 9000
node server.js --host 0.0.0.0 --port 9000
node server.js --port 0        # 由操作系统分配随机空闲端口

# 租户模式（可选）：默认非租户模式，共享 web 根下的批次/索引/收藏夹。
# --tenant alice 开启租户模式并指定 id；--tenant（不带参数）id 取当前系统用户名；--no-tenant 强制非租户。
node server.js --tenant alice
node server.js --tenant
node server.js --no-tenant
node server.js --tenant alice --data-root C:/data/alice

# 租户 active 追踪 / 审查日志：默认关闭；--audit 开启、--no-audit 关闭（或 config 里 audit: true）
node server.js --audit
node server.js --no-audit

# 等价于环境变量
REPORT_VIEWER_CONFIG=prod node server.js
REPORT_VIEWER_TENANT=alice REPORT_VIEWER_DATA_ROOT=C:/data/alice REPORT_VIEWER_AUDIT=1 node server.js

# 或通过 npm script
npm start
```

> 启动前会自动通过 `/status` API 探测目标地址是否已有实例在运行：若已启动则打印
> `Already running` 并退出（不重复监听）；否则正常启动。启动日志统一为英文。
>
> 默认**非租户模式**：直接使用程序 web 根（`public/`）下的共享批次目录、批次索引与收藏夹。
> 通过 `--tenant alice`（或 `--tenant`，缺省取系统用户名）开启**租户模式**：每个租户拥有独立
> 数据根 `~/.report-viewer/<租户>/`（首次启动自动创建兼容的空批次目录 / 空索引 / 空忽略配置），
> 批次索引/批次数据/收藏夹/忽略配置均按租户隔离；`--no-tenant` 可强制回到非租户模式。
> 开启审查（`--audit` 或 config `audit: true`）后，活跃租户信息实时写入**程序自身目录**
> （`server.js` 同级目录）下的 `.report-viewer/active/<租户>.json`（心跳），启动/停止记录追加到
> 同目录 `.report-viewer/activity.log`（程序目录只读时回退到 `~/.report-viewer/`）。
> 部署时若直接部署 `server.js`/`lib/`/`public/` 到目标目录，则审计文件就在该目标目录下的
> `.report-viewer/` 内，不会多套一层 `src`。

浏览器打开 <http://127.0.0.1:8123>（`--port 0` 时以启动日志打印的实际端口为准）。

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
| `POST` | `/api/batch` | 批次元数据写回（body 任意组合：`{ "batchId": "...", "deleted": true }` / `{ "favorite": true }` / `{ "batchName": "...", "description": "..." }` / `{ "tags": ["a","b"] }`；`tags: []` 或空 `description` 表示清除对应字段，空 `batchName` 返回 400）。**写回后服务端会自动重建 `batches-index.json`**，保证刷新页面立即读到新值（收藏标记 / 标签 / 名称 / 软删除状态） |
| `POST` | `/api/reveal` | 在系统文件管理器中打开批次目录（body：`{ "path": "<批次目录绝对路径>" }`）；需 `features.revealPath` 开启，路径限定在 `scan.basedir` 内。返回 `{ ok, path, launcher }`；启动文件管理器失败（如系统未找到可执行文件）返回 **500** 并给出原因，前端提示「打开目录失败」。 |
| `GET` / `POST` | `/api/favorites` | 收藏夹读取 / 整树保存（body：`{ "favorites": {...} }`） |
| `POST` | `/api/ignore` | 忽略配置回写（body：`{ "url": "<当前生效的配置地址，缺省用 config.urls.ignore>", "config": {…分组结构…} }`）；仅允许写入 `.json` 且路径需落在允许的根目录内（非租户：web 根；租户：租户数据根，`/tenant/` 前缀自动剥离），原子写入 |
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
│   ├── generate-sample-data.js
│   └── migrate-legacy-data.js   # 旧数据格式 -> 新数据格式迁移
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

命令行参数（最高优先级）：`--port` / `--host`（覆盖 `server.*`），`--config` / `--profile`（切换配置文件）。

## 数据模式

数据文件结构见 [`docs/DATA_SCHEMA.md`](DATA_SCHEMA.md)。关键点：

- `report-validation-data.json` 顶层 `"mode"` 为 `"single"` 或 `"multi"`。
- 多文件模式：清单中的每个 item 带 `file` 与预计算 `summary`，查看器动态加载 item 文件；搜索/筛选/统计仍作用于全部 item 的合并数据。
- 每个 item 内联 `ctxDefs`（`id` / `scopes` / `type` / `def` / `hits`）。
- 字段定义注册表在每个 `channel` 内（`channel.fields`，`id` / `name` / `userTag` / `type`）。

## 生成样例数据

```bash
node tools/generate-sample-data.js            # 单文件模式
node tools/generate-sample-data.js --split    # 多文件模式（清单 + data/items/*.json）
node tools/generate-sample-data.js --batch    # 更新全部样例批次（通用切片 + 多文件批次 + 特殊用途批次）
node tools/generate-sample-data.js --special  # 仅更新特殊用途批次（单来源渠道 / 批次分页 / 批次软删除）
node tools/migrate-legacy-data.js <旧文件>     # 旧数据格式迁移为新格式（原地或指定输出）
```

生成批次后需触发一次扫描（`GET /scan` 或界面「刷新批次」）以更新 `batches-index.json`。

### 特殊用途样例批次

除通用切片批次（每批 2 / 4 个 item）外，`--batch` / `--special` 还会生成三个固定用途的样例批次：

| 批次目录 | items | 批次名 / 用途 |
| --- | --- | --- |
| `batches/2026-08-17/batch-20260817-0900` | 18 | `single-source-20260817-单一来源渠道测试`：全部 item 仅含 1 个来源渠道（`sourceCount=1`）；标签 `单一来源` / `渠道测试` |
| `batches/2026-08-17/batch-20260817-1200` | 28 | `paging-20260817-批次分页测试-28items`：验证 item 列表分页（8/页 → 4 页）与字段 / 消息表分页（20/页）；标签 `分页测试` / `28items` |
| `batches/2026-08-17/batch-20260817-1500` | 1 | `deleted-20260817-批次软删除测试`：`batch-meta.json` 默认带 `deleted` 标记，默认范围不可见，需切到「全部批次(含已删除)」范围查看（仅供查看，不可加载）；标签 `软删除` / `分页测试` |

这三类批次自带 `batch-meta.json`，且**不参与通用切片**（否则每次 `--batch` 都会被覆盖成 2 / 4 个 item）。

## License

MIT
