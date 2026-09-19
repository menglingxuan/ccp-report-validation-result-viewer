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
  "creationType": "sample",
  "skippedItems": [ { "itemId": "...", "channel": "HKTR", "source": "来源渠道 A", "reason": "..." } ],
  "items": [ { "tradeId": "...", "ctxDefs": { }, "channels": [ ] } ]
}
```

| 顶层键 | 类型 | 说明 |
|---|---|---|
| `mode` | 字符串 | `"single"` |
| `reportEnv` | 字符串 | 运行环境标识（可选） |
| `creationType` | 字符串 | 数据来源：`"sample"`（内置样例）/ `"user"`（真实用户数据） |
| `skippedItems` | 数组 | 未能参与比较的 item 记录（顶层，`channel`/`source` 可为 null） |
| `items` | 数组 | 完整 item 列表（每个 item 内联 `ctxDefs`） |

## 2. 多文件模式（`mode: "multi"`）

清单文件（`report-validation-data.json`）：

```json
{
  "mode": "multi",
  "reportEnv": "OTCXXX",
  "creationType": "sample",
  "skippedItems": [ { "itemId": "...", "channel": null, "source": null, "reason": "..." } ],
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

每个 item 文件内容与单文件模式中的 item 结构相同（含 `ctxDefs`、`channels`、`logs`；字段注册表在各 channel 内）。

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
| `channels` | 数组 | 各渠道比较结果（字段定义注册表在各 channel 内） |
| `enabledChannels` | 字符串数组 | 启用渠道名 |
| `warnings` / `errors` | 数组 | item 级警告 / 错误（含 scope / source；source 可能为空） |
| `uncompared` | 数组 | item 级未比较条目（合并 XPath 与 CSV，含 type / source；channel、source 可为 null，source 非空时 channel 不可为空） |
| `logs` | 数组 | item 级日志（对象式 `{scope, channel, source, text}`） |

### `skippedItems`（顶层，与 `reportEnv` 同级）

```json
"skippedItems": [
  { "itemId": "T-20240810-091", "channel": "HKTR", "source": "来源渠道 A", "reason": "在 HKTR 渠道的来源渠道 A 中未找到该 item 的对应记录，已跳过该来源渠道的比较。" },
  { "itemId": "T-20240810-092", "channel": null, "source": null, "reason": "未在任一报告渠道中找到对应记录，该 item 未能参与比较。" }
]
```

| 键 | 类型 | 说明 |
|---|---|---|
| `itemId` | 字符串 | 被跳过 item 的标识 |
| `channel` | 字符串\|null | 报告渠道；`null` 表示未关联到具体渠道（涵盖全部渠道） |
| `source` | 字符串\|null | 来源渠道；`null` 表示未关联到具体来源 |
| `reason` | 字符串 | 跳过原因 |

### `item.ctxDefs`

```json
"ctxDefs": {
  "hktr.ctx.default": { "id": 1, "scopes": [1], "type": "builtin", "def": "HKTR 默认上下文（标准报送场景）", "hits": "命中 3 个映射条目（EO 2 / AO 1）" },
  "hktr.ctx.conv.default": { "id": 5, "scopes": [2], "type": "builtin", "def": "…", "hits": "…" },
  "hktr.ctx.val.default": { "id": 7, "scopes": [3], "type": "builtin", "def": "…", "hits": "…" }
}
```

| 键 | 类型 | 说明 |
|---|---|---|
| `id` | 正整数 | 该 item 内唯一的上下文 id，供字段各规则的 `ctxs`（id 数组）引用 |
| `scopes` | 整数数组 | 上下文作用域：`1` 字段映射 / `2` 值转换 / `3` 终值校验；同一 ctx 可配置在多种规则中，故为数组 |
| `type` | 字符串 | 来源类型：`builtin`（内置）/ `user`（用户自定义） |
| `def` | 字符串 | 上下文定义 |
| `hits` | 字符串 | 命中说明 |

### `channel.fields`（字段定义注册表，位于 channel 对象内）

```json
"fields": [
  { "id": "1", "name": "tradeId", "userTag": "contextAssertion", "type": "id" },
  { "id": "2", "name": "notional", "userTag": "productAssertion", "type": "num" }
]
```

| 键 | 类型 | 说明 |
|---|---|---|
| `id` | 数字字符串 | 字段标识（如 `"1"`、`"2"`…，按该渠道字段出现顺序编号，用于关联比较字段） |
| `name` | 字符串 | 字段名（原 `f`） |
| `userTag` | 字符串 | 断言类型（原 `t`：platformAssertion / productAssertion / contextAssertion） |
| `type` | 字符串 | 值类型（原 `k`：id/num/date/code/product/text/multi） |

> 说明：`fields` 属于 **report channel**（每个报告渠道的字段定义不同），按 id（数字字符串）在该渠道内唯一；同一字段名在不同渠道可复用同一个 `name`，但 id 按各渠道自身顺序编号。
> 比较字段通过 `id` 关联所在渠道的注册表，查看器用 (channel, source, id) 三元组唯一定位某个比较字段。

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
| `fields` | 数组 | 字段定义注册表（该渠道的字段定义，见 `channel.fields`） |
| `sources` | 数组 | 来源渠道（A/B），其 `fields[]` 为比较结果 |

## 5. field（`channel.sources[].fields[]`）

| 键 | 类型 | 说明 |
|---|---|---|
| `id` | 数字字符串 | 关联 `channel.fields` 的字段标识 |
| `cmpLeft` | 对象 | 左侧（EO/来源）：`{ value, ctx, ctxs, elRaw, el, srcType }`；`ctx` 为命中 ctxKey 的 **原始字符串表达式**（如 `"hktr.ctx.default and hktr.ctx.v2"`，其中每个元 ctxKey 的 id 见 `ctxs`）；`ctxs` 为 `item.ctxDefs` 的 **id 引用数组**；`el` 为 EO 来源元素（CSV 列），`elRaw` 为 EO 字段映射原始配置 |
| `cmpRight` | 对象 | 右侧（AO/报送）：`{ value, ctx, ctxs, elRaw, el, srcType }`；`ctx` 为原始字符串表达式、`ctxs` 为 id 引用数组；`el` 即原 `x`（srcType=1）或 `aoCsv`（srcType=2），`elRaw` 即原 `excelMapping` |
| `cvtLeft` | 对象\|null | EO 值转换规则：`{ ctx, ctxs, el, elRaw, raw }`；`ctx` 为原始字符串表达式、`ctxs` 为 id 引用数组；`el` 即原 `conversionRule.value`，`elRaw` 即原 `excelConversionRule`，`raw` 即原 `eoUnconverted`；未配置时为 `null` |
| `cvtRight` | 对象\|null | AO 值转换规则（结构同 `cvtLeft`）；`ctx` 为原始字符串表达式、`ctxs` 为 id 引用数组；`raw` 为 AO 未转换值；未配置时为 `null` |
| `vdt` | 对象\|null | AO 终值校验规则：`{ ctx, ctxs, el, elRaw }`；`ctx` 为原始字符串表达式、`ctxs` 为 id 引用数组；`el` 即原 `validationRule.value`，`elRaw` 即原 `excelValidationRule`；未配置时为 `null` |
| `result` | 字符串 | `PASSED` 或 `FAILED` |
| `remarks` | 字符串 | 说明（原 `note`） |
| `resultText` | 字符串 | 结果说明（原 `resultNote`） |
| `resultDetails` | 数组 | 额外结果 `[{label, value}]`（原 `extraResults`） |
| `prints` | 字符串数组 | 相关打印信息 |

> 已移除字段：`eoConverted`（不再需要）与 `field.ctxs`（命中上下文现由 `cmpLeft` / `cmpRight` / `cvtLeft` / `cvtRight` / `vdt` 的 `ctxs` 取并集）。`f` / `t` / `k` 迁移到 `channel.fields`；`x` / `aoCsv` / `ctx` / `eo` / `ao` / `eoUnconverted` / `conversionRule` / `validationRule` / `excelMapping` / `excelConversionRule` / `excelValidationRule` 迁移到上述对象；`ctx`（单数）由 ctx key 字符串/id 改为 **命中 ctxKey 的原始字符串表达式**，`ctxs` 改为 `item.ctxDefs` 的 id 引用数组。

## 6. 批次元数据（`batch-meta.json`）与索引（`batches-index.json`）

批次目录可包含 `batch-meta.json`（可选）与 `report-validation-data.json`（单文件或多文件清单）。扫描器 `lib/scanner.js` 支持两种数据模式：

- 优先读取 `batch-meta.json` 的 `reportEnv` / `dataUrl` / `summary`。
- 否则回退到数据文件（单文件或多文件清单）的顶层 `reportEnv`，item 数量取 `items.length`。

索引 `batches-index.json` 的 `batches[]` 除原有字段外，增加 `dataMode`（`"single"` / `"multi"`），供查看器按需加载。旧格式数据可用 `node tools/migrate-legacy-data.js <文件>` 迁移。

### 6.1 `batch-meta.json` 可选字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `deleted` | boolean | 软删除标记。扫描器**不跳过**该批次，而是写入索引并带 `deleted: true`（默认范围不展示，需切到「全部批次(含已删除)」范围） |
| `favorite` | boolean | 收藏标记（回写元数据，扫描后仍保留） |
| `tags` | string[] | 自定义批次标签。清洗规则（`lib/scanner.js` 的 `sanitizeTags`）：去空白、去重、单个最长 24 字符、最多 12 个；空数组等同未定义 |
| `batchName` | string | 批次名（展示名）。**允许重复**：界面仅告警不阻止；`urls.defaultDataMode` 按名解析时取首个非已删除匹配。经 `POST /api/batch` 回写时去首尾空白、最长 200 字符、不允许为空 |
| `description` | string | 批次描述，支持多行（换行统一为 `\n`，最长 4000 字符）；空值表示清除字段 |
| `summary` / `description` / `commandLine` / `ignoreUrl` / `reportEnv` | - | 同原有定义；`summary.items` 以数据文件实际 item 数量为准（扫描时校正） |

### 6.2 忽略配置（`ignore-config-by-platform.json`）

**默认值为空配置 `{}`**（不忽略任何条目，Java 样例生成器 `ValidationJsonGenerator.generateIgnoreConfig()` 同样输出空 map）；运行时由查看器的「忽略 / 取消忽略 / 批量忽略 / 导入」操作回写。

按「平台」分组，每个平台下三个数组；运行时在 `public/core.js` 中映射为**扁平 key**（`groupedToFlat` 读入 / `flatToGrouped` 导出 / `msgIgnoreKey` 生成）：

| 分组 | 条目字段 | 扁平 key（JSON 数组） |
| --- | --- | --- |
| `warnings` | `channel` / `source` / `scope` / `type` / `level` / `field` | `["warn", platform, channel, source, scope, type, level, field]` |
| `uncomparedXpaths` | `xpath` / `channel` / `source` | `["xpath", xpath, channel, platform, source, ""]` |
| `uncomparedCsvs` | `value` / `channel` / `source` | `["csv", value, channel, platform, source, ""]` |

```json
{
  "OTC-PLATFORM-A": {
    "warnings": [{ "channel": "HKTR", "source": "", "scope": "field", "type": "platformAssertion", "level": "WARN", "field": "notional" }],
    "uncomparedXpaths": [{ "xpath": "/HKTR/foo", "channel": "HKTR", "source": "IRS" }],
    "uncomparedCsvs": []
  }
}
```

- **三种条目均以 `source`（来源渠道）参与 key**，`source` 可能为空（渠道级条目 / 未下发来源时为空串），读取与生成时统一归一化为空串。
- **条目不携带类型字段**：靠所在数组名区分（`warnings` / `uncomparedXpaths` / `uncomparedCsvs`），不存在 `kind`；未比较元素也不写恒空的 `ctx`。历史文件里残留的 `kind` / `ctx` 会被忽略（读入时不看这两个字段），任意一次忽略/取消忽略回写时会随整文件重写而自动消失。
- `platform` 不随消息下发，**跟随 item 注入**（`app.js` 的 `enrichMsg`），key 的平台槽位取当前 item 的 `platform`；因此配置文件按平台分组才能逐平台生效。
- 所有槽位在写入/读取时均归一化为字符串（`|| ''`）：全局未比较条目的 `channel` / `source` 为 `null` 时同样归一为空串，保证「配置文件 → 界面」与「导出 → 重新加载」双向都能命中（key 集合不变）。key 末尾恒为 `""` 的历史保留槽位（对应已废弃的 `ctx` 概念，配置文件中不再作为字段出现）。
- 界面交互：**警告 / 未比较** 选项卡提供逐行「忽略 / 取消忽略」、表头批量忽略，以及「导入 / 导出忽略配置」。
  - **导出**：把当前全部忽略项（内存中已加载的完整集合）按本节的**分组格式**下载为 `ignore-config-by-platform.json`（无 `kind`，见下）。导出的内容可直接作为导入文件，也可直接 PUT 给 `POST /api/ignore`。
  - **导入（分部覆盖）**：以导入文件为准，**只覆盖文件中出现的部分**（`warnings` / `uncomparedXpaths` / `uncomparedCsvs`），未出现的部分保持原值 —— 因此可以只导入「忽略警告」或「忽略 CSV」等单个/多个部分（把导出的文件删掉不需要的数组即可）。某一部分出现但数组为空时，该部分被**清空**；空文件 `{}` 视为三部分皆空，即清空全部忽略。
  - 导入只接受**分组格式**：旧版「扁平 key 作为文件内容」的格式会被拒绝（`importLegacyFail`），无任何可识别分组的非空对象会被拒绝（`importShapeFail`），非法 JSON 报 `importFail`（三种失败均不改动当前配置与文件）。
  - 成功后立即 `POST /api/ignore` 回写服务端配置文件，提示按部分列出结果，例如：
    ```
    已分部覆盖导入忽略配置：
    • 警告：2 条
    • 未比较 XPath：未包含，保持不变
    • 未比较 CSV：1 条
    ```
- **持久化（写回）**：忽略 / 取消忽略 / 批量忽略 / 导入会 `POST /api/ignore`（body `{ "url": "<当前生效的配置地址>", "config": { …分组结构… } }`）将配置回写到当前生效的配置文件：
  - `url` 由客户端传入自己**实际加载成功**的地址：全局配置（`config.json` 的 `urls.ignore`），或 `batch-meta.json` 中 `ignoreUrl` 指向的批次级配置（此时读写同一批次下的文件）。客户端会先把地址归一化为**站点根相对路径**，服务端也兼容同源绝对 URL（跨域 / 非 `http(s)` 协议一律 403）。
  - 服务端限定只允许写入 `.json`、且路径必须落在允许的根目录内：非租户模式为 web 根（`public/`），租户模式为租户数据根（`CFG.tenant.dataRoot`，`/tenant/` 前缀会被剥离）。非法路径返回 403，结构不合法返回 400；写入使用原子写（`writeFileAtomic`）。
  - 回写失败（如服务端未更新、路径被拒）时浏览器控制台会告警，并在批次面板顶部提示「忽略配置保存失败」（`ignoreSaveError`）。
  - 与收藏夹（`POST /api/favorites` → `favorites.json`）同一套「按租户隔离 + 原子写入」机制。
- 存储：`localStorage['reportValidationIgnoreConfig.v1']` 保存运行时扁平 key（仅作镜像，加载/切换批次时写入）；刷新时以配置文件为准，文件不可用时回退 localStorage。
