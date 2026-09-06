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
| `fields` | 数组 | **字段定义注册表（按字段名去重）** |
| `channels` | 数组 | 各渠道比较结果 |
| `enabledChannels` | 字符串数组 | 启用渠道名 |
| `skippedItems` | 数组 | 未比较 item 记录 |
| `warnings` / `errors` | 数组 | item 级警告 / 错误（含 scope / source；source 可能为空） |
| `uncompared` | 数组 | item 级未比较条目（合并 XPath 与 CSV，含 type） |
| `logs` | 数组 | item 级日志（对象式 `{scope, channel, source, text}`） |

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

### `item.fields`（字段定义注册表）

```json
"fields": [
  { "id": "1", "name": "tradeId", "userTag": "contextAssertion", "type": "id" },
  { "id": "4", "name": "notional", "userTag": "productAssertion", "type": "num" }
]
```

| 键 | 类型 | 说明 |
|---|---|---|
| `id` | 数字字符串 | 字段标识（如 `"1"`、`"2"`…，按字段名去重后按出现顺序编号，用于关联比较字段） |
| `name` | 字符串 | 字段名（原 `f`） |
| `userTag` | 字符串 | 断言类型（原 `t`：platformAssertion / productAssertion / contextAssertion） |
| `type` | 字符串 | 值类型（原 `k`：id/num/date/code/product/text/multi） |

> 说明：`fields` 按 id（数字字符串）去重，且属于 item（每个 item 可有不同的字段定义）；同一字段名在多个渠道/来源中共享同一定义与同一个数字字符串 `id`。
> 比较字段通过 `id` 关联注册表，查看器用 (channel, source, id) 三元组唯一定位某个比较字段。

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
| `sources` | 数组 | 来源渠道（A/B），其 `fields[]` 为比较结果 |

## 5. field（`channel.sources[].fields[]`）

| 键 | 类型 | 说明 |
|---|---|---|
| `id` | 数字字符串 | 关联 `item.fields` 的字段标识 |
| `ctxs` | 字符串数组 | 命中上下文（原 `ctx`） |
| `cmpLeft` | 对象 | 左侧（EO/来源）：`{ value, ctx, ctxs, elRaw, el, srcType }`；`el` 为 EO 来源元素（CSV 列），`elRaw` 为 EO 字段映射原始配置 |
| `cmpRight` | 对象 | 右侧（AO/报送）：`{ value, ctx, ctxs, elRaw, el, srcType }`；`el` 即原 `x`（srcType=1）或 `aoCsv`（srcType=2），`elRaw` 即原 `excelMapping` |
| `cvtLeft` | 对象\|null | EO 值转换规则：`{ ctx, ctxs, el, elRaw, raw }`；`el` 即原 `conversionRule.value`，`ctxs` 即原 `conversionRule.ctx`，`elRaw` 即原 `excelConversionRule`，`raw` 即原 `eoUnconverted`；未配置时为 `null` |
| `cvtRight` | 对象\|null | AO 值转换规则（结构同 `cvtLeft`）；未配置时为 `null` |
| `vdt` | 对象\|null | AO 终值校验规则：`{ ctx, ctxs, el, elRaw }`；`el` 即原 `validationRule.value`，`ctxs` 即原 `validationRule.ctx`，`elRaw` 即原 `excelValidationRule`；未配置时为 `null` |
| `result` | 字符串 | `PASSED` 或 `FAILED` |
| `remarks` | 字符串 | 说明（原 `note`） |
| `resultText` | 字符串 | 结果说明（原 `resultNote`） |
| `resultDetails` | 数组 | 额外结果 `[{label, value}]`（原 `extraResults`） |
| `prints` | 字符串数组 | 相关打印信息 |

> 已移除字段：`eoConverted`（不再需要）。`f` / `t` / `k` 迁移到 `item.fields`；`x` / `aoCsv` / `ctx` / `eo` / `ao` / `eoUnconverted` / `conversionRule` / `validationRule` / `excelMapping` / `excelConversionRule` / `excelValidationRule` 迁移到上述对象。

## 6. 批次元数据（`batch-meta.json`）与索引（`batches-index.json`）

批次目录可包含 `batch-meta.json`（可选）与 `report-validation-data.json`（单文件或多文件清单）。扫描器 `lib/scanner.js` 支持两种数据模式：

- 优先读取 `batch-meta.json` 的 `reportEnv` / `dataUrl` / `summary`。
- 否则回退到数据文件（单文件或多文件清单）的顶层 `reportEnv`，item 数量取 `items.length`。

索引 `batches-index.json` 的 `batches[]` 除原有字段外，增加 `dataMode`（`"single"` / `"multi"`），供查看器按需加载。旧格式数据可用 `node tools/migrate-legacy-data.js <文件>` 迁移。
