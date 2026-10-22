# CCP Report Validation Result Viewer（前端查看器）

金融监管报告比较结果的**单页查看器**与**单一批次扫描服务**，两者已整合进同一个 Node HTTP 服务。

- 技术栈：原生 JavaScript（ES Modules）+ Node.js 内置模块（**零运行时依赖**）
- 运行时：Node.js **>= 24**
- 入口：`server.js`（静态站点 + 批次扫描 API 合二为一）

## 特性

- **保留原有全部 UI 风格**：11 套主题、17 列可配置字段比较表（列可见性与显示名见「配置」的 `columns`）、侧栏虚拟滚动、健康总览、全局搜索、字段对比（Compare）、消息忽略、批次 dock 面板等。
- **单文件 / 多文件数据模式**：
  - 单文件：一个 `report-validation-data.json` 包含全部 item。
  - 多文件：`report-validation-data.json` 为清单（manifest），每个 item 一个独立文件，支持**动态加载**、跨文件**搜索/筛选/统计**。
  - 清单的**顶层字段与单文件模式完全一致**（`mode` / `reportEnv` / `creationType` / 三张声明表 `reportChannelDefs`·`sourceChannelDefs`·`usedCtxKeyDefs` / `skippedItems`），只把 `items` 换成轻量条目（`file` + 预计算 `summary`）；Java 生成器（`validationJsonJob -m multi`）与 `splitToFiles()`（JS / Java）都会写出这些字段，且**键顺序一致**：`mode` → `reportEnv` → `creationType` → `reportChannelDefs` → `sourceChannelDefs` → `usedCtxKeyDefs` → `skippedItems` → `items`。
  - 所有近期功能（typed Ctx 标签/弹框、批次删除/收藏、新增徽章、可配置默认数据源、空数据占位、来源渠道筛选、字段详情左右导航与规则折叠、任务说明扩展内容等）均同时适配单文件与多文件模式。
- **任务说明扩展内容（`descriptionEx`，只读）**：`batch-meta.json` 可选字段 `{ contentType, plainContent }`；`contentType: "markDownTable"` 时把 Markdown 表格渲染到「任务说明」**末尾**（**表头 `⚲` 字段筛选**（与主列表同款浮层输入框，列间 AND）/ **列排序**（升序 → 降序 → 原序）/ **分页**（紧凑页码 17×17 + 轻灰当前页，位于表格右上，每页 `limits.descExPageSize` 默认 5））；
  总页数 `≤ 3` 时不显示排序/筛选图标；列宽按**整表最大内容宽度**定宽（分页/排序切换时宽度固定，单列 56–360px）；页码控件位于表格右侧、**默认收起**（`▸` 展开 / `▾` 收起）、展开后为简约主题色竖向页码，仅 1 页时不显示；
  该块采用**弱化配色 + 虚线边框**的描述性样式（无独立工具条、无强调色、无冗余提示文案），与主题内容拉开层次；
  内容**不进批次索引**（索引只写 `metaUrl`，打开「任务说明」时懒加载 `batch-meta.json`），不显示在批次详情，也不可通过「编辑批次描述」/ `POST /api/batch` 修改；
  开关 `features.descriptionEx`（所有配置文件默认 `true`），契约与扩展步骤见 [`docs/DATA_SCHEMA.md` §6.3](DATA_SCHEMA.md)。
- **item 只保留 ctx 命中，定义在顶层 `usedCtxKeyDefs`**：`item.ctxDefs[<ctxKey>] = { id, hits }`（id 引用声明表，`hits` 是本 item 的命中摘要），
  ctxKey 的 `id` / `type` / `rules` / `def` 只在顶层声明表里写一次（见 `docs/DATA_SCHEMA.md` §3.1）。
  - `rules` 为**规则名数组**：`fdm` 字段映射 / `cvt` 值转换 / `vdt` 终值校验；同一 ctx 可配置在多种规则中；`type` 为 `builtin`（内置）/ `user`（用户自定义）。旧的数字 `scopes: [1,2,3]` 已废弃（查看器仍能读老数据）。
  - 主列表「命中Ctx」列展示各规则 `ctxs` 的 id 并集（解析为 CtxKey），统一使用主题配色标签；字段详情页各规则 section 直接展示各自 `ctxs` 的 id 引用。
  - 「命中Ctx」标签单击即弹出定义/命中详情（主列表与详情页均可，弹框跟随标签，长文本/多行可滚动），命中详情内展示该 CtxKey 的**全部 rules** 徽章。
- **字段定义注册表在 report channel 级别**：`reportChannelDefs[].fieldDefs`（`id` / `name` / `userTag` / `type`）每个报告渠道各自维护（不同渠道的字段定义不同）；
  比较字段通过 `id` 关联**其父报告渠道**的 fieldDefs（同名不同渠道的字段 id 也不相同）；查看器 hydrate 时会把它注入 item 渠道，下游逻辑无感。
- **默认数据源可配置**：`urls.defaultDataMode` 取值 `init`（不加载任何文件，直接用空数据集）、`default`（加载默认模板数据，即 `urls.defaultData`；未配置时就是主数据文件 `urls.data`）或某个已扫描批次名（加载该批次数据）；其他值等同 `default`。
  - 空数据集下「运行环境」显示为空（`reportEnv` 为 `INIT`），查看器展示友好空状态 —— 不再需要单独的空占位数据文件。
- **批次管理**：批次软删除（元数据 `deleted` 标记），可即时撤销/确认删除；删除后即时以删除样式区分，刷新/重启后默认不再展示；搜索/筛选/统计默认只作用于正常批次。
  - 批次面板右上角的范围按钮为**三态循环**：`≡` 全部批次 → `✓` 仅看兼容 → `🗑` 全部批次(含已删除) → `≡`。
  - 「全部批次(含已删除)」范围会展示带 `deleted` 标记的批次（批次名置灰 + 「已删除」徽章），可查看详情、参与排序/搜索/筛选，但**不支持加载 / 收藏 / 删除 / 钉住**等操作。
  - 扫描器不再跳过 `deleted` 批次，而是带上 `deleted` 标记写入 `batches-index.json`（因此服务端 `POST /api/batch { deleted: false }` 可恢复）。
- **批次标签（`tags`）**：`batch-meta.json` 的 `tags` 字符串数组（去空白 / 去重 / 单个 ≤ 24 字符 / 最多 12 个），在列表卡片与详情中展示（卡片中位于 item 数量标签之前）。
  - 筛选面板在「报告环境」下方新增「按标签筛选」下拉（选项从当前范围的批次标签去重收集）。
- **批次编辑（✎，仅兼容批次）**：列表卡片提供铅笔入口，可同时编辑**批次名 / 批次描述（多行）/ 标签**，保存后经 `POST /api/batch` 直接回写 `batch-meta.json`（不兼容与已删除批次不提供该入口，也拒绝保存）。删除 / 收藏 / 编辑等全部元数据写回都走同一入口并带 `If-Match` 乐观并发（写前先取 `GET /api/batch` 的 `etag`，冲突时提示「批次元数据已被其他会话修改」并用服务端返回的最新 etag **重放一次**；因 `POST /api/batch` 是字段级补丁，重放不会覆盖其它字段）。
  - **批次名允许重复**：若输入的名称与其它批次重名，编辑器仅给出告警（列出同名批次 ID）且**不阻止保存**——与 `urls.defaultDataMode` 按批次名解析时取首个匹配的现状一致；批次名为空则不提交（服务端也返回 400）。
- **批次目录双击打开**：批次详情中的「批次目录」支持双击，经 `POST /api/reveal` 在系统文件管理器中打开该目录（`features.revealPath`：dev/test 默认开启，prod 默认关闭；路径限定在批次根目录内）。Launcher 用**系统绝对路径**解析（Windows 用 `%SystemRoot%\explorer.exe`，不依赖 `PATH` —— 某些环境下 `PATH` 含畸形条目会让 Node 的 PATH 查找整体失效，`spawn('explorer.exe')` 直接 ENOENT）；启动失败会如实返回 500 并在页面上提示，不再无声无息。
- **清除偏好记忆（顶栏）**：顶栏帮助按钮右侧新增同风格按钮（逆时针重置箭头内联 SVG 图标，尺寸与帮助按钮一致；hover 提示「清除偏好记忆（语言、列可见性、批次置顶等）」），**无二次确认**，点击即清除**当前作用域**的本地状态（localStorage 5 项 + IndexedDB 数据缓存，共 6 项）；完成后于视口顶部弹出完成提示（`.app-toast`，自动消失）并自动刷新本页。缓存项清单、作用域规则与实现约束见 [`docs/LOCAL_CACHE.md`](LOCAL_CACHE.md)。
  - **按租户隔离**：租户模式下 localStorage 键带 `@<tenantId>` 后缀、IndexedDB key 带 `tenant:<id>:` 前缀（租户标识由服务端在下发的 `/config.json` 里提供，仅 `enabled`/`id`），多租户共用同一 origin 时互不干扰；非租户模式沿用历史键名（不做迁移）。清理不使用 `localStorage.clear()`，也不会删 IDB 库，同源下其它应用/租户的数据不受影响。
  - 开关 `features.clearLocalCache`（`config.json` / dev / test 默认 `true`，**prod 默认 `false`**，关闭时按钮隐藏）；服务器端数据（批次、收藏夹、忽略配置）不受影响。其它已打开的标签页建议一并刷新，否则可能把旧状态写回。
- **主页（顶栏）**：同一排新增按钮（简约房子内联 SVG 图标，与帮助 / 清除按钮同一套 30×30 圆形按钮与 15×15 图标尺寸，画布占比对齐；hover 提示「回到站点根」/ Back to Site Root），点击回到站点根（`origin + pathname`，不带查询参数与深链接）并重新加载页面（先 `history.replaceState` 去掉 query/hash，避免被查看器的 `syncHash` 写回，再 `location.reload`）；与启动失败提示条里的「回到主页」链接共用 `webRootUrl()`；开关 `features.homeButton`（prod 默认 `false`）。
- **版本兼容性合并到版本号标签**：批次列表卡片、dock 悬停小卡片与批次详情的标签行统一由 `batchBadgesHTML` 渲染，不再单独展示「版本兼容 / 版本不兼容」标签，兼容性以版本号标签的配色 + title 提示表达；详情标签与卡片一致（仅不含 item 数量标签）。
  - **两套版本号不要混用**：批次能否加载只看 `batch-meta.json` 的 `formatVersion`（查看器白名单 `SUPPORTED_FORMAT_VERSIONS = [2, 3]`，当前生成器写 `3`）；`config.json` 的 `configVersion` 只是**配置结构**版本（当前 `3`），**不参与**兼容判定（超出范围仅在控制台告警）。二者常量集中在 `public/core.js`，Java 侧对应 `model/ContractVersion`。
- **Item 关联属性浮层（hover 展示）**：主列表「报告日期」左侧的 item id **鼠标悬停**即弹出（原为点击），移出后延迟收起；鼠标进入浮层内部保持展开，便于点击复制。浮层首行为带标签的 `Item ID` 行并附复制按钮（其余行为对手方 Item ID / 平台 Trade ID / 平台 Trade Deal ID，均带复制按钮）。
- **激活筛选标签（chips）与「清除全部」**：
  - Item 列表（左栏）与批次列表都会在列表上方显示当前激活的筛选标签（Item：**报告日期** / 状态 / 平台 / 产品 / TradeId；批次：名称 / 命令行 / 描述 / 日期 / 环境 / 标签），主列表字段筛选同样沿用该样式。批次标签位于列表上方的**独立区域**（在拖动标记之上，不随列表高度拖拽变化，无标签时自动收起）。
  - 标签下方以**小字**（`.chip-count`，`--muted` 11px）显示当前筛选**匹配数量**（`chipMatchCount`：「匹配 N 项」/「{N} matches」）——Item 列表取 `filteredItems().length`，批次列表取 `visibleBatches().length`；无标签时文本为空、整行自动收起（`:empty { display: none }`）。
  - 标签数 **> 1** 时额外显示「清除全部」，一键清除全部标签并重置对应筛选状态与分页（Item 侧含**报告日期**）；单个标签仍可用自身 ✕ 移除。日期筛选的每个入口（📅 浮层、手动输入、✕ 清除、原生日期选择器）都会刷新标签，因此选完日期立刻能看到并可一键移除。
  - **日期提示互斥**：「N 个报告日期（有数据）」/「N 个批次日期（有数据）」提示**仅在未指定具体日期时显示**，选定某个日期后自动隐藏（批次侧 `updateBatchDateHint()`，手动输入即时生效）。
  - Item 列表的标签区高度变化后会自动重算列表起始位置（`renderSidebarChips` → `layoutSidebarList`），**并计入下方计数小字的高度**，避免首个 item 被标签或计数行遮挡。
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
- **静态资源压缩（brotli 优先，gzip 兜底）**：可压缩资源（HTML/CSS/JS/MJS/JSON/SVG/TXT）按 `Accept-Encoding` 选编码——支持 `br` 就用 brotli，只支持 `gzip` 就用 gzip，都不支持（或显式 `q=0` 拒绝）就原样下发；无论是否压缩都下发 `Vary: Accept-Encoding`（避免中间缓存把压缩体喂给不支持的客户端）。压缩结果按 `ETag` 缓存（上限 32 项），因此同一文件的重复请求不重复压缩，且与 `If-None-Match` → 304 协商共存。brotli 质量取 **9**（实测样例数据：q4 141 KB/7 ms · q6 95 KB/11 ms · **q9 75 KB/21 ms** · q11 65 KB/**2125 ms** · gzip 208 KB/12 ms —— q9 是拐点，比 q11 快 100 倍只大 13%）。小于 1 KB 的文件与二进制类型不压缩。数据文件本身也改为**紧凑 JSON**（见下条），两相叠加后首屏要传的数据是 4.57 MB → **约 75 KB**。
- **数据文件写紧凑 JSON（体积约为缩进版的一半）**：数据文件由生成器 / 迁移工具 / 合并命令统一经 `lib/json-write.js` 写出，**默认紧凑**（无缩进 + 结尾换行）；缩进只服务于人阅读，却要占 40%+ 体积（实测样例 4.57 MB → 2.69 MB），而查看器只解析内容。需要人工排查时给生成器 / 迁移工具 / `merge-batch` 加 `--pretty` 即可拿到缩进版。**例外（保持缩进）**：`batches-index.json`（索引，人也会看）、`favorites.json` / `batch-meta.json` / 租户配置等用户态小文件（便于手工编辑与 diff；服务端 `POST /api/batch` 写回时也是缩进版）。
- **扫描进度 SSE**：`GET /scan/progress`（`text/event-stream`）实时推送目录/批次/跳过计数；前端在「刷新批次」时订阅并在按钮上显示进度。
- **收藏夹服务端持久化**：`GET/POST /api/favorites` 共享收藏树（多用户一致，非管理员账号可写 `favorites.json`），localStorage 仅作离线回退。
- **忽略配置服务端持久化**：忽略 / 取消忽略 / 批量忽略 / 导入会 `POST /api/ignore` 回写到当前生效的 `ignore-config-by-platform.json`（默认空配置，可按租户隔离；与收藏夹同一套原子写入机制）。「导入」为**分部覆盖**语义（以文件为准，只覆盖文件里出现的部分：警告 / 未比较 XPath / 未比较 CSV，其余保持不变；只接受分组格式），「导出」产物可直接重新导入。多会话并发写入用 `If-Match` 乐观并发保护：遇 409 先以服务端为准重载并重绘（含打开着的管理窗口），再用新 `etag` **重放一次**本次变更；同一浏览器的多个标签通过 `BroadcastChannel('report-viewer-ignore')` 互相同步，标签回到前台时再按 `etag` 校验一次。
- **忽略配置管理（查看 / 删除）**：警告 / 未比较选项卡工具栏的「管理忽略配置」打开模态窗口，按类型分页签查看当前全部忽略项（默认选中入口对应类型），含「忽略条数」列（当前 item 内因该条目被忽略的条数，`countIgnoredByKey`），支持**表头三态排序**、**字段级筛选**（`⚲` 浮层，列间 AND，与主列表同一交互：默认下拉框精确匹配、字段列「关联字段 / 元素」自由输入包含匹配；「忽略条数」列仅支持排序、无筛选图标）与**分页**（每页 `limits.ignoreMgrPageSize` 默认 10；条数 > 20 才显示排序 / 筛选图标，单页时不显示分页控件），以及逐条删除；删除即回写配置文件并立即重绘当前数据集（复用 `POST /api/ignore` 的 `If-Match` 乐观并发，409 冲突按既有策略重新加载）。
- **计算 Worker**：健康总览与全局搜索等重计算移到 Web Worker（`worker.js`，复用 `core.js` 纯函数），失败自动回退主线程同步计算。
- **纯函数核心拆分**：`public/core.js` 承载无副作用纯函数（搜索/排序/过滤/差异 diff/忽略 key/健康统计/全局搜索），主线程与 Worker 共用，并由 Node 测试直接导入回归。
- **搜索限定名（工具栏字段搜索与全局搜索共用同一语法）**：`field:` 报告字段 / `tag:`（同义词 `userTag:`）**用户标签** / `xpath:` CCP XPath / `csv:` CCP CSV / `eo:` 期望值 / `ao:` 实际值 / `ctx:` 命中 Ctx / `desc:` 说明；可叠加 `regex:`（如 `xpath:regex:`）；不加限定名时在全部字段做普通文本匹配。**用户标签的搜索能力与 `columns.userTag.raw` 联动**（保证能搜到的东西与界面显示的一致）：`raw: false`（默认）时按「原始值 + 当前语言显示标签」双通道匹配——标签映射（`columns.userTag.labels`）由界面按当前语言解析后作为 `tagLabels` 传给纯函数，Worker 与主线程回退走同一参数，因此结果一致；`raw: true` 时界面显示的就是原始值，只按原始值搜索（`tagLabels` 为空、显示标签不再可搜），帮助面板中 `tag:` 的说明文案也随之切换（`helpSyntaxTag` / `helpSyntaxTagRaw`）。全局搜索结果行还会显示该字段的用户标签徽章，便于确认命中原因。
- **深链接增强**：URL hash 除 `item/ch/tab/q/result/page` 外，还包含 `batch`（当前批次）、`fr`（强制加载）、`is`（侧栏搜索）、`st/pf/pd/td/dt`（侧栏与批次筛选）、`sp`（特殊值过滤）、`sort`、`cols`（列可见性）、`filters`（列过滤器 JSON）等，可基本完整还原视图状态。失效的 `batch`（不存在 / 版本不兼容 / 批次目录已被移除）会回退默认数据并给出提示；会话内 hash 变更与「返回默认数据」按钮都经由同一安全入口，回退失败不再产生未捕获异常，提示语也不会丢失。多文件清单为空（`mode: multi` + `items: []`）时直接渲染空状态。hash 解析后会把侧栏筛选**回写到控件**（`#search` / `#itemSearch` / **`#itemFilter` 状态下拉** / `#reportDateFilter`），避免深链接 `st=…` 生效但下拉仍显示「全部状态」的错位。
- **侧栏「按状态筛选」判定**：`全部通过` → `failed === 0`；`存在失败` → `failed > 0`；`存在警告` → 未忽略的 `warnings > 0`（三者为互不相同的独立过滤，可与平台 / 产品 / TradeId / 日期筛选叠加）。`failed = 非 PASSED 字段数`。多文件模式下未按需加载的 item 使用清单里的预计算 `summary`，读取时统一经 `normalizeItemSummary()` 归一（缺失 / 非数字 → 0），因此清单里 `summary` 缺字段也不会把 `undefined` 渲染到卡片；**但清单 summary 与 item 文件内容不一致时（summary 缺失 / 过期），筛选与卡片会以 summary 为准，直到该 item 被选中并懒加载后才按实际内容重算**。
- **启动期兜底**：`initApp()` 的任何未预期异常都会移除加载骨架层并**贴底**显示固定提示条（`--warn` 配色，「页面初始化失败，请刷新重试…」），避免用户停留在全屏骨架层（观感等同空白页），也不会遮挡页头；提示条不依赖任何页面容器，DOM 缺元素时同样可见。提示条末尾附「或 回到主页」超链接，指向 web 根（`origin + pathname`，不含查询参数与深链接），便于从失效的深链接回到干净主页。
- **主列表分页在选项卡切换间保留**：字段比较用 `state.page`、消息类（警告 / 错误 / 未比较 / 未比较项）用 `state.msgPage`，两者互不干扰，所以切换选项卡（含点当前选项卡）**不再把页码重置为 1**；页码越界由 `computeFieldPage()` / `renderMsgTable()` 调用 `paginateRows()` 自动收敛。会改变数据集的操作仍各自重置页码：切换 item、全局搜索、列 / 特殊值筛选浮层、清除筛选标签与「清除全部」、汇总卡片跳转、字段警告图标的选项卡跳转、每页条数下拉。副作用是 hash 里的 `page=` 在非字段选项卡下也会保留，刷新后可按深链接还原字段比较所在页。
- **键盘导航**：字段表与消息表行可聚焦（↑/↓ 移动、`Enter` 打开字段详情、`Space` 切换忽略）。
- **声明表（定义与引用分离，三张表）**：报告渠道、来源渠道、ctxKey 与字段定义的**定义只在顶层写一次** ——
  `$root.reportChannelDefs = [{id,name,desc,format,fieldDefs}]`、`$root.sourceChannelDefs = [{id,name,format}]`、`$root.usedCtxKeyDefs = {<ctxKey>:{id,type,rules,def}}`（与 `items` / `skippedItems` 同级）；
  item 里只保留 id 引用（`item.channels[] = {id, enabled?, files, sources:[{id, fields}]}`、`item.ctxDefs[<ctxKey>] = {id, hits}`），不再重复写定义。
  （旧的根键 `channels` / `sources` 已改名为 `reportChannelDefs` / `sourceChannelDefs`；旧的 item 级 `fields` 已迁到 `reportChannelDefs[].fieldDefs`。**无向后兼容**：校验器对旧键名直接报错；本项目不提供数据迁移工具，旧数据需自行改写。）
  查看器加载时用 `core.js` 的 `hydrateDataset()`（多文件模式逐 item 用清单的声明表 `hydrateItem()`）把定义补回内存中的 item，因此**渲染 / 搜索 / 忽略配置 / 深链接仍全部按名称工作**；生成器（JS `hoistRegistries()` / Java `ValidationJsonGenerator.hoistRegistries()`）做反向变换，两者互为逆操作（`hoist(hydrate(x)) === x`，有测试断言）。`files` 与 `sources[].fields`（本 item 的比较结果）有意留在 item 内：文件名含 tradeId，字段集也逐 item 可变。
- **数据契约：引用 ⊆ 声明**：`item.channels[].id` 与 `item.channels[].sources[].id` **必须**能在 `reportChannelDefs` / `sourceChannelDefs` 里解析；`item.ctxDefs` 的 key 必须在 `usedCtxKeyDefs` 里声明且 id 一致；`sources[].fields[].id` 必须在**父报告渠道的** `fieldDefs` 里声明；`skippedItems` 引用的渠道 / 来源渠道同样必须已声明（`hoistRegistries()` 会把它们一起补进声明表）。item 里不再接受新定义（写 `name` / `desc` / `format` / `fieldDefs` / ctxKey 的 `type`·`def`·`rules` 都会被报错）；三张声明表**只有在该数据集没有任何引用时**才可以省略。声明表内部冲突（同 id 不同名称 / 同名不同 id / `fieldDefs[].id` 重复）在生成与迁移时**直接报错**，不静默取第一个。这条契约让「id 指向哪个渠道 / ctxKey / 字段」各只有一处答案，是「引用只留 id」的前提。
- **渠道 / 来源渠道 / ctxKey / 字段稳定标识（id）**：`reportChannelDefs[].id`（预设 `HKTR=1` / `JSFA=2` / `CFTC=3`）、`sourceChannelDefs[].id`（预设 `来源渠道 A=1` / `来源渠道 B=2`）、`usedCtxKeyDefs[].id` 与 `fieldDefs[].id`（数字字符串，**数据集内唯一**：HKTR 从 1 起 / JSFA 从 21 起 / CFTC 从 41 起）都是必填；声明表是**数据集级**的，因此来源渠道的 id 与名称同样数据集内唯一（不再只按渠道内唯一）。
  引用写法：`logs` 与 `skippedItems` **保留 id**（名字 + id 双写），`warnings` / `errors` / `uncompared` **只写名称**（消息量小、以人读为主，双写 id 纯冗余）。加载时 `hydrateItem()` 按 `channelId` / `sourceId` 从声明表把名称补回（只补缺的、不覆盖已有的），因此**展示 / 筛选 / 深链接仍全部按名称工作**。
  id 的职责是**稳定标识**：日志锚点、内部 locator（`data-log-key` 等）、跨 item 关联；**URL / 深链接、忽略配置、界面展示仍用名称** —— 忽略配置是跨 item / 跨批次按平台共享的，深链接也要能跨批次通用，改成 id 会让已有配置与老链接失效。
- **来源渠道数据格式（`format`）**：`csv`（默认）或 `xml`；由生成器从该来源比较值侧的 `cmpLeft.valueSrcFmt` 推导。字段两侧的 `valueSrcFmt`（`csv`/`xml`）取代了旧的数字 `srcType`（数字在 raw JSON 里不自解释）：左侧（EO，来自映射表）恒为 `csv`，右侧（AO）随所在渠道的 `format`；CSV/XPath 图表也由它决定。
- **日志文本不是数据通道**：`item.logs[].text` 只是展示内容（含时间戳与 `[渠道/来源]` 前缀，为了人读），代码**不得**从文本里提取渠道 / 来源渠道（真实数据的文本可能完全不含渠道信息）。日志行的归属一律看 `channelId` / `sourceId`（老数据回退看 `channel` / `source` 字段）；`isFieldLogLine()` 与字段日志取数同样只看结构化字段。两种形态的重活量收益实测（18 item 样例，含 9513 个引用点）：raw −6.96%、gzip −3.30%、brotli 约 −0.75%（其中 `logs` 占 91% 的引用）。
- **启用口径单点化（`channels[].enabled`）**：渠道是否参与本次比较**只有一处**——`channels[].enabled`（**省略 = 启用**，只在禁用时写 `false`）；历史上的 `item.enabledChannels` 名单**已彻底移除**（出现即校验报错，不允许两份口径共存）。`public/core.js` 的 `enabledChannelsOf` / `isChannelEnabled` 是唯一入口，字段表展开、侧栏卡片、统计卡、图表、对比、全局搜索、健康总览与多文件清单的 `summary` 全部经它取渠道集合。此前**只有部分消费方尊重启用名单**（选项卡与顶部卡片按启用口径、侧栏卡片按全部渠道直接算），同一个 item 会出现「卡片 48 个字段 / 字段表 72 条」这种自相矛盾的显示；现在所有数字都由 `itemStatsPure` 与 `flatFields` 两个同源函数算出，不可能再对不上。
- **完整日志的字段定位（日志锚点）**：`item.logs[]` 的 `field`（字段 id，**仅 `scope: "field"` 的日志行有值，且此时 `channelId` / `sourceId` 必须非空**；渠道 / 来源名称不再是日志行的必填项，查看器加载时按 id 补回）；字段级日志行即原 `field.prints` 的日志化版本，**只在 `item.logs` 里存一份**（`fields[]` 不新增任何字段，字段上只有 `prints` 保留待用）。查看器渲染「完整日志」时给这些行打**id 锚点**：`data-log-key="<渠道id>|<来源id>|<字段id>"`（例 `1|1|2`）+ `id="log-<渠道id>-<来源id>-f<字段id>.<同键序号>"`（例 `log-1-1-f2.1`，不超过 18 字符）。用 id 而非名称是刻意的：**数字天然无歧义**，不需要再把名称 slug 化 / 哈希（旧实现的 36 进制短哈希与碰撞兜底已删除），因此改渠道显示名不会让锚点漂移，**跨 item 也能用同一个合成键关联**同一实体；同键序号按 `item.logs` 顺序编号，与当前搜索 / 作用域筛选无关，因此同一行 id 稳定。跳转时用 `getElementById(logAnchorId(...,1))` 直取并**用 `data-log-key` 复核一致**，不一致或未命中再按 `data-log-key` 扫描兜底（同时覆盖「首个日志行被筛选掉」的情况）。于是可以**从字段侧跳回日志**：字段比较的「报告字段」链接**单击即打开比较详情**；警告 / 错误选项卡的「关联字段」链接**单击即跳到主列表该字段行**（两个链接都是单击即时响应，不做双击判定、无 300ms 延迟）；要跳某字段的关联日志行，统一走**字段详情页**标题后的 ▸（详情页自带日志入口，因此不需要双击手势）。详情页刚弹出的 350 ms 内忽略「点遮罩关闭」，避免对『报告字段』链接习惯性双击时，第二次点击落在遮罩上把刚打开的详情页瞬间关掉。跳转前清空文本搜索、并把会遮住目标行的渠道 / 来源作用域放宽到 `ALL` 后重绘定位，落到目标行时以 `.flash-log` 高亮 1.8s（与字段行 `.flash-row` 同配色）。此外，在「完整日志」里**单击**任意一条字段级日志行（行带 `tabindex="-1"`，可聚焦但不进 Tab 顺序），会把**同一字段（id 合成键相同）的所有日志行一起整行高亮**（`.log-hi`，通栏底色带左右外扩到日志框内边距、文字位置不变；底色用专色 `--log-hi-bg`，比 `--accent-bg` 再深一档，9 套主题各自定义），便于一眼看清该字段这次的完整打印；**焦点消失即取消**（点击别处 / 切到别的选项卡 / 窗口失焦都会触发 `focusout` 清掉高亮，单击另一条字段日志行则自动切到那一组）。单击高亮与跳转闪烁可并存（`.flash-log` 动画结束后归位到整行高亮）。
- **字段详情页的「相关打印信息」改为读取关联日志行**：由 `field.prints` 改为从**完整日志**（`item.logs`）中取 `channelId` + `sourceId` + `field` 三者匹配的行（按 id 匹配，不依赖名称是否存在），按原始顺序渲染（字段对象不存日志，没有命中就是「无关联日志行」）；旧 `prints` 字段保留待用（不再读取）。标题标签后新增三角图标（`data-log-jump`）可关闭详情页并跳回「完整日志」中该字段的首个关联日志行——有可定位的日志行时才显示，否则只展示「该字段暂无关联日志行」占位。
- **数据校验**：`lib/validate.js` 校验数据文件结构（顶层三张声明表 `reportChannelDefs` / `sourceChannelDefs` / `usedCtxKeyDefs`（旧键名 `channels` / `sources` / `ctxKeyDefs`、以及旧 item 元数据 `platformTradeId` / `platformDealId` 都直接报错）/ `reportEnv` / `creationType`（`sample`|`user`）/ `skippedItems` 数组与条目字段 / item 只写引用的 `ctxDefs`（`{id,hits}`）/ 声明表的 `fieldDefs`（数字字符串 id、数据集内唯一）/ 比较字段的 `valueSrcFmt`（`csv`|`xml`，旧 `srcType` 报错）；可选规则对象 `cvtLeft`·`cvtRight`·`vdt` 允许为 `null`；`item.logs[]` 的日志行契约：`scope` ∈ `item`/`channel`/`field`、`text` 必为字符串、`field` 仅 `scope="field"` 时有值且要求 `channelId` / `sourceId` 非空（名称可省，由查看器按 id 解析；**`text` 不参与任何逻辑**）；`warnings` / `errors` / `uncompared` 只写名称（不得再写 id），`skippedItems` 的名字 + id 双写必须与声明表一致（悬空 id 会在扫描时被指出——这类历史数据问题就是引入 id 后第一次被发现），服务启动时对默认数据文件告警。
- **item 元数据改名**：`item.platformTradeId` / `item.platformDealId` 改名为 `platformOriTradeId` / `platformOriTradeDealId`（旧键名会被校验器直接报错，避免筛选静默失效；侧栏「平台 Trade ID」筛选与 item 属性浮层已同步改为新键，**界面文案不变**）。
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
| `npm run merge-batch` | 把指定多文件模式批次合并为单文件模式（`node tools/merge-batch.mjs --batch <id>`） |
| `npm run verify:multi` | 多文件模式端到端冒烟验证（`tools/verify-multi-mode.mjs`） |
| `npm run clean` | 清理仓库根的本地构建/运行产物（`bin/` `build/` `.gradle/` `generated/` `logs/` `.apt_generated*`；`--all` 连 `target/`） |
| `npm test` | 运行全部测试（`node --test`） |

## HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/` | 查看器首页 |
| `GET` | `/config.json` | 统一配置（租户模式下 `urls.batches` 重写为 `/tenant/`、`urls.ignore` 重写为 `/tenant/<urls.ignore>`，并注入解析后的 `features.revealPath`） |
| `POST` / `GET` | `/scan` | 触发一次完整批次扫描（同步返回结果）；已有扫描在跑返回 **409**，失败返回 **500** `{ ok:false, error }` |
| `GET` | `/scan/progress` | 扫描进度 SSE（`text/event-stream`） |
| `GET` | `/tenant/...` | 租户数据根内的文件（批次索引 / 批次数据 / 租户级 `favorites.json`、`ignore-config-by-platform.json` 等）；无租户文件时回退到共享 web 根，均无则 404 |
| `GET` / `POST` | `/api/batch` | 批次元数据读取 / 写回。`GET /api/batch?id=<batchId>`（也接受 `batchId=`）返回 `{ ok, batchId, meta, etag }`（`etag` 为当前 `batch-meta.json` 的强 ETag；文件不存在时为 `null`，缺 id 返回 **400**、批次不存在返回 **404**）。`POST` 的 body 为任意组合：`{ "batchId": "...", "deleted": true }` / `{ "favorite": true }` / `{ "batchName": "...", "description": "..." }` / `{ "tags": ["a","b"] }`；`tags: []` 或空 `description` 表示清除对应字段，空 `batchName` 返回 **400**。**写回后服务端会自动重建 `batches-index.json`**，保证刷新页面立即读到新值（收藏标记 / 标签 / 名称 / 软删除状态）；成功响应带新 `etag` |
| `POST` | `/api/reveal` | 在系统文件管理器中打开批次目录（body：`{ "path": "<批次目录绝对路径>" }`）；需 `features.revealPath` 开启，路径限定在 `scan.basedir` 内。返回 `{ ok, path, launcher }`；启动文件管理器失败（如系统未找到可执行文件）返回 **500** 并给出原因，前端提示「打开目录失败」。 |
| `GET` / `POST` | `/api/favorites` | 收藏夹读取 / 整树保存（body：`{ "favorites": {...}, "ifMatch": "<GET 返回的 etag>" }`） |
| `GET` / `POST` | `/api/ignore` | 忽略配置回写（body：`{ "url": "<当前生效的配置地址，缺省用 config.urls.ignore>", "config": {…分组结构…} }`）；仅允许写入 `config.urls.ignore` 指向的配置文件**或** `scan.basedir` 内的 `.json`（批次级忽略配置），路径需落在允许的根目录内（非租户：web 根；租户：租户数据根，`/tenant/` 前缀自动剥离），原子写入 |
| `GET` | `/status` / `/health` | 服务状态与当前配置（含 `version` 与 `tenant` 块） |

> **写操作通用约束**（`POST /scan` 与全部 `POST /api/*`）：仅允许**同源**调用（带 `Origin` 时其 host 必须与请求 Host 一致，跨源返回 **403**；不带 `Origin` 的 curl/脚本不受限）；请求体上限 **256 KiB**（超出返回 **413**）。
>
> **静态资源压缩**：静态文件（HTML / CSS / JS / MJS / JSON / SVG / TXT）按 `Accept-Encoding` 走 **brotli（优先）/ gzip**，并与强 `ETag` + `Cache-Control: no-cache` 共存（`If-None-Match` → **304**）；压缩结果按 `ETag` 缓存，重复请求不重复压缩。API 响应（`no-store`）与 `/scan/progress`（SSE）不压缩。
>
> **乐观并发**（`/api/ignore`、`/api/favorites`、`/api/batch`）：写入后可得到新 `etag`；客户端应把加载/上次写入得到的 `etag` 作为 `ifMatch` 回传（也接受 `If-Match` 请求头，`*` 表示不校验），若服务端文件已被其他会话修改则返回 **409** 且不写入（不匹配时响应仍带服务端当前 `etag`，文件不存在时 `etag` 为 `null`，首次写入可省略 `ifMatch`）。

## 项目结构

```
src/
├── server.js                  # 统一 HTTP 服务入口（静态站点 + 扫描/写回 API）
├── config.json                # 统一配置（服务端 + 浏览器共用）
├── config-dev.json / config-test.json / config-prod.json   # 按 profile 的配置
├── package.json
├── lib/
│   ├── config.js              # 配置加载器（config.json + 环境变量 + CLI）
│   ├── scanner.js             # 批次扫描器（异步，带 onProgress 进度回调）
│   ├── validate.js            # 数据校验器（validateDataset / validateFile）
│   ├── reveal.js              # 「在系统文件管理器中打开目录」（Launcher 解析 + 错误上抛）
│   ├── json-write.js          # 数据 JSON 输出策略（默认紧凑 + 结尾换行；pretty 可选）
│   └── sample-data.js         # 样例数据生成器（buildDataset / splitToFiles）
├── public/                    # Web 根目录（静态资源与数据）
│   ├── index.html             # 查看器页面（UI 结构与样式）
│   ├── app.js                 # 查看器逻辑（ES 模块，UI 与状态）
│   ├── core.js                # 纯函数核心（无副作用，主线程/Worker/测试共用）
│   ├── worker.js              # 计算 Worker（健康总览 / 全局搜索）
│   ├── themes.css / i18n.json / batch-help.json
│   ├── config.schema.json     # config.json 的 JSON Schema（校验用）
│   ├── report-validation-data.json            # 主数据文件（单文件或多文件清单，同时充当默认模板数据）
│   ├── ignore-config-by-platform.json         # 忽略配置（默认 {}，运行期回写）
│   ├── favorites.json                         # 收藏夹（运行期写入，租户模式下按租户隔离）
│   ├── batches-index.json                     # 批次索引（扫描输出）
│   └── batches/               # 批次目录（扫描 basedir）
├── tools/
│   ├── generate-sample-data.js
│   ├── merge-batch.mjs          # 批次模式转换：多文件模式 -> 单文件模式（租户/非租户均支持）
│   ├── verify-multi-mode.mjs    # 多文件模式端到端冒烟验证（临时 web 根 + 起服务 + HTTP 断言）
│   └── clean.js                 # 清理仓库根的本地构建/运行产物（npm run clean）
├── test/
│   ├── pure-logic.test.js     # 纯函数回归测试（含忽略 key/导入解析）
│   ├── scanner.test.js        # 扫描器测试（含 deleted/tags）
│   ├── validate.test.js       # 数据校验器测试
│   ├── sample-multi.test.js   # 多文件模式样例生成（清单 + item 相对路径）
│   ├── merge-batch.test.js    # 批次模式转换：多文件 -> 单文件（合并/备份/dry-run/错误分支）
│   ├── desc-ex.test.js        # 任务说明扩展内容（descriptionEx）：表格解析/搜索/排序/分页
│   ├── ignore-manage.test.js  # 忽略配置管理：key 解析、列出/排序、筛选规则、命中计数、三态排序、批量删除
│   ├── i18n.test.js           # i18n 契约：3 语言键 1:1、零死键、源码引用键已定义、descriptionEx 键齐备
│   ├── config.test.js         # 配置加载测试（默认值/环境变量/租户）
│   ├── batch-meta.test.js     # 批次元数据测试
│   ├── reveal.test.js         # 打开目录 Launcher 解析与错误传播
│   └── server.test.js         # 服务集成测试
└── docs/
    ├── README.md
    ├── CONFIG.md
    ├── DATA_SCHEMA.md
    ├── LOCAL_CACHE.md
    └── REFACTOR_PLAN.md        # 项目级重构计划与实施方案（兼容层清理 / 生成器去重 / 前端拆模块 / 体积优化）
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
- **两种模式的顶层字段一致**：`reportEnv` / `creationType`（`sample`|`user`）/ `skippedItems` 在单文件数据集与多文件清单中都存在（`creationType` 决定 Sample 徽标与「示例数据」提示，缺省按 `sample` 处理）。
- 多文件模式：清单中的每个 item 带 `file` 与预计算 `summary`，查看器动态加载 item 文件；搜索/筛选/统计仍作用于全部 item 的合并数据。
- 多文件模式下 item 文件路径**相对清单文件所在目录**解析（根目录与批次目录清单都适用）；主数据 / 默认模板数据 / 批次数据在两种模式下的文件形态一致（`multi` 时均为清单）。
- 每个 item 内联 `ctxDefs`，但只写 `{ id, hits }`（定义在顶层 `usedCtxKeyDefs`，`id` / `type` / `rules` / `def`）。
- 字段定义声明表在每个报告渠道里（`reportChannelDefs[].fieldDefs`，`id` / `name` / `userTag` / `type`），item 只写字段 id 引用。
- **模式转换**：`node tools/merge-batch.mjs --batch <id>` 可把多文件批次合并为单文件（清单 `mode` 改为 `single`、item 内联；
  除 `mode` / `items` 外的清单顶层字段与 item 顺序原样保留；合并前自动备份原清单为 `<清单名>.multi.bak`，**item 文件不删除**，
  因此可用 `splitToFiles` 再拆回去）；命令默认会刷新 `batches-index.json`，使 `summary.items` 与 `mode` 立即生效（`--no-scan` 可跳过）。

## 生成样例数据

```bash
node tools/generate-sample-data.js            # 单文件模式
node tools/generate-sample-data.js --split    # 多文件模式（主清单 + data/items/*.json）
node tools/generate-sample-data.js --batch    # 更新全部样例批次（通用切片 + 多文件批次 + 特殊用途批次）
node tools/generate-sample-data.js --special  # 仅更新特殊用途批次（单来源渠道 / 批次分页 / 批次软删除）
node tools/generate-sample-data.js --pretty   # 输出缩进版 JSON（仅供人工排查；默认紧凑，体积约为一半）
node tools/merge-batch.mjs --list              # 列出批次及其当前模式（单文件 / 多文件）
node tools/merge-batch.mjs --batch <batchId>   # 把该多文件批次合并为单文件（原地覆盖清单 + 自动备份 + 刷新索引）
node tools/merge-batch.mjs --batch <目录> --dry-run        # 只检查与统计，不写任何文件
node tools/merge-batch.mjs --batch <目录> --tenant[=id]    # 租户模式（批次根/索引按租户数据根解析；--no-tenant 相反）
node tools/verify-multi-mode.mjs              # 多文件模式端到端冒烟验证（自动清理临时目录）
node tools/verify-multi-mode.mjs --keep       # 同上，但保留临时 web 根并打印手工浏览命令
```

`verify-multi-mode.mjs` 会在临时目录造一份 multi 数据（主清单 + 默认模板清单 + `data/items/*.json` + 一个单文件批次 + 一个多文件批次），
以 `REPORT_VIEWER_WEBROOT` 指向它启动 `server.js`，然后断言：清单结构 / 每个 item 文件可按「相对清单目录」加载 /
默认模板清单存在 / 批次清单相对路径解析 / 索引不含 `dataMode` / `cwd` / 单文件与多文件批次共存（共 17 项，全部通过则退出码 0）。

生成批次后需触发一次扫描（`GET /scan` 或界面「刷新批次」）以更新 `batches-index.json`。

> 切片批次与特殊用途批次是从完整数据集里**重新拼出顶层对象**写的（`batchDataset()`），因此必须把三张声明表
> （`reportChannelDefs` / `sourceChannelDefs` / `usedCtxKeyDefs`）一起带上：漏掉就会变成「item 引用了未声明的渠道」形态，
> `lib/validate.js` 会拒绝、查看器也补不出名称。多文件批次的清单同理必须声明 item 文件里出现的全部渠道 / 来源渠道
> （`splitToFiles()` 在缺少声明表时会尝试从 item 里的定义补出）。这两点都有落盘样例数据的守卫测试（`test/declaration-contract.test.js`）。

### 特殊用途样例批次

除通用切片批次（每批 2 / 4 个 item）外，`--batch` / `--special` 还会生成三个固定用途的样例批次：

| 批次目录 | items | 批次名 / 用途 |
| --- | --- | --- |
| `batches/2026-08-17/batch-20260817-0900` | 18 | `single-source-20260817-单一来源渠道测试`：全部 item 仅含 1 个来源渠道（`sourceCount=1`）；标签 `单一来源` / `渠道测试` |
| `batches/2026-08-17/batch-20260817-1200` | 28 | `paging-20260817-批次分页测试-28items`：验证 item 列表分页（8/页 → 4 页）与字段 / 消息表分页（20/页）；标签 `分页测试` / `28items` |
| `batches/2026-08-17/batch-20260817-1500` | 1 | `deleted-20260817-批次软删除测试`：`batch-meta.json` 默认带 `deleted` 标记，默认范围不可见，需切到「全部批次(含已删除)」范围查看（仅供查看，不可加载）；标签 `软删除` / `分页测试` |

这三类批次自带 `batch-meta.json`，且**不参与通用切片**（否则每次 `--batch` 都会被覆盖成 2 / 4 个 item）。

其中 `batch-20260817-1200` 与多文件批次 `batch-20260816-1700` 还带 `descriptionEx`（`contentType: "markDownTable"`，18 行表格）示例，
用于验证「任务说明」末尾的只读 Markdown 表格：表头 `⚲` 字段筛选 / 列排序（升序 → 降序 → 原序）/ 分页（默认 5 行/页，共 4 页 → 工具与页码均展示）。

## License

MIT
