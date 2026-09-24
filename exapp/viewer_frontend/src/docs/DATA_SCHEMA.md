# 数据说明（DATA SCHEMA）

数据文件位于 web 根目录（`public/`），由 `config.json` 的 `urls.data` / `urls.defaultData` 引用。

- 单文件模式：一个文件包含全部 item。
- 多文件模式：一个**清单文件**（manifest）+ 每个 item 一个独立文件。

两种模式都由顶层 `"mode"` 字段标记：`"single"` 或 `"multi"`（缺省按 `"single"` 处理）。

> 多文件模式下，主数据（`urls.data`）、默认模板数据（`urls.defaultData`）与批次数据文件都是清单：
> 生成器（Java `validationJsonJob -m multi` 与 `node tools/generate-sample-data.js --split`）会把三者都写成清单，
> 并各自引用同一套 `data/items/<tradeId>.json`（批次目录则为 `<批次目录>/data/items/<tradeId>.json`）。

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

清单的**顶层字段与单文件模式完全一致**（多文件模式只把 `items` 换成轻量条目）：

| 顶层键 | 类型 | 说明 |
|---|---|---|
| `mode` | 字符串 | `"multi"` |
| `reportEnv` | 字符串 | 运行环境标识（可选） |
| `creationType` | 字符串 | 数据来源：`"sample"`（内置样例）/ `"user"`（真实用户数据）；查看器据此决定是否展示 Sample 徽标与「示例数据」提示，缺省按 `"sample"` 处理 |
| `skippedItems` | 数组 | 未能参与比较的 item 记录（结构见 §3 的 `skippedItems`） |
| `items` | 数组 | 轻量清单条目（下表） |

| 清单 item 键 | 类型 | 说明 |
|---|---|---|
| `tradeId` / `reportDate` / `generatedAt` / `platform` / `product` / `productCategory` | 字符串 | item 元数据（供侧栏搜索/筛选） |
| `counterpartyItemId` / `platformTradeId` / `platformDealId` | 字符串 | 可选元数据 |
| `enabledChannels` | 字符串数组 | 启用渠道 |
| `file` | 字符串 | 该 item 完整数据文件的路径（**相对清单文件所在目录**；因此根目录清单用 `data/items/<tradeId>.json`，批次清单也一样） |
| `summary` | 对象 | 预计算统计摘要（侧栏与统计卡无需加载完整 item） |

> 可选字段的显式 `null` 视为「未提供」（Java 生成器的 ObjectMapper 保留 null）：顶层 `reportEnv` / `creationType` / `skippedItems` 与 item 的 `summary` 均允许为 `null`。

每个 item 文件内容与单文件模式中的 item 结构相同（含 `ctxDefs`、`channels`、`logs`；字段注册表在各 channel 内）。

> 多文件模式下：查看器先加载清单（轻量），点击 item 时按需加载完整文件；搜索/筛选/统计对全部 item 的合并数据生效。
> 清单未加载的 item 只有元数据（无 `channels` / `ctxDefs` / `logs`），需要完整 item 的功能（忽略开关、字段比较、关联错误、日志）都先确保 item 已加载。

### 2.1 模式转换（多文件 → 单文件）

命令行工具 `tools/merge-batch.mjs`（npm：`npm run merge-batch`）把**指定的一个多文件批次**合并为单文件批次：

```
node tools/merge-batch.mjs --list                                  # 列出批次及其当前模式
node tools/merge-batch.mjs --batch <batchId|批次目录>               # 合并（原地覆盖清单）
node tools/merge-batch.mjs --batch <id> --dry-run                   # 只校验+统计，不写文件
node tools/merge-batch.mjs --batch <id> --tenant[=id] | --no-tenant # 租户 / 非租户模式
```

- 清单定位：`--manifest <name>` > `batch-meta.json` 的 `dataUrl`（相对批次目录）> `report-validation-data.json`；批次目录可由 `batches-index.json`（batchId）或目录名解析。
- 合并规则：输出 `mode: "single"`，item 内容取各 item 文件原文、顺序与清单一致；清单里除 `mode` / `items` 之外的顶层字段（`reportEnv` / `creationType` / `skippedItems` / 自定义字段）原样保留，item 上的 `file` / `summary` 不会写入。
- 安全措施：写入前按 `lib/validate.js` 校验（失败则拒绝写入，可用 `--force` 覆盖）；默认把原清单备份为 `<清单名>.multi.bak`（`--no-backup` 关闭）；**不删除** `data/items/*.json`，因此随时可用 `splitToFiles()` 再拆回多文件。
- 合并后默认刷新 `batches-index.json`（`--no-scan` 跳过），使查看器立即看到单文件模式与 `summary.items`。
- 租户模式与 `server.js` 同一套解析：`--tenant[=id]` / `--no-tenant` / `REPORT_VIEWER_TENANT`、`--config dev|test|prod`、`--data-root <dir>`、`REPORT_VIEWER_DATA_ROOT`；批次根与索引分别取 `scan.basedir` / `scan.out`（相对各自数据根解析）。

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
| `logs` | 数组 | item 级日志（对象式 `{scope, channel, source, field, text}`，见下方「`item.logs` 日志行」） |

### `item.logs` 日志行

```json
"logs": [
  { "scope": "item",    "channel": null,          "source": null,          "field": null, "text": "2024-08-14 10:23:00.100 INFO  开始比较 item=T-20240814-1001，报告日期=2024-08-10" },
  { "scope": "channel", "channel": "HKTR",       "source": null,          "field": null, "text": "2024-08-14 10:23:00.200 INFO  [HKTR] 读取报送文件 …" },
  { "scope": "field",   "channel": "HKTR",       "source": "来源渠道 A", "field": "2",  "text": "2024-08-14 10:24:10.140 INFO  [HKTR/来源渠道 A] EO=…，AO=… → FAILED（…）" }
]
```

| 键 | 类型 | 说明 |
|---|---|---|
| `scope` | 字符串 | `item`（item 级，开始/加载/初始化/完成）/ `channel`（渠道执行步骤与该渠道自身日志）/ `field`（字段比较过程日志） |
| `channel` | 字符串\|null | 报告渠道；`scope=item` 时为 `null`，`scope=channel`\|`field` 时必非空 |
| `source` | 字符串\|null | 来源渠道；仅 `scope=field` 时非空（渠道级日志可为 `null` 表示“未关联到具体来源”） |
| `field` | 字符串\|null | **字段 id（引用该渠道的 `channel.fields`）**；仅 `scope="field"` 的行有值（string），其余行必须为 `null` / 省略 |
| `text` | 字符串 | 日志正文（单行；时间戳与渠道前缀包含在正文内） |

> **不变式**（`lib/validate.js` 会报错）：`field` 非空 ⇒ `scope === "field"` 且 `channel` / `source` 均非空。
>
> **用途**：查看器用 `channel` + `source` + `field` 三元组给这些行建立**日志锚点**（渲染时记在 `data-log-key`，DOM `id` 用短标识 `log-<渠道>-s<来源渠道序号>-f<字段id>.<同键序号>`），从而实现「字段比较 / 关联字段 / 字段详情 → 完整日志」的定位高亮（详见 `docs/README.md` 的「完整日志的字段定位」）。同一三元组可对应多行日志（字段比较过程打印多行），跳转取**首个**。

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
| `prints` | 字符串数组 | 相关打印信息（**保留待用**：字段详情页已改为读取关联日志行 `logs`） |
| `logs` | 数组 | 该字段关联的日志行：元素与 `item.logs` 同构（`{scope, channel, source, field, text}`），`scope` 恒为 `"field"`、`field` 恒等于该字段的 `id`、`channel` / `source` 恒等于所属渠道 / 来源渠道名；同一批行也会出现在 `item.logs` 中（查看器据此定位高亮） |

> 已移除字段：`eoConverted`（不再需要）与 `field.ctxs`（命中上下文现由 `cmpLeft` / `cmpRight` / `cvtLeft` / `cvtRight` / `vdt` 的 `ctxs` 取并集）。`f` / `t` / `k` 迁移到 `channel.fields`；`x` / `aoCsv` / `ctx` / `eo` / `ao` / `eoUnconverted` / `conversionRule` / `validationRule` / `excelMapping` / `excelConversionRule` / `excelValidationRule` 迁移到上述对象；`ctx`（单数）由 ctx key 字符串/id 改为 **命中 ctxKey 的原始字符串表达式**，`ctxs` 改为 `item.ctxDefs` 的 id 引用数组。
>
> `logs` 为新增字段（与 `prints` 同源：同样是字段比较过程的三行文本，但改为带 `channel`/`source`/`field` 的日志行，从而能在「完整日志」里定位）——生成器（Java `ValidationJsonGenerator` / JS `lib/sample-data.js`）与旧数据迁移工具（`tools/migrate-legacy-data.js`）都会同时写 `prints` 与 `logs`。

## 6. 批次元数据（`batch-meta.json`）与索引（`batches-index.json`）

批次目录可包含 `batch-meta.json`（可选）与 `report-validation-data.json`（单文件或多文件清单）。扫描器 `lib/scanner.js` 支持两种数据模式：

- 优先读取 `batch-meta.json` 的 `reportEnv` / `dataUrl` / `summary`。
- 否则回退到数据文件（单文件或多文件清单）的顶层 `reportEnv`，item 数量取 `items.length`。

索引 `batches-index.json` 的 `batches[]`（由 `lib/scanner.js` 写入）字段：
`batchId` / `batchName` / `date` / `executedAt` / `formatVersion` / `path` / `reportEnv` / `dataUrl` / `ignoreUrl` / `summary` / `creationType`（`sample` / `user`），以及可选字段：`deleted`（软删除）、`tags`、`favorite`、`argv`（原始命令）、`metaUrl`（批次目录内 `batch-meta.json` 的相对路径，供查看器按需读取扩展内容；仅在文件存在时写入）、`validationErrors`（扫描时数据校验失败项；**有意保留在索引里**，但当前界面尚未展示，只在扫描/启动日志告警）。旧格式数据可用 `node tools/migrate-legacy-data.js <文件>` 迁移。

> 索引**不写入** `dataMode` / `cwd`（前端从不使用，已移除）；二者如需仍可从对应 `batch-meta.json` 读取。
> 索引也**不写入** `descriptionEx` 正文（避免索引随批次数膨胀）：查看器用 `metaUrl` 懒加载 `batch-meta.json` 后再取该字段，详见 §6.3。

### 6.1 `batch-meta.json` 可选字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `deleted` | boolean | 软删除标记。扫描器**不跳过**该批次，而是写入索引并带 `deleted: true`（默认范围不展示，需切到「全部批次(含已删除)」范围） |
| `favorite` | boolean | 收藏标记（回写元数据，扫描后仍保留） |
| `tags` | string[] | 自定义批次标签。清洗规则（`lib/scanner.js` 的 `sanitizeTags`）：去空白、去重、单个最长 24 字符、最多 12 个；空数组等同未定义 |
| `batchName` | string | 批次名（展示名）。**允许重复**：界面仅告警不阻止；`urls.defaultDataMode` 按名解析时取首个非已删除匹配。经 `POST /api/batch` 回写时去首尾空白、最长 200 字符、不允许为空 |
| `description` | string | 批次描述，支持多行（换行统一为 `\n`，最长 4000 字符）；空值表示清除字段 |
| `ignoreUrl` | string | 批次级忽略配置地址（相对批次目录 / web 根）。扫描器写入索引；查看器 `POST /api/ignore` 按同一地址回写（缺省用 `config.urls.ignore`） |
| `summary` / `commandLine` / `reportEnv` | - | 同原有定义；`summary.items` 以数据文件实际 item 数量为准（扫描时校正） |
| `descriptionEx` | 对象 | 任务说明**扩展内容**（只读）：`{ contentType, plainContent }`，渲染在「任务说明」末尾，见 §6.3 |

> `deleted` / `favorite` / `tags` / `ignoreUrl` 由**查看器与服务端**写入（`POST /api/batch`、`POST /api/ignore`），Java 样例生成器不写这四项；Java 模型 `BatchMeta` 已声明为可选字段（`@JsonInclude(NON_NULL)`，缺失时不序列化）。
> `descriptionEx` 也是可选字段（Java 模型 `DescriptionEx`）：样例生成器（Java / `node tools/generate-sample-data.js --batch`）会写一份 `markDownTable` 示例；查看器与 `POST /api/batch` **都不会修改它**（只读）。

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
- 界面交互：**警告 / 未比较** 选项卡提供逐行「忽略 / 取消忽略」、表头批量忽略，「管理忽略配置」（查看 / 删除），以及「导入 / 导出忽略配置」。
  - **管理（查看 / 删除）**：点击「管理忽略配置」打开模态窗口，按类型分页签查看当前全部忽略项（**警告 / 未比较 XPath / 未比较 CSV**），默认选中入口对应的类型：警告选项卡 → 警告；未比较选项卡 → 有内容的未比较类型（XPath 优先，其次 CSV）。
    - **「忽略条数」列** = **当前 item 内**因该条目被忽略的数据条数（`countIgnoredByKey()`，作用域口径与 `msgIgnoreKey()` 完全一致；不受渠道 / 来源筛选影响）。数据按 item 懒加载，跨 item 统计需拉取全部 item 文件，因此**只统计当前 item**（列头 tooltip 已声明口径；当前 item 内无命中时显示 `—`）。
    - 列表支持**表头排序**与**字段级筛选**（与主列表 / descriptionEx 同一交互）：点击列头三态切换（升序 → 降序 → 原序，箭头 `⇅` / `▲` / `▼`）；列头右侧 `⚲` 打开筛选浮层（列之间 **AND**，有筛选值的列 `⚲` 保持高亮；再次点击同一列 `⚲` 关闭浮层，不改筛选值）；筛选无命中时表格内显示「无匹配条目」。**切换类型页签会关闭筛选浮层并重置排序与筛选**（各类型列数 / 列义不同），关闭窗口同样会关闭浮层。
      - **下拉框式筛选**（默认）：选项 = 「全部」+ 该列在**当前数据中的不同取值**（码位排序，结果确定）+ 当存在空格子时附带的「空值」（哨兵 `FILTER_EMPTY`）；取值按**精确匹配**（大小写不敏感），跨列表如同属下拉框则逐列精确匹配。「忽略条数」列只支持排序、不提供筛选图标（其 `⚲` 不渲染）。
      - **自由输入筛选**（仅字段列：「关联字段」/「元素」）：输入即过滤，按**包含匹配**（大小写不敏感）。
      - 两种规则统一由纯函数 `filterRowsByRules(rows, rules)` 执行（`mode` 为 `exact` / `contains`），行模型与列表一致。
    - **分页**：每页条数 `config.limits.ignoreMgrPageSize`（默认 **10**，无页大小选择器）；**仅当列表条数 > 20** 时才展示表头排序 / 筛选图标（按条数而非页数判定，避免 11~30 条时既不能排序也不能筛选），**仅 1 页时不展示分页控件**。工具隐藏时即便存有排序 / 筛选状态也会被忽略（避免出现无法清除的隐藏行）。切类型 / 排序 / 筛选 / 删除后页码自动收敛（`paginateRows()`）。
    - 该窗口只做**查看与删除**：不做新增（新增请用表格里的「忽略 / 批量忽略」），也不支持编辑条目字段。
    - 删除 = 从内存扁平 key 中移除该条（`removeIgnoreKeys`，纯函数，不修改入参）→ `saveIgnoreConfig()` 回写配置文件（同一套 `POST /api/ignore` + `If-Match` 乐观并发）→ 立即重绘当前数据集（表格、页签计数、批次面板），因此刚被删掉忽略的条目会马上回到列表里。写入失败 / 409 冲突的处理与其它忽略操作一致（顶部提示 + 以服务端为准重新加载）。
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
  - **乐观并发**：写入响应带 `etag`；客户端把加载时拿到的 `etag` 作为 `ifMatch` 回传，服务端发现文件已被其他会话修改即返回 **409**（不写入）。前端遇到 409 时：**先以服务端为准重新加载并重绘（含打开着的忽略管理窗口），再用新 `etag` 重放一次本次变更（自动重试一次）**；若重试仍冲突，才提示「保存冲突」并停止。这样多会话并发写入不会静默丢失用户的点击。文件不存在时 `etag` 为 `null`，首次写入可省略 `ifMatch`。
  - **跨标签同步**：同一浏览器内多个标签页通过 `BroadcastChannel('report-viewer-ignore')` 广播写入结果（分组配置 + `etag`），其它标签就地更新内存、重绘列表与计数（不再互相撞 409）；不支持 `BroadcastChannel` 时自动降级。此外标签页**回到前台**（`visibilitychange`）时会对配置文件做一次 `etag` 校验，变化才重绘，保证与其它会话（含非本浏览器的会话）最终一致且不靠猜测重载。
- 存储：`localStorage['reportValidationIgnoreConfig.v1']` 保存运行时扁平 key（仅作镜像，加载/切换批次时写入）；刷新时以配置文件为准，文件不可用时回退 localStorage。
- **读取宽松 / 写入严格**：读取端 `normalizeIgnoreConfig()` 仍兼容旧版「扁平 key 对象」格式（老版本导出与本地镜像），但**导入接口不再接受**该格式（`importLegacyFail`），避免静默错配 key。

### 6.3 任务说明扩展内容（`descriptionEx`，只读）

```json
"descriptionEx": {
  "contentType": "markDownTable",
  "plainContent": "| 序号 | 检查项 | 说明 |\n| --- | --- | --- |\n| 1 | 数据接入完整性 | 覆盖 `HKTR` / `JSFA` / `CFTC` |"
}
```

| 键 | 类型 | 说明 |
| --- | --- | --- |
| `contentType` | string | 内容类型（大小写不敏感）。当前支持 `markDownTable`；缺省或未知值按**纯文本**渲染（`descExUnsupported` / `descExBadTable` 提示，不报错、不空白） |
| `plainContent` | string | 内容正文；`markDownTable` 时为 Markdown 表格文本。最长 65536 字符（`core.js` 的 `DESC_EX_MAX_CHARS`），超出截断并提示 |

**渲染与交互**

- 位置：**「任务说明」卡片末尾**（`#taskNote` 内 `.task-note-text` 之后，独立块 `.task-note-descex`），不是批次详情的一部分。
- **视觉定位**：只读描述性内容 —— 弱化配色（`--muted` 文字 + 虚线边框，不使用强调色）、无独立工具条，与主题内容拉开层次。
- 表格能力：
  - **表头字段筛选**：每个列头右侧一个 `⚲` 图标（与主列表字段表的表头筛选完全一致的视觉与交互），点击弹出浮层自由输入框；列之间为 **AND** 关系，输入即就地重绘（不触发整页 `render()`），已生效的列图标高亮；清空输入即取消该列筛选。
  - **列排序**：点击列头标签（升序 → 降序 → 原序；数字列按数值，空值恒排在后），⇅/▲/▼ 提示当前列与方向。
  - **工具显示条件**：数据总页数 `≤ 3`（`core.js` 的 `DESC_EX_TOOLS_MAX_PAGES`）时**不展示**排序与筛选图标，保持纯描述；超过阈值（如样例的 18 行 → 4 页）才出现。
  - **分页**：每页条数 `config.limits.descExPageSize`（默认 **5**）；页码控件位于**表格右侧**，**默认收起**（仅一个 `▸` 三角，点击展开为 `▾`；尺寸与页码按钮同大；无分页时（仅 1 页）不展示）；展开后的页码列位于**折叠三角正下方**，为**简约竖向列**（上一页 / 窗口化页码 / 下一页 / `页码/总页数`）——上一页/下一页**沿用主列表分页的同一字符 `‹` `›` 与同一尺寸与配色，仅用 CSS 旋转 90° 得到上下方向**；无边框/无底色，用主题色（普通页与箭头 `--muted`、当前页 `--accent` 加粗），**不使用白色高亮**；页码多时按窗口显示（`1 … p-1 p p+1 … n`，`core.js` 的 `pageItems`，最多 7 项含省略号）。
- Markdown 支持范围（GFM 子集 + 最小内联格式）：表头 + 分隔行（`---` / `:--:` / `--:`，**仅用于识别表格**）、数据行、`\|` 转义、行内 `` `code` `` / `**bold**` / `*italic*`；**不允许 HTML 直通**（全部先转义），链接与图片不解析。
- 对齐：**单元格与表头统一左对齐**（忽略分隔行中的对齐标记，避免声明与实际渲染不一致）；首/末列有额外左/右侧内边距（默认 14px），避免文字紧贴表格边框。
- 宽度：**按整表的最大内容宽度定宽**（`core.js` 的 `fitColWidths` + `table-layout: fixed`）——列宽在分页切换/排序/筛选时保持不变，单列限制在 56–360px（超出换行），表格总宽 = 各列之和（不强制占满整行，内容超出可用宽度时由外层横向滚动）；页码控件位于**表格右侧**。
- 列数不齐的行按表头列数对齐（补空 / 截断）并给出统计提示；缺少 `|` 的行被忽略并计数；**空行视为表格结束**（其后内容不再解析）。

**数据通路与只读约束**

- 索引只写 `metaUrl`（`batch-meta.json` 的相对路径），**内容不进索引**；查看器在渲染「任务说明」时用 `fetchJSONCached` 懒加载（ETag + IndexedDB 缓存，重复打开不重复下载），失败时提示 `descExLoadFail`。
- **只读**：`POST /api/batch` 的字段白名单（`deleted` / `favorite` / `batchName` / `description` / `tags`）不含 `descriptionEx`，且「编辑批次描述」只读写 `description`；该内容只能由生成器或人工维护 `batch-meta.json`。
- 批次**描述搜索**（批次面板的「描述」筛选）只匹配 `description`，不解析 `descriptionEx`。
- 开关：`config.features.descriptionEx`（**所有配置文件默认 `true`**）；关闭时该块完全不渲染（与未提供 `descriptionEx` 时完全一致）。

**扩展新类型（contentType）**

1. `public/core.js` 增加解析纯函数（如 `parseMarkdownTable` 风格，返回渲染所需数据 + `issues`），并补单测（`test/desc-ex.test.js`）；
2. `public/app.js` 的 `DESC_EX_RENDERERS` 注册渲染器（`parse(raw)` + `render(ctx)`）；
3. 需要时补 i18n 键（3 种语言 1:1）与文档 / 样例数据。

> Java 侧模型：`com.otcc.viewer.model.DescriptionEx`（`contentType` / `plainContent`，`@JsonInclude(NON_NULL)`）；`ValidationConfig.Features.descriptionEx` / `Limits.descExPageSize` 与前端同名同默认值。
