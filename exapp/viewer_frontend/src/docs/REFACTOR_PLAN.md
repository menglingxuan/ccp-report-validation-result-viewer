# 全量重构计划与实施方案

> 目标：在不改变任何现有**行为 / 交互 / 历史优化**的前提下，做一次**项目级**重构 —— 删除一切不必要的向后兼容代码、过时的测试与文件，
> 收敛重复实现，拆开单体模块，让整体结构更精简、逻辑更清晰、后续演进更便宜。
>
> 本文是施工图，不是提案清单：每一项都写了**具体文件、具体动作、验收方式**。
> 数据契约以 `docs/DATA_SCHEMA.md`（本轮刚统一为三张声明表 + 规则名 + `fieldDefs` + `valueSrcFmt`）为唯一基准，重构期间**冻结契约**。

---

## 0. 前置结论（本轮已完成，作为重构的起跑线）

| 项 | 状态 |
|---|---|
| 数据契约 | 已统一：根级 `reportChannelDefs` / `sourceChannelDefs` / `usedCtxKeyDefs` → `skippedItems` → `items`（键顺序固定）；item 只留 id 引用；消息只写名称；日志 / `skippedItems` 保留 id；item 元数据为 `platformOriTradeId` / `platformOriTradeDealId` |
| 三层校验 | JS `lib/validate.js`、Java `ValidationJsonGenerator.hoistRegistries()`、查看器 `hydrateDataset()` 三者对同一契约一致 |
| 测试基线 | JS **197/197**、Java **21/21**、`tools/verify-multi-mode.mjs` **27/27**（含键顺序断言）、Java 与 JS 产出的全部数据文件过 JS 校验器 0 错 |
| 浏览器基线 | 单文件与多文件批次（`batch-20260816-1700`）均正常：渠道选项卡 HKTR/JSFA/CFTC，完整日志 307 行 / 234 个日志锚点（`log-1-1-f1.1` + `data-log-key=1|1|1`），ctx 弹框规则徽章 `fmd`/`cvt`/`vdt` 与定义、命中均正确 |
| 已提前完成的重构项 | ① 双击判定窗口（`scheduleFieldClick` / `FIELD_CLICK_DELAY_MS` / `cancelFieldClick`）已删除（关联字段改单击即时响应，跳日志统一走详情页 ▸）；② 旧键名（`ctxKeyDefs` / `platformTradeId` / `platformDealId`）与更早的 `channels` / `sources` / `srcType` 已全部纳入校验器报错清单 |

**这些数字是每一步重构后的回归门（见 §7）。**

---

## 1. 重构原则（不可违反）

1. **行为冻结，结构放开**：UI 交互、URL 深链接、忽略配置口径、统计口径必须逐字保持（已有大量测试与浏览器基线守护）；
   唯一的例外是用户明确提出的交互调整（如本轮取消「关联字段」双击跳转）——这类改动必须先改测试与文档，再改代码。
2. **契约单一来源**：同一份数据契约只能有一处权威定义（文档 + 一处 schema + 一处校验实现），不允许 JS / Java / 文档三处各写一版规则。
3. **无兼容层**：不保留「旧的也能读」的双形态代码。老数据一律先过迁移工具，然后**把迁移工具一起删掉**。
4. **一次一项、每项可回滚**：每个阶段独立提交，阶段末必须跑满 §7 的验证门。
5. **删除优先于新增**：任何「先留着以后可能有用」的代码，一律删除（`prints` 这类已经明确不再读取的字段就是典型）。
6. **不做纯风格搬动**：重构必须带来可量化收益（行数 / 文件数 / 重复实现数 / 体积 / 加载时间），否则不做。

---

## 2. 现状盘点（重构对象的量化基线）

### 2.1 前端（`exapp/viewer_frontend/src`）

| 文件 | 行数 | 大小 | 问题 |
|---|---:|---:|---|
| `public/app.js` | 6725 | 378 KB | **单体**：状态、DOM 渲染、事件、i18n 绑定、Worker 通信、批次管理全在一个文件 |
| `public/index.html` | 1505 | 100 KB | 结构与样式混杂，无法分片 |
| `public/i18n.json` | 1310 | 60 KB | 与文案键值硬编码在 app.js 中的调用并存 |
| `public/core.js` | 1205 | 64 KB | 纯函数层，**内含 4 处旧形态兼容分支**（见 §4.1） |
| `lib/sample-data.js` | 751 | 49 KB | 与 Java `ValidationJsonGenerator` **重复实现同一份样例数据** |
| `lib/validate.js` | 505 | 30 KB | 契约校验的 JS 实现（与 Java 测试、文档三处重复） |
| `tools/migrate-legacy-data.js` | 259 | 13 KB | ~~迁移工具（老形态 → 新形态），契约统一后应整体删除~~ → **P1 已删除** |
| `tools/generate-sample-data.js` | 237 | 13 KB | 生成 + 切片 + 批次，一只工具承担 5 种模式 |
| `lib/merge-batch.js` / `lib/scanner.js` / `server.js` | 228 / 250 / 812 | 12 / 12 / 39 KB | `server.js` 同时负责静态服务、压缩、扫描、租户、`POST /api/*` 写回 |
| `test/*.js` | 25 个文件 | — | 夹具各自内联数据集，重复度高 |

### 2.2 Java（`src/main/java/com/otcc/viewer`）

| 文件 | 行数 | 问题 |
|---|---:|---|
| `generator/ValidationJsonGenerator.java` | 1538 | 一次生成 20+ 种文件；`hoistRegistries` + 声明表 + 消息 + 日志 + 批次索引全在一个类 |
| `generator/BasicDataGenerator.java` | 254 | 与 `MinimalDataGenerator` 大量重复；本轮已删掉一处死变量 |
| `batch/HelloWorldTasklet.java` + `SampleDataBatchConfiguration` | 19 + 92 | ~~**Spring Batch 脚手架遗留**（`helloWorldJob` 仍在注册）~~ → **P1 已删除** |
| `generator/{SampleStyle,BasicStyleGenerator,MinimalStyleGenerator,StyleDataTasklet,SampleDataGeneratorRegistry}` | 34+29+25+44+26 | 样式生成器抽象只服务 2 个样例风格，收益 < 成本 |
| `model/*` | 约 25 个类 | `@JsonInclude(NON_NULL)` 手工标注散布；同一模型同时表达「声明」与「引用」两种形态 |
| 构建 | `pom.xml` **与** `build.gradle` / `settings.gradle` / `gradlew*` / `mvnw*` | **双构建系统并存**（**决定：保留两套**，CI 以 Maven 为准；Gradle 不进删除清单） |

### 2.3 数据与产物

- ~~`public/report-validation-data.json` 与 `public/report-validation-data-default.json`：**SHA 完全相同**~~ → **已合并（P1）**：只留主数据文件。
- `public/batches/**`：52 个文件 / **15.0 MB**（样例批次是仓库里最大的产物）。
- `field.prints`：占文件 8.1%（370 KB / 18 item），**查看器已明确不再读取**。
- 根目录生成物：`bin/`、`build/`、`target/`、`generated/`、`logs/`、`.gradle/`、`.apt_generated*/`（.gitignore 已覆盖，但本地产物仍在）。
- `generated/` 是 Java 测试的落盘目录，既是测试产物又被人工查看，职责重叠。

---

## 3. 目标架构

```
exapp/viewer_frontend/
├─ src/
│  ├─ contract/                     # ★ 单一契约来源（新）
│  │   ├─ schema.json               #   数据文件 JSON Schema（从 public/config.schema.json 拆出的数据部分）
│  │   ├─ rules.js                  #   共享规则表：id 预设、规则名、枚举值、引用完整性规则
│  │   └─ README.md                 #   与 DATA_SCHEMA.md 互链
│  ├─ core/                         # ★ 纯函数层（由 public/core.js 拆出，无 DOM / 无 fs）
│  │   ├─ registry.js               #   三张声明表读取 / hydrate / hoist
│  │   ├─ fields.js                 #   flatFields / 聚合 / 统计
│  │   ├─ logs.js                   #   日志锚点、字段↔日志索引
│  │   ├─ search.js                 #   查询解析 / 匹配 / 排序
│  │   └─ enable.js                 #   enabledChannelsOf 等口径单点
│  ├─ lib/                          # Node 侧（校验、样例生成、扫描、合并、写回）
│  ├─ public/                       # ★ 浏览器交付物
│  │   ├─ app.js                    #   只做装配（< 800 行）
│  │   ├─ ui/{state,render,tables,modals,batch,theme,i18n}.js
│  │   ├─ worker.js
│  │   └─ *.css
│  ├─ tools/                        # CLI
│  └─ test/                         # 夹具移到 test/fixtures/，按层组织（core / lib / tools）
└─ docs/
```

Java 侧目标：

- `generator/` 拆成 `DatasetAssembler`（组数据）、`RegistryHoister`（声明表提升）、`ArtifactWriter`（落盘：数据 / 索引 / meta / 样式）、`SampleContent`（样例文案与字段表）。
- ~~删除 `batch/HelloWorldTasklet`~~（P1 已完成）、`SampleStyle` 体系（**暂缓**：`generate --style` 是已写进 README 的 CLI 能力，需单独决定）；**Gradle 与 Maven 双构建保留**（决定见 P5）。
- `model/` 拆成 `model/declaration/*`（声明表：`ChannelDef` / `SourceChannelDef` / `CtxKeyDef` / `FieldDef`）与 `model/item/*`（item 侧：`ChannelRef` / `SourceRef` / `Field` / `CtxHit`），
  **从此不再需要靠 `@JsonInclude(NON_NULL)` 让同一个类承担两种形态**（这是当前最容易写出 bug 的地方）。

---

## 4. 分阶段实施方案

### P1 — 兼容层与死代码清理（低风险，先做）

**P1 进度：JS 侧 4.1 已完成（除 `validate.js` 提示性报错的收尾复检），4.2 已完成 HelloWorld + `ItemLog.channel/.source`，`SampleStyle` 体系暂缓，Gradle 保留；4.3 决定不实施；4.4 待做。**

**4.1 删除 JS 侧旧形态分支**（✅ 已完成）

| 位置 | 动作 |
|---|---|
| `core.js` `normalizeFieldResult()`（`srcType` → `valueSrcFmt` 归一，约 273–281 行） | 删除整个函数与调用点 |
| `core.js` `collectDefinitions()` 的 `item.fields` 回退（303 / 321 行） | 删除 |
| `core.js` `collectDefinitions()` 的 `side.srcType` 回退（346 行） | 删除 |
| `core.js` `normalizeCtxRules()` 接受数字 `scopes`（370 行） | 只接受规则名数组 |
| `core.js` `hoistRegistries()` 里对根级旧键 `channels` / `sources` 的排除分支 | 删除 |
| `app.js` `ctxRulesOf()` 的 `def.scopes` 回退 + `RULE_LEGACY`（4869 / 4865 附近） | 删除 |
| `validate.js` 「`channels` 已改名」「`srcType` 已改名」「`enabledChannels` 已移除」等**提示性报错** | 保留 1 轮（给使用方迁移窗口），P1 末删除；改为「未知顶层键」统一报错 |
| `tools/migrate-legacy-data.js` | ✅ **P1 已整体删除**（连同脚本、文档迁移章节、老形态用例） |
| `validate.js` 的 `readManifest` / 老形态探测回退 | 删除（只保留当前契约） |
| `lib/sample-data.js` `splitToFiles()` 的「声明表缺失时用 `hoistRegistries` 探针补出」分支 | 删除（生成器必须显式写三张表） |

**4.2 删除 Java 侧旧形态与脚手架**（✅ HelloWorld / ItemLog 已删；其余见备注）

| 位置 | 动作 |
|---|---|
| `batch/HelloWorldTasklet.java` + `SampleDataBatchConfiguration` 的 `helloWorldJob` bean | ✅ 已删除（含 README / CLI 帮助文本） |
| `SampleStyle` / `BasicStyleGenerator` / `MinimalStyleGenerator` / `StyleDataTasklet` / `SampleDataGeneratorRegistry` / `SampleDataGenerator` | **暂缓**：`generate --style` 是 README 已公开的 CLI 能力，删除会减少功能面，需单独确认 |
| `validationJsonJob` 的 `--style` 相关分支（`GenerateCommand` / `SampleDataCommand` 的 `SampleStyle` 字段） | **暂缓**（同上） |
| `build.gradle` / `settings.gradle` / `gradlew` / `gradlew.bat` / `gradle/` | ~~删除~~ → **决定：保留**（双构建并存，CI 以 Maven 为准） |
| `ItemLog.channel` / `.source`（仅读兼容字段） | ✅ 已删除（新契约日志只写 id；`refInScope` 只按 `channelId` 判断） |
| `Message` / `UncomparedEntry` 的注释里残留的 id 双写说明 | 待复查 |

**4.3 删除已无读取方的数据字段**
（决定：不实施，保留 prints）
- `field.prints`：~~删除~~ → **决定保留**（占文件 8.1%，但作为字段级统计留档；查看器仍不读取）。

**4.4 删除重复产物与占位数据**（✅ 已完成）

- ✅ `public/report-validation-data.json` 与 `-default.json` 字节相同 → **删除 `-default.json`**，默认模板数据即主数据文件（`urls.defaultData` 改为可选，留空即用 `urls.data`）；Java 生成器 / JS 工具 / 配置 / Schema / 测试 / 文档同步。
- ✅ `report-validation-data-init.json` + `urls.initData`：**文件与配置键已删除**；`defaultDataMode: "init"` 保留语义但改为**不加载任何文件、直接用空数据集**（`reportEnv: "INIT"`, `items: []`），prod 配置仍从空状态开始。
- ✅ 根目录 `bin/`、`build/`、`.apt_generated*/`、`logs/`、`generated/` 加进清理脚本 `tools/clean.js`（`npm run clean`；`--all` 连 `target/` 一起清）。

**P1 验收**：§7 全门通过；`git diff` 净删除；`grep -r` 旧键（`srcType` / `enabledChannels` / `item.fields` / `scopes`）在**非文档**文件中 0 命中。

---

### P2 — 生成器单一实现（去重 JS / Java 两套样例数据）

**问题**：`lib/sample-data.js`（750 行）与 `ValidationJsonGenerator.java`（1538 行）生成同一份样例数据，字段表、ctx 池、日志文案、批次切片逻辑各写一遍；两边已经数次「一边改了另一边忘」的本轮就发生过（字段 id 编号按 item 子集 vs 渠道全量）。

**方案**（二选一，推荐 A）：
（决定：实施方案A）
- **A. Java 为唯一生成器**：Java 产出全部落盘数据（含 `public/batches/**`、`public/report-validation-data.json`）。
  JS 侧 `lib/sample-data.js` 只保留 `test/fixtures/` 用的**最小夹具构建器**（几十行，不产出落盘文件），
  `tools/generate-sample-data.js` 改为调用 Java CLI（`mvnw -q exec:java` 或直接 `java -jar`）。
- **B. JS 为唯一生成器**：删除 Java `BasicDataGenerator` / `MinimalDataGenerator` / `ValidationJsonGenerator` 的数据内容部分，
  Java 只保留 `validationJsonJob` 的**契约校验 + 批次元数据**能力。

无论 A/B，都要把**字段表 / ctx 池 / 文案**抽成数据文件（`contract/sample-content.json`），由两侧共读。

**P2 验收**：§7 全门通过；落盘数据与重构前**逐字节等价**（或差异仅来自 P1 已批准的字段删除）；生成器实现数从 2 → 1。

---

### P3 — 前端模块化拆分（`app.js` 6741 行 → 分片装配）

按依赖顺序分批搬迁，**每批都是纯搬动 + 显式导入**，不改行为：

1. `core/`：从 `public/core.js` 拆出 `registry.js` / `fields.js` / `logs.js` / `search.js` / `enable.js`（纯函数，先拆，测试不动）。
2. `ui/state.js`：`state`、`state.columns`、深链接 `syncHash()` / `applyHash()`、`savePrefs()`。
3. `ui/i18n.js`：`t()`、`i18n.json` 加载、语言切换。
4. `ui/tables.js`：字段表 / 消息表 / 分页 / 列宽 / 排序 / 筛选浮层。
5. `ui/modals.js`：字段比较详情、ctx 弹框、规则弹框、值面板、忽略管理。
6. `ui/batch.js`：批次面板、收藏夹、扫描、`POST /api/*`、租户。
7. `ui/theme.js`：主题、CSS 变量、`themes.css`。
8. `app.js`：只留装配 + `__test` 入口。

**硬性约束**：

- 保留 `__test` 的对外形状（`setData` / `getData` / `setState` / `setIgnoreConfig`），否则 25 个测试文件全线重写。
- `index.html` 里内联结构与内联事件一并外移到 `ui/`，但 **DOM id / class 名不变**（E2E 与 CSS 依赖它们）。
- 每拆一个文件立刻跑一次 §7（尤其浏览器基线，因为 DOM 结构最容易在搬动时被动到）。

**P3 验收**：`app.js` < 800 行；单文件最大 < 1200 行；§7 全门通过；浏览器基线数字与 §0 完全一致。

---

### P4 — 数据体积与加载性能（承接既有 A/B/C/D/E/F 规划）

前几轮已完成 A 期实测（紧凑 JSON −41%、brotli q9 ≈ 75 KB；`JSON.parse` 4.5 MB 仅 8.4 ms，**不是瓶颈**）。剩余项按性价比排序：

1. **C 日志分组索引（优先）**：`item.logs` 增加 `(channelId,sourceId,field)` → 行号索引，字段↔日志查询 O(1)；
   可删掉 `logFieldKey` 的运行时合成与 `data-log-key` 兜底扫描等一堆补丁（双击判定窗口三轮已删）。
2. **B 分层分片**：`dataset.json`（顶层 + item 索引 + summary）→ `items/<id>.json` → `items/<id>.logs`，首屏与内存 O(1)。
3. **F 摘要先行 + 倒排索引**：`byResult` / `byField` / 异常字段列表，侧栏筛选与全局搜索从 O(总行数) 降到 O(命中)。
4. **D 声明表共享的进一步复用**：本轮三张声明表已把「定义」收敛；下一步可把规则表达式 `el` 池化（2484 处 / 53 唯一）。
5. **E / G 暂缓**：列式化与虚拟滚动只在行数上万后才有净收益（已实测同列对象→数组仅省 11.2%）。

**P4 验收**：首屏字节 / gzip / brotli 三项不回退；`JSON.parse` 与首屏渲染时间不回退；§7 通过。

---

### P5 — 构建、CI 与文档收敛
（决定：第 1 个 bullet point 调整为仍同时保留 gradle 和 maven 两套构建体系）
- **双构建并存**：`pom.xml` + `mvnw` 与 `build.gradle` + `gradlew` 同时保留，**CI 与门禁以 Maven 为准**（`mvnw -o test`），Gradle 仅作为备用入口且必须保持可编译；JS `node --test` 为唯一 JS 门禁。
- **一条命令跑全门**：`npm run verify` = JS 测试 + Java 测试 + `validate.js` 落盘数据 + `verify-multi-mode.mjs`（当前需要人工分 4 步）。
- **契约单点**：`docs/DATA_SCHEMA.md` 的结构部分改为从 `contract/schema.json` 生成，避免「文档与校验器各说一套」。
- **文档瘦身**：`README.md` 已 274 行、`DATA_SCHEMA.md` 463 行，把历史沿革（「旧形态已移除」的说明）移入 `docs/HISTORY.md`，主文档只描述当前状态。

---

## 5. 明确要删除的清单（汇总，逐条可执行）

| # | 对象 | 位置 | 理由 |
|---|---|---|---|
| 1 | `srcType` 兼容归一 | `core.js` / `validate.js` | 契约已改 `valueSrcFmt`，且无老数据外流 |
| 2 | `item.fields` 老形态回退 | `core.js` / `validate.js` | 已迁到 `reportChannelDefs[].fieldDefs` |
| 3 | `usedCtxKeyDefs` 旧 `scopes`（数字）兼容 | `core.js` / `app.js` | 已改 `rules`（fmd / cvt / vdt 规则名）→ ✅ 已删 |
| 4 | `enabledChannels` 检测分支 | `validate.js` / `core.js` 注释 | 契约早已单点化 |
| 5 | 根级 `channels` / `sources` 识别 | `validate.js` / `core.js` / `sample-data.js` | 已改名 |
| 6 | `tools/migrate-legacy-data.js` 及其文档章节 / 测试用例 | `tools/` / `docs/` / `test/` | 迁移窗口结束后无用 → ✅ 已删 |
| 7 | `field.prints` | Java `Field` / `sample-data.js` / 文档 / 测试 | 查看器不再读取，占文件 8.1% → **决定保留，不删** |
| 8 | `ItemLog.channel` / `.source` | Java model | 日志只写 id → ✅ 已删 |
| 9 | `HelloWorldTasklet` + `helloWorldJob` | Java batch | Spring Batch 脚手架遗留 → ✅ 已删 |
| 10 | `SampleStyle` 体系（6 个文件） | Java generator / cli | 只有一种样例风格 → **暂缓**（`generate --style` 已公开） |
| 11 | `report-validation-data-init.json` + `init` 分支 | `public/` / `app.js` | 用「0 项空数据集」表达空状态 → ✅ 已删（`init` 模式改为内置空数据集） |
| 12 | 落盘产物 `generated/` 的双重职责 | Java 测试 | 改为 `target/` 下临时目录，测试不再污染仓库根 |
| 13 | 双份样例生成器（JS 750 行 / Java 1538 行） | 两侧 | 单一实现 |

---

## 6. 风险与已知坑（本轮亲自踩过，施工时必须遵守）

1. **字段 id 必须跨 item 稳定**：登记表按**渠道全量字段名单**编号，绝不能按每个 item 的字段子集编号 —— 否则同一字段在不同 item 拿到不同 id，`hoistRegistries` 会抛「字段 id=X 定义在不同 item 里不一致」（JS / Java 各踩一次）。
2. **`text` 永远不是数据通道**：日志正文（含 `[渠道名]` 前缀）只供人读，任何代码不得从中解析渠道 / 来源（真实数据可能完全不含）。重构拆模块时这条最容易在「顺手取个名字」时被破坏。
3. **Java `ObjectMapper` 是 `Include.ALWAYS`**：可选字段必须显式 `@JsonInclude(NON_NULL)`，否则会吐出 `"channel":null,"source":null` 把省下的字节又还回去（本轮已在 `ItemLog` 上踩过）。P3 拆分模型类时这是首要检查项。
4. **同一模型承担「声明」与「引用」两种形态 = bug 温床**：目标架构里必须拆开（§3），不要再靠 `NON_NULL` 兜。（P1 已删掉 `ItemLog.channel/.source` 这一处）
5. **契约「引用 ⊆ 声明」是硬保证**：删兼容层时要保证生成器仍写三张声明表（切片批次是从数据集**重新拼顶层对象**的，`batchDataset()` 漏带声明表会立刻让全部 24 个样例批次变成非法数据 —— 这是上一轮的真实缺陷）。
6. **`validateDataset` 要区分清单与 item 文件**：多文件清单里 item 只有元数据，校验时不能按 item 文件规则要求 `channels` / `ctxDtls`。
7. **测试夹具必须带三张声明表**：否则会报「未声明」并把注意力引到错误的地方（本轮修过 `validate.test.js` / `pure-logic.test.js`）。
8. **`pure-logic.test.js` 要用 hydrate 后的数据断言**：原始数据没有名称 / `fields`，直接断言会得到 UNDEFINED 噪声。
9. **环境坑**：VS Code 终端会吞 `cd`（一律用绝对路径）；PowerShell 里 `node` 的标准输入是 GBK（脚本内不要放中文，或用 `\uXXXX`）；`create_file` 拒绝覆盖已存在路径。
10. **Java 测试落盘目录**：`OUT_DIR = Path.of("generated")` 是相对 **maven 进程 cwd**（仓库根），不是 PowerShell 的 location。
11. **版本号只有一处**：批次能否加载只看 `batch-meta.json` 的 `formatVersion` 是否在 `config.json` 的 `compatibleApiVersions` 内（默认 `[4]`）；写入方用代码常量（JS `DEFAULT_API_VERSION` / Java `API_VERSION`），不读配置。历史上 `formatVersion` 的白名单写死在代码里、而 `config.json` 另有一个从未被读取的 `configVersion`，导致「两边都改成 3 仍然报不兼容」—— 现已收敛为单一配置项 + 单一常量，并用 `test/version-contract.test.js` 锁定。

---

## 7. 验证门（每个阶段结束必须全过）

| # | 门 | 命令 / 方式 | 期望 |
|---|---|---|---|
| 1 | JS 单测 | `cd exapp/viewer_frontend/src; node --test` | 197/197（P1 删除用例后为新的等价条数，**只允许减少对应用例**） |
| 2 | Java 单测 | `& "<repo>\mvnw.cmd" -o -f "<repo>\pom.xml" test` | 21/21 |
| 3 | 契约校验 | `node lib/validate.js <生成的每个数据文件>` | 全部 `OK`，0 错 |
| 4 | 多文件端到端 | `node tools/verify-multi-mode.mjs` | 27/27 |
| 5 | 浏览器基线（单文件） | `REPORT_VIEWER_PORT=8801 node server.js` + 打开默认数据 | 78 字段 / 7 警告 / 日志行数与锚点数与重构前一致 |
| 6 | 浏览器基线（多文件） | 打开批次 `batch-20260816-1700` | 渠道选项卡 HKTR·JSFA·CFTC；完整日志 **307 行 / 234 锚点**；`log-1-1-f1.1`、`data-log-key=1\|1\|1`；ctx 弹框显示 `fmd`/`cvt`/`vdt` 徽章 + 定义 + 命中 |
| 7 | 深链接与忽略配置 | 手工：`#batch=…&item=…&ch=HKTR&q=…`、忽略某条警告后刷新 | 状态可还原；忽略配置键仍按名称，跨批次有效 |
| 8 | 体积不回退 | 记录 `raw / gzip / brotli` 三项 | 每阶段不得变差（P4 应显著变好） |

---

## 8. 建议提交顺序（每步一次提交，可独立回滚）

1. `chore: 删除 srcType / item.fields / scopes / enabledChannels 兼容分支`（✅ 已做）
2. `chore: 删除迁移工具与旧形态测试用例 + 文档同步`（✅ 已做）
3. ~~`chore: 删除 prints 字段（含生成器与测试）`~~ → **决定不实施**
4. `chore: 删除 Spring Batch 脚手架`（✅ HelloWorld 部分已做；`SampleStyle` 体系暂缓）
5. ~~`chore: 移除 Gradle 构建，CI 收敛到 Maven`~~ → **决定改为「双构建并存，CI 以 Maven 为准」**
6. `chore: 合并重复数据文件，清理生成物目录`
7. `refactor(js): core.js 拆分为 core/*`
8. `refactor(js): app.js 拆分为 ui/*（分批，每批一门）`
9. `refactor(java): generator 拆分 + model 拆声明/引用`
10. `refactor: 样例生成器单一实现（抽 sample-content.json）`
11. `perf: 日志分组索引（C 期）`
12. `perf: 分层分片（B 期）`
13. `perf: 摘要先行 + 倒排索引（F 期）`
14. `docs: DATA_SCHEMA 由 schema 生成，历史沿革移入 HISTORY.md`

---

## 9. 完成定义（DoD）

- 契约只有一处权威定义，且文档由它生成。
- 样例数据只有一份生成实现；`public/` 下不存在同内容副本。
- 仓库内**不存在**任何「旧的也能读」分支；`grep` 旧键名在非文档文件中 0 命中。
- `app.js` < 800 行；`core/`、`ui/` 分层清晰；Java `generator/` 单类 < 800 行。
- 双构建系统并存（Gradle 与 Maven 均保持可编译），门禁以 Maven 为准；一条命令跑满 §7 全部门。
- 首屏字节 / 加载时间不劣于重构前，且 P4 完成后明显更优。
