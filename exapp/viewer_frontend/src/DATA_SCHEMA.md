# 数据说明（DATA SCHEMA）

> 文件：`engine/deepseek-validation-data.json`
> 顶层：`{ "items": [...], "ctxDefs": {...}, "reportEnv": "..." }`

本文档描述数据 JSON 的结构，便于外部工具生成或替换真实数据。查看器对缺失字段有兼容回退。

---

## 顶层

| 键 | 类型 | 说明 |
|---|---|---|
| `items` | 数组 | 比较 item 列表 |
| `ctxDefs` | 对象 | 命中上下文（ctx）的定义，key 为 ctx 名，值为 `{ def, hit }` 等 |
| `reportEnv` | 字符串 | 运行环境标识（可选；缺失时查看器回退为内置默认值） |

---

## item（`items[]`）

| 键 | 类型 | 说明 |
|---|---|---|
| `tradeId` | 字符串 | item 唯一标识 |
| `reportDate` | 字符串 | 报告日期（`YYYY-mm-dd`） |
| `generatedAt` | 字符串 | 生成时间 |
| `platform` | 字符串 | 平台 |
| `product` | 字符串 | 产品 |
| `productCategory` | 字符串 | 产品类别（IR/CD/FX 等） |
| `counterpartyItemId` | 字符串\|空 | 对手方 item id（可空） |
| `platformTradeId` | 字符串\|空 | 平台交易 id |
| `platformDealId` | 字符串\|空 | 平台交易编号 |
| `enabledChannels` | 字符串数组 | 启用的报告渠道名（HKTR/JSFA/CFTC） |
| `channels` | 数组 | 各渠道比较结果 |
| `skippedItems` | 数组 | 未比较 item 记录 |
| `overviewLogs` | 字符串数组 | 汇总日志 |

---

## channel（`item.channels[]`）

| 键 | 类型 | 说明 |
|---|---|---|
| `name` | 字符串 | 渠道名（HKTR/JSFA/CFTC） |
| `desc` | 字符串 | 渠道描述 |
| `format` | 字符串 | `xml` 或 `csv` |
| `files` | 对象 | 输入/配置文件（见下） |
| `sources` | 数组 | 来源渠道（A/B） |
| `warnings` / `errors` | 数组 | 警告 / 错误消息 |
| `uncompared` | 数组 | 未比较 XPath（xml 渠道） |
| `uncomparedCsv` | 数组 | 未比较 CSV 字段（csv 渠道） |
| `logs` | 字符串数组 | 渠道日志 |

### `files`

| 键 | 类型 | 说明 |
|---|---|---|
| `eo` | 数组 | 来源 CSV 文件，元素可为 `"文件名"` 或 `{"name": "文件名", "path": "相对路径"}` |
| `ao` | 数组 | 报送文件（xml 渠道为 XML、csv 渠道为 CSV），元素格式同上 |
| `excel` | 对象 | `{ "file": "mapping.xlsx", "sheet": "HKTR", "path": "相对路径"(可选) }` |

---

## field（`channel.sources[].fields[]`）

| 键 | 类型 | 说明 |
|---|---|---|
| `id` | 字符串 | 字段唯一标识 |
| `f` | 字符串 | 报告字段名 |
| `x` | 字符串 | CCP XPath（xml 渠道；csv 渠道为空） |
| `aoCsv` | 字符串 | CCP/AO CSV 字段名（csv 渠道；xml 渠道为空） |
| `t` | 字符串 | 断言类型（platformAssertion/productAssertion/contextAssertion） |
| `k` | 字符串 | 值类型（num/date/id/code/text/product/multi…） |
| `ctx` | 字符串数组 | 命中上下文 |
| `eo` | 字符串 | 期望值（真实 EO） |
| `ao` | 字符串 | 实际值（真实 AO；xml 渠道即 XPath 值） |
| `result` | 字符串 | `PASSED` 或 `FAILED` |
| `note` | 字符串 | 说明/原因（列表「说明」列） |
| `resultNote` | 字符串 | 结果说明（详情页「结果」字段，与 `note` 独立） |
| `eoConverted` | 布尔 | 是否发生 EO 转换 |
| `eoUnconverted` | 字符串\|null | 未转换原始值 |
| `extraResults` | 数组 | **额外结果（type 2）**：`[{ "label": "...", "value": "..." }]`，显示在 AO 下方 |
| `conversionRule` / `validationRule` | 对象\|null | 转换/校验规则 `{ ctx, value }` |
| `excelMapping` / `excelConversionRule` / `excelValidationRule` | 字符串 | Excel 配置文本 |
| `prints` | 字符串数组 | 相关打印信息 |

> 兼容说明：
> - `files.eo/ao` 元素既可为字符串也可为 `{name,path}` 对象，查看器都能处理。
> - 若字段缺 `extraResults`，查看器回退为 EO/AO/Unconverted 的标准展示。
> - 若字段缺 `results`（旧格式），同样回退到 `eo`/`ao`。

---

## 消息（`warnings` / `errors`）

| 键 | 类型 | 说明 |
|---|---|---|
| `type` | 字符串 | 类型（platformAssertion/productAssertion/contextAssertion 等） |
| `level` | 字符串 | 级别（warning/error） |
| `field` | 字符串 | 关联字段名 |
| `text` | 字符串 | 消息内容 |
| `xpath` / `csvField` | 字符串 | 关联 XPath / CSV 字段 |
| `ctx` | 字符串 | 命中上下文 |

## 未比较记录（`uncompared` / `uncomparedCsv` / `skippedItems`）

| 键 | 类型 | 说明 |
|---|---|---|
| `xpath` / `csvField` | 字符串 | 未匹配的 XPath / CSV 字段 |
| `itemId` | 字符串 | 未比较 item id（skippedItems） |
| `channel` | 字符串 | 渠道 |
| `reason` | 字符串 | 未比较原因 |

---

## 批次元数据（`batch-meta.json`）

> 文件：`engine/batches/<date>/<batch-id>/batch-meta.json`

批次目录的可选元数据；`scan-batches.js` 扫描时优先读取，缺失时回退到数据文件推断。

| 键 | 类型 | 说明 |
|---|---|---|
| `batchId` | 字符串 | 批次唯一标识（缺省用目录名） |
| `batchName` | 字符串 | 批次显示名 |
| `date` | 字符串 | 批次日期（`YYYY-mm-dd`） |
| `executedAt` | 字符串 | 执行时间（ISO） |
| `formatVersion` | 整数 | 数据格式版本（当前 2） |
| `dataUrl` | 字符串 | 数据文件相对路径（相对 web 根目录） |
| `ignoreUrl` | 字符串 | 忽略配置相对路径 |
| `commandLine` / `argv` | 字符串数组 | 命令行参数 |
| `cwd` | 字符串 | 工作目录 |
| `description` | 字符串 | 批次描述（多行；前端「任务说明」回退来源） |
| `summary` | 对象 | `{ items, channels }` 摘要 |
| `reportEnv` | 字符串 | 运行环境标识（如 `OTCXXX`；优先于数据文件顶层） |

## 批次索引（`batches-index.json`）

> 文件：`engine/batches-index.json`（`scan-batches.js` 生成）

| 键 | 类型 | 说明 |
|---|---|---|
| `schemaVersion` | 整数 | 索引结构版本 |
| `generatedAt` | 字符串 | 扫描时间（ISO） |
| `basedir` | 字符串 | 批次根目录 |
| `count` | 整数 | 批次数量 |
| `batches[]` | 数组 | 批次条目（字段同 `batch-meta.json`，另含 `path`、解析后的 `dataUrl`/`ignoreUrl`） |

`batches[].reportEnv` 供前端「报告环境」筛选与环境徽章使用；`description` 供任务说明展示。
