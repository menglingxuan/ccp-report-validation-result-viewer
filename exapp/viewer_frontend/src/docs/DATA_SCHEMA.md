# 数据说明（DATA SCHEMA）

数据文件位于 web 根目录（`public/`），由 `config.json` 的 `urls.data` / `urls.defaultData` 引用。

- 单文件模式：一个文件包含全部 item。
- 多文件模式：一个**清单文件**（manifest）+ 每个 item 一个独立文件。

两种模式都由顶层 `"mode"` 字段标记：`"single"` 或 `"multi"`（缺省按 `"single"` 处理）。

---

## 1. 单文件模式（`mode: "single"`）

```json
{
  "mode": "single",
  "reportEnv": "OTCXXX",
  "items": [ { "tradeId": "...", "ctxDefs": { }, "channels": [ ] } ]
}
```

| 顶层键 | 类型 | 说明 |
|---|---|---|
| `mode` | 字符串 | `"single"` |
| `reportEnv` | 字符串 | 运行环境标识（可选） |
| `items` | 数组 | 完整 item 列表（每个 item 内联 `ctxDefs`） |

## 2. 多文件模式（`mode: "multi"`）

清单文件（`report-validation-data.json`）：

```json
{
  "mode": "multi",
  "reportEnv": "OTCXXX",
  "items": [
    {
      "tradeId": "T-20240814-1001",
      "reportDate": "2024-08-10",
      "generatedAt": "2024-08-14 10:23:00.000",
      "platform": "OTC-PLATFORM-A",
      "product": "IRS",
      "productCategory": "IR",
      "counterpartyItemId": "T-20240814-1002",
      "platformTradeId": "PT-20240814-1001",
      "platformDealId": "PD-20240814-1001",
      "enabledChannels": ["HKTR", "JSFA", "CFTC"],
      "file": "data/items/T-20240814-1001.json",
      "summary": {
        "total": 78, "passed": 64, "failed": 14, "rate": 82,
        "warnings": 5, "warningsIgnored": 0, "errors": 3, "uncompared": 1, "logs": 62
      }
    }
  ]
}
```

| 清单 item 键 | 类型 | 说明 |
|---|---|---|
| `tradeId` / `reportDate` / `generatedAt` / `platform` / `product` / `productCategory` | 字符串 | item 元数据（供侧栏搜索/筛选） |
| `counterpartyItemId` / `platformTradeId` / `platformDealId` | 字符串 | 可选元数据 |
| `enabledChannels` | 字符串数组 | 启用渠道 |
| `file` | 字符串 | 该 item 完整数据文件的路径（相对 web 根目录） |
| `summary` | 对象 | 预计算统计摘要（侧栏与统计卡无需加载完整 item） |

每个 item 文件内容与单文件模式中的 item 结构相同（含 `ctxDefs`、`channels`、`skippedItems`、`overviewLogs`）。

> 多文件模式下：查看器先加载清单（轻量），点击 item 时按需加载完整文件；搜索/筛选/统计对全部 item 的合并数据生效。

---

## 3. item 结构

| 键 | 类型 | 说明 |
|---|---|---|
| `tradeId` | 字符串 | item 唯一标识 |
| `reportDate` | 字符串 | 报告日期（`YYYY-mm-dd`） |
| `generatedAt` | 字符串 | 生成时间 |
| `platform` / `product` / `productCategory` | 字符串 | 平台 / 产品 / 产品类别 |
| `counterpartyItemId` / `platformTradeId` / `platformDealId` | 字符串\|空 | 对手方 / 平台标识 |
| `ctxDefs` | 对象 | **命中上下文定义（每个 item 独立）** |
| `enabledChannels` | 字符串数组 | 启用渠道名 |
| `channels` | 数组 | 各渠道比较结果 |
| `skippedItems` | 数组 | 未比较 item 记录 |
| `overviewLogs` | 字符串数组 | 汇总日志 |

### `item.ctxDefs`

```json
"ctxDefs": {
  "hktr.ctx.default": { "type": [1], "def": "HKTR 默认上下文（标准报送场景）", "hits": "命中 3 个映射条目（EO 2 / AO 1）" },
  "hktr.ctx.conv.default": { "type": [2], "def": "…", "hits": "…" },
  "hktr.ctx.val.default": { "type": [3], "def": "…", "hits": "…" }
}
```

| 键 | 类型 | 说明 |
|---|---|---|
| `type` | 整数数组 | CtxKey 类型数组：`1` 字段映射规则 / `2` 值转换规则 / `3` 终值校验规则；同一 ctx key 可配置在多种规则中，故为数组（兼容旧数据的单值整数） |
| `def` | 字符串 | 上下文定义 |
| `hits` | 字符串 | 命中说明 |

> 说明：`ctxDefs` 已从顶层迁移到 **每个 item 内部**（每个 item 的 def/hits 定义并不相同），
> 并为每个 CtxKey 增加 `type` 字段（数组）。主列表「命中Ctx」列展示所有 CtxKey（统一主题配色标签）；
> 字段详情页各规则 section 通过判断 `type` 是否包含对应值来归类 CtxKey；
> 点击 Ctx 标签弹出的命中详情会展示该 CtxKey 的**全部 type** 徽章。

## 空占位数据（`report-validation-data-init.json`）

用于空占位（0 个 item）的最小数据集：

```json
{ "mode": "single", "reportEnv": "INIT", "items": [] }
```

将其临时改名为 `report-validation-data-default.json` 后，查看器会加载空数据集并展示友好的空状态（不崩溃）。

## 4. channel

| 键 | 类型 | 说明 |
|---|---|---|
| `name` | 字符串 | 渠道名（HKTR/JSFA/CFTC） |
| `desc` | 字符串 | 渠道描述 |
| `format` | 字符串 | `xml` 或 `csv` |
| `files` | 对象 | 输入/配置文件（`eo` / `ao` / `excel`） |
| `sources` | 数组 | 来源渠道（A/B） |
| `warnings` / `errors` | 数组 | 警告 / 错误消息 |
| `uncompared` / `uncomparedCsv` | 数组 | 未比较 XPath / CSV 字段 |
| `logs` | 字符串数组 | 渠道日志 |

## 5. field（`channel.sources[].fields[]`）

| 键 | 类型 | 说明 |
|---|---|---|
| `id` / `f` / `x` / `aoCsv` | 字符串 | 字段标识 / 报告字段名 / XPath / CSV 字段 |
| `t` | 字符串 | 断言类型（platformAssertion / productAssertion / contextAssertion） |
| `k` | 字符串 | 值类型（num/date/id/code/text/product/multi…） |
| `ctx` | 字符串数组 | 命中上下文 |
| `eo` / `ao` | 字符串 | 期望值 / 实际值 |
| `result` | 字符串 | `PASSED` 或 `FAILED` |
| `note` / `resultNote` | 字符串 | 说明 / 结果说明 |
| `eoConverted` / `eoUnconverted` | 布尔 / 字符串\|null | EO 转换标记与原始值 |
| `extraResults` | 数组 | 额外结果 `[{label, value}]` |
| `conversionRule` / `validationRule` | 对象\|null | 转换 / 校验规则 `{ctx, value}` |
| `excelMapping` / `excelConversionRule` / `excelValidationRule` | 字符串 | Excel 配置文本 |
| `prints` | 字符串数组 | 相关打印信息 |

## 6. 批次元数据（`batch-meta.json`）与索引（`batches-index.json`）

批次目录可包含 `batch-meta.json`（可选）与 `report-validation-data.json`（单文件或多文件清单）。扫描器 `lib/scanner.js` 支持两种数据模式：

- 优先读取 `batch-meta.json` 的 `reportEnv` / `dataUrl` / `summary`。
- 否则回退到数据文件（单文件或多文件清单）的顶层 `reportEnv`，item 数量取 `items.length`。

索引 `batches-index.json` 的 `batches[]` 除原有字段外，增加 `dataMode`（`"single"` / `"multi"`），供查看器按需加载。
