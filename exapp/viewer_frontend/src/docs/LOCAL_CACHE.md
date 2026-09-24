# 本地缓存（偏好记忆）与清除

查看器把「浏览器记得的偏好与最近状态」全部存在浏览器本地，**不写服务器**；收藏夹与忽略配置在服务器另有一份权威数据（本地只是镜像）。
本文档汇总**受管理的缓存项、作用域规则与清除方式**，与 `public/app.js` 的实现一一对应。

> 界面入口：顶栏帮助按钮右侧的「清除偏好记忆」（逆时针重置箭头图标）与「主页」（房子图标）；两者均为 15×15 内联 SVG（与帮助按钮 `?` 视觉尺寸对齐），并各自受 `features.clearLocalCache` / `features.homeButton` 控制（prod 默认关闭）。应用内帮助面板（`batch-help.json` 第十节）提供同样的摘要。

## 1. 受管理的缓存项（共 6 项）

| # | 名称 | 存储位置 / 键（基名） | 内容 | 清除后的影响 |
|---|---|---|---|---|
| 1 | 界面偏好 | localStorage `reportValidationPrefs.v1` | 主题 / 语言 / 侧栏宽度 / dock 侧与位置 / 列表高度 / 列可见性 | 回到默认外观 |
| 2 | 上次活动批次 | localStorage `reportValidationBatch.v1` | `{ id, forced }` | 回退到「置顶 > 默认数据」 |
| 3 | 置顶批次 | localStorage `reportValidationPin.v1` | 批次 id | 置顶丢失（可重新置顶） |
| 4 | 忽略配置镜像 | localStorage `reportValidationIgnoreConfig.v1` | 运行时扁平 key | 无损失（以服务器配置文件为准） |
| 5 | 收藏夹镜像 | localStorage `reportValidationFavorites.v1` | 收藏树 | 无损失（以服务器 `favorites.json` 为准） |
| 6 | 数据缓存 | IndexedDB `reportViewerCache`（store `files`，key = 请求 URL） | ETag + 响应体 | 下次全量重新下载 |

- 不参与该项管理的其它存储：**没有** service worker、CacheStorage、Cookie、sessionStorage 写入。
- 除上表 6 项外，查看器不写任何浏览器本地存储。

## 2. 作用域（租户模式按租户分区）

租户模式（服务端在下发的 `/config.json` 里给 `tenant: { enabled: true, id }`）下，上表每一项都按租户隔离：

| 项 | 租户模式 | 非租户模式 |
|---|---|---|
| localStorage 键 | `<基名>@<tenantId>`，例：`reportValidationPrefs.v1@alice` | 历史键名（无后缀） |
| IndexedDB key | `tenant:<tenantId>:<url>` | 原 URL |

- 服务端只下发 `{ enabled, id }`，**不包含** `dataRoot` 等服务器路径。
- 非租户模式**不做迁移**：租户模式不会读取旧的无限定键（避免把一个租户的状态错误地交给另一个租户）；非租户模式的键名与历史版本完全一致。

## 3. 清除方式

- 入口：顶栏「清除偏好记忆」按钮（逆时针重置箭头图标；hover 提示「清除偏好记忆（语言、列可见性、批次置顶等）」）；开关 `features.clearLocalCache`（`config.json` / dev / test 默认 `true`，**prod 默认 `false`**，关闭时按钮隐藏）。
- 交互：**无二次确认**，点击立即清除 → 视口顶部提示（`.app-toast`，自动消失）→ 900ms 后自动刷新页面（内存态无法就地复原）。
- 实现约束（保证「只清当前作用域」）：
  - 不使用 `localStorage.clear()`，只删除 5 个基名（含作用域后缀）对应的键；
  - 不删除 IndexedDB 库，用游标按 `tenant:<id>:` 前缀逐条删除（非租户模式只删非租户项）；
  - 因此**同源下其它应用、其它租户，以及服务器端数据（批次 / 收藏夹 / 忽略配置）都不受影响**。
- 纯函数（`public/app.js` 导出，`test/local-cache.test.js` 覆盖）：

  | 函数 | 作用 |
  |---|---|
  | `localCacheKeys(tenantId)` | 返回当前作用域应清除的 localStorage 键清单 |
  | `clearLocalCacheStorage(storage, tenantId)` | 只删属于该作用域的键，返回被删除的键名数组 |
  | `idbKeyInScope(key, tenantId)` | 判断某条 IndexedDB 缓存 key 是否属于该作用域 |

- 注意：其它已打开的标签页仍持有旧的内存状态，其后续写入（如切换主题、加载批次）会把键写回；建议一并刷新。

## 4. 相关入口

- 顶栏「主页」按钮（简约房子图标，hover 提示「回到站点根」/"Back to Site Root"）：回到站点根（`origin + pathname`，不带查询参数与深链接）并重新加载；与启动失败提示条的「回到主页」共用 `webRootUrl()`；开关 `features.homeButton`（prod 默认关闭）。
- 配置开关：`features.clearLocalCache` / `features.homeButton`，见 [`CONFIG.md` §6](CONFIG.md)。
- 其它持久化（服务器端）：收藏夹 `GET/POST /api/favorites`、忽略配置 `POST /api/ignore`、批次元数据 `POST /api/batch`，见 [`README.md`](README.md)。
