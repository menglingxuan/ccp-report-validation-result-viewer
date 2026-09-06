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
| `basedir` | `public/batches` | 批次根目录（相对 `src/`） |
| `out` | `public/batches-index.json` | 索引输出路径（相对 `src/`） |
| `ignore` | `[]` | 排除目录的正则数组 |
| `env` | `null` | 仅扫描指定 `reportEnv` 的批次；`null` = 全部 |

> 环境变量覆盖（优先级：环境变量 > `config.json` > 内置默认值）：
> `REPORT_VIEWER_HOST` / `REPORT_VIEWER_PORT` / `REPORT_VIEWER_WEBROOT` /
> `REPORT_VIEWER_BASEDIR` / `REPORT_VIEWER_OUT` / `REPORT_VIEWER_ENV` / `REPORT_VIEWER_IGNORE`（逗号分隔，追加）。

## 3. `runType`

| 值 | 含义 |
|---|---|
| `dev` | 开发环境：`features` 中未显式配置的项默认 **true** |
| `test` | 测试环境：同上，默认 **true** |
| `prod` | 生产环境：`features` 中未显式配置的项默认 **false** |

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

## 9. `columns.default`

列名 → 布尔（`true` 显示 / `false` 隐藏）。可用列名：

`channel`、`source`、`f`、`x`、`aoCsv`、`t`、`ctx`、`eo`、`ao`、`result`、`note`。
