# 配置说明（CONFIG）

> 文件：`engine/report-validation-config.json`
> 结构校验：`engine/config.schema.json`（JSON Schema，编辑器可自动补全/校验）

所有配置项均可省略；省略时使用内置默认值。JSON 不支持注释，完整备注见本文件与 Schema。

---

## 顶层结构

| 键 | 类型 | 说明 |
|---|---|---|
| `configVersion` | 整数 | 配置结构版本号（当前 2） |
| `runType` | 字符串 | 运行环境（见下） |
| `urls` | 对象 | 数据/忽略规则/批次索引文件的相对路径 |
| `ui` | 对象 | 界面默认项 |
| `features` | 对象 | 18 个功能开关 |
| `limits` | 对象 | 分页与数量上限 |
| `batches` | 对象 | 最近批次面板的行为配置 |
| `columns` | 对象 | 默认列可见性 |

---

## 1. `runType`

| 值 | 含义 |
|---|---|
| `dev` | 开发环境：`features` 中未显式配置的项默认 **true**（全量展示） |
| `test` | 测试环境：同上，默认 **true** |
| `prod` | 生产环境：`features` 中未显式配置的项默认 **false**（按需开启） |

---

## 2. `urls`

| 键 | 含义 | 默认 |
|---|---|---|
| `data` | 比对结果数据 JSON 的相对路径 | `report-validation-data.json` |
| `ignore` | 忽略配置 JSON 的相对路径 | `ignore-config-by-platform.json` |
| `batches` | 批次索引 JSON（最近批次面板数据源）的相对路径 | `batches-index.json` |
| `scan` | 批次自动扫描 HTTP 接口地址（可选；不配置则跳过扫描接口，直接重新读取索引） | `http://127.0.0.1:8123/scan` |

> 说明：数据文件与忽略规则文件**相互独立**，仅在此处用路径引用，不并入本配置文件。
> `urls.scan` 指向 `scan-server.js`（见 `SCAN_SERVER.md`）：点击批次面板/dock 的「重新扫描」时先调用该接口执行 `scan-batches.js`，再重新读取 `batches-index.json`。

---

## 3. `ui`

| 键 | 可选值 | 含义 | 默认 |
|---|---|---|---|
| `lang` | `zh-CN` / `zh-HK` / `en` | 默认语言（简体 / 繁体香港 / 英文） | `zh-CN` |
| `theme` | `light` / `dark` / `warm` / `forest` / `midnight` / `ocean` / `graphite` / `violet` / `sunset` / `neon` / `aurora` | 默认主题配色 | `light` |
| `sidebarMode` | `combined` / `lazy` / `pagination` | 侧栏加载方式：`combined` 虚拟滚动（一体滚动）/ `lazy` 懒加载 / `pagination` 分页 | `combined` |
| `sidebarWidth` | 数字（≥160） | 侧栏初始宽度（px） | `280` |
| `reportCatDefault` | `null` / `charts` / `files` / `note` | 报告信息默认展开分类：`null` 收起 / `charts` 统计图表 / `files` 输入配置文件 / `note` 任务说明 | `null` |
| `batchDockSide` | `left` / `right` | 最近批次 dock 停靠与面板呼出方向 | `left` |
| `progressBarStyle` | `status` / `uniform` | 左侧 item 列表卡片进度条样式：`status` 按状态着色（通过绿色、有警告且无失败黄色）/ `uniform` 统一绿色 | `status` |

> 用户浏览器中的语言/主题/侧栏宽度/dock 方向偏好（localStorage）优先级高于 `ui` 里的默认值。

---

## 4. `features`（18 项，布尔）

| 键 | 含义（=true） |
|---|---|
| `uncomparedXpath` | 显示「未比较 XPath」选项卡 |
| `uncomparedCsv` | 显示「未比较 CSV 字段」选项卡 |
| `uncomparedItems` | 显示「未比较 Item」选项卡 |
| `logs` | 显示「完整日志」选项卡 |
| `conversionRule` | 详情页显示「EO 值转换规则」 |
| `validationRule` | 详情页显示「AO 终值校验规则」 |
| `excelMapping` | 详情页显示「Excel 映射配置」按钮 |
| `excelConversionRule` | 详情页显示「Excel 转换规则配置」按钮 |
| `excelValidationRule` | 详情页显示「Excel 终值校验规则配置」按钮 |
| `columnHover` | 表格列悬浮高亮 |
| `sidebarSearch` | 侧栏搜索框 |
| `sidebarTradeId` | 侧栏 Trade ID 筛选 |
| `compare` | 「对比」选项卡 |
| `healthOverview` | 「健康总览」按钮（含键盘 `H`） |
| `globalSearch` | 「全局搜索」按钮（含键盘 `G`） |
| `keyboardShortcuts` | 键盘快捷键总开关（`/ ? G H J K`） |
| `modalPrints` | 详情页「相关打印信息」 |
| `recentBatches` | 启用「最近批次」左侧 dock + 批次面板（多批次扫描） |

---

## 5. `limits`

| 键 | 含义 | 默认 |
|---|---|---|
| `pageSize` | 字段比较表每页条数 | `20` |
| `pageSizeOptions` | 每页条数的可选值（数组） | `[10, 20, 50]` |
| `sidebarPageSize` | 侧栏 item 列表每页条数 | `8` |
| `msgPageSize` | 警告/错误/未比较等消息表每页条数 | `20` |
| `globalSearchLimit` | 全局搜索最大返回结果数 | `200` |

---

## 6. `batches`

| 键 | 含义 | 默认 |
|---|---|---|
| `recentCount` | dock 中显示的最近批次数量 | `5` |
| `pageSize` | 批次面板列表每页条数 | `8` |
| `listMode` | `lazy` / `pagination` | 批次列表加载方式：`lazy` 懒加载（点「加载更多」逐页追加）/ `pagination` 分页（页码跳转） | `lazy` |
| `detailMode` | `quick` / `modal` | 批次详情交互：`quick` 单击浮动预览 + 双击加载（默认）/ `modal` 单击加载 + 信息图标弹窗 | `quick` |
| `panelWidth` | 批次面板展开宽度（px） | `320` |

---

## 7. `columns.default`

列名 → 布尔（`true` 显示 / `false` 隐藏）。可用列名：

`channel`（报告渠道）、`source`（来源渠道）、`f`（报告字段）、`x`（CCP XPath）、`aoCsv`（CCP CSV）、`t`（类型）、`ctx`（命中Ctx）、`eo`（期望值 EO）、`ao`（实际值 AO）、`result`（结果）、`note`（说明）。

默认：

```json
{ "channel": true, "source": true, "f": true, "x": true, "aoCsv": true,
  "t": false, "ctx": false, "eo": true, "ao": true, "result": true, "note": false }
```
