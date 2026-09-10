# 配置说明（CONFIG）

统一配置文件：`config.json`（项目根目录，即 `src/config.json`）。服务端与浏览器共用同一份配置。

所有配置项均可省略；省略时使用内置默认值。JSON 不支持注释，完整备注见本文件与 `public/config.schema.json`。

## 配置切换（dev / test / prod）

启动时可指定配置名，加载对应的配置文件：

| 配置名 | 加载文件 |
| --- | --- |
| `dev` | `config-dev.json` |
| `test` | `config-test.json` |
| `prod` | `config-prod.json` |
| （缺省） | `config.json` |

```bash
node server.js --config dev      # 或 --profile dev
REPORT_VIEWER_CONFIG=prod node server.js
```

优先级：`--config` 命令行 > 环境变量 `REPORT_VIEWER_CONFIG` > 缺省 `config.json`。

## 顶层结构

| 键 | 类型 | 说明 |
|---|---|---|
| `configVersion` | 整数 | 配置结构版本号（当前 `2`） |
| `server` | 对象 | HTTP 服务配置（仅服务端使用） |
| `scan` | 对象 | 批次扫描配置（服务端使用） |
| `runType` | 字符串 | 运行环境（`dev` / `test` / `prod`） |
| `audit` | 布尔 | 是否启用租户 active 追踪与审查日志（默认 `false`） |
| `tenants` | 对象 | 租户配置（固定端口 / 数据根），见 §3.1 |
| `urls` | 对象 | 数据 / 忽略规则 / 批次索引 / 扫描接口的路径 |
| `ui` | 对象 | 界面默认项 |
| `features` | 对象 | 19 个功能开关 |
| `limits` | 对象 | 分页与数量上限 |
| `batches` | 对象 | 最近批次面板的行为配置 |
| `columns` | 对象 | 默认列可见性 |

---

## 1. `server`

| 键 | 默认值 | 说明 |
|---|---|---|
| `host` | `127.0.0.1` | 监听地址 |
| `port` | `8123` | 监听端口 |
| `webRoot` | `public` | 静态站点根目录（相对 `src/`） |

## 2. `scan`

| 键 | 默认值 | 说明 |
|---|---|---|
| `basedir` | `batches` | 批次根目录（相对**数据根**解析：租户模式为租户数据根，非租户模式为 web 根，见 §3.1） |
| `out` | `batches-index.json` | 索引输出路径（相对**数据根**解析，同上） |
| `ignore` | `[]` | 排除目录的正则数组 |
| `env` | `null` | 仅扫描指定 `reportEnv` 的批次；`null` = 全部 |

> 环境变量覆盖（优先级：命令行 `--port`/`--host` > 环境变量 > 租户固定端口 > `config.json` > 内置默认值）：
> `REPORT_VIEWER_HOST` / `REPORT_VIEWER_PORT` / `REPORT_VIEWER_WEBROOT` /
> `REPORT_VIEWER_BASEDIR` / `REPORT_VIEWER_OUT` / `REPORT_VIEWER_ENV` / `REPORT_VIEWER_IGNORE`（逗号分隔，追加）/
> `REPORT_VIEWER_TENANT`（租户 id，非空时开启租户模式）/ `REPORT_VIEWER_DATA_ROOT`（数据根）。
>
> 也可用命令行参数覆盖：`node server.js --port 9000 --host 0.0.0.0 --tenant alice --data-root C:/data/alice`；
> `--tenant`（不带参数）取当前系统用户名，`--no-tenant` 强制非租户模式。

## 3. `runType`

| 值 | 含义 |
|---|---|
| `dev` | 开发环境：`features` 中未显式配置的项默认 **true** |
| `test` | 测试环境：同上，默认 **true** |
| `prod` | 生产环境：`features` 中未显式配置的项默认 **false** |

### 3.1 `tenants`（租户）

租户模式**可选**：默认非租户模式（共享 web 根下的批次数据）。
通过 `--tenant alice`、`--tenant`（不带参数，取当前系统用户名）或环境变量
`REPORT_VIEWER_TENANT` 开启租户模式；`--no-tenant` 强制回到非租户模式。
多用户同时使用时，每个租户拥有独立的批次目录、批次索引与收藏夹；键为租户 id。

```json
"tenants": {
  "alice": { "port": 9001 },
  "bob":   { "port": 9002, "dataRoot": "C:/data/bob" }
}
```

| 键 | 默认值 | 说明 |
|---|---|---|
| `port` | 无 | 该租户的**固定监听端口**（避免随机端口/共享端口；`0` 表示随机端口） |
| `dataRoot` | `~/.report-viewer/<租户>` | 该租户的数据根目录 |

- 端口优先级：命令行 `--port` > `REPORT_VIEWER_PORT` > 租户 `port` > `server.port` > 默认 `8123`。
- 数据根存放：`batches/`（批次夹具）、`batches-index.json`（扫描输出）、`favorites.json`（收藏夹）。
- 非租户模式（默认）数据根 = 程序 web 根（`public/`），直接使用共享批次数据；租户模式数据根 = `~/.report-viewer/<租户>`（或 `tenants.<id>.dataRoot`）。
- 租户模式首次启动时自动创建兼容的空数据/配置：空批次目录、空 `batches-index.json`、空忽略配置（不复制共享样例数据）。

### 3.2 `audit`（租户 active 追踪 / 审查日志）

默认关闭。开启后，活跃租户信息实时写入**程序自身目录**（`server.js` 同级目录）下的
`.report-viewer/active/<租户>.json`（心跳刷新 `lastSeenAt`），启动/停止记录追加到同目录
`.report-viewer/activity.log`（程序目录只读时回退 `~/.report-viewer/`）。
部署时若直接把 `server.js`/`lib/`/`public/` 部署到目标目录，审计文件就在该目标目录的
`.report-viewer/` 内，不会额外套一层 `src`。

| 方式 | 说明 |
|---|---|
| config `"audit": true` | 配置文件开启 |
| 环境变量 `REPORT_VIEWER_AUDIT=1` | 环境变量开启（`0` 关闭） |
| `--audit` / `--no-audit` | 命令行覆盖（优先级最高） |

优先级：命令行 `--audit`/`--no-audit` > 环境变量 `REPORT_VIEWER_AUDIT` > config `audit` > 默认 `false`。

## 4. `urls`

| 键 | 默认值 | 说明 |
|---|---|---|
| `data` | `report-validation-data.json` | 主数据文件（单文件或多文件清单），相对 web 根目录 |
| `defaultData` | `report-validation-data-default.json` | 默认模板数据文件；`defaultDataMode=default` 时优先加载 |
| `initData` | `report-validation-data-init.json` | 空占位数据文件；`defaultDataMode=init` 时加载 |
| `defaultDataMode` | `default` | 默认数据源：`init` / `default` / 某个已扫描批次名（其他值等同 `default`） |
| `ignore` | `ignore-config-by-platform.json` | 忽略配置，相对 web 根目录 |
| `batches` | `batches-index.json` | 批次索引，相对 web 根目录 |
| `help` | `batch-help.json` | docker 帮助文档内容文件，相对 web 根目录 |
| `scan` | `/scan` | 批次自动扫描接口（相对站点根） |

## 5. `ui`

| 键 | 可选值 | 默认值 |
|---|---|---|
| `lang` | `zh-CN` / `zh-HK` / `en` | `zh-CN` |
| `theme` | `light` / `dark` / `warm` / `forest` / `midnight` / `ocean` / `graphite` / `violet` / `sunset` / `neon` / `aurora` | `light` |
| `sidebarMode` | `combined` / `lazy` / `pagination` | `combined` |
| `sidebarWidth` | 数字（≥160） | `280` |
| `reportCatDefault` | `null` / `charts` / `files` / `note` | `null` |
| `batchDockSide` | `left` / `right` | `left` |
| `progressBarStyle` | `status` / `uniform` | `status` |

## 6. `features`（19 项，布尔）

`uncomparedXpath` / `uncomparedCsv` / `uncomparedItems` / `logs` /
`conversionRule` / `validationRule` / `excelMapping` / `sourceFilter` / `modalRules` /
`columnHover` / `sidebarSearch` / `sidebarTradeId` / `compare` /
`healthOverview` / `globalSearch` / `keyboardShortcuts` / `modalPrints` / `recentBatches` /
`batchHelp`（docker 帮助图标入口）

## 7. `limits`

| 键 | 默认值 |
|---|---|
| `pageSize` | `20` |
| `pageSizeOptions` | `[10, 20, 50]` |
| `sidebarPageSize` | `8` |
| `msgPageSize` | `20` |
| `globalSearchLimit` | `200` |

## 8. `batches`

| 键 | 默认值 | 说明 |
|---|---|---|
| `recentCount` | `5` | dock 中最近批次数量 |
| `pageSize` | `8` | 批次面板每页条数 |
| `listMode` | `lazy` | `lazy` / `pagination` |
| `detailMode` | `quick` | `quick` / `modal` |
| `panelWidth` | `320` | 批次面板宽度（px） |

## 9. `columns`

字段比较表列配置，包含 5 个子项：

- `default`：列名 → 布尔（`true` 显示 / `false` 隐藏），即各列的默认可见性。
- `labels`：列显示名覆盖（键为列名，值为字面量或 `{语言: 显示名}` 多语对象），未配置时回退到 i18n 默认标签。
- `selector`：列是否出现在「列选择」菜单中（`true` / `false`），未配置的列默认出现。
- `tag`：是否在 `aoEl` 单元格显示 XPath/CSV 标签（默认 `false`）。
- `userTag`：用户标签「值 → 显示」配置，含 `raw`（是否只显示原值，普通文本）与 `labels`（值 → 显示标签映射，值为字面量或 `{语言: 显示标签}` 多语对象，标签样式）。

可用列名（对应新数据结构）：

`channel`、`source`、`field`、`userTag`、`eoEl`、`aoEl`、`eoCvtEl`、`aoCvtEl`、`vdtEl`、`type`、`ctxs`、`eoUnconverted`、`eo`、`aoUnconverted`、`ao`、`result`、`remarks`。

| 列名 | 默认标签 | 含义 | 数据来源 |
| --- | --- | --- | --- |
| `channel` | 报告渠道 | 报告渠道 | `channel.name` |
| `source` | 来源渠道 | 来源渠道 | `source.name` |
| `field` | 报告字段 | 字段名 | `channel.fields[].name` |
| `userTag` | 用户标签 | 字段断言类型标签 | `channel.fields[].userTag` |
| `eoEl` | 表达式 (CMP-L) | 左侧（EO/来源）定位表达式 | `cmpLeft.el` |
| `aoEl` | 表达式 (CMP-R) | 右侧（AO/报送）定位表达式（XPath 或 CSV 列） | `cmpRight.el`（srcType=1 为 XPath，srcType=2 为 CSV） |
| `eoCvtEl` | 表达式 (CVT-L) | EO 值转换规则表达式 | `cvtLeft.el` |
| `aoCvtEl` | 表达式 (CVT-R) | AO 值转换规则表达式 | `cvtRight.el` |
| `vdtEl` | 表达式 (VDT) | AO 终值校验规则表达式 | `vdt.el` |
| `type` | 类型 | 值类型 | `channel.fields[].type` |
| `ctxs` | 命中Ctx | 命中上下文（各规则 `ctxs` 的 id 并集，解析为 key） | `cmpLeft`/`cmpRight`/`cvtLeft`/`cvtRight`/`vdt` 的 `ctxs` 并集 |
| `eoUnconverted` | 期望值 (EO-U) | EO 未转换值 | `cvtLeft.raw` |
| `eo` | 期望值 (EO) | 期望值 | `cmpLeft.value` |
| `aoUnconverted` | 期望值 (AO-U) | AO 未转换值 | `cvtRight.raw` |
| `ao` | 实际值 (AO) | 实际值 | `cmpRight.value` |
| `result` | 结果 | 比对结果 | `field.result` |
| `remarks` | 说明 | 说明 | `field.remarks` |

> `eoEl`/`aoEl`/`eoCvtEl`/`aoCvtEl`/`vdtEl`/`eoUnconverted`/`aoUnconverted` 为数据快速预览列，默认隐藏，可通过「列选择」或 `columns.default` 开启。
