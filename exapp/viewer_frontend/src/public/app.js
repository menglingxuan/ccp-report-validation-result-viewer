
    /* ============================================================
     * 数据模型说明
     * item (tradeId) -> 报告渠道 (HKTR/JSFA/CFTC)
     *   -> 来源渠道 (A/B, 各有一套字段映射)
     *     -> 字段比较结果 { id, ctxs, cmpLeft, cmpRight, cvtLeft, cvtRight, vdt, result, remarks, resultText, resultDetails, prints }
     * item 级别: fields[]（字段注册表，按 id 去重）/ ctxDefs / warnings[] / errors[] / uncompared[] / logs[]
     * ============================================================ */

    import {
      parseSearchQuery, makeMatcher, matchRow,
      specialValueMatch, sortValue, flatFields, diffSegments,
      groupedToFlat, normalizeIgnoreConfig, msgIgnoreKey, flatToGrouped, parseIgnoreImport, applyIgnoreImport,
      listIgnoreEntries, countIgnoredByKey, removeIgnoreKeys,
      computeHealthPure, globalSearchPure,
      normalizeDescriptionEx, parseMarkdownTable, inlineMarkdown, filterTableRows, sortTableRows, paginateRows, cycleSort,
      filterRowsByRules, FILTER_EMPTY,
      descExToolsVisible, pageItems, fitColWidths,
      normalizeItemSummary,
    } from './core.js';

    const TYPE_META = {
      platformAssertion: { label: '平台断言', cls: 'tp-platform' },
      productAssertion:  { label: '产品断言', cls: 'tp-product' },
      contextAssertion:  { label: '上下文断言', cls: 'tp-context' },
    };

    const ERROR_TYPE_META = {
      xpathError:      { label: 'errXpath',      cls: 'er-xpath' },
      conversionError: { label: 'errConversion', cls: 'er-conversion' },
      mappingError:    { label: 'errMapping',    cls: 'er-mapping' },
      runtimeError:    { label: 'errRuntime',    cls: 'er-runtime' },
      bufferError:     { label: 'errBuffer',     cls: 'er-buffer' },
    };

    const CHANNELS = [
      { name: 'HKTR', desc: '香港交易资料储存库', format: 'xml' },
      { name: 'JSFA', desc: '日本金融厅', format: 'xml' },
      { name: 'CFTC', desc: '美国商品期货交易委员会', format: 'csv' },
    ];

    // 产品类别 -> 子产品（示例：利率类 IR 包含 IRS/OIS/BSW 等）
    const PRODUCT_CATEGORIES = {
      IR: { label: 'catIR', sub: ['IRS', 'OIS', 'BSW'] },
      CD: { label: 'catCD', sub: ['CDS', 'CDX'] },
      FX: { label: 'catFX', sub: ['FXS', 'FXF', 'FXO'] },
    };
    const DEFAULT_ENV = 'UNKNOWN';
    // 本次比较任务的说明文本（多行）
    const TASK_NOTE = '本次比较任务说明：\n1. 校验多渠道来源数据与监管报送数据的一致性。\n2. 验证配置驱动映射（Excel）与命中上下文逻辑。\n3. 回归测试多行字段与特殊字符的展示效果。';

    // 每个报告渠道的字段定义以数据文件为准（见 docs/DATA_SCHEMA.md 4/5 节）。
    /* ---------- 数据源与配置（外部 JSON 输入） ---------- */
    let DATA_URL = 'report-validation-data.json';
    let DEFAULT_DATA_URL = 'report-validation-data-default.json';
    let INIT_DATA_URL = 'report-validation-data-init.json';
    let DEFAULT_DATA_MODE = 'default';
    let IGNORE_CONFIG_URL = 'ignore-config-by-platform.json';
    // 回写目标：实际加载成功的配置文件 URL（批次级忽略配置与其批次文件同目录，保持读写同一文件）。
    let IGNORE_ACTIVE_URL = '';
    // 加载时的 ETag：回写时作为 If-Match 发回，服务端检测到其它会话已修改则返回 409（乐观并发）。
    let IGNORE_ETAG = '';
    const CONFIG_URL = 'config.json';
    let DATA_MODE = 'single';
    // 当前已加载数据清单文件的绝对 URL（多文件模式据此解析 item 文件的相对路径）。
    let DATA_FILE_URL = null;
    let APP_LIMITS = { pageSize: 20, pageSizeOptions: [10, 20, 50], sidebarPageSize: 8, msgPageSize: 20, globalSearchLimit: 200, descExPageSize: 5, ignoreMgrPageSize: 10 };
    let APP_REPORT_CAT_DEFAULT = null;
    let APP_PROGRESS_STYLE = 'status';
    let DATA = { items: [] };
    let APP_FEATURES = {
      uncomparedXpath: true, uncomparedItems: true, uncomparedCsv: true, logs: true,
      conversionRule: true, validationRule: true,
      excelMapping: true,
      sourceFilter: true,
      modalRules: true,
      columnHover: true,
      sidebarSearch: true, sidebarTradeId: true,
      compare: true, healthOverview: true, globalSearch: true,
      keyboardShortcuts: true, modalPrints: true,
      recentBatches: true, batchHelp: true,
      // 任务说明扩展内容（batch-meta.json 的 descriptionEx，只读）：默认启用。
      descriptionEx: true,
      // 顶栏「清除偏好记忆」与「主页」按钮（均仅清/作用于浏览器本地；默认 dev/test 开、prod 关）。
      clearLocalCache: true,
      homeButton: true,
    };
    let SIDEBAR_MODE = 'combined';
    const SIDEBAR_ROW_H = 112;
    let SIDEBAR_SCROLL_PENDING = false;

    /* ---------- 最近批次（多批次扫描） ---------- */
    let BATCHES_INDEX_URL = 'batches-index.json';
    let SCAN_API_URL = '';
    const SUPPORTED_FORMAT_VERSIONS = [2];
    const BATCH_STORAGE_KEY = 'reportValidationBatch.v1';   // 基名（实际键见 storageKey）
    const PIN_STORAGE_KEY = 'reportValidationPin.v1';       // 基名（实际键见 storageKey）
    // 被「置顶为默认加载」的批次 id（持久化，冷/热启动时优先加载）。
    let PINNED_BATCH_ID = null;
    let BATCHES_INDEX = { batches: [] };
    let BATCH_STATE = {
      loaded: false,
      loading: false,
      expanded: false,
      search: '',
      date: '',
      sortDir: -1,
      page: 1,
      pageSize: 8,
      recentCount: 5,
      active: null,
      forced: false,
      notice: '',
      side: 'left',
      scanning: false,
      dockY: null,
      // 批次范围：'all' 全部批次 / 'compat' 仅看兼容 / 'allDeleted' 全部批次(含已删除)
      batchScope: 'all',
      cmd: '',
      desc: '',
      env: '',
      tag: '',
      searchCollapsed: true,
      filtersCollapsed: true,
      listMode: 'lazy',
      listH: null,
      detailMode: 'quick',
      pendingDeletes: {},
      favoritesOpen: false,
    };
    const BATCH_ROW_H = 100;
    let BATCH_SCROLL_PENDING = false;
    let NEW_BATCH_IDS = {};

    /* ---------- 本地缓存作用域（按租户分区） ----------
     * 租户模式（config.json 的 tenant.enabled）下，所有本地缓存键带 `@<tenantId>` 后缀：
     * 偏好 / 上次批次 / 置顶 / 忽略配置镜像 / 收藏夹镜像（localStorage）与数据缓存（IndexedDB）
     * 均按租户隔离。非租户模式沿用历史键名——**不做迁移**，避免把某个租户的旧状态错误地交给其它租户。
     * 「清除本地缓存」也只清除当前作用域内的项。
     */
    let TENANT_ID = null;
    function storageKey(base) { return TENANT_ID ? base + '@' + TENANT_ID : base; }
    function idbCacheKey(url) { return TENANT_ID ? 'tenant:' + TENANT_ID + ':' + url : url; }
    async function loadAppConfig() {
      try {
        const res = await fetch(CONFIG_URL, { cache: 'no-store' });
        if (!res.ok) return;
        const cfg = await res.json();
        if (!cfg || typeof cfg !== 'object') return;
        const warn = function (msg) { try { console.warn('[config] ' + msg); } catch (e) {} };

        // 缓存作用域：尽早确定当前租户（后续所有 localStorage / IndexedDB 读写均依赖它）。
        const tn = cfg.tenant && typeof cfg.tenant === 'object' ? cfg.tenant : null;
        TENANT_ID = (tn && tn.enabled && typeof tn.id === 'string' && tn.id) ? tn.id : null;

        const runType = String(cfg.runType || '').toLowerCase();
        const verbose = runType === 'dev' || runType === 'test';
        const f = cfg.features || {};
        const flag = function (k) { return f[k] !== undefined ? !!f[k] : verbose; };
        APP_FEATURES = {
          uncomparedXpath: flag('uncomparedXpath'),
          uncomparedItems: flag('uncomparedItems'),
          uncomparedCsv: flag('uncomparedCsv'),
          logs: flag('logs'),
          conversionRule: flag('conversionRule'),
          validationRule: flag('validationRule'),
          excelMapping: flag('excelMapping'),
          sourceFilter: flag('sourceFilter'),
          modalRules: flag('modalRules'),
          columnHover: flag('columnHover'),
          sidebarSearch: flag('sidebarSearch'),
          sidebarTradeId: flag('sidebarTradeId'),
          compare: flag('compare'),
          healthOverview: flag('healthOverview'),
          globalSearch: flag('globalSearch'),
          keyboardShortcuts: flag('keyboardShortcuts'),
          modalPrints: flag('modalPrints'),
          recentBatches: flag('recentBatches'),
          batchHelp: flag('batchHelp'),
          revealPath: flag('revealPath'),
          descriptionEx: flag('descriptionEx'),
          clearLocalCache: flag('clearLocalCache'),
          homeButton: flag('homeButton'),
        };

        if (cfg.urls && typeof cfg.urls === 'object') {
          if (typeof cfg.urls.data === 'string' && cfg.urls.data) DATA_URL = cfg.urls.data;
          if (typeof cfg.urls.defaultData === 'string') DEFAULT_DATA_URL = cfg.urls.defaultData;
          if (typeof cfg.urls.initData === 'string') INIT_DATA_URL = cfg.urls.initData;
          if (typeof cfg.urls.defaultDataMode === 'string') DEFAULT_DATA_MODE = cfg.urls.defaultDataMode;
          if (typeof cfg.urls.ignore === 'string' && cfg.urls.ignore) { IGNORE_CONFIG_URL = cfg.urls.ignore; IGNORE_ACTIVE_URL = IGNORE_CONFIG_URL; }
          if (typeof cfg.urls.batches === 'string' && cfg.urls.batches) BATCHES_INDEX_URL = cfg.urls.batches;
          if (typeof cfg.urls.help === 'string' && cfg.urls.help) BATCH_HELP_URL = cfg.urls.help;
          if (typeof cfg.urls.scan === 'string' && cfg.urls.scan) SCAN_API_URL = cfg.urls.scan;
        }

        const ui = cfg.ui && typeof cfg.ui === 'object' ? cfg.ui : {};
        if (ui.sidebarMode === 'lazy' || ui.sidebarMode === 'pagination' || ui.sidebarMode === 'combined') SIDEBAR_MODE = ui.sidebarMode;
        else if (ui.sidebarMode !== undefined) warn('未知 ui.sidebarMode=' + ui.sidebarMode + '（可选 combined / lazy / pagination）');
        if (ui.lang && LANGS.some(function (l) { return l[0] === ui.lang; })) LANG = ui.lang;
        else if (ui.lang !== undefined) warn('未知 ui.lang=' + ui.lang + '（可选 zh-CN / zh-HK / en）');
        if (ui.theme && THEMES.some(function (t) { return t[0] === ui.theme; })) THEME = ui.theme;
        else if (ui.theme !== undefined) warn('未知 ui.theme=' + ui.theme);
        if (typeof ui.sidebarWidth === 'number' && ui.sidebarWidth >= 160) SIDEBAR_WIDTH = ui.sidebarWidth;
        if (ui.reportCatDefault === null || ui.reportCatDefault === 'charts' || ui.reportCatDefault === 'files' || ui.reportCatDefault === 'note') APP_REPORT_CAT_DEFAULT = ui.reportCatDefault;
        else if (ui.reportCatDefault !== undefined) warn('未知 ui.reportCatDefault=' + ui.reportCatDefault + '（可选 null / charts / files / note）');
        if (ui.batchDockSide === 'left' || ui.batchDockSide === 'right') BATCH_STATE.side = ui.batchDockSide;
        else if (ui.batchDockSide !== undefined) warn('未知 ui.batchDockSide=' + ui.batchDockSide + '（可选 left / right）');
        if (ui.progressBarStyle === 'status' || ui.progressBarStyle === 'uniform') APP_PROGRESS_STYLE = ui.progressBarStyle;
        else if (ui.progressBarStyle !== undefined) warn('未知 ui.progressBarStyle=' + ui.progressBarStyle + '（可选 status / uniform）');

        const lm = cfg.limits && typeof cfg.limits === 'object' ? cfg.limits : {};
        if (typeof lm.pageSize === 'number' && lm.pageSize > 0) APP_LIMITS.pageSize = Math.floor(lm.pageSize);
        if (Array.isArray(lm.pageSizeOptions)) {
          const opts = lm.pageSizeOptions.filter(function (n) { return typeof n === 'number' && n > 0; });
          if (opts.length) APP_LIMITS.pageSizeOptions = opts;
        }
        if (typeof lm.sidebarPageSize === 'number' && lm.sidebarPageSize > 0) APP_LIMITS.sidebarPageSize = Math.floor(lm.sidebarPageSize);
        if (typeof lm.msgPageSize === 'number' && lm.msgPageSize > 0) APP_LIMITS.msgPageSize = Math.floor(lm.msgPageSize);
        if (typeof lm.globalSearchLimit === 'number' && lm.globalSearchLimit > 0) APP_LIMITS.globalSearchLimit = Math.floor(lm.globalSearchLimit);
        if (typeof lm.descExPageSize === 'number' && lm.descExPageSize > 0) APP_LIMITS.descExPageSize = Math.floor(lm.descExPageSize);
        if (typeof lm.ignoreMgrPageSize === 'number' && lm.ignoreMgrPageSize > 0) APP_LIMITS.ignoreMgrPageSize = Math.floor(lm.ignoreMgrPageSize);

        if (cfg.columns && typeof cfg.columns === 'object') {
          if (cfg.columns.default && typeof cfg.columns.default === 'object') {
            Object.keys(cfg.columns.default).forEach(function (k) {
              if (Object.prototype.hasOwnProperty.call(DEFAULT_COLUMNS, k)) DEFAULT_COLUMNS[k] = !!cfg.columns.default[k];
            });
          }
          if (cfg.columns.labels && typeof cfg.columns.labels === 'object') {
            Object.keys(cfg.columns.labels).forEach(function (k) { COL_LABELS[k] = cfg.columns.labels[k]; });
          }
          if (cfg.columns.selector && typeof cfg.columns.selector === 'object') {
            Object.keys(cfg.columns.selector).forEach(function (k) { COL_SELECTOR[k] = !!cfg.columns.selector[k]; });
          }
          if (cfg.columns.tag !== undefined) COL_TAG = !!cfg.columns.tag;
          if (cfg.columns.widths && typeof cfg.columns.widths === 'object') {
            Object.keys(cfg.columns.widths).forEach(function (k) {
              const cw = COL_WIDTHS[k];
              const w = cfg.columns.widths[k];
              if (!cw || !w || typeof w !== 'object') return;
              if (typeof w.def === 'number' && w.def > 0) cw.def = Math.floor(w.def);
              if (typeof w.min === 'number' && w.min > 0) cw.min = Math.floor(w.min);
              if (typeof w.max === 'number' && w.max > 0) cw.max = Math.floor(w.max);
              if (typeof w.resizable === 'boolean') cw.resizable = w.resizable;
            });
          }
          if (cfg.columns.userTag && typeof cfg.columns.userTag === 'object') {
            if (cfg.columns.userTag.raw !== undefined) USER_TAG_RAW = !!cfg.columns.userTag.raw;
            if (cfg.columns.userTag.labels && typeof cfg.columns.userTag.labels === 'object') {
              Object.keys(cfg.columns.userTag.labels).forEach(function (k) { USER_TAG_LABELS[k] = cfg.columns.userTag.labels[k]; });
            }
          }
        }

        const bt = cfg.batches && typeof cfg.batches === 'object' ? cfg.batches : {};
        if (typeof bt.recentCount === 'number' && bt.recentCount > 0) BATCH_STATE.recentCount = Math.floor(bt.recentCount);
        if (typeof bt.pageSize === 'number' && bt.pageSize > 0) BATCH_STATE.pageSize = Math.floor(bt.pageSize);
        if (bt.listMode === 'lazy' || bt.listMode === 'pagination') BATCH_STATE.listMode = bt.listMode;
        if (bt.detailMode === 'quick' || bt.detailMode === 'modal') BATCH_STATE.detailMode = bt.detailMode;
        if (typeof bt.panelWidth === 'number' && bt.panelWidth >= 240) document.documentElement.style.setProperty('--batch-w', bt.panelWidth + 'px');
      } catch (e) { try { console.warn('[config] 配置解析失败：', e); } catch (_) {} }
    }

    function isTabEnabled(tab) {
      if (tab === 'uncompared') return (APP_FEATURES.uncomparedXpath || APP_FEATURES.uncomparedCsv);
      if (tab === 'uncomparedItems') return APP_FEATURES.uncomparedItems;
      if (tab === 'logs') return APP_FEATURES.logs;
      if (tab === 'compare') return APP_FEATURES.compare;
      return true;
    }

    /* ---------- 数据加载：单文件 / 多文件模式 ---------- */
    function validDataset(json) {
      return !!(json && typeof json === 'object' && Array.isArray(json.items));
    }
    function normalizeLoaded(json) {
      DATA_MODE = json.mode === 'multi' ? 'multi' : 'single';
      return json;
    }
    async function fetchJSON(url) {
      return fetchJSONCached(url);
    }
    /* ---------- IndexedDB + ETag 缓存（no-cache 重校验，保证数据绝不陈旧） ----------
     * 服务端对静态/数据文件返回强 ETag 与 Cache-Control: no-cache；
     * 此处用 If-None-Match 条件请求：304 时用本地缓存体，200 时更新缓存体。
     * 缓存仅按 URL 存储，跨用户由服务端数据源保证一致；任何缓存写入都伴随新 ETag。 */
    let IDB = null;
    function openIdb() {
      return new Promise(function (resolve) {
        if (IDB) return resolve(IDB);
        if (typeof indexedDB === 'undefined') return resolve(null);
        try {
          const req = indexedDB.open('reportViewerCache', 1);
          req.onupgradeneeded = function () {
            const db = req.result;
            if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
          };
          req.onsuccess = function () { IDB = req.result; resolve(IDB); };
          req.onerror = function () { IDB = null; resolve(null); };
        } catch (e) { resolve(null); }
      });
    }
    function idbGet(db, key) {
      return new Promise(function (resolve) {
        try {
          const tx = db.transaction('files', 'readonly');
          const req = tx.objectStore('files').get(key);
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }
    function idbPut(db, key, val) {
      return new Promise(function (resolve) {
        try {
          const tx = db.transaction('files', 'readwrite');
          tx.objectStore('files').put(val, key);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }
    async function fetchJSONCached(url) {
      // 缓存键按租户作用域分区（idbCacheKey）：同一 origin 下多租户互不覆盖。
      const key = idbCacheKey(url);
      const db = await openIdb();
      const cached = db ? await idbGet(db, key) : null;
      const headers = {};
      if (cached && cached.etag) headers['If-None-Match'] = cached.etag;
      const res = await fetch(url, { cache: 'no-store', headers: headers });
      if (res.status === 304 && cached) return JSON.parse(cached.body);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.text();
      const etag = res.headers.get('etag');
      if (db && etag) await idbPut(db, key, { etag: etag, body: body });
      return JSON.parse(body);
    }
    // 默认数据源可配置（urls.defaultDataMode）：
    //   "init"          -> 读取 urls.initData（空占位数据）
    //   "default" 或其他 -> 读取 urls.defaultData（默认模板数据）
    //   某个批次名        -> 读取该批次的数据文件
    // 上述均不可用时回退到主数据文件 DATA_URL，再失败则回退为空数据集。
    async function loadData() {
      const mode = String(DEFAULT_DATA_MODE || '').trim();

      if (mode === 'init') {
        try {
          const json = await fetchJSON(INIT_DATA_URL);
          if (validDataset(json)) { DATA_FILE_URL = resolveUrl(location.href, INIT_DATA_URL); return normalizeLoaded(json); }
        } catch (e) { console.warn('[data] init 数据文件加载失败：', e); }
      } else if (mode && mode !== 'default') {
        const b = BATCHES_INDEX.batches.find(function (x) { return (x.batchId === mode || x.batchName === mode) && !x.deleted; });
        if (b && b.dataUrl) {
          const url = resolveUrl(indexBaseUrl(), b.dataUrl);
          try {
            const json = await fetchJSON(url);
            if (validDataset(json)) { BATCH_STATE.active = b; saveBatchActive(); DATA_FILE_URL = url; return normalizeLoaded(json); }
          } catch (e) { console.warn('[data] 批次数据加载失败：' + mode, e); }
        }
      }

      if (DEFAULT_DATA_URL) {
        try {
          const json = await fetchJSON(DEFAULT_DATA_URL);
          if (validDataset(json)) { DATA_FILE_URL = resolveUrl(location.href, DEFAULT_DATA_URL); return normalizeLoaded(json); }
        } catch (e) { console.warn('[data] 默认数据文件加载失败：', e); }
      }
      try {
        const json = await fetchJSON(DATA_URL);
        if (validDataset(json)) { DATA_FILE_URL = resolveUrl(location.href, DATA_URL); return normalizeLoaded(json); }
        throw new Error('数据格式无效');
      } catch (e) {
        console.warn('[data] 外部 JSON 加载失败：', e);
        DATA_FILE_URL = null;
        return { mode: 'single', items: [], reportEnv: DEFAULT_ENV };
      }
    }
    function isMultiMode() { return DATA_MODE === 'multi'; }
    // 多文件模式：按需加载单个 item 的完整数据文件。
    async function loadItemFile(tradeId) {
      const meta = DATA.items.find(function (i) { return i.tradeId === tradeId; });
      if (!meta || !meta.file) return null;
      // item 文件相对「当前清单文件」所在目录解析：根目录数据与批次目录数据均能正确加载。
      const base = DATA_FILE_URL || location.href;
      try {
        const full = await fetchJSON(resolveUrl(base, meta.file));
        if (full && typeof full === 'object') return full;
      } catch (e) { console.warn('[data] item 文件加载失败：' + tradeId, e); }
      return null;
    }
    async function ensureItemLoaded(tradeId) {
      if (!isMultiMode()) return;
      const idx = DATA.items.findIndex(function (i) { return i.tradeId === tradeId; });
      if (idx < 0) return;
      if (DATA.items[idx] && DATA.items[idx].__loaded) return;
      const full = await loadItemFile(tradeId);
      if (full) { full.__loaded = true; DATA.items[idx] = full; }
    }
    async function ensureAllLoaded() {
      if (!isMultiMode()) return;
      const stubs = DATA.items.filter(function (i) { return !i.__loaded; });
      const BATCH = 8;
      for (let i = 0; i < stubs.length; i += BATCH) {
        await Promise.all(stubs.slice(i, i + BATCH).map(function (stub) { return ensureItemLoaded(stub.tradeId); }));
      }
    }
    // 后台渐进加载所有 item 文件（不阻塞首屏渲染）。
    function preloadAllItems() { ensureAllLoaded(); }
    // 多文件模式下：确保 URL（或默认首个）item 已加载，否则 applyHash→rowPageFor→filteredFields 得到空列表，
    // fr 行选中定位与主列表渲染会静默失败。useHash=false 时固定加载首个 item。
    async function ensureHashItemLoaded(useHash) {
      if (!isMultiMode()) return;
      const want = useHash === false ? null : hashParams().item;
      const first = DATA.items[0] && DATA.items[0].tradeId;
      const id = (want && DATA.items.some(function (it) { return it.tradeId === want; })) ? want : first;
      if (id) await ensureItemLoaded(id);
    }
    // 字段比较表列注册表。label 为 i18n 键，可被 config.columns.labels 覆盖为字面量。
    // 数组顺序即「主列表显示顺序」与「列选择」弹层顺序：
    //   报告渠道 → 来源渠道 → 报告字段 → 用户标签 → 类型 → 命中Ctx
    //   → 表达式系列（CMP-L / CMP-R / CVT-L / CVT-R / VDT）
    //   → 期望值系列（EO-U / EO / AO-U / AO）→ 结果 → 说明
    // 「表达式 / 未转换值」预览列默认隐藏，用于数据快速预览。
    const COLUMNS = [
      { key: 'channel', label: 'colChannel', sortable: true,  filterable: 'select' },
      { key: 'source',  label: 'colSource',  sortable: true,  filterable: 'select' },
      { key: 'field',   label: 'colField',   sortable: true,  filterable: 'text' },
      { key: 'userTag', label: 'colUserTag', sortable: true,  filterable: 'select' },
      { key: 'type',    label: 'colType',    sortable: true,  filterable: 'select' },
      { key: 'ctxs',    label: 'colCtx',     sortable: true,  filterable: 'text' },
      { key: 'eoEl',    label: 'colEoEl',    sortable: false, filterable: 'text' },
      { key: 'aoEl',    label: 'colAoEl',    sortable: true,  filterable: 'text' },
      { key: 'eoCvtEl', label: 'colEoCvtEl', sortable: false, filterable: 'text' },
      { key: 'aoCvtEl', label: 'colAoCvtEl', sortable: false, filterable: 'text' },
      { key: 'vdtEl',   label: 'colVdtEl',   sortable: false, filterable: 'text' },
      { key: 'eoUnconverted', label: 'colEoUnconverted', sortable: false, filterable: 'text' },
      { key: 'eo',      label: 'colEO',      sortable: false, filterable: 'text' },
      { key: 'aoUnconverted', label: 'colAoUnconverted', sortable: false, filterable: 'text' },
      { key: 'ao',      label: 'colAO',      sortable: false, filterable: 'text' },
      { key: 'result',  label: 'colResult',  sortable: true,  filterable: 'select' },
      { key: 'remarks', label: 'colNote',    sortable: true,  filterable: 'text' },
    ];
    // 可见性默认值：键顺序与 COLUMNS 保持一致（state.columns / 「列选择」均按此顺序遍历）。
    const DEFAULT_COLUMNS = { channel: true, source: true, field: true, userTag: true, type: false, ctxs: false, eoEl: false, aoEl: false, eoCvtEl: false, aoCvtEl: false, vdtEl: false, eoUnconverted: false, eo: true, aoUnconverted: false, ao: true, result: true, remarks: false };
    // 列显示名 / 是否出现在「列选择」/ XPath-CSV 标签开关，均可由 config.columns 覆盖。
    let COL_LABELS = {};
    let COL_SELECTOR = {};
    let COL_TAG = false;
    // 用户标签「值 → 显示」：raw 时显示原值（普通文本），否则按 labels 映射显示标签样式。
    let USER_TAG_RAW = false;
    let USER_TAG_LABELS = {};
    // 解析多语配置值：字符串直接返回；对象按当前语言取值（回退 zh-CN，再回退首个值）。
    function locText(v) {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object') {
        if (v[LANG] != null) return String(v[LANG]);
        if (v['zh-CN'] != null) return String(v['zh-CN']);
        const k = Object.keys(v)[0];
        if (k) return String(v[k]);
      }
      return null;
    }
    function colLabel(c) {
      const s = locText(COL_LABELS[c.key]);
      return s != null ? s : t(c.label);
    }
    function isColSelectable(c) { return COL_SELECTOR[c.key] !== false; }

    let state = null;
    function initState() {
      state = {
        itemId: DATA.items.length ? DATA.items[0].tradeId : '',
        rowId: -1,
        tab: 'fields',
        channel: 'ALL',
        source: 'ALL',
        search: '',
        colFilter: { channel: 'ALL', source: 'ALL', field: '', userTag: 'ALL', eoEl: '', aoEl: '', eoCvtEl: '', aoCvtEl: '', vdtEl: '', type: 'ALL', ctxs: '', eoUnconverted: '', eo: '', aoUnconverted: '', ao: '', result: 'ALL', remarks: '' },
        sort: { key: '', dir: 1 },
        page: 1,
        pageSize: APP_LIMITS.pageSize,
        columns: Object.assign({}, DEFAULT_COLUMNS, PREF_COLUMNS),
        colWidths: {},
        itemSearch: '',
        itemFilter: 'ALL',
        itemPlatforms: [],
        itemProducts: [],
        itemTradeIds: [],
        reportCat: APP_REPORT_CAT_DEFAULT,
        sidebarPage: 1,
        sidebarPageSize: APP_LIMITS.sidebarPageSize,
        specialFilter: { eo: 'ALL', ao: 'ALL' },
        showFieldMsg: false,
        msgSort: { key: '', dir: 1 },
        msgFilter: {},
        msgPage: 1,
        msgPageSize: APP_LIMITS.msgPageSize,
        reportDateFilter: '',
        compare: { mode: 'channel', channelA: 'HKTR', channelB: 'JSFA', itemB: '', sort: { key: '', dir: 1 }, filter: { f: '', source: 'ALL', aResult: 'ALL', bResult: 'ALL', diff: 'ALL' }, page: 1, pageSize: 20 },
      };
    }
    let ACTIVE_FILTERS = [];
    let SIDEBAR_FILTERS = [];
    let POPOVER = { el: null, cleanup: null };
    let VAL_PANEL = null;
    let HASH_SYNC = { applying: false };
    let RESTORE_ROW = false;
    let SEARCH_TIMER = null;
    let ITEM_SEARCH_TIMER = null;

    /* ---------- 国际化与主题 ---------- */
    const I18N_URL = 'i18n.json';
    let I18N = { 'zh-CN': {} };
    async function loadI18n() {
      try {
        const res = await fetch(I18N_URL, { cache: 'no-store' });
        if (!res.ok) return;
        const d = await res.json();
        if (d && typeof d === 'object') I18N = d;
      } catch (e) {}
    }
    const LANGS = [['zh-CN', '简体中文'], ['zh-HK', '繁體中文（香港）'], ['en', 'English']];
    const THEMES = [
      ['light', 'themeLight'], ['dark', 'themeDark'], ['warm', 'themeWarm'], ['forest', 'themeForest'],
      ['midnight', 'themeMidnight'], ['ocean', 'themeOcean'], ['graphite', 'themeGraphite'], ['violet', 'themeViolet'],
      ['sunset', 'themeSunset'], ['neon', 'themeNeon'], ['aurora', 'themeAurora'],
    ];
    let LANG = 'zh-CN';
    let THEME = 'light';
    let SIDEBAR_WIDTH = 280;
    const PREF_STORAGE_KEY = 'reportValidationPrefs.v1';    // 基名（实际键见 storageKey）
    let PREF_COLUMNS = null;
    function loadPrefs() {
      try {
        const p = JSON.parse(localStorage.getItem(storageKey(PREF_STORAGE_KEY)) || '{}');
        if (p.lang && LANGS.some(function (l) { return l[0] === p.lang; })) LANG = p.lang;
        if (p.theme && THEMES.some(function (t) { return t[0] === p.theme; })) THEME = p.theme;
        if (typeof p.sidebarWidth === 'number') SIDEBAR_WIDTH = p.sidebarWidth;
        if (p.batchDockSide === 'left' || p.batchDockSide === 'right') BATCH_STATE.side = p.batchDockSide;
        if (typeof p.dockY === 'number') BATCH_STATE.dockY = p.dockY;
        if (typeof p.listH === 'number') BATCH_STATE.listH = p.listH;
        if (p.columns && typeof p.columns === 'object') {
          PREF_COLUMNS = {};
          Object.keys(p.columns).forEach(function (k) {
            if (Object.prototype.hasOwnProperty.call(DEFAULT_COLUMNS, k)) PREF_COLUMNS[k] = !!p.columns[k];
          });
        }
      } catch (e) {}
    }
    function savePrefs() {
      const cols = {};
      if (state && state.columns) {
        Object.keys(state.columns).forEach(function (k) {
          if (state.columns[k] !== DEFAULT_COLUMNS[k]) cols[k] = !!state.columns[k];
        });
      }
      try { localStorage.setItem(storageKey(PREF_STORAGE_KEY), JSON.stringify({ theme: THEME, lang: LANG, sidebarWidth: SIDEBAR_WIDTH, batchDockSide: BATCH_STATE.side, dockY: BATCH_STATE.dockY, listH: BATCH_STATE.listH, columns: cols })); } catch (e) {}
    }
    function applySidebarWidth() {
      document.documentElement.style.setProperty('--side-w', SIDEBAR_WIDTH + 'px');
    }
    function t(key) {
      if (I18N[LANG] && I18N[LANG][key] != null) return I18N[LANG][key];
      if (I18N['zh-CN'][key] != null) return I18N['zh-CN'][key];
      return key;
    }
    function channelDesc(name) {
      const map = { HKTR: 'channelDescHKTR', JSFA: 'channelDescJSFA', CFTC: 'channelDescCFTC' };
      return t(map[name] || name);
    }
    // 渠道下拉候选：以数据文件里实际出现的渠道为准（与 sourceNames 一致），避免写死导致新渠道无法筛选。
    function channelNames() {
      const names = [];
      (DATA.items || []).forEach(function (it) {
        (it.channels || []).forEach(function (ch) {
          if (ch && ch.name && names.indexOf(ch.name) === -1) names.push(ch.name);
        });
      });
      return names.length ? names : CHANNELS.map(function (c) { return c.name; });
    }
    function sourceNames() {
      const names = [];      DATA.items.forEach(function (it) {
        (it.channels || []).forEach(function (ch) {
          (ch.sources || []).forEach(function (s) {
            if (s.name && names.indexOf(s.name) === -1) names.push(s.name);
          });
        });
      });
      return names;
    }
    function currentSources() {
      const it = currentItem();
      if (!it) return [];
      const names = [];
      (it.channels || []).forEach(function (ch) {
        (ch.sources || []).forEach(function (s) {
          if (s.name && names.indexOf(s.name) === -1) names.push(s.name);
        });
      });
      return names;
    }
    function applyTheme(id) {
      THEME = id || 'light';
      THEMES.forEach(function (th) { document.body.classList.remove('theme-' + th[0]); });
      if (THEME !== 'light') document.body.classList.add('theme-' + THEME);
    }
    function currentEnv() {
      if (BATCH_STATE.active && typeof BATCH_STATE.active.reportEnv === 'string' && BATCH_STATE.active.reportEnv) return BATCH_STATE.active.reportEnv;
      // 空占位数据（0 个 item，如 init 数据集）时运行环境显示为空。
      if (DATA && Array.isArray(DATA.items) && !DATA.items.length) return '';
      if (DATA && typeof DATA.reportEnv === 'string' && DATA.reportEnv) return DATA.reportEnv;
      return DEFAULT_ENV;
    }
    function updateEnvBadge() {
      const el = document.getElementById('envBadge');
      if (!el) return;
      const env = currentEnv();
      // 未识别的环境不直接显示 DEFAULT_ENV（'UNKNOWN'），按语言显示「未知」。
      el.textContent = t('env') + (env === DEFAULT_ENV ? t('batchEnvUnknown') : env);
    }
    function applyStaticText() {
      document.getElementById('appTitle').textContent = t('appTitle');
      document.getElementById('appSub').textContent = t('appSub');
      updateEnvBadge();
      document.getElementById('search').placeholder = t('toolbarSearch');
      document.getElementById('itemSearch').placeholder = t('sidebarSearch');
      document.getElementById('reportDateFilter').placeholder = t('sidebarDate');
      const itemFilter = document.getElementById('itemFilter');
      itemFilter.options[0].text = t('sidebarStatusAll');
      itemFilter.options[1].text = t('sidebarStatusPassed');
      itemFilter.options[2].text = t('sidebarStatusFailed');
      itemFilter.options[3].text = t('sidebarStatusWarn');
      document.getElementById('platformFilterBtn').textContent = t('sidebarPlatform') + ' ▾';
      document.getElementById('productFilterBtn').textContent = t('sidebarProduct') + ' ▾';
      document.getElementById('tradeIdFilterBtn').textContent = t('sidebarTradeId') + ' ▾';
      document.querySelectorAll('.report-cat').forEach(function (b) {
        const k = b.getAttribute('data-cat');
        const key = k === 'charts' ? 'reportCatCharts' : (k === 'files' ? 'reportCatFiles' : 'reportCatNote');
        b.title = t(key);
        b.setAttribute('aria-label', t(key));
      });
      // 批次 dock 无障碍标签 / 顶部折叠按钮提示 / 页脚示例数据说明（原先写死在 HTML 里，不随语言切换）。
      const dockEl = document.getElementById('batchDock');
      if (dockEl) dockEl.setAttribute('aria-label', t('batchDockLabel'));
      const topCollapseEl = document.getElementById('topCollapse');
      if (topCollapseEl) topCollapseEl.title = document.body.classList.contains('top-collapsed') ? t('topExpandTitle') : t('topCollapseTitle');
      const sideCollapseEl = document.getElementById('sideCollapse');
      if (sideCollapseEl) { sideCollapseEl.title = t('sideCollapseTitle'); sideCollapseEl.setAttribute('aria-label', t('sideCollapseTitle')); }
      const sideExpandEl = document.getElementById('sideExpand');
      if (sideExpandEl) { sideExpandEl.title = t('sideExpandTitle'); sideExpandEl.setAttribute('aria-label', t('sideExpandTitle')); }
      const noteEl = document.getElementById('sampleDataNote');
      if (noteEl) noteEl.textContent = t('sampleDataNote');
      document.getElementById('sidebarTitle').textContent = t('sidebarTitle');
      document.getElementById('healthBtn').textContent = t('healthBtn');
      document.getElementById('globalSearchBtn').textContent = t('globalSearch');
      document.getElementById('helpBtn').title = t('helpTitle');
      document.getElementById('helpBtn').setAttribute('aria-label', t('helpTitle'));
      const clearPrefsBtn = document.getElementById('clearPrefsBtn');
      if (clearPrefsBtn) {
        clearPrefsBtn.title = t('clearPrefsBtn');
        clearPrefsBtn.setAttribute('aria-label', t('clearPrefsBtn'));
      }
      const homeBtn = document.getElementById('homeBtn');
      if (homeBtn) {
        homeBtn.title = t('homeBtn');
        homeBtn.setAttribute('aria-label', t('homeBtn'));
      }
      document.getElementById('themeSelect').title = t('themeLabel');
      document.getElementById('langSelect').title = t('langLabel');
      document.getElementById('search').setAttribute('aria-label', t('toolbarSearch'));
      document.getElementById('itemSearch').setAttribute('aria-label', t('sidebarSearch'));
      document.getElementById('reportDateFilter').setAttribute('aria-label', t('sidebarDate'));
      document.getElementById('healthBtn').setAttribute('aria-label', t('healthBtn'));
      document.getElementById('themeSelect').setAttribute('aria-label', t('themeLabel'));
      document.getElementById('langSelect').setAttribute('aria-label', t('langLabel'));
      document.getElementById('platformFilterBtn').setAttribute('aria-label', t('sidebarPlatform'));
      document.getElementById('productFilterBtn').setAttribute('aria-label', t('sidebarProduct'));
      document.getElementById('tradeIdFilterBtn').setAttribute('aria-label', t('sidebarTradeId'));
      document.getElementById('sidebar').setAttribute('aria-label', t('sidebarTitle'));
      const ts = document.getElementById('themeSelect');
      ts.options.length = 0;
      THEMES.forEach(function (th) { const o = document.createElement('option'); o.value = th[0]; o.textContent = t(th[1]); ts.appendChild(o); });
      ts.value = THEME;
      document.getElementById('langSelect').value = LANG;
    }
    function setLang(lang) { LANG = lang; applyStaticText(); render(); renderBatchDock(); renderBatchPanel(); renderBatchBadge(); renderForceBanner(); savePrefs(); }

    /* ---------- 忽略配置（服务端持久化，按租户隔离；localStorage 仅作镜像） ---------- */
    const IGNORE_STORAGE_KEY = 'reportValidationIgnoreConfig.v1';   // 基名（实际键见 storageKey）
    let IGNORE_CONFIG = {};
    async function loadIgnoreConfig() {
      try {
        const res = await fetch(IGNORE_CONFIG_URL, { cache: 'no-store' });
        if (res.ok) {
          const norm = normalizeIgnoreConfig(await res.json());
          if (norm) { IGNORE_CONFIG = norm; IGNORE_ACTIVE_URL = IGNORE_CONFIG_URL; IGNORE_ETAG = res.headers.get('etag') || ''; saveIgnoreConfigLocal(); return; }
        }
      } catch (e) {}
      IGNORE_ACTIVE_URL = IGNORE_CONFIG_URL;
      try { IGNORE_CONFIG = JSON.parse(localStorage.getItem(storageKey(IGNORE_STORAGE_KEY)) || '{}'); }
      catch (e) { IGNORE_CONFIG = {}; }
    }

    /* ---------- 最近批次：索引加载 / 渲染 / 切换 ---------- */
    function resolveUrl(base, rel) {
      if (!rel) return '';
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rel)) return rel;
      try { return new URL(rel, base).href; } catch (e) { return rel; }
    }
    function indexBaseUrl() {
      try { return new URL(BATCHES_INDEX_URL, location.href).href; } catch (e) { return location.href; }
    }
    let BATCH_HELP_URL = 'batch-help.json';
    let BATCH_HELP = null;
    async function loadBatchHelp() {
      try {
        const res = await fetch(BATCH_HELP_URL, { cache: 'no-store' });
        if (!res.ok) return;
        const d = await res.json();
        if (d && typeof d === 'object') BATCH_HELP = d;
      } catch (e) {}
    }
    function openBatchHelp() {
      const lang = BATCH_HELP && BATCH_HELP[LANG] ? BATCH_HELP[LANG] : (BATCH_HELP ? BATCH_HELP['zh-CN'] : null);
      let body = '';
      if (lang && Array.isArray(lang.sections)) {
        body = lang.sections.map(function (s) {
          let html = '<div class="hd-block"><h4>' + esc(s.h || '') + '</h4>';
          if (Array.isArray(s.p)) html += s.p.map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('');
          if (Array.isArray(s.items)) html += '<ul>' + s.items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
          if (s.code) html += '<pre>' + esc(s.code) + '</pre>';
          return html + '</div>';
        }).join('');
      } else {
        body = '<p>' + esc(t('batchHelp')) + '</p>';
      }
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML =
        '<div class="modal batch-help"><div class="modal-head"><h3>' + esc(lang && lang.title ? lang.title : t('batchHelp')) + '</h3><button class="modal-close" aria-label="' + t('closeLabel') + '">✕</button></div>' +
        '<div class="modal-body">' + body + '</div></div>';
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop || e.target.closest('.modal-close')) backdrop.remove();
      });
      document.body.appendChild(backdrop);
    }
    async function loadBatchesIndex() {
      BATCHES_INDEX = { batches: [] };
      BATCH_STATE.loaded = false;
      try {
        const idx = await fetchJSONCached(BATCHES_INDEX_URL);
        if (idx && Array.isArray(idx.batches)) BATCHES_INDEX = idx;
      } catch (e) {}
      prunePinnedBatch();
      BATCH_STATE.loaded = true;
    }
    function batchCompatible(b) {
      return SUPPORTED_FORMAT_VERSIONS.indexOf(Number(b && b.formatVersion)) !== -1;
    }
    function batchSortVal(b) { return String(b.executedAt || b.date || ''); }
    function isBatchPending(b) { return !!(b && BATCH_STATE.pendingDeletes[b.batchId]); }
    function isNewBatch(b) { return !!(b && NEW_BATCH_IDS[b.batchId]); }
    // 可用批次：未进入「待删除」状态、且未被软删除 -> 可加载 / 收藏 / 删除 / 钉住。
    function usableBatches() { return BATCHES_INDEX.batches.filter(function (b) { return !isBatchPending(b) && !b.deleted; }); }
    // 当前「批次范围」下的批次集合（不含客户端待删除批次）：
    //   'all'        全部批次（不含已软删除的批次）
    //   'compat'     仅看兼容
    //   'allDeleted' 全部批次(含已删除)：额外纳入 deleted 批次，仅可查看详情 / 排序 / 搜索
    function scopeBatches() {
      const list = BATCHES_INDEX.batches.filter(function (b) { return !isBatchPending(b); });
      return BATCH_STATE.batchScope === 'allDeleted' ? list : list.filter(function (b) { return !b.deleted; });
    }
    function scopeCompatOnly() { return BATCH_STATE.batchScope === 'compat'; }
    // 当前范围下的批次数量：「仅看兼容」只统计兼容批次（不含搜索 / 日期 / 环境 / 标签筛选）。
    function scopeCount() {
      const list = scopeBatches();
      return scopeCompatOnly() ? list.filter(batchCompatible).length : list.length;
    }
    function pendingBatches() { return BATCHES_INDEX.batches.filter(function (b) { return isBatchPending(b); }); }
    function batchQueryMatcher(q) {
      const s = String(q == null ? '' : q).trim();
      if (!s) return null;
      let regex = false, text = s;
      if (/^regex:/i.test(s)) { regex = true; text = s.slice(6).trim(); }
      if (!text) return null;
      if (regex) {
        try { const re = new RegExp(text, 'i'); return function (hay) { return re.test(String(hay == null ? '' : hay)); }; } catch (e) {}
      }
      const lower = text.toLowerCase();
      return function (hay) { return String(hay == null ? '' : hay).toLowerCase().indexOf(lower) !== -1; };
    }
    function visibleBatches() {
      const dRaw = BATCH_STATE.date.trim();
      const d = /^\d{4}-\d{2}-\d{2}$/.test(dRaw) ? dRaw : '';
      const nameM = batchQueryMatcher(BATCH_STATE.search);
      const cmdM = batchQueryMatcher(BATCH_STATE.cmd);
      const descM = batchQueryMatcher(BATCH_STATE.desc);
      const list = scopeBatches().filter(function (b) {
        if (scopeCompatOnly() && !batchCompatible(b)) return false;
        if (nameM && !nameM((b.batchName || '') + ' ' + (b.batchId || ''))) return false;
        if (cmdM && !cmdM(((b.commandLine || []).concat(b.argv || [])).join(' '))) return false;
        if (descM && !descM(b.description || '')) return false;
        if (d) {
          const bd = String(b.date || String(b.executedAt || '').slice(0, 10));
          if (bd !== d) return false;
        }
        if (BATCH_STATE.env && String(b.reportEnv || '') !== BATCH_STATE.env) return false;
        if (BATCH_STATE.tag && (Array.isArray(b.tags) ? b.tags : []).indexOf(BATCH_STATE.tag) === -1) return false;
        return true;
      });
      list.sort(function (a, b) { return BATCH_STATE.sortDir * batchSortVal(a).localeCompare(batchSortVal(b)); });
      return list;
    }
    function recentBatches() {
      return usableBatches().slice().filter(function (b) {
        return scopeCompatOnly() ? batchCompatible(b) : true;
      }).sort(function (a, b) {
        return batchSortVal(b).localeCompare(batchSortVal(a));
      }).slice(0, BATCH_STATE.recentCount);
    }
    function formatBatchTime(s) {
      const d = new Date(s);
      if (isNaN(d.getTime())) return s;
      const p = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    function batchSummaryText(b) {
      const s = b.summary || {};
      const parts = [];
      if (typeof s.items === 'number') parts.push(s.items + ' ' + t('batchItems'));
      return parts.join(' · ');
    }
    function batchScanTimeText() {
      const g = BATCHES_INDEX.generatedAt;
      if (!g) return '';
      const d = new Date(g);
      if (isNaN(d.getTime())) return '';
      const p = function (n) { return (n < 10 ? '0' : '') + n; };
      return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    function batchBadgesHTML(b, opts) {
      const o = opts || {};
      const compat = batchCompatible(b);
      const deleted = !!b.deleted;
      const pinned = isPinned(b);
      const tags = Array.isArray(b.tags) ? b.tags : [];
      // 兼容性样式与数据合并到第一个「版本号」标签（不再单独展示版本兼容/不兼容标签）。
      let out = '<span class="b-badge bv ' + (compat ? 'ok' : 'bad') + '" title="' + esc(compat ? t('batchCompat') : t('batchIncompat')) + '">v' + esc(String(b.formatVersion)) + '</span>';
      if (b.creationType === 'sample') out += '<span class="b-badge sample">Sample</span>';
      if (deleted) out += '<span class="b-badge del">🗑 ' + t('batchDeletedBadge') + '</span>';
      if (isNewBatch(b)) out += '<span class="b-badge new">' + t('batchNew') + '</span>';
      if (pinned) out += '<span class="b-badge pin" title="' + t('pinTitle') + '">📌 ' + t('pinLabel') + '</span>';
      if (b.reportEnv) out += '<span class="b-badge benv">' + esc(b.reportEnv) + '</span>';
      tags.forEach(function (tag) { out += '<span class="b-badge tag" title="' + esc(tag) + '">' + esc(tag) + '</span>'; });
      // item 数量标签仅在列表卡片中展示（详情视图与之保持一致，但不含该标签）。
      if (o.withItems) {
        const sum = batchSummaryText(b);
        if (sum) out += '<span class="b-badge bsum">' + esc(sum) + '</span>';
      }
      return out;
    }
    function batchItemHTML(b) {
      const compat = batchCompatible(b);
      const deleted = !!b.deleted;
      const active = BATCH_STATE.active && BATCH_STATE.active.batchId === b.batchId;
      const pending = isBatchPending(b);
      const title = deleted ? t('batchDeletedHint') : (BATCH_STATE.detailMode === 'quick' ? t('batchQuickHint') : '');
      const desc = (typeof b.description === 'string' && b.description.trim()) ? b.description.trim() : '';
      const descLine = desc.split('\n')[0].trim();
      const descHTML = descLine ? '<div class="bi-desc" title="' + esc(desc) + '">' + esc(descLine) + '</div>' : '';
      let infoBtn = '';
      if (BATCH_STATE.detailMode === 'modal' && !pending) {
        infoBtn = '<button class="bi-info" data-binfor="' + esc(b.batchId) + '" title="' + t('batchInfo') + '" aria-label="' + t('batchInfo') + '">ℹ</button>';
      }
      const pinned = isPinned(b);
      // 已删除批次：不渲染任何修改操作（收藏 / 删除 / 钉住），也不参与待删除流程。
      const actions = deleted
        ? ''
        : pending
        ? '<div class="bi-actions"><button class="bi-act undo" data-batch-undo="' + esc(b.batchId) + '">' + t('batchDeleteUndo') + '</button>' +
          '<button class="bi-act confirm" data-batch-confirm="' + esc(b.batchId) + '">' + t('batchDeleteConfirm') + '</button></div>'
        : '<span class="bi-actions2">' +
          (active ? '<button class="bi-pin' + (pinned ? ' on' : '') + '" data-batch-pin="' + esc(b.batchId) + '" title="' + (pinned ? t('pinUnpinTitle') : t('pinTitle')) + '" aria-label="' + (pinned ? t('pinUnpinTitle') : t('pinTitle')) + '">' + (pinned ? '📌' : '📍') + '</button>' : '') +
          (compat ? '<button class="bi-edit" data-batch-edit="' + esc(b.batchId) + '" title="' + t('batchEdit') + '" aria-label="' + t('batchEdit') + '">✎</button>' : '') +
          '<button class="bi-fav' + (isBatchFavorited(b) ? ' on' : '') + '" data-batch-fav="' + esc(b.batchId) + '" title="' + t('favAdd') + '" aria-label="' + t('favAdd') + '">' + (isBatchFavorited(b) ? '★' : '☆') + '</button>' +
          ((isBatchFavorited(b) || pinned) ? '' : '<button class="bi-del" data-batch-del="' + esc(b.batchId) + '" title="' + t('batchDelete') + '" aria-label="' + t('batchDelete') + '">✕</button>') +
          '</span>';
      const dataAttr = pending ? 'data-batch-pending="' + esc(b.batchId) + '"' : 'data-batch="' + esc(b.batchId) + '"';
      return '<div class="batch-item' + (deleted ? ' deleted' : '') + (active ? ' active' : '') + (compat ? '' : ' incompat') + (pending ? ' deleting' : '') + '" ' + dataAttr + (pending ? '' : ' role="button" tabindex="0"') + (title && !pending ? ' title="' + title + '"' : '') + '>' +
        '<div class="bi-top"><span class="bi-name">' + esc(b.batchName || b.batchId) + '</span>' + infoBtn + actions + '</div>' +
        '<div class="bi-time">' + esc(formatBatchTime(b.executedAt)) + '</div>' +
        descHTML +
        '<div class="bi-badges">' + batchBadgesHTML(b, { withItems: true }) + '</div></div>';
    }
    function batchPagerHTML(p, pages) {
      const from = Math.max(1, p - 1), to = Math.min(pages, p + 1);
      let parts = [];
      if (pages > 3) parts.push('<button class="pg" data-bpage="1"' + (p === 1 ? ' disabled' : '') + '>«</button>');
      parts.push('<button class="pg" data-bpage="' + (p - 1) + '"' + (p === 1 ? ' disabled' : '') + '>‹</button>');
      for (let i = from; i <= to; i++) parts.push('<button class="pg' + (i === p ? ' cur' : '') + '" data-bpage="' + i + '">' + i + '</button>');
      parts.push('<button class="pg" data-bpage="' + (p + 1) + '"' + (p === pages ? ' disabled' : '') + '>›</button>');
      if (pages > 3) parts.push('<button class="pg" data-bpage="' + pages + '"' + (p === pages ? ' disabled' : '') + '>»</button>');
      return parts.join('') + '<span class="pg-info">' + p + '/' + pages + '</span>';
    }
    /* ---------- 清除本地缓存（按租户作用域） ----------
     * 作用域键清单与判定均为纯函数（便于 Node 单测）：
     *   - localStorage：5 个基名（偏好 / 上次批次 / 置顶 / 忽略镜像 / 收藏镜像）+ 作用域后缀；
     *   - IndexedDB：租户模式只清 `tenant:<id>:` 前缀，非租户模式只清非租户项（不会误删其它租户缓存）。
     * 只删当前作用域内的项，不使用 storage.clear()，不动同源下其它租户或其它应用的数据。
     */
    function localCacheKeys(tenantId) {
      const bases = [PREF_STORAGE_KEY, BATCH_STORAGE_KEY, PIN_STORAGE_KEY, IGNORE_STORAGE_KEY, FAV_STORAGE_KEY];
      return bases.map(function (b) { return tenantId ? b + '@' + tenantId : b; });
    }
    function clearLocalCacheStorage(storage, tenantId) {
      const removed = [];
      localCacheKeys(tenantId).forEach(function (k) {
        try {
          if (storage.getItem(k) !== null) { storage.removeItem(k); removed.push(k); }
        } catch (e) { /* 隐私模式下 storage 可能抛错：忽略单键失败 */ }
      });
      return removed;
    }
    // IDB 缓存 key：租户模式为 `tenant:<id>:<url>`，非租户为原 URL。
    function idbKeyInScope(key, tenantId) {
      const k = String(key == null ? '' : key);
      if (!tenantId) return k.indexOf('tenant:') !== 0;
      return k.indexOf('tenant:' + tenantId + ':') === 0;
    }
    // 按作用域逐条删除 IndexedDB 缓存（游标判定，不删库 → 不影响其它租户）。
    function clearLocalCacheIdb(tenantId) {
      return openIdb().then(function (db) {
        if (!db) return 0;
        return new Promise(function (resolve) {
          let n = 0;
          const done = function () { resolve(n); };
          try {
            const tx = db.transaction('files', 'readwrite');
            const req = tx.objectStore('files').openCursor();
            req.onsuccess = function () {
              const cur = req.result;
              if (!cur) return;
              if (idbKeyInScope(cur.key, tenantId)) { cur.delete(); n++; }
              cur.continue();
            };
            req.onerror = done;
            tx.oncomplete = done;
            tx.onerror = done;
            tx.onabort = done;
          } catch (e) { done(); }
        });
      });
    }
    // 站点根地址（不含查询参数与深链接）：顶栏「主页」与启动失败提示共用。
    function webRootUrl() {
      try {
        if (location.origin && location.origin !== 'null') return location.origin + location.pathname;
      } catch (e) {}
      return location.pathname || '/';
    }
    // 轻量操作反馈：显示在视口顶部，自动消失（重载后随之消失，不做持久化）。
    let TOAST_TIMER = null;
    function showToast(msg) {
      let el = document.getElementById('appToast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'appToast';
        el.className = 'app-toast';
        el.setAttribute('role', 'status');
        (document.body || document.documentElement).appendChild(el);
      }
      el.textContent = msg;
      if (TOAST_TIMER) clearTimeout(TOAST_TIMER);
      TOAST_TIMER = setTimeout(function () { if (el.parentNode) el.remove(); }, 2600);
    }
    // 清除当前作用域的本地「偏好记忆」（localStorage 5 项 + IndexedDB 数据缓存）：
    // 无需二次确认，直接执行；给出完成反馈后重载（内存态无法就地复原）。
    function clearLocalCacheNow() {
      const removed = clearLocalCacheStorage(window.localStorage, TENANT_ID);
      showToast((TENANT_ID ? t('clearPrefsDone') : t('clearPrefsDoneDefault')).replace('{id}', TENANT_ID || ''));
      try {
        console.info('[cache] 已清除本地偏好记忆（作用域：' + (TENANT_ID ? 'tenant:' + TENANT_ID : 'default') + '）：localStorage ' + removed.length + ' 项');
      } catch (e) {}
      clearLocalCacheIdb(TENANT_ID).then(function (n) {
        try { console.info('[cache] IndexedDB 数据缓存已清除 ' + n + ' 项'); } catch (e) {}
        setTimeout(function () { location.reload(); }, 900);
      });
    }

    function renderBatchDock() {
      const dock = document.getElementById('batchDock');
      if (!dock) return;
      const rec = recentBatches();
      let chips = '';
      rec.forEach(function (b) {
        const active = BATCH_STATE.active && BATCH_STATE.active.batchId === b.batchId;
        const day = String(b.date || '').slice(-2);
        chips += '<button class="bd-chip' + (active ? ' active' : '') + (batchCompatible(b) ? '' : ' incompat') + (isBatchFavorited(b) ? ' fav' : '') + (isPinned(b) ? ' pinned' : '') + '" data-batch="' + esc(b.batchId) + '" aria-label="' + esc(b.batchName + ' · ' + formatBatchTime(b.executedAt)) + '">' + esc(day || '?') + (isNewBatch(b) ? '<span class="bd-new-dot" title="' + t('batchNew') + '"></span>' : '') + '</button>';
      });
      if (!chips && usableBatches().length) chips = '<span class="bd-empty" title="' + t('batchNoCompat') + '">' + t('batchNoCompat') + '</span>';
      dock.innerHTML =
        '<div class="bd-grip" id="batchGrip" title="' + t('batchDragHint') + '" aria-label="' + t('batchDragHint') + '">⋮⋮</div>' +
        '<button class="bd-btn' + (BATCH_STATE.expanded ? ' on' : '') + '" id="batchToggle" title="' + t('batchToggle') + '" aria-label="' + t('batchToggle') + '">☰</button>' +
        '<div class="bd-sep"></div>' +
        '<div class="bd-recent">' + chips + '</div>' +
        '<div class="bd-sep"></div>' +
        '<button class="bd-btn" id="batchRefreshDock" title="' + t('batchRefresh') + '" aria-label="' + t('batchRefresh') + '">' + (BATCH_STATE.scanning ? '<span class="spin">⟳</span>' : '⟳') + '</button>' +
        '<button class="bd-btn' + (BATCH_STATE.favoritesOpen ? ' on' : '') + '" id="favToggle" title="' + t('favoritesTitle') + '" aria-label="' + t('favoritesTitle') + '">★</button>' +
        (APP_FEATURES.batchHelp ? '<button class="bd-btn" id="batchHelpBtn" title="' + t('batchHelp') + '" aria-label="' + t('batchHelp') + '">?</button>' : '');
    }
    function renderBatchPanel() {
      const panel = document.getElementById('batchPanel');
      if (!panel) return;
      const envs = [];
      scopeBatches().forEach(function (b) {
        const e = String(b.reportEnv || '').trim();
        if (e && envs.indexOf(e) === -1) envs.push(e);
      });
      const envOpts = '<option value="">' + t('batchEnvAll') + '</option>' +
        envs.map(function (e) { return '<option value="' + esc(e) + '"' + (BATCH_STATE.env === e ? ' selected' : '') + '>' + esc(e) + '</option>'; }).join('');
      // 标签选项：从当前范围的批次元数据 tags 去重收集（按标签筛选）。
      const tagSet = [];
      scopeBatches().forEach(function (b) {
        (Array.isArray(b.tags) ? b.tags : []).forEach(function (tag) { if (tagSet.indexOf(tag) === -1) tagSet.push(tag); });
      });
      tagSet.sort(function (a, b) { return a.localeCompare(b); });
      const tagOpts = '<option value="">' + t('batchTagAll') + '</option>' +
        tagSet.map(function (g) { return '<option value="' + esc(g) + '"' + (BATCH_STATE.tag === g ? ' selected' : '') + '>' + esc(g) + '</option>'; }).join('');
      panel.innerHTML =
        '<div class="bp-head"><span class="bp-title">' + t('batchTitle') + '</span>' +
        '<span class="bp-count"' + (BATCHES_INDEX.generatedAt ? ' title="' + esc(t('batchScannedAt') + ' ' + batchScanTimeText()) + '"' : '') + '>' + scopeCount() + '</span>' +
        (function () {
          const scope = BATCH_STATE.batchScope;
          const label = scope === 'compat' ? t('batchCompatOnly') : (scope === 'allDeleted' ? t('batchAllDeleted') : t('batchAll'));
          const icon = scope === 'compat' ? '✓' : (scope === 'allDeleted' ? '🗑' : '≡');
          return '<button class="bp-compat' + (scope === 'all' ? '' : ' on') + (scope === 'allDeleted' ? ' del' : '') + '" id="batchCompatFilter" title="' + esc(label) + '" aria-label="' + esc(label) + '"><span class="bp-ico' + (scope === 'all' ? '' : ' sm') + '">' + icon + '</span></button>';
        })() +
        '<button class="bp-collapse" id="batchSideFlip" title="' + t('batchSideFlip') + '" aria-label="' + t('batchSideFlip') + '">⇄</button>' +
        '<button class="bp-collapse" id="batchClose" title="' + t('batchClose') + '" aria-label="' + t('batchClose') + '">' + (BATCH_STATE.side === 'right' ? '⟩' : '⟨') + '</button></div>' +
        '<div class="bp-controls">' +
        '<div class="bp-toggle-row">' +
        '<button class="bp-search-toggle" id="batchSearchToggle" title="' + t('batchSearchLabel') + '">' + t('batchSearchLabel') + ' ' + (BATCH_STATE.searchCollapsed ? '▸' : '▾') + '</button>' +
        '<button class="bp-search-toggle" id="batchFiltersToggle" title="' + t('batchFiltersLabel') + '">' + t('batchFiltersLabel') + ' ' + (BATCH_STATE.filtersCollapsed ? '▸' : '▾') + '</button>' +
        '<span class="bp-toggle-spacer"></span>' +
        '<button class="bp-cal" id="batchSort" title="' + t('batchSortLabel') + '：' + (BATCH_STATE.sortDir === 1 ? t('batchSortAsc') : t('batchSortDesc')) + '" aria-label="' + t('batchSortLabel') + '">' + (BATCH_STATE.sortDir === 1 ? '↑' : '↓') + '</button>' +
        '<button class="bp-cal" id="batchRefresh" title="' + t('batchRefresh') + '" aria-label="' + t('batchRefresh') + '">' + (BATCH_STATE.scanning ? '<span class="spin">⟳</span>' : '⟳') + '</button>' +
        '</div>' +
        (BATCH_STATE.searchCollapsed ? '' :
          '<div class="bp-search"><input type="search" id="batchSearch" placeholder="' + t('batchSearch') + '" value="' + esc(BATCH_STATE.search) + '"><button class="bp-clear" id="batchSearchClear" title="' + t('batchNone') + '">✕</button></div>' +
          '<div class="bp-search"><input type="search" id="batchCmd" placeholder="' + t('batchCmdSearch') + '" value="' + esc(BATCH_STATE.cmd) + '"><button class="bp-clear" id="batchCmdClear" title="' + t('batchNone') + '">✕</button></div>' +
          '<div class="bp-search"><input type="search" id="batchDesc" placeholder="' + t('batchDescSearch') + '" value="' + esc(BATCH_STATE.desc) + '"><button class="bp-clear" id="batchDescClear" title="' + t('batchNone') + '">✕</button></div>') +
        (BATCH_STATE.filtersCollapsed ? '' :
          '<div class="bp-row">' +
          '<input type="text" id="batchDate" placeholder="' + t('batchDate') + '" value="' + esc(BATCH_STATE.date) + '" maxlength="10" inputmode="numeric">' +
          '<button class="bp-cal" id="batchDateCal" title="' + t('batchDate') + '" aria-label="' + t('batchDate') + '">📅</button>' +
          '<button class="bp-clear" id="batchDateClear" title="' + t('batchDateClearLabel') + '">✕</button>' +
          '</div>' +
          '<div class="bp-date-hint"></div>' +
          '<div class="bp-row"><select id="batchEnv" title="' + t('batchEnv') + '">' + envOpts + '</select></div>' +
          '<div class="bp-row"><select id="batchTag" title="' + t('batchTagFilter') + '">' + tagOpts + '</select></div>') +
        '</div>' +
        '<div class="bp-notice" id="batchNotice"' + (BATCH_STATE.notice ? '' : ' hidden') + '>' +
        '<span class="bp-notice-text">' + esc(BATCH_STATE.notice || '') + '</span>' +
        '<button class="bp-notice-close" id="batchNoticeClose" title="' + t('closeLabel') + '" aria-label="' + t('closeLabel') + '">✕</button>' +
        '</div>' +
        // 激活筛选标签：位于批次列表上方的独立区域（在拖动标记之上，不随列表高度拖拽变化）。
        '<div class="bp-chips" id="batchChips"></div>' +
        '<div class="chip-count" id="batchMatchCount"></div>' +
        '<div class="bp-resize top" id="batchResizeTop" title="' + t('batchResizeHint') + '" aria-label="' + t('batchResizeHint') + '">⠿</div>' +
        '<div class="bp-pending-bar" id="batchPendingBar" hidden></div>' +
        '<div class="bp-list" id="batchList"></div>' +
        '<div class="bp-pager" id="batchPager"></div>' +
        '<div class="bp-resize" id="batchResize" title="' + t('batchResizeHint') + '" aria-label="' + t('batchResizeHint') + '">⠿</div>';
      renderBatchList();
      renderBatchPendingBar();
      positionBatchPanel();
      updateBatchDateHint();
    }
    // 批次日期提示：仅在未指定具体日期时展示「N 个批次日期（有数据）」（与侧栏报告日期提示一致）。
    function updateBatchDateHint() {
      const el = document.querySelector('#batchPanel .bp-date-hint');
      if (!el) return;
      if (BATCH_STATE.date.trim()) { el.textContent = ''; return; }
      const dates = {};
      scopeBatches().forEach(function (b) { dates[String(b.date || '')] = true; });
      el.textContent = Object.keys(dates).length + ' ' + t('batchDateHint');
    }
    function renderBatchPendingBar() {
      const el = document.getElementById('batchPendingBar');
      if (!el) return;
      const pending = pendingBatches();
      if (!pending.length) { el.hidden = true; el.innerHTML = ''; return; }
      el.hidden = false;
      el.innerHTML = '<div class="bp-pending-head">' + t('batchPendingDelete') + ' · ' + pending.length + '</div>' +
        pending.map(function (b) { return batchItemHTML(b); }).join('');
    }
    function markBatchPending(id) {
      const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === id; });
      if (b && b.deleted) return;
      if (b && isBatchFavorited(b)) { setBatchNotice(t('favDeleteBlocked')); return; }
      if (b && isPinned(b)) { setBatchNotice(t('pinDeleteBlocked')); return; }
      BATCH_STATE.pendingDeletes[id] = true;
      renderBatchPanel(); renderBatchDock();
    }
    function unmarkBatchPending(id) {
      delete BATCH_STATE.pendingDeletes[id];
      renderBatchPanel(); renderBatchDock();
    }
    async function confirmBatchDelete(id) {
      try {
        const res = await fetch('/api/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchId: id, deleted: true }) });
        const j = await res.json().catch(function () { return null; });
        if (!res.ok || !j || j.ok !== true) throw new Error(j && j.error ? j.error : ('HTTP ' + res.status));
      } catch (e) {
        setBatchNotice(t('batchDeleteError') + ' ' + (e && e.message ? e.message : e));
        return;
      }
      delete BATCH_STATE.pendingDeletes[id];
      // 软删除：批次仍保留在索引中（带 deleted 标记），默认范围不再展示，
      // 「全部批次(含已删除)」范围仍可见（仅查看，不可加载/修改）。
      BATCHES_INDEX.batches.forEach(function (b) { if (b.batchId === id) b.deleted = true; });
      if (PINNED_BATCH_ID === id) { PINNED_BATCH_ID = null; savePinnedId(); }
      if (BATCH_STATE.active && BATCH_STATE.active.batchId === id) { BATCH_STATE.active = null; saveBatchActive(); }
      setBatchNotice('');
      renderBatchPanel(); renderBatchDock(); renderBatchBadge(); renderForceBanner();
    }

    /* ---------- 收藏夹（按包名 aa.bb.cc 分层折叠） ---------- */
    const FAV_STORAGE_KEY = 'reportValidationFavorites.v1';   // 基名（实际键见 storageKey）
    let FAVORITES = {};
    let FAV_COLLAPSED = {};
    let FAV_SEARCH = '';
    // 加载时的 ETag：回写时作为 If-Match 发回（乐观并发，避免多会话互相覆盖）。
    let FAV_ETAG = '';
    async function loadFavorites() {
      // 优先读取服务端共享收藏（多用户一致）；失败则回退 localStorage。
      try {
        const res = await fetch('/api/favorites', { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          if (j && j.ok === true && j.favorites && typeof j.favorites === 'object' && !Array.isArray(j.favorites)) {
            FAVORITES = j.favorites;
            FAV_ETAG = j.etag || '';
            try { localStorage.setItem(storageKey(FAV_STORAGE_KEY), JSON.stringify(FAVORITES)); } catch (e) {}
            return;
          }
        }
      } catch (e) {}
      try { FAVORITES = JSON.parse(localStorage.getItem(storageKey(FAV_STORAGE_KEY)) || '{}'); } catch (e) { FAVORITES = {}; }
      if (!FAVORITES || typeof FAVORITES !== 'object' || Array.isArray(FAVORITES)) FAVORITES = {};
    }
    function saveFavorites() {
      try { localStorage.setItem(storageKey(FAV_STORAGE_KEY), JSON.stringify(FAVORITES)); } catch (e) {}
      const body = { favorites: FAVORITES };
      if (FAV_ETAG) body.ifMatch = FAV_ETAG;
      fetch('/api/favorites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) {
          if (r.status === 409) {
            console.warn('[favorites] 保存冲突（409）：已重新加载服务端收藏夹');
            setBatchNotice(t('saveConflict'));
            loadFavorites().then(function () { refreshFavoriteViews(); });
            return null;
          }
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json().catch(function () { return null; });
        })
        .then(function (j) { if (j && j.etag) FAV_ETAG = j.etag; })
        .catch(function (e) { console.warn('[favorites] 保存失败：', e); });
    }
    function favPkgList() { return Object.keys(FAVORITES).sort(); }
    function isValidPkg(pkg) { return /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(String(pkg || '').trim()); }
    // 收藏标记回写批次元数据（服务端持久化，扫描后仍在索引中体现）。
    function setBatchFavoriteFlag(batchId, flag) {
      const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === batchId; });
      if (b) b.favorite = flag;
      fetch('/api/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchId: batchId, favorite: flag }) }).catch(function () {});
    }
    // 收藏状态：元数据 favorite 为冗余缓存（索引可能滞后），收藏夹树为权威来源，任一命中即为已收藏。
    function isBatchFavorited(b) { return !!(b && (b.favorite || favoriteCountFor(b.batchId) > 0)); }
    // 该批次存在哪些收藏包（一个批次可被收藏到多个包）。
    function favPkgsFor(batchId) {
      return Object.keys(FAVORITES).filter(function (pkg) {
        return (FAVORITES[pkg] || []).some(function (f) { return f.batchId === batchId; });
      });
    }
    function favoriteCountFor(batchId) { return favPkgsFor(batchId).length; }
    // 收藏项自带 batchName 快照：批次改名后同步更新（否则收藏夹仍显示旧名）。
    function syncFavoriteBatchName(batchId, name) {
      let changed = false;
      Object.keys(FAVORITES).forEach(function (pkg) {
        (FAVORITES[pkg] || []).forEach(function (f) {
          if (f.batchId === batchId && f.batchName !== name) { f.batchName = name; changed = true; }
        });
      });
      return changed;
    }
    // 收藏状态变化后统一刷新受影响视图：收藏夹面板 + 批次列表 + dock 小图标 +「当前批次」徽章。
    // 尤其是当前批次被收藏/取消收藏时，徽章上的 ★ 标记必须同步（否则会遗留旧标记）。
    function refreshFavoriteViews() {
      renderFavoritesPanel();
      renderBatchPanel();
      renderBatchDock();
      renderBatchBadge();
    }
    // 从所有收藏包中移除该批次（收藏按钮取消收藏 / 收藏项 ✕ 共用）。
    function removeBatchFromFavorites(batchId) {
      let changed = false;
      Object.keys(FAVORITES).forEach(function (pkg) {
        const before = FAVORITES[pkg] || [];
        const after = before.filter(function (f) { return f.batchId !== batchId; });
        if (after.length !== before.length) {
          changed = true;
          if (after.length) FAVORITES[pkg] = after;
          else delete FAVORITES[pkg];
        }
      });
      if (changed) saveFavorites();
      setBatchFavoriteFlag(batchId, false);
      hideBatchQuickDetail();
      refreshFavoriteViews();
      return changed;
    }
    // 取消收藏二次确认（已收藏批次再次点击收藏按钮）。
    function openRemoveFavoriteDialog(batchId) {
      const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === batchId; });
      const pkgs = favPkgsFor(batchId);
      if (!b) return;
      if (!pkgs.length) { removeBatchFromFavorites(batchId); return; }
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML =
        '<div class="modal" style="max-width:420px"><div class="modal-head"><h3>' + t('favRemoveTitle') + '</h3><button class="modal-close" aria-label="' + t('closeLabel') + '">✕</button></div>' +
        '<div class="modal-body">' +
        '<div class="fav-add-batch">' + esc(b.batchName || b.batchId) + '</div>' +
        '<div class="fav-add-hint">' + t('favRemoveBody') + '</div>' +
        '<div class="fav-remove-pkgs">' + esc(pkgs.join('、')) + '</div>' +
        '<div class="fav-add-actions"><button class="tool-btn danger" data-fav-unfav="1">' + t('favRemoveConfirm') + '</button><button class="tool-btn" data-fav-uncancel="1">' + t('cancel') + '</button></div>' +
        '</div></div>';
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop || e.target.closest('.modal-close') || e.target.closest('[data-fav-uncancel]')) { backdrop.remove(); return; }
        if (e.target.closest('[data-fav-unfav]')) {
          backdrop.remove();
          removeBatchFromFavorites(batchId);
        }
      });
      document.body.appendChild(backdrop);
    }
    // 收藏按钮：未收藏 -> 选择包名加入收藏；已收藏 -> 二次确认后取消收藏。
    function toggleBatchFavorite(batchId) {
      const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === batchId; });
      if (!b) return;
      if (isBatchFavorited(b)) openRemoveFavoriteDialog(batchId);
      else openAddFavoriteDialog(batchId);
    }
    function addFavorite(batchId, pkg) {
      pkg = String(pkg || '').trim();
      if (!isValidPkg(pkg)) return { ok: false, error: t('favInvalidPkg') };
      const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === batchId; });
      if (!b) return { ok: false, error: t('favBatchMissing') };
      if (b.deleted) return { ok: false, error: t('batchDeletedBlocked') };
      if (isBatchPending(b)) return { ok: false, error: t('favPendingBlocked') };
      if (!FAVORITES[pkg]) FAVORITES[pkg] = [];
      if (!FAVORITES[pkg].some(function (f) { return f.batchId === batchId; })) {
        FAVORITES[pkg].push({ batchId: batchId, batchName: b.batchName || b.batchId, date: b.date || '', executedAt: b.executedAt || '', savedAt: new Date().toISOString() });
        saveFavorites();
      }
      setBatchFavoriteFlag(batchId, true);
      refreshFavoriteViews();
      return { ok: true };
    }
    function removeFavorite(pkg, batchId) {
      if (!FAVORITES[pkg]) return;
      FAVORITES[pkg] = FAVORITES[pkg].filter(function (f) { return f.batchId !== batchId; });
      if (!FAVORITES[pkg].length) delete FAVORITES[pkg];
      saveFavorites();
      if (favoriteCountFor(batchId) === 0) setBatchFavoriteFlag(batchId, false);
      refreshFavoriteViews();
    }
    function favoriteBatchExists(batchId) {
      return BATCHES_INDEX.batches.some(function (b) { return b.batchId === batchId && !b.deleted; });
    }
    function favItemsHTML(items, pkg) {
      return (items || []).map(function (f) {
        const missing = !favoriteBatchExists(f.batchId);
        const savedHint = t('favSavedAt') + ' ' + formatBatchTime(f.savedAt);
        return '<div class="fav-item' + (missing ? ' missing' : '') + '">' +
          '<button class="fav-load" data-fav-load="' + esc(f.batchId) + '" title="' + esc(savedHint + ' · ' + t('favClickHint')) + '">' + esc(f.batchName) + '</button>' +
          (missing ? '<span class="fav-missing-badge" title="' + t('favMissing') + '">' + t('favMissing') + '</span>' : '') +
          '<button class="fav-remove" data-fav-remove="' + esc(f.batchId) + '" data-fav-pkg="' + esc(pkg) + '" title="' + t('favRemove') + '">✕</button>' +
          '</div>';
      }).join('');
    }
    function favTreeHTML() {
      const root = { children: {} };
      favPkgList().forEach(function (pkg) {
        const segs = pkg.split('.');
        let node = root;
        segs.forEach(function (seg) {
          if (!node.children[seg]) node.children[seg] = { name: seg, children: {} };
          node = node.children[seg];
        });
        node.pkg = pkg;
      });
      function walk(node, depth, path) {
        let out = '';
        Object.keys(node.children || {}).sort().forEach(function (seg) {
          const child = node.children[seg];
          const full = path ? path + '.' + seg : seg;
          const collapsed = !!FAV_COLLAPSED[full];
          const hasKids = Object.keys(child.children || {}).length > 0;
          const items = child.pkg ? (FAVORITES[child.pkg] || []) : [];
          const chev = (hasKids || items.length) ? (collapsed ? '▸' : '▾') : '·';
          out += '<div class="fav-node">' +
            '<button class="fav-toggle" data-fav-pkg="' + esc(full) + '" style="padding-left:' + (10 + depth * 14) + 'px">' + chev + ' ' + esc(seg) + (items.length ? ' <span class="fav-count">' + items.length + '</span>' : '') + '</button>';
          if (!collapsed && child.pkg && items.length) out += '<div class="fav-items">' + favItemsHTML(items, child.pkg) + '</div>';
          if (!collapsed) out += walk(child, depth + 1, full);
          out += '</div>';
        });
        return out;
      }
      return walk(root, 0, '');
    }
    // 收藏搜索：按「包名 + 批次名」简易匹配，返回扁平结果列表。
    function favSearchResultsHTML(q) {
      const lower = String(q || '').trim().toLowerCase();
      const out = [];
      favPkgList().forEach(function (pkg) {
        const pkgMatch = pkg.toLowerCase().indexOf(lower) !== -1;
        (FAVORITES[pkg] || []).forEach(function (f) {
          const nameMatch = String(f.batchName || '').toLowerCase().indexOf(lower) !== -1;
          if (pkgMatch || nameMatch) {
            const missing = !favoriteBatchExists(f.batchId);
            out.push('<div class="fav-item' + (missing ? ' missing' : '') + '">' +
              '<span class="fav-pkg-tag" title="' + esc(pkg) + '">' + esc(pkg) + '</span>' +
              '<button class="fav-load" data-fav-load="' + esc(f.batchId) + '" title="' + esc(t('favSavedAt') + ' ' + formatBatchTime(f.savedAt) + ' · ' + t('favClickHint')) + '">' + esc(f.batchName) + '</button>' +
              (missing ? '<span class="fav-missing-badge" title="' + t('favMissing') + '">' + t('favMissing') + '</span>' : '') +
              '<button class="fav-remove" data-fav-remove="' + esc(f.batchId) + '" data-fav-pkg="' + esc(pkg) + '" title="' + t('favRemove') + '">✕</button>' +
              '</div>');
          }
        });
      });
      return out.length ? out.join('') : '<div class="empty">' + t('favEmpty') + '</div>';
    }
    function renderFavoritesPanel() {
      const panel = document.getElementById('favoritesPanel');
      if (!panel) return;
      if (!BATCH_STATE.favoritesOpen) { panel.hidden = true; return; }
      panel.hidden = false;
      const count = favPkgList().reduce(function (n, pkg) { return n + (FAVORITES[pkg] || []).length; }, 0);
      const searching = !!(FAV_SEARCH && FAV_SEARCH.trim());
      const searchBar = count > 8
        ? '<div class="fav-searchbar"><input class="pop-control" id="favSearch" placeholder="' + t('favSearchPlaceholder') + '" value="' + esc(FAV_SEARCH) + '"><button class="fav-search-clear" id="favSearchClear" title="' + t('filterClear') + '" aria-label="' + t('filterClear') + '">✕</button></div>'
        : '';
      const body = count
        ? (searching ? favSearchResultsHTML(FAV_SEARCH) : favTreeHTML())
        : '<div class="empty">' + t('favEmpty') + '</div>';
      panel.innerHTML =
        '<div class="bp-head"><span class="bp-title">' + t('favoritesTitle') + '</span>' +
        '<span class="bp-count">' + count + '</span>' +
        '<button class="bp-collapse" id="favClose" title="' + t('batchClose') + '" aria-label="' + t('batchClose') + '">⟨</button></div>' +
        searchBar +
        '<div class="fav-tree">' + body + '</div>';
    }
    function toggleFavoritesPanel(force) {
      BATCH_STATE.favoritesOpen = force !== undefined ? force : !BATCH_STATE.favoritesOpen;
      if (BATCH_STATE.favoritesOpen) {
        BATCH_STATE.expanded = false;
        const bp = document.getElementById('batchPanel');
        if (bp) bp.hidden = true;
      }
      renderFavoritesPanel();
      renderBatchDock();
    }
    // 收藏版本不兼容批次前的警告提示。
    function confirmFavoriteIncompatible(b) {
      const body = t('favIncompatBody').replace('{v}', 'v' + b.formatVersion).replace('{list}', 'v' + SUPPORTED_FORMAT_VERSIONS.join(', v'));
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML =
        '<div class="modal" style="max-width:460px"><div class="modal-head"><h3>' + t('favIncompatTitle') + '</h3><button class="modal-close" aria-label="' + t('closeLabel') + '">✕</button></div>' +
        '<div class="modal-body"><p>' + esc(body) + '</p>' +
        '<div class="bulk-actions"><button class="bulk-btn danger" data-fav-force="1">' + t('favIncompatConfirm') + '</button>' +
        '<button class="bulk-btn cancel" data-fav-force="0">' + t('batchForceCancel') + '</button></div></div></div>';
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop || e.target.closest('.modal-close')) { backdrop.remove(); return; }
        const btn = e.target.closest('[data-fav-force]');
        if (!btn) return;
        backdrop.remove();
        if (btn.getAttribute('data-fav-force') === '1') openAddFavoriteDialogInner(b.batchId);
      });
      document.body.appendChild(backdrop);
    }
    function openAddFavoriteDialog(batchId) {
      const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === batchId; });
      if (!b) return;
      if (!batchCompatible(b)) { confirmFavoriteIncompatible(b); return; }
      openAddFavoriteDialogInner(batchId);
    }
    function openAddFavoriteDialogInner(batchId) {
      const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === batchId; });
      if (!b) return;
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML =
        '<div class="modal" style="max-width:420px"><div class="modal-head"><h3>' + t('favAddTitle') + '</h3><button class="modal-close" aria-label="' + t('closeLabel') + '">✕</button></div>' +
        '<div class="modal-body">' +
        '<div class="fav-add-batch">' + esc(b.batchName || b.batchId) + '</div>' +
        '<input class="pop-control" id="favPkgInput" placeholder="' + t('favPkgPlaceholder') + '" value="">' +
        '<div class="fav-add-hint">' + t('favPkgHint') + '</div>' +
        '<div class="fav-add-actions"><button class="tool-btn" id="favSave">' + t('favSave') + '</button><button class="tool-btn" data-fav-cancel="1">' + t('cancel') + '</button></div>' +
        '</div></div>';
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop || e.target.closest('.modal-close') || e.target.closest('[data-fav-cancel]')) { backdrop.remove(); return; }
        if (e.target.closest('#favSave')) {
          const pkg = backdrop.querySelector('#favPkgInput').value;
          const r = addFavorite(batchId, pkg);
          if (r.ok) { backdrop.remove(); renderFavoritesPanel(); renderBatchPanel(); }
          else alert(r.error);
        }
      });
      document.body.appendChild(backdrop);
      const input = backdrop.querySelector('#favPkgInput');
      input.focus(); input.select();
    }
    // 批次列表上方的激活筛选标签（与主列表 #filterChips 同一套样式与「清除全部」规则）。
    let BATCH_FILTERS = [];
    function batchActiveFilters() {
      const list = [];
      if (BATCH_STATE.search.trim()) list.push({ label: t('batchSearchLabel') + ': ' + BATCH_STATE.search.trim(), clear: function () { BATCH_STATE.search = ''; } });
      if (BATCH_STATE.cmd.trim()) list.push({ label: t('batchCmdSearch') + ': ' + BATCH_STATE.cmd.trim(), clear: function () { BATCH_STATE.cmd = ''; } });
      if (BATCH_STATE.desc.trim()) list.push({ label: t('batchDescSearch') + ': ' + BATCH_STATE.desc.trim(), clear: function () { BATCH_STATE.desc = ''; } });
      if (BATCH_STATE.date.trim()) list.push({ label: t('batchDate') + ': ' + BATCH_STATE.date.trim(), clear: function () { BATCH_STATE.date = ''; } });
      if (BATCH_STATE.env) list.push({ label: t('batchEnv') + ': ' + BATCH_STATE.env, clear: function () { BATCH_STATE.env = ''; } });
      if (BATCH_STATE.tag) list.push({ label: t('batchTagLabel') + ': ' + BATCH_STATE.tag, clear: function () { BATCH_STATE.tag = ''; } });
      return list;
    }
    function renderBatchChips(total) {
      const el = document.getElementById('batchChips');
      if (!el) return;
      BATCH_FILTERS = batchActiveFilters();
      const html = BATCH_FILTERS.map(function (f, i) {
        return '<span class="filter-chip">' + esc(f.label) + '<button data-bchip="' + i + '" title="' + t('filterClearThis') + '">✕</button></span>';
      }).join('');
      const clearAll = BATCH_FILTERS.length > 1
        ? '<button class="filter-clear-all" data-bchip-all="1" title="' + t('clearAllFilters') + '">' + t('clearAllFilters') + '</button>'
        : '';
      el.innerHTML = html + clearAll;
      renderChipMatchCount('batchMatchCount', BATCH_FILTERS.length, total);
    }
    // 筛选标签下方的「匹配 N 项」小字：仅在确实有标签时显示（无标签 -> 文本置空，元素自动收起）。
    function renderChipMatchCount(elId, filterCount, matches) {
      const el = document.getElementById(elId);
      if (!el) return;
      const n = typeof matches === 'number' ? matches : 0;
      el.textContent = filterCount > 0 ? t('chipMatchCount').replace('{N}', n) : '';
    }
    // 清除全部批次筛选标签，并重置搜索 / 日期 / 环境 / 标签筛选状态与分页。
    function clearAllBatchFilters() {
      BATCH_STATE.search = '';
      BATCH_STATE.cmd = '';
      BATCH_STATE.desc = '';
      BATCH_STATE.date = '';
      BATCH_STATE.env = '';
      BATCH_STATE.tag = '';
      BATCH_STATE.page = 1;
      renderBatchPanel();
    }
    function renderBatchList() {
      const listEl = document.getElementById('batchList');
      const pagerEl = document.getElementById('batchPager');
      if (!listEl) return;
      const list = visibleBatches();
      renderBatchChips(list.length);
      const total = list.length;
      const pages = Math.max(1, Math.ceil(total / BATCH_STATE.pageSize));
      if (BATCH_STATE.page > pages) BATCH_STATE.page = pages;
      let slice, footer = '';
      if (BATCH_STATE.listMode === 'lazy') {
        const limit = BATCH_STATE.page * BATCH_STATE.pageSize;
        slice = list.slice(0, limit);
        if (total > limit) footer = '<button class="load-more" data-bloadmore="1">' + t('loadMore') + '（' + (total - limit) + '）</button>';
        else if (total > BATCH_STATE.pageSize) footer = '<span class="pg-info">' + t('allLoaded') + ' · ' + total + '</span>';
      } else {
        const start = (BATCH_STATE.page - 1) * BATCH_STATE.pageSize;
        slice = list.slice(start, start + BATCH_STATE.pageSize);
        if (total > BATCH_STATE.pageSize) footer = batchPagerHTML(BATCH_STATE.page, pages);
      }
      BATCH_STATE._slice = slice;
      if (BATCH_STATE.scanning) {
        listEl.innerHTML = batchListSkeletonHTML();
      } else if (!slice.length) {
        listEl.innerHTML = '<div class="empty">' + (scopeCount() ? t('batchEmptyFiltered') : t('batchEmpty')) + '</div>';
      } else {
        renderBatchListVirtual(listEl, slice);
      }
      if (pagerEl) pagerEl.innerHTML = footer;
    }
    function renderBatchListVirtual(listEl, slice) {
      const rowH = BATCH_ROW_H;
      const totalH = slice.length * rowH;
      const viewH = listEl.clientHeight || 400;
      const scrollTop = listEl.scrollTop;
      const overscan = 4;
      const visible = Math.ceil(viewH / rowH) + overscan * 2;
      let first = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
      let last = Math.min(slice.length, first + visible);
      if (last - first < visible) first = Math.max(0, last - visible);
      const topPad = first * rowH;
      const rows = slice.slice(first, last).map(function (b) { return batchItemHTML(b); }).join('');
      listEl.innerHTML = '<div style="height:' + topPad + 'px"></div>' + rows + '<div style="height:' + Math.max(0, totalH - topPad - (last - first) * rowH) + 'px"></div>';
    }
    function batchListSkeletonHTML() {
      let out = '';
      for (let i = 0; i < 6; i++) out += '<div class="bp-sk"><span class="bp-sk-line w55"></span><span class="bp-sk-line w35"></span><span class="bp-sk-line w75"></span></div>';
      return out;
    }
    function scrollBatchListToActive() {
      const listEl = document.getElementById('batchList');
      if (!listEl || !BATCH_STATE.active) return;
      const list = visibleBatches();
      const idx = list.findIndex(function (x) { return x.batchId === BATCH_STATE.active.batchId; });
      if (idx >= 0) {
        const page = Math.floor(idx / BATCH_STATE.pageSize) + 1;
        if (page !== BATCH_STATE.page) { BATCH_STATE.page = page; renderBatchList(); }
        listEl.scrollTop = Math.max(0, idx * BATCH_ROW_H - listEl.clientHeight / 2);
        renderBatchListVirtual(listEl, BATCH_STATE._slice || []);
      }
    }
    let BATCH_LIST_TIMER = null;
    let BD_CARD = null;
    function showBdCard(chip, id) {
      const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === id; });
      if (!b) return;
      hideBdCard();
      BD_CARD = document.createElement('div');
      BD_CARD.className = 'bd-card';
      BD_CARD.innerHTML =
        '<div class="bdc-name">' + esc(b.batchName || b.batchId) + '</div>' +
        '<div class="bdc-time">' + esc(formatBatchTime(b.executedAt)) + '</div>' +
        '<div class="bdc-badges">' + batchBadgesHTML(b) + '</div>';
      document.body.appendChild(BD_CARD);
      const cr = chip.getBoundingClientRect();
      const cw = BD_CARD.offsetWidth, ch = BD_CARD.offsetHeight;
      let left = BATCH_STATE.side === 'right' ? (cr.left - cw - 10) : (cr.right + 10);
      let top = cr.top + cr.height / 2 - ch / 2;
      left = Math.max(8, Math.min(window.innerWidth - cw - 8, left));
      top = Math.max(8, Math.min(window.innerHeight - ch - 8, top));
      BD_CARD.style.left = left + 'px';
      BD_CARD.style.top = top + 'px';
    }
    function hideBdCard() {
      if (BD_CARD) { BD_CARD.remove(); BD_CARD = null; }
    }
    function setBatchNotice(msg) {
      BATCH_STATE.notice = msg || '';
      const el = document.getElementById('batchNotice');
      if (el) {
        el.hidden = !msg;
        const txt = el.querySelector('.bp-notice-text');
        if (txt) txt.textContent = msg || '';
      }
    }
    function saveBatchActive() {
      try {
        if (BATCH_STATE.active) localStorage.setItem(storageKey(BATCH_STORAGE_KEY), JSON.stringify({ id: BATCH_STATE.active.batchId, forced: BATCH_STATE.forced }));
        else localStorage.removeItem(storageKey(BATCH_STORAGE_KEY));
      } catch (e) {}
    }
    function restoreActiveBatch() {
      try {
        const s = JSON.parse(localStorage.getItem(storageKey(BATCH_STORAGE_KEY)) || 'null');
        if (s && s.id) {
          const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === s.id; });
          if (b) return { batch: b, forced: batchCompatible(b) ? false : !!s.forced };
        }
      } catch (e) {}
      return null;
    }
    function batchById(id) {
      if (!id) return null;
      return BATCHES_INDEX.batches.find(function (x) { return x.batchId === id; }) || null;
    }
    function isPinned(b) { return !!(b && PINNED_BATCH_ID === b.batchId); }
    function loadPinnedId() {
      try {
        const v = JSON.parse(localStorage.getItem(storageKey(PIN_STORAGE_KEY)) || 'null');
        PINNED_BATCH_ID = typeof v === 'string' && v ? v : null;
      } catch (e) { PINNED_BATCH_ID = null; }
    }
    function savePinnedId() {
      try { if (PINNED_BATCH_ID) localStorage.setItem(storageKey(PIN_STORAGE_KEY), JSON.stringify(PINNED_BATCH_ID)); else localStorage.removeItem(storageKey(PIN_STORAGE_KEY)); } catch (e) {}
    }
    function toggleBatchPin(batchId) {
      const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === batchId; });
      if (!b) return;
      PINNED_BATCH_ID = isPinned(b) ? null : b.batchId;
      savePinnedId();
      renderBatchPanel(); renderBatchDock(); renderBatchBadge();
    }
    // 冷/热启动时优先加载被置顶的批次（存在且未被删除时才生效）。
    function restorePinnedBatch() {
      if (!PINNED_BATCH_ID) return null;
      const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === PINNED_BATCH_ID && !isBatchPending(x) && !x.deleted; });
      if (b && b.dataUrl) return { batch: b, forced: false };
      return null;
    }
    // 批次被物理删除（重新扫描后索引中不再存在）或被软删除时，及时清除置顶状态。
    function prunePinnedBatch() {
      if (!PINNED_BATCH_ID) return;
      const exists = BATCHES_INDEX.batches.some(function (b) { return b.batchId === PINNED_BATCH_ID && !b.deleted; });
      if (!exists) { PINNED_BATCH_ID = null; savePinnedId(); }
    }
    function toggleBatchPanel(force) {
      BATCH_STATE.expanded = force === undefined ? !BATCH_STATE.expanded : !!force;
      // 批次面板与收藏夹互斥：打开批次面板时隐藏收藏夹。
      if (BATCH_STATE.expanded) { BATCH_STATE.favoritesOpen = false; renderFavoritesPanel(); }
      const panel = document.getElementById('batchPanel');
      if (panel) panel.hidden = !BATCH_STATE.expanded;
      renderBatchDock();
      if (BATCH_STATE.expanded) { renderBatchPanel(); scrollBatchListToActive(); }
    }
    function applyBatchSide() {
      document.body.classList.toggle('batch-side-right', BATCH_STATE.side === 'right');
    }
    function toggleBatchSide() {
      BATCH_STATE.side = BATCH_STATE.side === 'right' ? 'left' : 'right';
      applyBatchSide();
      savePrefs();
      renderBatchDock();
      if (BATCH_STATE.expanded) renderBatchPanel();
    }
    function setBatchScanning(v) {
      BATCH_STATE.scanning = !!v;
      document.querySelectorAll('#batchRefreshDock, #batchRefresh').forEach(function (btn) {
        if (!btn) return;
        btn.disabled = v;
        btn.innerHTML = v ? '<span class="spin">⟳</span>' : '⟳';
      });
    }
    let BATCH_PROGRESS = { phase: 'idle', dirCount: 0, batchCount: 0, skipped: 0 };
    function setScanProgress(p) {
      BATCH_PROGRESS = p || { phase: 'idle', dirCount: 0, batchCount: 0, skipped: 0 };
      document.querySelectorAll('#batchRefreshDock, #batchRefresh').forEach(function (btn) {
        if (!btn || !BATCH_STATE.scanning) return;
        const n = BATCH_PROGRESS.batchCount || 0;
        btn.innerHTML = '<span class="spin">⟳</span> <span class="scan-prog">' + n + '</span>';
      });
    }
    let BATCH_RING_TIMER = null;
    function flashBatchRing(fail) {
      const target = BATCH_STATE.expanded ? document.getElementById('batchPanel') : document.getElementById('batchDock');
      if (!target) return;
      target.classList.remove('batch-ring', 'batch-ring-fail');
      void target.offsetWidth;
      target.classList.add('batch-ring');
      if (fail) target.classList.add('batch-ring-fail');
      clearTimeout(BATCH_RING_TIMER);
      BATCH_RING_TIMER = setTimeout(function () { target.classList.remove('batch-ring', 'batch-ring-fail'); }, 1650);
    }
    function positionBatchPanel() {
      const dock = document.getElementById('batchDock');
      const panel = document.getElementById('batchPanel');
      if (!dock || !panel) return;
      if (BATCH_STATE.dockY != null) {
        const dockRect = dock.getBoundingClientRect();
        const panelH = panel.offsetHeight || 0;
        const dockCenter = dockRect.top + dockRect.height / 2;
        let top = (dockCenter < window.innerHeight / 2) ? dockRect.top : (dockRect.bottom - panelH);
        top = Math.max(8, Math.min(window.innerHeight - panelH - 8, top));
        panel.style.top = top + 'px';
        panel.style.translate = '0 0';
      } else {
        panel.style.top = '';
        panel.style.translate = '';
      }
    }
    function openBatchDatePicker(anchor) {
      if (anchor.classList.contains('active')) { closePopover(); return; }
      const counts = {};
      BATCHES_INDEX.batches.forEach(function (b) { const d = String(b.date || ''); if (d) counts[d] = (counts[d] || 0) + 1; });
      const dates = Object.keys(counts).sort().reverse();
      let html = '<div class="date-option' + (!BATCH_STATE.date ? ' active' : '') + '" data-bdate="">' + t('healthAllDates') + '（' + BATCHES_INDEX.batches.length + '）</div>';
      dates.forEach(function (d) {
        html += '<div class="date-option' + (BATCH_STATE.date === d ? ' active' : '') + '" data-bdate="' + esc(d) + '"><span>' + esc(d) + (BATCH_STATE.date === d ? ' ✓' : '') + '</span><span class="date-opt-count">' + counts[d] + '</span></div>';
      });
      const pop = openPopover(anchor, '<div class="date-list">' + html + '</div>', t('batchDate') + '（' + dates.length + '）');
      pop.querySelectorAll('.date-option').forEach(function (el) {
        el.addEventListener('click', function () {
          BATCH_STATE.date = el.getAttribute('data-bdate');
          BATCH_STATE.page = 1;
          closePopover();
          renderBatchPanel();
        });
      });
    }
    function applyBatchDockY() {
      const dock = document.getElementById('batchDock');
      if (!dock) return;
      if (BATCH_STATE.dockY != null) {
        dock.style.top = BATCH_STATE.dockY + 'px';
        dock.style.bottom = 'auto';
        dock.style.transform = 'none';
      } else {
        dock.style.top = '';
        dock.style.bottom = '';
        dock.style.transform = '';
      }
    }
    function applyBatchListH() {
      const panel = document.getElementById('batchPanel');
      if (!panel) return;
      if (BATCH_STATE.listH != null) panel.style.setProperty('--bp-list-h', BATCH_STATE.listH + 'px');
      else panel.style.removeProperty('--bp-list-h');
    }
    function renderBatchBadge() {
      const el = document.getElementById('batchBadge');
      if (!el) return;
      if (APP_FEATURES.recentBatches && BATCH_STATE.active) {
        const b = BATCH_STATE.active;
        el.hidden = false;
        el.innerHTML =
          '<span class="batch-badge-label">' + t('batchCurrentLabel') + '</span>' +
          (BATCH_STATE.forced ? '<span class="batch-badge-warn" title="' + t('batchForcedBanner') + '">⚠</span>' : '') +
          '<span class="batch-badge-text">' + esc(b.batchName || b.batchId) + '</span>' +
          (isPinned(b) ? '<span class="batch-badge-pin" title="' + t('pinTitle') + '">📌</span>' : '') +
          (isBatchFavorited(b) ? '<span class="batch-badge-star" title="' + t('favoritesTitle') + '">★</span>' : '');
        el.title = (b.batchName || b.batchId) + ' · ' + formatBatchTime(b.executedAt);
      } else el.hidden = true;
    }
    function renderForceBanner() {
      const banner = document.getElementById('batchForceBanner');
      if (!banner) return;
      if (BATCH_STATE.active && BATCH_STATE.forced) {
        document.getElementById('batchForceText').textContent = t('batchForcedBanner');
        document.getElementById('batchBackDefault').textContent = t('batchBackDefault');
        banner.hidden = false;
      } else banner.hidden = true;
    }
    // 打开批次（查看详情或加载）：已删除批次只走详情展示，不支持加载。
    function openBatchDetail(anchor, b) {
      if (!b.deleted) { selectBatch(b); return; }
      if (BATCH_STATE.detailMode === 'modal') openBatchInfo(b);
      else showBatchQuickDetail(anchor, b);
    }
    function selectBatch(b) {
      // 已删除（软删除）批次：仅可查看，不可加载。
      if (b && b.deleted) { setBatchNotice(t('batchDeletedBlocked')); return; }
      if (!batchCompatible(b)) { confirmIncompatible(b); return; }
      loadBatch(b, false);
    }
    function confirmIncompatible(b) {
      const body = t('batchForceBody').replace('{v}', 'v' + b.formatVersion).replace('{list}', 'v' + SUPPORTED_FORMAT_VERSIONS.join(', v'));
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML =
        '<div class="modal" style="max-width:460px"><div class="modal-head"><h3>' + t('batchForceTitle') + '</h3><button class="modal-close" aria-label="' + t('closeLabel') + '">✕</button></div>' +
        '<div class="modal-body"><p>' + esc(body) + '</p>' +
        '<div class="bulk-actions"><button class="bulk-btn danger" data-force="1">' + t('batchForceConfirm') + '</button>' +
        '<button class="bulk-btn cancel" data-force="0">' + t('batchForceCancel') + '</button></div></div></div>';
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop || e.target.closest('.modal-close')) { backdrop.remove(); return; }
        const btn = e.target.closest('[data-force]');
        if (!btn) return;
        backdrop.remove();
        if (btn.getAttribute('data-force') === '1') loadBatch(b, true);
      });
      document.body.appendChild(backdrop);
    }
    async function loadBatchData(b, forced, dataUrl) {
      try {
        const res = await fetch(dataUrl, { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        if (!json || !Array.isArray(json.items) || !json.items.length) throw new Error('数据格式无效');
        DATA = normalizeLoaded(json);
        DATA_FILE_URL = dataUrl;
      } catch (e) {
        console.warn('[batch] 加载失败：', e);
        setBatchNotice(t('batchLoadError') + ' ' + (b.batchName || b.batchId));
        return false;
      }
      const ignoreUrl = b.ignoreUrl ? resolveUrl(indexBaseUrl(), b.ignoreUrl) : '';
      if (ignoreUrl) {
        let ok = false;
        try {
          const r = await fetch(ignoreUrl, { cache: 'no-store' });
          if (r.ok) { const norm = normalizeIgnoreConfig(await r.json()); if (norm) { IGNORE_CONFIG = norm; ok = true; IGNORE_ETAG = r.headers.get('etag') || ''; } }
        } catch (e) {}
        // 回写目标跟随实际加载成功的配置文件：批次级忽略配置回写到该批次目录，否则回退全局配置。
        IGNORE_ACTIVE_URL = ok ? ignoreUrl : IGNORE_CONFIG_URL;
        saveIgnoreConfigLocal();
      } else {
        await loadIgnoreConfig();
      }
      BATCH_STATE.active = b; BATCH_STATE.forced = forced;
      setBatchNotice('');
      saveBatchActive();
      return true;
    }
    async function loadBatch(b, forced, applyUrlAfter) {
      if (BATCH_STATE.loading) return;
      BATCH_STATE.loading = true;
      renderBatchPanel(); renderBatchDock();
      const dataUrl = resolveUrl(indexBaseUrl(), b.dataUrl || '');
      const ok = await loadBatchData(b, forced, dataUrl);
      BATCH_STATE.loading = false;
      if (!ok) { renderBatchPanel(); renderBatchDock(); return; }
      // 加载至主列表后移除「新增」徽章。
      if (NEW_BATCH_IDS[b.batchId]) delete NEW_BATCH_IDS[b.batchId];
      initState();
      await ensureHashItemLoaded(applyUrlAfter);
      if (applyUrlAfter) applyHash(); else clearHash();
      applyDateFilterVisibility();
      render();
      preloadAllItems();
      renderBatchPanel(); renderBatchDock(); renderBatchBadge(); renderForceBanner();
      scrollBatchListToActive();
    }
    async function loadDefaultReport() {
      BATCH_STATE.active = null; BATCH_STATE.forced = false;
      setBatchNotice('');
      saveBatchActive();
      await loadIgnoreConfig();
      DATA = await loadData();
      initState();
      // 多文件模式允许空清单（items 为空）：没有 item 可加载时直接渲染空状态，
      // 避免 DATA.items[0] 解引用抛 TypeError（曾导致回退提示丢失、hash 与内容不一致）。
      if (isMultiMode() && DATA.items.length) await ensureItemLoaded(DATA.items[0].tradeId);
      applyDateFilterVisibility();
      render();
      preloadAllItems();
      renderBatchPanel(); renderBatchDock(); renderBatchBadge(); renderForceBanner();
    }
    // 回退默认数据的统一入口（会话内深链接失效 / 「返回默认数据」按钮）：
    // 任何失败都不再产生未捕获的 Promise 拒绝，并保证提示语可见。
    async function fallbackToDefaultReport(notice) {
      let ok = true;
      try {
        await loadDefaultReport();
      } catch (e) {
        ok = false;
        console.warn('[batch] 回退默认数据失败：', e);
      }
      setBatchNotice(notice || (ok ? '' : t('batchLoadError')));
      return ok;
    }
    async function reloadBatchesIndex() {
      setBatchScanning(true);
      const listEl = document.getElementById('batchList');
      if (listEl) listEl.innerHTML = batchListSkeletonHTML();
      const t0 = Date.now();
      // 先调用扫描接口（自动执行 scan-batches.js），完成后再重新读取批次索引。
      // 同时订阅 /scan/progress SSE，实时展示扫描进度。
      let scanFailed = false;
      let es = null;
      if (SCAN_API_URL) {
        const progressUrl = SCAN_API_URL.replace(/\/scan\/?$/, '/scan/progress');
        try {
          es = new EventSource(progressUrl);
          es.onmessage = function (ev) {
            try { setScanProgress(JSON.parse(ev.data)); } catch (e) {}
          };
        } catch (e) { es = null; }
        try {
          const res = await fetch(SCAN_API_URL, { method: 'POST', cache: 'no-store' });
          const j = await res.json().catch(function () { return null; });
          if (!res.ok || !j || j.ok !== true) {
            scanFailed = true;
            setBatchNotice(t('batchScanError') + ' ' + (j && j.error ? j.error : ('HTTP ' + res.status)));
          } else {
            setBatchNotice('');
          }
        } catch (e) {
          scanFailed = true;
          setBatchNotice(t('batchScanError') + ' ' + (e && e.message ? e.message : e));
        }
        if (es) { try { es.close(); } catch (e) {} es = null; }
      }
      setScanProgress({ phase: 'done', dirCount: 0, batchCount: 0, skipped: 0 });
      const prevIds = {};
      BATCHES_INDEX.batches.forEach(function (b) { prevIds[b.batchId] = true; });
      await loadBatchesIndex();
      // 本次扫描新增的批次：仅对当前扫描结果中的新批次应用「新增」徽章。
      const newIds = {};
      BATCHES_INDEX.batches.forEach(function (b) { if (!prevIds[b.batchId]) newIds[b.batchId] = true; });
      NEW_BATCH_IDS = newIds;
      const wait = Math.max(0, 280 - (Date.now() - t0));
      if (wait) await new Promise(function (r) { setTimeout(r, wait); });
      setBatchScanning(false);
      renderBatchDock();
      renderBatchPanel();
      flashBatchRing(scanFailed);
      if (BATCH_STATE.active && !BATCHES_INDEX.batches.some(function (x) { return x.batchId === BATCH_STATE.active.batchId; })) {
        BATCH_STATE.active = null; BATCH_STATE.forced = false; saveBatchActive();
        renderBatchBadge(); renderForceBanner();
      }
    }
    function clearHash() {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
      HASH_SYNC.applying = false;
    }
    // 在系统文件管理器中打开批次目录（服务端 /api/reveal，路径限定在批次根目录内）。
    async function revealBatchDir(dir) {
      if (!dir) return;
      try {
        const res = await fetch('/api/reveal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: dir }) });
        const j = await res.json().catch(function () { return null; });
        if (!res.ok || !j || j.ok !== true) throw new Error(j && j.error ? j.error : ('HTTP ' + res.status));
      } catch (e) {
        setBatchNotice(t('batchRevealError') + ' ' + (e && e.message ? e.message : e));
      }
    }

    // 批次编辑器（仅兼容批次）：编辑批次名 / 批次描述 / 标签，保存后直接回写 batch-meta.json。
    // 批次名允许重复：重名仅给出告警（不影响保存），与「defaultDataMode 按名解析取首个匹配」的现状一致。
    function openBatchEditor(batchId) {
      const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === batchId; });
      if (!b) return;
      if (b.deleted) { setBatchNotice(t('batchDeletedBlocked')); return; }
      if (!batchCompatible(b)) { setBatchNotice(t('batchEditIncompat')); return; }
      const draft = Array.isArray(b.tags) ? b.tags.slice() : [];
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML =
        '<div class="modal" style="max-width:520px"><div class="modal-head"><h3>' + t('batchEditTitle') + '</h3><button class="modal-close" aria-label="' + t('closeLabel') + '">✕</button></div>' +
        '<div class="modal-body">' +
        '<div class="fav-add-batch">' + esc(b.batchId) + '</div>' +
        '<div class="be-label">' + t('batchNameLabel') + '</div>' +
        '<input class="pop-control" id="beName" maxlength="200" value="' + esc(b.batchName || b.batchId) + '">' +
        '<div class="be-warn" id="beNameWarn" hidden></div>' +
        '<div class="be-label">' + t('batchDesc') + '</div>' +
        '<textarea class="pop-control" id="beDesc" rows="3" maxlength="4000" placeholder="' + t('batchDescPlaceholder') + '">' + esc(b.description || '') + '</textarea>' +
        '<div class="be-label">' + t('batchTagLabel') + '</div>' +
        '<div class="tag-list" id="tagList"></div>' +
        '<div class="tag-add-row"><input class="pop-control" id="tagInput" placeholder="' + t('batchTagPlaceholder') + '" maxlength="24"><button class="tool-btn" id="tagAddBtn">' + t('batchTagAdd') + '</button></div>' +
        '<div class="fav-add-hint">' + t('batchTagHint') + '</div>' +
        '<div class="fav-add-actions"><button class="tool-btn" id="beSaveBtn">' + t('favSave') + '</button><button class="tool-btn" data-be-cancel="1">' + t('cancel') + '</button></div>' +
        '</div></div>';
      const listEl = backdrop.querySelector('#tagList');
      const inputEl = backdrop.querySelector('#tagInput');
      const nameEl = backdrop.querySelector('#beName');
      const descEl = backdrop.querySelector('#beDesc');
      const warnEl = backdrop.querySelector('#beNameWarn');
      const renderTags = function () {
        listEl.innerHTML = draft.length
          ? draft.map(function (tag, i) { return '<span class="tag-chip">' + esc(tag) + '<button class="tag-chip-del" data-tag-remove="' + i + '" title="' + t('favRemove') + '" aria-label="' + t('favRemove') + '">✕</button></span>'; }).join('')
          : '<span class="tag-empty">' + t('batchTagEmpty') + '</span>';
      };
      // 重名检查：批次名允许重复，仅提示（不影响保存）。
      const checkName = function () {
        const name = nameEl.value.trim();
        if (!name) { warnEl.hidden = false; warnEl.textContent = t('batchNameEmpty'); return; }
        const ids = BATCHES_INDEX.batches.filter(function (x) {
          return x.batchId !== batchId && String(x.batchName || x.batchId) === name;
        }).map(function (x) { return x.batchId; });
        warnEl.hidden = ids.length === 0;
        warnEl.textContent = ids.length
          ? t('batchNameDupWarn').replace('{n}', String(ids.length)).replace('{ids}', ids.join('、'))
          : '';
      };
      const addTag = function () {
        const v = String(inputEl.value || '').trim().slice(0, 24);
        if (!v) return;
        if (draft.indexOf(v) === -1) draft.push(v);
        inputEl.value = '';
        renderTags();
      };
      const save = async function () {
        const name = nameEl.value.trim();
        if (!name) { checkName(); nameEl.focus(); return; }
        try {
          const res = await fetch('/api/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batchId: batchId, batchName: name, description: descEl.value, tags: draft }),
          });
          const j = await res.json().catch(function () { return null; });
          if (!res.ok || !j || j.ok !== true) throw new Error(j && j.error ? j.error : ('HTTP ' + res.status));
          b.batchName = j.batchName || name;
          if (j.description) b.description = j.description; else delete b.description;
          const tags = Array.isArray(j.tags) ? j.tags : [];
          if (tags.length) b.tags = tags; else delete b.tags;
          // 收藏夹中缓存的批次名同步更新（收藏项自带 batchName 快照）。
          if (syncFavoriteBatchName(batchId, b.batchName)) { saveFavorites(); renderFavoritesPanel(); }
          backdrop.remove();
          hideBatchQuickDetail();
          renderBatchBadge();
          renderBatchPanel(); renderBatchDock();
        } catch (e) {
          alert(t('batchEditError') + ' ' + (e && e.message ? e.message : e));
        }
      };
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop || e.target.closest('.modal-close') || e.target.closest('[data-be-cancel]')) { backdrop.remove(); return; }
        const rm = e.target.closest('[data-tag-remove]');
        if (rm) { draft.splice(parseInt(rm.getAttribute('data-tag-remove'), 10), 1); renderTags(); return; }
        if (e.target.closest('#tagAddBtn')) { addTag(); return; }
        if (e.target.closest('#beSaveBtn')) { save(); return; }
      });
      backdrop.addEventListener('keydown', function (e) {
        if (e.target === inputEl && e.key === 'Enter') { e.preventDefault(); addTag(); }
      });
      nameEl.addEventListener('input', checkName);
      document.body.appendChild(backdrop);
      checkName();
      renderTags();
      nameEl.focus();
      nameEl.setSelectionRange(nameEl.value.length, nameEl.value.length);
    }
    function batchDetailKVHTML(b) {
      const dir = b.path || BATCHES_INDEX.basedir || '';
      const revealable = !!APP_FEATURES.revealPath;
      const rows = [
        [t('batchEnv'), b.reportEnv || t('batchEnvUnknown'), false],
        [t('batchDateLabel'), b.date || '', false],
        [t('batchExecutedAt'), formatBatchTime(b.executedAt), false],
        [t('batchBasedir'), dir, true],
      ];
      if (b.summary && typeof b.summary.items === 'number') rows.push([t('batchItemCount'), b.summary.items, false]);
      return rows.map(function (r) {
        const v = r[1] == null ? '' : String(r[1]);
        if (r[2]) {
          // 批次目录：双击在系统文件管理器中打开（需 features.revealPath 开启；关闭时给出提示）。
          const title = (revealable ? t('batchRevealHint') : t('batchRevealDisabled')) + '\n' + v;
          return '<div class="k">' + esc(r[0]) + '</div><div class="v bi-dir"><span class="bi-link' + (revealable ? ' revealable' : '') + '" title="' + esc(title) + '"' + (revealable ? ' data-reveal-dir="' + esc(v) + '"' : '') + '>' + esc(v) + '</span><button class="bi-copy" data-copy="' + esc(v) + '" title="' + t('batchCopy') + '" aria-label="' + t('batchCopy') + '">⧉</button></div>';
        }
        return '<div class="k">' + esc(r[0]) + '</div><div class="v">' + esc(v) + '</div>';
      }).join('');
    }
    function batchDetailCmdHTML(b) {
      const cl = b.commandLine || b.argv;
      if (Array.isArray(cl) && cl.length) return '<div class="bi-cmd-label">' + t('batchCommandLine') + '</div><div class="bi-cmd">' + esc(cl.join(' ')) + '</div>';
      return '';
    }
    function batchDetailDescHTML(b) {
      const d = b.description;
      if (typeof d === 'string' && d.trim()) return '<div class="bi-cmd-label">' + t('batchDesc') + '</div><div class="bi-cmd">' + esc(d) + '</div>';
      return '';
    }
    function openBatchInfo(b) {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML =
        '<div class="modal"><div class="modal-head"><h3 title="' + esc(b.batchName || b.batchId) + '">' + t('batchInfoTitle') + '：' + esc(b.batchName || b.batchId) + '</h3><button class="modal-close" aria-label="' + t('closeLabel') + '">✕</button></div>' +
        '<div class="modal-body"><div class="bi-badges">' + batchBadgesHTML(b) + '</div><div class="bi-kv">' + batchDetailKVHTML(b) + '</div>' + batchDetailCmdHTML(b) + batchDetailDescHTML(b) + '</div></div>';
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop || e.target.closest('.modal-close')) backdrop.remove();
      });
      document.body.appendChild(backdrop);
    }
    let BATCH_QD = null;
    let BATCH_QD_HIDE_TIMER = null;
    function scheduleBatchQdHide() {
      clearTimeout(BATCH_QD_HIDE_TIMER);
      BATCH_QD_HIDE_TIMER = setTimeout(function () {
        if (BATCH_QD && !BATCH_QD.__hover) hideBatchQuickDetail();
      }, 180);
    }
    function cancelBatchQdHide() {
      clearTimeout(BATCH_QD_HIDE_TIMER);
      BATCH_QD_HIDE_TIMER = null;
    }
    function buildBatchQuickDetail(b) {
      const card = document.createElement('div');
      card.className = 'batch-qd';
      card.id = 'batchQuickDetail';
      card.innerHTML =
        '<div class="bq-name">' + esc(b.batchName || b.batchId) + '</div>' +
        '<div class="bq-time">' + esc(formatBatchTime(b.executedAt)) + '</div>' +
        '<div class="bq-badges">' + batchBadgesHTML(b) + '</div>' +
        '<div class="bi-kv">' + batchDetailKVHTML(b) + '</div>' +
        batchDetailCmdHTML(b) +
        batchDetailDescHTML(b);
      // 悬停进详情框时保持显示，移出后自动消失。
      card.addEventListener('mouseenter', function () { card.__hover = true; cancelBatchQdHide(); });
      card.addEventListener('mouseleave', function () { card.__hover = false; scheduleBatchQdHide(); });
      return card;
    }
    function placeBatchQuickDetail(card, left, top) {
      const cw = card.offsetWidth, ch = card.offsetHeight;
      left = Math.max(8, Math.min(window.innerWidth - cw - 8, left));
      top = Math.max(8, Math.min(window.innerHeight - ch - 8, top));
      card.style.left = left + 'px';
      card.style.top = top + 'px';
    }
    function showBatchQuickDetail(anchor, b) {
      hideBatchQuickDetail();
      const card = buildBatchQuickDetail(b);
      document.body.appendChild(card);
      const r = anchor.getBoundingClientRect();
      const left = BATCH_STATE.side === 'right' ? (r.left - card.offsetWidth - 12) : (r.right + 12);
      placeBatchQuickDetail(card, left, r.top);
      BATCH_QD = card;
    }
    function showBatchQuickDetailBelow(anchor, b) {
      hideBatchQuickDetail();
      const card = buildBatchQuickDetail(b);
      document.body.appendChild(card);
      const r = anchor.getBoundingClientRect();
      const left = r.left + r.width / 2 - card.offsetWidth / 2;
      placeBatchQuickDetail(card, left, r.bottom + 8);
      BATCH_QD = card;
    }
    function hideBatchQuickDetail() {
      cancelBatchQdHide();
      if (BATCH_QD) { BATCH_QD.remove(); BATCH_QD = null; }
    }

    function msgIsIgnored(tab, m) {
      const k = msgIgnoreKey(tab, m);
      return k ? !!IGNORE_CONFIG[k] : false;
    }
    // 本地镜像：仅写 localStorage（加载/切换批次时用，避免无意义的回写）。
    function saveIgnoreConfigLocal() {
      try { localStorage.setItem(storageKey(IGNORE_STORAGE_KEY), JSON.stringify(IGNORE_CONFIG)); } catch (e) {}
    }
    // 回写目标归一化：服务端只接受「站点根相对路径」（并拒绝跨域地址），
    // 而批次级 ignoreUrl 经 resolveUrl 解析后是绝对 URL，因此这里统一转回路径。
    function ignoreWriteTarget() {
      const raw = IGNORE_ACTIVE_URL || IGNORE_CONFIG_URL;
      try {
        const u = new URL(raw, location.href);
        if (u.origin === location.origin) return u.pathname.replace(/^\/+/, '');
      } catch (e) {}
      return raw;
    }

    // 忽略配置变更后的统一重绘（粒度与各写入调用方一致：不关浮层、不重置当前页）。
    function renderAfterIgnoreChange() {
      renderSummary(); renderTabs(); renderChannelTabs();
      renderSidebar(); renderSidebarChips(); renderContent();
      repaintIgnoreManagerIfOpen();
    }
    // 忽略配置在别处（其它标签页 / 会话）变更后的统一收敛：更新内存 + 重绘（含打开着的忽略管理窗口）。
    function applyIgnoreConfigChange(flat, etag) {
      IGNORE_CONFIG = flat || {};
      IGNORE_ETAG = etag || '';
      saveIgnoreConfigLocal();
      renderAfterIgnoreChange();
    }
    // 若「管理忽略配置」窗口开着，同步刷新其列表（不重开窗口）。
    function repaintIgnoreManagerIfOpen() {
      const bd = document.querySelector('.modal-backdrop');
      if (bd && bd.querySelector('#ignoreMgrBody')) paintIgnoreMgr(bd);
    }
    // 跨标签同步：广播本次写入结果（分组格式 + etag），其它标签就地更新。
    function broadcastIgnoreConfig() {
      if (!IGNORE_BC) return;
      try {
        IGNORE_BC.postMessage({ type: 'ignore-updated', url: ignoreWriteTarget(), etag: IGNORE_ETAG || '', config: flatToGrouped(IGNORE_CONFIG) });
      } catch (e) {}
    }
    /* 跨标签：同名 BroadcastChannel 广播写入结果；不支持时自动降级（仅靠回前台重校验）。
     * 注意：仅在浏览器环境创建 —— 本模块会被 test/pure-logic.test.js 直接 import，
     * Node 下开着的 BroadcastChannel 会阻止测试进程退出（保持事件循环存活）。 */
    const IGNORE_BC_NAME = 'report-viewer-ignore';
    let IGNORE_BC = null;
    try {
      if (typeof window !== 'undefined' && typeof BroadcastChannel === 'function') IGNORE_BC = new BroadcastChannel(IGNORE_BC_NAME);
    } catch (e) { IGNORE_BC = null; }
    if (IGNORE_BC) {
      IGNORE_BC.addEventListener('message', function (ev) {
        const d = ev && ev.data;
        // 只接受「同一回写目标」的广播；发送方自己收不到（BroadcastChannel 语义）。
        if (!d || d.type !== 'ignore-updated' || d.url !== ignoreWriteTarget()) return;
        const norm = normalizeIgnoreConfig(d.config);
        if (!norm) return;
        applyIgnoreConfigChange(norm, d.etag);
      });
    }
    // 回到前台时与服务端核对一次 etag（其它标签 / 会话可能已改过配置），仅在确有变化时重绘。
    async function revalidateIgnoreConfig() {
      const url = IGNORE_ACTIVE_URL || IGNORE_CONFIG_URL;
      if (!url) return;
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const etag = res.headers.get('etag') || '';
        if (etag && etag === IGNORE_ETAG) return;
        const norm = normalizeIgnoreConfig(await res.json());
        if (!norm) return;
        applyIgnoreConfigChange(norm, etag);
      } catch (e) {}
    }
    // 回到前台时与服务端核对一次 etag；Node 环境（pure-logic.test.js 直接 import 本模块）无 document，需保护。
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') revalidateIgnoreConfig();
      });
    }

    // 忽略/取消忽略与批量操作：localStorage 镜像 + 回写服务端配置文件。
    // 服务端按租户隔离（租户模式下写入租户数据根内的同名文件），读取路径与 IGNORE_ACTIVE_URL 一致。
    // `replay`：可选的「本次变更」重放函数 —— 遇到 409（其它会话先写）时，先按服务端收敛界面，
    // 再用新 etag 重放一次本次变更（只重试一次），避免用户的点击因冲突而静默丢失。
    function saveIgnoreConfig(replay, isRetry) {
      saveIgnoreConfigLocal();
      const body = { url: ignoreWriteTarget(), config: flatToGrouped(IGNORE_CONFIG) };
      // 乐观并发：带上加载时的 ETag，服务端内容已变则拒写（409）。
      if (IGNORE_ETAG) body.ifMatch = IGNORE_ETAG;
      try {
        fetch('/api/ignore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }).then(function (r) {
          if (r.status === 409) {
            // 其它会话已修改配置文件：以服务端为准重新加载并重绘，然后（首次冲突时）重放本次变更。
            console.warn('[ignore] 配置回写冲突（409）：已重新加载服务端配置' + (isRetry ? '（重试仍冲突）' : ''));
            return loadIgnoreConfig().then(function () {
              renderAfterIgnoreChange();
              if (typeof replay === 'function' && !isRetry) {
                replay();                       // 重放本次变更（重放后会再重绘一次，保证界面与“已生效的意图”一致）
                renderAfterIgnoreChange();
                saveIgnoreConfig(null, true);
              } else {
                setBatchNotice(t('saveConflict'));
              }
              return null;
            });
          }
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json().catch(function () { return null; });
        }).then(function (j) {
          if (!j) return;
          if (j.etag) IGNORE_ETAG = j.etag;
          setBatchNotice('');
          broadcastIgnoreConfig();
        }).catch(function (e) {
          console.warn('[ignore] 配置回写失败：', e);
          setBatchNotice(t('ignoreSaveError') + ' ' + (e && e.message ? e.message : e));
        });
      } catch (e) {
        console.warn('[ignore] 配置回写失败：', e);
        setBatchNotice(t('ignoreSaveError') + ' ' + (e && e.message ? e.message : e));
      }
    }
    function toggleIgnoreByKey(key) {
      const want = !IGNORE_CONFIG[key];
      if (want) IGNORE_CONFIG[key] = true;
      else delete IGNORE_CONFIG[key];
      saveIgnoreConfig(function () { if (want) IGNORE_CONFIG[key] = true; else delete IGNORE_CONFIG[key]; });
      renderAfterIgnoreChange();
    }
    function exportIgnoreConfig() {
      const grouped = flatToGrouped(IGNORE_CONFIG);
      const blob = new Blob([JSON.stringify(grouped, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'ignore-config-by-platform.json';
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    }

    function esc(s) {
      return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }
    function fallbackCopyText(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () { fallbackCopyText(text); });
      } else {
        fallbackCopyText(text);
      }
    }

    function currentItem() {
      return DATA.items.find(it => it.tradeId === state.itemId) || DATA.items[0] || null;
    }

    async function selectItem(id) {
      state.itemId = id;
      state.rowId = -1;
      state.page = 1;
      state.channel = 'ALL';
      state.source = 'ALL';
      state.colFilter = { channel: 'ALL', source: 'ALL', field: '', userTag: 'ALL', eoEl: '', aoEl: '', eoCvtEl: '', aoCvtEl: '', vdtEl: '', type: 'ALL', ctxs: '', eoUnconverted: '', eo: '', aoUnconverted: '', ao: '', result: 'ALL', remarks: '' };
      state.sort = { key: '', dir: 1 };
      state.msgSort = { key: '', dir: 1 };
      state.msgFilter = {};
      state.specialFilter = { eo: 'ALL', ao: 'ALL' };
      state.search = '';
      document.getElementById('search').value = '';
      if (isMultiMode()) await ensureItemLoaded(id);
      render();
      if (SIDEBAR_MODE === 'combined') {
        const all = state._sidebarAll || [];
        const idx = all.findIndex(function (it) { return it.tradeId === id; });
        if (idx >= 0) {
          const listEl = document.getElementById('sidebarList');
          const rowH = SIDEBAR_ROW_H;
          listEl.scrollTop = Math.max(0, idx * rowH - listEl.clientHeight / 2 + rowH / 2);
          renderSidebarVirtual(all);
        }
      } else {
        const el = document.querySelector('#sidebarList .item[data-id="' + id + '"]');
        if (el) el.scrollIntoView({ block: 'nearest' });
      }
    }

    function moveItem(dir) {
      const all = (state._sidebarAll && state._sidebarAll.length) ? state._sidebarAll : filteredItems();
      if (!all.length) return;
      const idx = all.findIndex(function (it) { return it.tradeId === state.itemId; });
      const next = idx === -1 ? 0 : Math.min(all.length - 1, Math.max(0, idx + dir));
      if (all[next] && all[next].tradeId !== state.itemId) selectItem(all[next].tradeId);
    }

    function highlight(text, q) {
      const s = esc(text);
      const query = (q || '').trim();
      if (!query) return s;
      const lower = text.toLowerCase();
      const ql = query.toLowerCase();
      let out = '';
      let i = 0;
      while (i < text.length) {
        const idx = lower.indexOf(ql, i);
        if (idx === -1) { out += esc(text.slice(i)); break; }
        out += esc(text.slice(i, idx)) + '<mark>' + esc(text.slice(idx, idx + ql.length)) + '</mark>';
        i = idx + ql.length;
      }
      return out;
    }

    function scopeChannels() {
      const it = currentItem();
      if (!it) return [];
      if (state.channel === 'ALL') return it.channels.filter(function (c) { return it.enabledChannels.indexOf(c.name) !== -1; });
      if (it.enabledChannels.indexOf(state.channel) === -1) return [];
      return it.channels.filter(function (c) { return c.name === state.channel; });
    }

    function isFieldColVisible(c) {
      // 被配置禁用（columns.selector[key] === false）的列一律不渲染：
      // 它不会出现在「列选择」菜单里，若仍按历史预置 / 深链接渲染就会变成无法关闭的列。
      return !!state.columns[c.key] && isColSelectable(c);
    }

    function itemStatsAll(item) {
      // 多文件模式下未按需加载的 item 只有清单里的预计算 summary（字段可能缺失 -> 归一为 0）。
      if (isMultiMode() && item && !Array.isArray(item.channels)) return normalizeItemSummary(item.summary);
      let total = 0, passed = 0, failed = 0;
      item.channels.forEach(ch => ch.sources.forEach(s => s.fields.forEach(f => {
        total++;
        f.result === 'PASSED' ? passed++ : failed++;
      })));
      let warnings = 0, warningsIgnored = 0;
      (item.warnings || []).forEach(w => { if (msgIsIgnored('warnings', enrichMsg(w))) warningsIgnored++; else warnings++; });
      const errors = (item.errors || []).length;
      const uncompared = (item.uncompared || []).length;
      const logs = (item.logs || []).length;
      return { total: total, passed: passed, failed: failed, rate: total ? Math.round(passed / total * 100) : 0, warnings: warnings, warningsIgnored: warningsIgnored, errors: errors, uncompared: uncompared, logs: logs };
    }

    // platform 跟随 item：计算忽略 key 时从当前 item 注入（source 条目自带，可能为空）。
    function sourceMatches(name) { return !state.source || state.source === 'ALL' || name === state.source; }
    function enrichMsg(m) {
      const it = currentItem();
      return Object.assign({}, m, { platform: it ? it.platform : '' });
    }
    function scopeWarnings() {
      const it = currentItem();
      if (!it) return [];
      const names = scopeChannels().map(function (c) { return c.name; });
      return (it.warnings || []).map(function (w, i) { return Object.assign({}, w, { _idx: i }); })
        .filter(function (w) { return names.indexOf(w.channel) !== -1 && sourceMatches(w.source); }).map(enrichMsg);
    }
    function scopeErrors() {
      const it = currentItem();
      if (!it) return [];
      const names = scopeChannels().map(function (c) { return c.name; });
      return (it.errors || []).map(function (e, i) { return Object.assign({}, e, { _idx: i }); })
        .filter(function (e) { return names.indexOf(e.channel) !== -1 && sourceMatches(e.source); });
    }
    function scopeUncompared() {
      const it = currentItem();
      if (!it) return [];
      const names = scopeChannels().map(function (c) { return c.name; });
      return (it.uncompared || []).map(function (u, i) { return Object.assign({}, u, { _idx: i }); })
        .filter(function (u) {
          const chOk = u.channel == null || names.indexOf(u.channel) !== -1;
          return chOk && sourceMatches(u.source);
        }).map(enrichMsg);
    }
    function scopeSkippedItems() {
      const list = DATA.skippedItems || [];
      return list.map(function (s, i) { return Object.assign({}, s, { _idx: i }); }).filter(function (s) {
        const chOk = state.channel === 'ALL' || s.channel == null || s.channel === state.channel;
        return chOk && sourceMatches(s.source);
      });
    }
    function scopeLogs() {
      const it = currentItem();
      if (!it) return [];
      const logs = it.logs || [];
      return logs.filter(function (l) {
        const chOk = state.channel === 'ALL' || l.channel === state.channel;
        return chOk && sourceMatches(l.source);
      });
    }

    function scopeStats() {
      let total = 0, passed = 0, failed = 0;
      scopeChannels().forEach(ch => ch.sources.forEach(s => {
        if (!sourceMatches(s.name)) return;
        s.fields.forEach(f => {
          total++;
          f.result === 'PASSED' ? passed++ : failed++;
        });
      }));
      return {
        total: total, passed: passed, failed: failed,
        rate: total ? Math.round(passed / total * 100) : 0,
        warnings: scopeWarnings().filter(m => !msgIsIgnored('warnings', m)).length,
        warningsIgnored: scopeWarnings().filter(m => msgIsIgnored('warnings', m)).length,
        errors: scopeErrors().length,
        uncompared: scopeUncompared().filter(u => !msgIsIgnored('uncompared', u)).length,
        uncomparedIgnored: scopeUncompared().filter(u => msgIsIgnored('uncompared', u)).length,
        logs: scopeLogs().length,
        skipped: scopeSkippedItems().length,
      };
    }

    function filteredFields(item) {
      let rows = flatFields(item, searchTagLabels()).map(function (r, i) { r._idx = i; return r; });
      if (state.channel !== 'ALL') rows = rows.filter(r => r.channel === state.channel);
      if (state.source && state.source !== 'ALL') rows = rows.filter(r => r.source === state.source);
      COLUMNS.forEach(c => {
        const v = state.colFilter[c.key];
        if (!v || v === 'ALL') return;
        if (c.filterable === 'select') {
          rows = rows.filter(r => sortValue(r, c.key) === v);
        } else if (c.filterable === 'text') {
          rows = rows.filter(r => String(sortValue(r, c.key)).toLowerCase().includes(v.toLowerCase()));
        }
      });
      ['eo', 'ao'].forEach(function (col) {
        const sv = state.specialFilter[col];
        if (sv && sv !== 'ALL') rows = rows.filter(function (r) { return specialValueMatch(sortValue(r, col), sv); });
      });
      if (state.search.trim()) {
        const pq = parseSearchQuery(state.search);
        const matcher = makeMatcher(pq);
        if (matcher) rows = rows.filter(function (r) { return matchRow(r, pq, matcher); });
      }
      if (state.sort.key) {
        const k = state.sort.key, d = state.sort.dir;
        rows.sort((a, b) => { const va = sortValue(a, k), vb = sortValue(b, k); if (va < vb) return -1 * d; if (va > vb) return 1 * d; return 0; });
      }
      return rows;
    }

    function preview(v) {
      const s = String(v).replace(/\r?\n/g, ' ⏎ ');
      return s.length > 32 ? s.slice(0, 32) + '…' : s;
    }

    function typeLabel(type) {
      const map = { platformAssertion: 'typePlatform', productAssertion: 'typeProduct', contextAssertion: 'typeContext' };
      return t(map[type] || type);
    }
    function typeChip(type) {
      const m = TYPE_META[type] || { cls: '' };
      return '<span class="chip ' + m.cls + '">' + esc(typeLabel(type)) + '</span>';
    }
    function userTagLabel(v) {
      if (!v) return '';
      if (USER_TAG_RAW) return String(v);
      const s = locText(USER_TAG_LABELS[v]);
      return s != null ? s : typeLabel(v);
    }
    function userTagHTML(v) {
      if (!v) return '—';
      if (USER_TAG_RAW) return esc(String(v));
      const m = TYPE_META[v] || { cls: '' };
      return '<span class="chip ' + m.cls + '">' + esc(userTagLabel(v)) + '</span>';
    }

    function errorTypeLabel(type) {
      const m = ERROR_TYPE_META[type];
      return t(m ? m.label : type);
    }
    function errorTypeChip(type) {
      const m = ERROR_TYPE_META[type] || { cls: 'er-buffer' };
      return '<span class="chip ' + m.cls + '">' + esc(errorTypeLabel(type)) + '</span>';
    }

    const VALUE_TYPE_KEYS = { id: 'vtId', num: 'vtNum', date: 'vtDate', code: 'vtCode', product: 'vtProduct', text: 'vtText', multi: 'vtMulti' };
    function valueTypeLabel(k) { return t(VALUE_TYPE_KEYS[k] || k); }

    function sortArrow(key) {
      if (state.sort.key !== key) return '⇅';
      return state.sort.dir === 1 ? '▲' : '▼';
    }

    // 字段定位：channel.fields 为 report channel 级字段注册表；比较字段用 (channel, source, id) 三元组唯一定位。
    function fieldLocKey(channel, source, id) { return channel + '\u0001' + source + '\u0001' + id; }
    function parseFieldLoc(key) {
      const p = String(key || '').split('\u0001');
      return { channel: p[0] || '', source: p[1] || '', id: p[2] || '' };
    }
    function findField(item, channel, source, id) {
      const ch = (item.channels || []).find(function (c) { return c.name === channel; });
      if (!ch) return null;
      const s = (ch.sources || []).find(function (x) { return x.name === source; });
      if (!s) return null;
      const f = (s.fields || []).find(function (x) { return x.id === id; });
      return f ? { channel: ch.name, source: s.name, field: f, ch: ch } : null;
    }
    function fieldDef(channel, id) {
      const arr = (channel && channel.fields) || [];
      for (let i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
      return null;
    }

    /* ---- 渲染 ---- */
    function filteredItems() {
      const q = state.itemSearch.trim().toLowerCase();
      const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
      const list = DATA.items.filter(it => {
        const s = itemStatsAll(it);
        const hay = (it.tradeId + ' ' + it.reportDate + ' ' + it.platform + ' ' + it.product).toLowerCase();
        if (tokens.length && !tokens.every(t => hay.includes(t))) return false;
        if (state.reportDateFilter && it.reportDate !== state.reportDateFilter) return false;
        if (state.itemFilter === 'PASSED' && s.failed !== 0) return false;
        if (state.itemFilter === 'FAILED' && s.failed === 0) return false;
        if (state.itemFilter === 'WARN' && s.warnings === 0) return false;
        if (state.itemPlatforms.length && state.itemPlatforms.indexOf(it.platform) === -1) return false;
        if (state.itemProducts.length && state.itemProducts.indexOf(it.product) === -1) return false;
        if (state.itemTradeIds.length && state.itemTradeIds.indexOf(it.platformTradeId) === -1) return false;
        return true;
      });
      list.sort(function (a, b) { return b.reportDate.localeCompare(a.reportDate); });
      return list;
    }

    function sidebarSig() {
      return [state.itemSearch, state.reportDateFilter, state.itemFilter, state.itemPlatforms.join(','), state.itemProducts.join(','), state.itemTradeIds.join(',')].join('|');
    }

    function sidebarItemHTML(it, q) {
      const s = itemStatsAll(it);
      const cls = it.tradeId === state.itemId ? 'item active' : 'item';
      const isSample = currentCreationType() === 'sample';
      const barCls = 'bar-fill' + (APP_PROGRESS_STYLE === 'status' && s.failed === 0 && s.warnings > 0 ? ' bar-warn' : '');
      const warnNote = s.warnings > 0 ? ' · ' + s.warnings + ' ' + t('sidebarUnconfirmedWarnings') : '';
      const barTitle = t('passRate') + ' ' + s.rate + '% · ' + t('passed') + ' ' + s.passed + ' / ' + t('failed') + ' ' + s.failed + (s.warnings ? ' · ' + t('warnings') + ' ' + s.warnings : '');
      return '<div class="' + cls + '" data-id="' + it.tradeId + '" tabindex="0">' +
        '<div class="item-id">' + highlight(it.tradeId, q) + (isSample ? '<span class="item-sample-badge">Sample</span>' : '') + '</div>' +
        '<div class="item-sub">' + s.total + ' ' + t('sidebarFields') + ' · <span class="num-fail">' + s.failed + '</span> ' + t('sidebarFailures') + ' · <span class="num-pass">' + s.rate + '%</span> ' + t('sidebarPassRate') + warnNote + '</div>' +
        '<div class="item-sub">' + t('sidebarReportDate') + ' ' + esc(it.reportDate) + '</div>' +
        '<div class="item-sub">' + esc(it.platform) + ' · ' + esc(it.productCategory) + ' · ' + esc(it.product) + '</div>' +
        '<div class="bar" title="' + esc(barTitle) + '"><div class="' + barCls + '" style="width:' + s.rate + '%"></div></div>' +
        '</div>';
    }

    // 侧栏头「上一个 / 下一个 Item」箭头：位于标题与统计数字之间，简约样式（类分页箭头），默认隐藏、悬停显示。
    // 落在筛选后列表的首/末项时，对应方向置灰。
    function itemNavHTML() {
      const all = (state._sidebarAll && state._sidebarAll.length) ? state._sidebarAll : filteredItems();
      const idx = all.findIndex(function (it) { return it.tradeId === state.itemId; });
      const atFirst = all.length <= 1 || idx === 0;
      const atLast = all.length <= 1 || (idx >= 0 && idx >= all.length - 1);
      return '<button class="item-nav" data-item-nav="-1" title="' + t('prevItem') + '" aria-label="' + t('prevItem') + '"' + (atFirst ? ' disabled' : '') + '>‹</button>' +
        '<button class="item-nav" data-item-nav="1" title="' + t('nextItem') + '" aria-label="' + t('nextItem') + '"' + (atLast ? ' disabled' : '') + '>›</button>';
    }

    function pagerHTML(p, pages) {
      const from = Math.max(1, p - 1), to = Math.min(pages, p + 1);
      let parts = [];
      if (pages > 3) parts.push('<button class="pg" data-sidepage="1"' + (p === 1 ? ' disabled' : '') + ' title="' + t('pageFirst') + '">«</button>');
      parts.push('<button class="pg" data-sidepage="' + (p - 1) + '"' + (p === 1 ? ' disabled' : '') + ' title="' + t('pagePrev') + '">‹</button>');
      for (let i = from; i <= to; i++) parts.push('<button class="pg' + (i === p ? ' cur' : '') + '" data-sidepage="' + i + '">' + i + '</button>');
      parts.push('<button class="pg" data-sidepage="' + (p + 1) + '"' + (p === pages ? ' disabled' : '') + ' title="' + t('pageNext') + '">›</button>');
      if (pages > 3) parts.push('<button class="pg" data-sidepage="' + pages + '"' + (p === pages ? ' disabled' : '') + ' title="' + t('pageLast') + '">»</button>');
      return parts.join('') + '<span class="pg-info">' + p + '/' + pages + '</span>';
    }

    function layoutSidebarList() {
      const list = document.getElementById('sidebarList');
      if (!list) return;
      if (window.innerWidth <= 920) { list.style.top = ''; list.style.bottom = ''; return; }
      const chips = document.getElementById('sidebarChips');
      const chipCount = document.getElementById('sidebarMatchCount');
      const pager = document.getElementById('sidebarPager');
      const topEl = (chips && chips.offsetHeight) ? chips : document.querySelector('.sidebar-filters');
      let top = topEl ? topEl.offsetTop + topEl.offsetHeight : 0;
      // 标签下方的「匹配 N 项」小字也占高度，需一并计入，否则首个 item 会被它遮挡。
      if (chipCount && chipCount.offsetHeight) top = Math.max(top, chipCount.offsetTop + chipCount.offsetHeight);
      const bottom = pager ? pager.offsetHeight : 0;
      list.style.top = top + 'px';
      list.style.bottom = bottom + 'px';
    }

    function renderSidebarVirtual(all) {
      const listEl = document.getElementById('sidebarList');
      if (!all.length) {
        listEl.innerHTML = '<div class="empty">' + t('sidebarEmpty') + '</div>';
        document.getElementById('sidebarPager').innerHTML = '';
        layoutSidebarList();
        return;
      }
      const rowH = SIDEBAR_ROW_H;
      const pageSize = state.sidebarPageSize;
      const pages = Math.max(1, Math.ceil(all.length / pageSize));
      const stride = pageSize * rowH;
      const pagerEl = document.getElementById('sidebarPager');
      // 由滚动位置推导当前页（视口顶部所在的分页块）。
      const pageFromScroll = Math.min(pages, Math.max(1, Math.floor(listEl.scrollTop / stride) + 1));
      pagerEl.innerHTML = pagerHTML(pageFromScroll, pages);
      layoutSidebarList();
      const viewH = listEl.clientHeight || 400;
      const overscan = 3;
      const scrollTop = listEl.scrollTop;
      const totalH = all.length * rowH;
      // 视口高度通常大于 pageSize*rowH，最后一页的起始偏移被滚动上限裁剪（永远到不了），
      // 仅用 scrollTop/stride 推导会卡在倒数第二页；因此单独判定「已滚动到底部」直接指示最后一页。
      const maxScroll = Math.max(0, totalH - viewH);
      const atBottom = maxScroll > 0 && scrollTop >= maxScroll - 1;
      const page = atBottom ? pages : pageFromScroll;
      if (page !== pageFromScroll) pagerEl.innerHTML = pagerHTML(page, pages);
      // 同步分页状态（深链接 sp= 与「上一个/下一个」推算均以它为准）。
      state.sidebarPage = page;
      const visible = Math.ceil(viewH / rowH) + overscan * 2;
      let first = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
      let last = Math.min(all.length, first + visible);
      if (last - first < visible) first = Math.max(0, last - visible);
      const q = state.itemSearch.trim();
      const topPad = first * rowH;
      const slice = all.slice(first, last);
      const rows = slice.map(function (it) { return sidebarItemHTML(it, q); }).join('');
      listEl.innerHTML =
        '<div style="height:' + topPad + 'px"></div>' + rows +
        '<div style="height:' + Math.max(0, totalH - topPad - slice.length * rowH) + 'px"></div>';
    }

    function renderSidebar() {
      const all = filteredItems();
      const sig = sidebarSig();
      if (SIDEBAR_MODE === 'combined' && state._sidebarSig !== sig) {
        state._sidebarSig = sig;
        document.getElementById('sidebarList').scrollTop = 0;
      }
      state._sidebarAll = all;
      let passedItems = 0, failedItems = 0;
      all.forEach(function (it) { if (itemStatsAll(it).failed === 0) passedItems++; else failedItems++; });
      const pct = all.length ? Math.round(passedItems / all.length * 100) : 0;
      const itemCountEl = document.getElementById('itemCount');
      itemCountEl.innerHTML = '<span class="num-pass">' + passedItems + '</span>/<span class="num-fail">' + failedItems + '</span>/<span class="num-pass">' + pct + '%</span>';
      itemCountEl.title = t('passed') + ' ' + passedItems + ' / ' + t('failed') + ' ' + failedItems + ' / ' + t('passRate') + ' ' + pct + '%';
      const itemNavEl = document.getElementById('itemNav');
      if (itemNavEl) itemNavEl.innerHTML = itemNavHTML();
      updateReportDateHint();
      syncHash();
      if (SIDEBAR_MODE === 'combined') {
        renderSidebarVirtual(all);
        return;
      }
      const q = state.itemSearch.trim();
      let pages = 1, list;
      if (SIDEBAR_MODE === 'lazy') {
        const limit = state.sidebarPage * state.sidebarPageSize;
        list = all.slice(0, limit);
      } else {
        pages = Math.max(1, Math.ceil(all.length / state.sidebarPageSize));
        if (state.sidebarPage > pages) state.sidebarPage = pages;
        const start = (state.sidebarPage - 1) * state.sidebarPageSize;
        list = all.slice(start, start + state.sidebarPageSize);
      }
      document.getElementById('sidebarList').innerHTML = all.length
        ? list.map(function (it) { return sidebarItemHTML(it, q); }).join('')
        : '<div class="empty">' + t('sidebarEmpty') + '</div>';
      let footerHtml = '';
      if (SIDEBAR_MODE === 'lazy') {
        const limit = state.sidebarPage * state.sidebarPageSize;
        if (all.length > limit) {
          footerHtml = '<button class="load-more" data-loadmore="1">' + t('loadMore') + '（' + (all.length - limit) + '）</button>';
        } else if (all.length > state.sidebarPageSize) {
          footerHtml = '<span class="pg-info">' + t('allLoaded') + ' · ' + all.length + '</span>';
        }
      } else if (all.length > 0) {
        footerHtml = pagerHTML(state.sidebarPage, pages);
      }
      document.getElementById('sidebarPager').innerHTML = footerHtml;
      layoutSidebarList();
    }

    function renderSidebarChips() {
      const chips = [];
      // 报告日期：与其它侧栏筛选一样以标签形式展示（此前只写在输入框里，选中后无标签、无法一键移除）。
      if (state.reportDateFilter) {
        chips.push({
          label: t('sidebarReportDate') + ': ' + state.reportDateFilter,
          clear: function () {
            state.reportDateFilter = '';
            const input = document.getElementById('reportDateFilter');
            if (input) { input.value = ''; input.parentElement.classList.remove('has-value'); }
          },
        });
      }
      if (state.itemFilter !== 'ALL') {
        chips.push({
          label: t('statusChipLabel') + (state.itemFilter === 'PASSED' ? t('sidebarStatusPassed') : (state.itemFilter === 'WARN' ? t('sidebarStatusWarn') : t('sidebarStatusFailed'))),
          clear: function () { state.itemFilter = 'ALL'; document.getElementById('itemFilter').value = 'ALL'; },
        });
      }
      state.itemPlatforms.forEach(function (v) {
        chips.push({
          label: t('platformChip') + v,
          clear: function () { const i = state.itemPlatforms.indexOf(v); if (i !== -1) state.itemPlatforms.splice(i, 1); },
        });
      });
      state.itemProducts.forEach(function (v) {
        const it = DATA.items.find(function (x) { return x.product === v; });
        const catLabel = it && it.productCategory ? productCategoryLabel(it.productCategory) : '';
        chips.push({
          label: t('productChip') + (catLabel ? catLabel + ' / ' : '') + v,
          clear: function () { const i = state.itemProducts.indexOf(v); if (i !== -1) state.itemProducts.splice(i, 1); },
        });
      });
      state.itemTradeIds.forEach(function (v) {
        chips.push({
          label: t('sidebarTradeId') + ': ' + v,
          clear: function () { const i = state.itemTradeIds.indexOf(v); if (i !== -1) state.itemTradeIds.splice(i, 1); },
        });
      });
      SIDEBAR_FILTERS = chips;
      // 标签数 > 1 时提供「清除全部」，统一清除 Item 列表的筛选状态。
      const clearAll = chips.length > 1
        ? '<button class="filter-clear-all" data-side-clear-all="1" title="' + t('clearAllFilters') + '">' + t('clearAllFilters') + '</button>'
        : '';
      document.getElementById('sidebarChips').innerHTML = chips.map((c, i) =>
        '<span class="filter-chip">' + esc(c.label) + '<button data-sideclear="' + i + '" title="' + t('filterClearThis') + '">✕</button></span>'
      ).join('') + clearAll;
      document.getElementById('platformFilterBtn').classList.toggle('has-filter', state.itemPlatforms.length > 0);
      document.getElementById('productFilterBtn').classList.toggle('has-filter', state.itemProducts.length > 0);
      document.getElementById('tradeIdFilterBtn').classList.toggle('has-filter', state.itemTradeIds.length > 0);
      renderChipMatchCount('sidebarMatchCount', chips.length, filteredItems().length);
      // 标签区高度变化会影响列表起始位置：必须在写入标签后重新布局，
      // 否则新增/移除标签时 #sidebarList 的 top 会沿用过时高度，首个 item 被标签遮挡。
      layoutSidebarList();
    }

    // 清除全部 Item 列表筛选标签（报告日期 / 状态 / 平台 / 产品 / TradeId）并重置分页。
    function clearAllSidebarFilters() {
      state.reportDateFilter = '';
      state.itemFilter = 'ALL';
      state.itemPlatforms = [];
      state.itemProducts = [];
      state.itemTradeIds = [];
      state.sidebarPage = 1;
      const f = document.getElementById('itemFilter');
      if (f) f.value = 'ALL';
      const d = document.getElementById('reportDateFilter');
      if (d) { d.value = ''; d.parentElement.classList.remove('has-value'); }
      renderSidebar();
      renderSidebarChips();
    }

    function syncMiniSummary() {
      const backTop = document.getElementById('backTop');
      if (backTop) backTop.classList.toggle('show', window.scrollY > 420);
      const s = document.getElementById('summary');
      const mini = document.getElementById('miniSummary');
      if (!s || !mini) return;
      const tb = document.querySelector('.topbar');
      const tbH = tb ? tb.offsetHeight : 0;
      let shouldShow;
      if (document.body.classList.contains('top-collapsed')) {
        shouldShow = window.scrollY >= tbH + 4;
      } else {
        shouldShow = s.getBoundingClientRect().bottom < 0;
      }
      mini.classList.toggle('show', shouldShow);
    }

    function updateMiniSummary(s) {
      const el = document.getElementById('miniSummary');
      if (!el) return;
      el.innerHTML =
        '<span class="ms-item">' + t('passRate') + ' <b class="ok">' + s.rate + '%</b></span>' +
        '<span class="ms-item">' + t('failed') + ' <b class="bad">' + s.failed + '</b></span>' +
        '<span class="ms-item">' + t('warnings') + ' <b class="warn">' + s.warnings + '/<span class="num-muted">' + s.warningsIgnored + '</span></b></span>';
    }

    function renderSummary() {
      if (!DATA.items.length) {
        document.getElementById('summary').innerHTML = '<div class="empty-hint">' + t('emptyDataTitle') + '</div>';
        updateMiniSummary({ rate: 0, failed: 0, warnings: 0, warningsIgnored: 0 });
        return;
      }
      const s = scopeStats();
      const cards = [
        { label: t('fieldsTotal'), value: s.total, cls: '', action: 'fields', active: state.tab === 'fields' && state.colFilter.result === 'ALL', tip: t('tipFields') },
        { label: t('passed'), value: s.passed, cls: 'ok', action: 'passed', active: state.tab === 'fields' && state.colFilter.result === 'PASSED', tip: t('tipPassed') },
        { label: t('failed'), value: s.failed, cls: 'bad', action: 'failed', active: state.tab === 'fields' && state.colFilter.result === 'FAILED', tip: t('tipFailed') },
        { label: t('passRate'), value: s.rate + '%', cls: '', action: 'rate', active: false, tip: t('tipRate') },
        { label: t('warnings'), value: s.warnings + '/<span class="num-muted">' + s.warningsIgnored + '</span>', cls: 'warn', action: 'warnings', active: state.tab === 'warnings', tip: t('tipWarnings') },
        { label: t('errors'), value: s.errors, cls: 'bad', action: 'errors', active: state.tab === 'errors', tip: t('tipErrors') },
      ];
      document.getElementById('summary').innerHTML = cards.map(c => {
        const cls = 'card' + (c.action ? ' clickable' : '') + (c.active ? ' active-filter' : '');
        const attr = (c.action ? ' data-action="' + c.action + '"' : '') + (c.tip ? ' title="' + esc(c.tip) + '"' : '');
        return '<div class="' + cls + '"' + attr + '>' +
          '<div class="card-label">' + c.label + '</div>' +
          '<div class="card-value ' + c.cls + '">' + c.value + '</div></div>';
      }).join('');
      updateMiniSummary(s);
    }

    function renderMeta() {
      const it = currentItem();
      // 悬停即弹出关联属性浮层，故用 aria-label 代替原生 title（避免系统提示盖住浮层）。
      document.getElementById('itemMeta').innerHTML = '<a class="item-meta-link" data-item-info="1" aria-label="' + esc(t('viewItemAttrs')) + '">' + esc(it.tradeId) + '</a>';
      document.getElementById('reportMeta').textContent = t('reportDateLabel') + it.reportDate + '　　' + t('generatedAtLabel') + it.generatedAt;
      document.getElementById('channelMeta').textContent = t('channelMetaLabel') +
        it.channels.map(c => c.name + '（' + channelDesc(c.name) + '）').join('　');
    }

    // item 关联属性浮层：鼠标悬停（而非点击）展示，首行为带标签与复制按钮的 Item ID。
    let ITEM_INFO_HIDE_TIMER = null;
    function scheduleItemInfoHide() {
      clearTimeout(ITEM_INFO_HIDE_TIMER);
      ITEM_INFO_HIDE_TIMER = setTimeout(function () {
        const el = POPOVER.el;
        // 鼠标已移到浮层内（便于点击复制按钮）时保持展开。
        if (el && el.__itemInfoHover) return;
        closePopover();
      }, 200);
    }
    function openItemInfoPopover(anchor, item) {
      if (anchor.classList.contains('active')) { closePopover(); return; }
      const cpId = item.counterpartyItemId;
      const cpInData = !!cpId && DATA.items.some(function (x) { return x.tradeId === cpId; });
      const cp = cpInData
        ? '<a class="cp-link" data-cp-item="' + esc(cpId) + '" title="' + t('jumpToItem') + '">' + esc(cpId) + '</a>'
        : (cpId
          ? '<span class="cp-link cp-static" data-cp-missing="1" title="' + t('counterpartyNotInDataTip') + '">' + esc(cpId) + '</span>'
          : '<span class="num-muted">' + t('counterpartyNone') + '</span>');
      const cpNote = (!cpInData && cpId)
        ? '<div class="cp-static-note" data-cp-missing="1"></div>'
        : '';
      const copyBtn = function (v) {
        return v ? '<button class="copy-btn" data-copy="' + esc(v) + '" title="' + t('copyValue') + '" aria-label="' + t('copyValue') + '">⧉</button>' : '';
      };
      const html =
        '<div class="item-info-row"><span class="iir-label">' + t('itemIdLabel') + '</span><span class="mono">' + esc(item.tradeId) + '</span>' + copyBtn(item.tradeId) + '</div>' +
        '<div class="item-info-row"><span class="iir-label">' + t('counterpartyLabel') + '</span>' + cp + copyBtn(item.counterpartyItemId) + '</div>' +
        cpNote +
        '<div class="item-info-row"><span class="iir-label">' + t('platformTradeIdLabel') + '</span><span class="mono">' + esc(item.platformTradeId || t('counterpartyNone')) + '</span>' + copyBtn(item.platformTradeId) + '</div>' +
        '<div class="item-info-row"><span class="iir-label">' + t('platformDealIdLabel') + '</span><span class="mono">' + esc(item.platformDealId || t('counterpartyNone')) + '</span>' + copyBtn(item.platformDealId) + '</div>';
      const pop = openPopover(anchor, html, '', 340);
      // 鼠标进入浮层时保持展开，移出后延迟收起。
      pop.addEventListener('mouseover', function () { pop.__itemInfoHover = true; clearTimeout(ITEM_INFO_HIDE_TIMER); });
      pop.addEventListener('mouseout', function (e) {
        if (e.relatedTarget && pop.contains(e.relatedTarget)) return;
        pop.__itemInfoHover = false;
        scheduleItemInfoHide();
      });
      pop.addEventListener('click', function (e) {
        const cb = e.target.closest('.copy-btn');
        if (cb) {
          copyText(cb.getAttribute('data-copy'));
          cb.classList.add('copied');
          setTimeout(function () { cb.classList.remove('copied'); }, 1200);
          return;
        }
        const miss = e.target.closest('[data-cp-missing]');
        if (miss) {
          const note = pop.querySelector('.cp-static-note');
          if (note) {
            const old = note.textContent;
            note.textContent = t('counterpartyNotInDataTip');
            note.classList.add('cp-note-flash');
            clearTimeout(note._cpT);
            note._cpT = setTimeout(function () {
              note.textContent = old;
              note.classList.remove('cp-note-flash');
            }, 2200);
          }
          return;
        }
        const a = e.target.closest('[data-cp-item]');
        if (!a) return;
        const id = a.getAttribute('data-cp-item');
        closePopover();
        if (DATA.items.some(function (x) { return x.tradeId === id; })) selectItem(id);
      });
    }

    function fileEntryName(v) {
      if (v && typeof v === 'object') return v.name != null ? String(v.name) : '';
      return String(v == null ? '' : v);
    }
    function fileEntryPath(v) {
      if (v && typeof v === 'object') return v.path != null ? String(v.path) : '';
      return '';
    }
    function fileLinkHTML(v) {
      const name = fileEntryName(v);
      const path = fileEntryPath(v);
      if (path) return '<a class="file-link" href="' + esc(path) + '" target="_blank" rel="noopener" title="' + esc(path) + '">' + esc(name) + '</a>';
      return '<span class="file-name" title="' + esc(name) + '">' + esc(name) + '</span>';
    }

    function renderReportCats() {
      const cat = state.reportCat;
      document.getElementById('reportInfo').style.display = cat ? 'block' : 'none';
      document.getElementById('paneCharts').hidden = cat !== 'charts';
      document.getElementById('paneFiles').hidden = cat !== 'files';
      document.getElementById('paneNote').hidden = cat !== 'note';
      document.querySelectorAll('.report-cat').forEach(function (b) {
        b.classList.toggle('active', b.getAttribute('data-cat') === cat);
      });
    }

    function renderFiles() {
      const it = currentItem();
      const chs = state.channel === 'ALL' ? it.channels : it.channels.filter(c => c.name === state.channel);
      const stripColon = function (s) { return String(s || '').replace(/\s*[:：]\s*$/, ''); };
      const fileRowHTML = function (tag, cls, tip, v, meta) {
        return '<div class="file-row">' +
          '<span class="ftag ' + cls + '" title="' + esc(tip) + '">' + tag + '</span>' +
          fileLinkHTML(v) +
          (meta ? '<span class="file-meta">' + esc(meta) + '</span>' : '') +
          '</div>';
      };
      const html = chs.map(function (ch) {
        const eoRows = ((ch.files && ch.files.eo) || []).map(function (v) { return fileRowHTML('EO', 'ftag-eo', stripColon(t('filesEO')), v); }).join('');
        const aoTip = stripColon(ch.format === 'csv' ? t('filesAOCsv') : t('filesAO'));
        const aoRows = ((ch.files && ch.files.ao) || []).map(function (v) { return fileRowHTML('AO', 'ftag-ao', aoTip, v); }).join('');
        const xl = (ch.files && ch.files.excel) || {};
        const xlRow = fileRowHTML('XL', 'ftag-xl', stripColon(t('filesExcel')), { name: xl.file, path: xl.path }, 'sheet: ' + (xl.sheet || ''));
        return '<div class="file-card">' +
          '<div class="fc-head">' + esc(ch.name) + '</div>' +
          '<div class="fc-body">' + eoRows + aoRows + xlRow + '</div>' +
          '</div>';
      }).join('');
      document.getElementById('filesPanel').innerHTML =
        '<div class="files-title">' + t('filesTitle') + '</div>' +
        '<div class="files-grid">' + html + '</div>';
    }

    function renderTaskNote() {
      const desc = (BATCH_STATE.active && typeof BATCH_STATE.active.description === 'string' && BATCH_STATE.active.description.trim())
        ? BATCH_STATE.active.description
        : TASK_NOTE;
      document.getElementById('taskNote').innerHTML =
        '<div class="task-note-title">' + t('taskNoteTitle') + '</div>' +
        '<div class="task-note-text">' + esc(desc).replace(/\n/g, '<br>') + '</div>' +
        (APP_FEATURES.descriptionEx ? '<div class="task-note-descex" id="taskNoteDescEx"></div>' : '');
      ensureDescriptionEx();
    }

    /* ---------- 任务说明扩展内容（batch-meta.json 的 descriptionEx，只读） ----------
     * 数据通路：索引只带 batch-meta.json 的路径（metaUrl），内容在打开「任务说明」时懒加载
     * （fetchJSONCached：ETag + IndexedDB，重复打开不再下载）；内容不进 batches-index.json。
     * 只读：POST /api/batch 的白名单不含 descriptionEx；批次详情/描述编辑均不涉及它。
     * 扩展点：新增 contentType 时在 core.js 加解析纯函数，再在下面的注册表登记一个渲染器。 */
    let DESC_EX_STATE = {
      seq: 0,            // 加载代次：批次切换后丢弃过期响应
      batchId: '',
      status: 'idle',    // idle / loading / ready / empty / error
      ex: null,          // 归一化后的 { contentType, plainContent, truncated }
      parsed: null,      // 渲染器解析结果（表格结构或 null）
      renderer: null,
      note: '',          // 回退/告警说明（i18n 键或已拼接文本）
      page: 1,
      filters: [],       // 表头字段搜索：按列自由输入（AND 组合）
      sort: { col: -1, dir: 1 },
      pagerOpen: false,  // 竖向页码默认收起（由右侧 ▸ 三角展开）
      colWidths: null,   // 列宽（按整表最大内容宽度计算，分页切换时宽度固定）
    };

    function descExPageSize() {
      const n = APP_LIMITS.descExPageSize;
      return (typeof n === 'number' && n > 0) ? Math.floor(n) : 5;
    }

    // 渲染器注册表。parse(raw) -> 渲染所需数据（失败返回 null 走纯文本回退）；
    // render(ctx) -> HTML 字符串（ctx 提供 esc/t/pageSize 等）。
    const DESC_EX_RENDERERS = {
      markdowntable: {
        label: 'markDownTable',
        parse: function (raw) {
          const tb = parseMarkdownTable(raw);
          return (tb && tb.header && tb.header.length) ? tb : null;
        },
        render: renderDescExTableBlock,
      },
      text: {
        label: 'text',
        parse: function () { return null; },
        render: renderDescExTextBlock,
      },
    };

    function descExRenderer(contentType) {
      const key = String(contentType || '').toLowerCase();
      return DESC_EX_RENDERERS[key] || null;
    }

    function descExMetaUrl(b) {
      return (b && typeof b.metaUrl === 'string' && b.metaUrl) ? resolveUrl(indexBaseUrl(), b.metaUrl) : '';
    }

    // 懒加载 + 首帧渲染（renderTaskNote 每次都会调用，靠 batchId/status 去重）。
    function ensureDescriptionEx() {
      const box = document.getElementById('taskNoteDescEx');
      if (!box) return;
      if (!APP_FEATURES.descriptionEx) { box.innerHTML = ''; return; }
      const b = BATCH_STATE.active;
      const url = descExMetaUrl(b);
      if (!b || !url) { box.innerHTML = ''; return; }

      if (DESC_EX_STATE.batchId === b.batchId && DESC_EX_STATE.status !== 'idle') {
        paintDescriptionEx(box);
        return;
      }
      const seq = ++DESC_EX_STATE.seq;
      DESC_EX_STATE = {
        seq: seq, batchId: b.batchId, status: 'loading', ex: null, parsed: null,
        renderer: null, note: '', page: 1, filters: [], sort: { col: -1, dir: 1 },
        pagerOpen: false, colWidths: null,
      };
      box.innerHTML = '<div class="descex-note">' + esc(t('descExLoading')) + '</div>';
      fetchJSONCached(url).then(function (meta) {
        if (DESC_EX_STATE.seq !== seq) return;                 // 批次已切换：丢弃过期响应
        const ex = normalizeDescriptionEx(meta && meta.descriptionEx);
        if (!ex) {
          DESC_EX_STATE.status = 'empty';
        } else {
          const r = descExRenderer(ex.contentType);
          const parsed = r ? r.parse(ex.plainContent) : null;
          if (r && parsed) {
            DESC_EX_STATE.status = 'ready';
            DESC_EX_STATE.ex = ex;
            DESC_EX_STATE.renderer = r;
            DESC_EX_STATE.parsed = parsed;
          } else {
            // 未知 contentType 或解析失败 -> 纯文本回退（永不空白、永不报错）。
            DESC_EX_STATE.status = 'ready';
            DESC_EX_STATE.ex = ex;
            DESC_EX_STATE.renderer = DESC_EX_RENDERERS.text;
            DESC_EX_STATE.parsed = null;
            DESC_EX_STATE.note = r ? t('descExBadTable') : (t('descExUnsupported') + ex.contentType);
          }
        }
        const now = document.getElementById('taskNoteDescEx');
        if (now) paintDescriptionEx(now);
      }).catch(function () {
        if (DESC_EX_STATE.seq !== seq) return;
        DESC_EX_STATE.status = 'error';
        const now = document.getElementById('taskNoteDescEx');
        if (now) paintDescriptionEx(now);
      });
    }

    function paintDescriptionEx(box) {
      const st = DESC_EX_STATE;
      if (!box) return;
      if (st.status === 'loading') { box.innerHTML = '<div class="descex-note">' + esc(t('descExLoading')) + '</div>'; return; }
      if (st.status === 'error') { box.innerHTML = '<div class="descex-note">' + esc(t('descExLoadFail')) + '</div>'; return; }
      if (st.status !== 'ready' || !st.ex) { box.innerHTML = ''; return; }
      const r = st.renderer || DESC_EX_RENDERERS.text;
      const notes = [];
      if (st.note) notes.push(esc(st.note));
      if (st.ex.truncated) notes.push(esc(t('descExTruncated')));
      if (st.parsed && Array.isArray(st.parsed.issues)) {
        st.parsed.issues.forEach(function (is) {
          if (is.kind === 'ragged') notes.push(esc(t('descExRagged')) + '（' + is.count + '）');
          if (is.kind === 'skipped') notes.push(esc(t('descExSkipped')) + '（' + is.count + '）');
        });
      }
      box.innerHTML = r.render({ esc: esc, t: t }) +
        (notes.length ? '<div class="descex-note">' + notes.join(' · ') + '</div>' : '');
      bindDescriptionEx(box);
    }

    // 事件只重绘该块（不触发 render()），避免丢失页码/筛选/排序状态与输入焦点。
    function bindDescriptionEx(box) {
      if (box.__descexBound) return;
      box.__descexBound = true;
      box.addEventListener('click', function (e) {
        const th = e.target.closest('[data-descex-sort]');
        if (th) {
          const col = parseInt(th.getAttribute('data-descex-sort'), 10);
          const s = DESC_EX_STATE.sort;
          if (s.col === col) {
            if (s.dir === 1) s.dir = -1;
            else { s.col = -1; s.dir = 1; }                    // 升序 -> 降序 -> 原序
          } else { s.col = col; s.dir = 1; }
          DESC_EX_STATE.page = 1;
          paintDescriptionEx(box);
          return;
        }
        const pg = e.target.closest('[data-descex-page]');
        if (pg && !pg.disabled) {
          DESC_EX_STATE.page = parseInt(pg.getAttribute('data-descex-page'), 10) || 1;
          paintDescriptionEx(box);
          return;
        }
        const tgl = e.target.closest('[data-descex-pager-toggle]');
        if (tgl) {
          DESC_EX_STATE.pagerOpen = !DESC_EX_STATE.pagerOpen;
          paintDescriptionEx(box);
        }
      });
      // 表头字段筛选：与主列表一致 —— 列头右侧一个 ⚲ 图标，点击弹出自由输入框（列之间 AND）。
      // 注意：不能复用主列表的 .hf-toggle（其点击由全局处理器接管），故用 .descex-fbtn（同一视觉样式）。
      box.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-descex-filter-btn]');
        if (!btn) return;
        const k = parseInt(btn.getAttribute('data-descex-filter-btn'), 10);
        if (btn.classList.contains('active')) { closePopover(); return; }
        const wrap = document.createElement('div');
        wrap.innerHTML = '<input type="search" class="pop-control" placeholder="' + esc(t('descExFilter')) + '" value="' + esc(DESC_EX_STATE.filters[k] || '') + '">';
        const input = wrap.firstChild;
        const pop = openPopover(btn, input.outerHTML, '', 220);
        const ctrl = pop.querySelector('.pop-control');
        if (ctrl) {
          ctrl.focus();
          ctrl.addEventListener('input', function () {
            DESC_EX_STATE.filters[k] = ctrl.value;
            DESC_EX_STATE.page = 1;
            paintDescriptionEx(box);
          });
        }
      }, true);
    }

    // 竖向页码控件（默认收起，由右侧 ▸ 三角展开）：上一页（上） / 窗口化页码 / 下一页（下） / 页码指示器。
    // 箭头**沿用主列表分页的同一字符（‹ ›）**，仅用 CSS 旋转 90° 得到上下方向 —— 风格与尺寸完全不变。
    function descexPagerHTML(page, pages) {
      let html = '<div class="descex-pager-col">';
      html += '<button class="descex-pager-toggle" data-descex-pager-toggle title="' + t('descExPagerToggle') + '"' +
        ' aria-label="' + t('descExPagerToggle') + '" aria-expanded="' + (DESC_EX_STATE.pagerOpen ? 'true' : 'false') + '">' +
        (DESC_EX_STATE.pagerOpen ? '▾' : '▸') + '</button>';
      if (DESC_EX_STATE.pagerOpen) {
        html += '<div class="descex-pager">';
        html += '<button class="pg" data-descex-page="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + ' title="' + t('pagePrev') + '"><span class="pg-ico">‹</span></button>';
        pageItems(page, pages).forEach(function (it) {
          html += it === null
            ? '<span class="pg-gap">…</span>'
            : '<button class="pg' + (it === page ? ' cur' : '') + '" data-descex-page="' + it + '">' + it + '</button>';
        });
        html += '<button class="pg" data-descex-page="' + (page + 1) + '"' + (page >= pages ? ' disabled' : '') + ' title="' + t('pageNext') + '"><span class="pg-ico">›</span></button>';
        html += '<span class="pg-info">' + page + '/' + pages + '</span>';
        html += '</div>';
      }
      return html + '</div>';
    }

    // 列宽：按整表（含所有行）的最大内容宽度估算，保证分页切换时表格宽度固定。
    // 估算会额外计入：行内 `code` 的内边距、以及表头右侧的排序箭头 + 筛选图标占位。
    function descExColWidths(tb, withTools) {
      if (Array.isArray(DESC_EX_STATE.colWidths) && DESC_EX_STATE.colWidths.length === tb.header.length) return DESC_EX_STATE.colWidths;
      let ctx2d = null;
      try {
        ctx2d = document.createElement('canvas').getContext('2d');
        const fam = getComputedStyle(document.body).fontFamily || 'sans-serif';
        ctx2d.font = '12px ' + fam;
      } catch (e) { ctx2d = null; }
      const textW = function (s) { return ctx2d ? ctx2d.measureText(s).width : String(s).length * 7; };
      const codeW = function (s) { return Math.floor(((String(s).match(/`/g) || []).length) / 2) * 8; };
      const headExtra = withTools ? 34 : 0;   // 排序箭头 + 筛选图标
      const measured = tb.header.map(function (h, k) {
        let w = textW(h.text) + codeW(h.text);
        tb.rows.forEach(function (row) {
          const raw = row[k] ? String(row[k].text || '') : '';
          const cw = textW(raw) + codeW(raw);
          if (cw > w) w = cw;
        });
        return w + headExtra;
      });
      const widths = fitColWidths(measured, {
        padFirst: 14 + 10, padMid: 10 + 10, padLast: 10 + 14, min: 56, max: 360,
      });
      DESC_EX_STATE.colWidths = widths;
      return widths;
    }

    // markDownTable 渲染器：表头字段筛选（⚲ 弹框）+ 列排序 + 折叠式竖向分页（只读）；单元格统一左对齐。
    // 总页数 ≤ DESC_EX_TOOLS_MAX_PAGES（默认 3）时不展示排序/筛选图标，保持纯描述性（数据量小无需工具）。
    function renderDescExTableBlock(ctx) {
      const tb = DESC_EX_STATE.parsed;
      const all = tb.rows;
      const tools = descExToolsVisible(all.length, descExPageSize());
      const matched = tools ? filterTableRows(all, DESC_EX_STATE.filters) : all;
      const sorted = tools ? sortTableRows(matched, DESC_EX_STATE.sort.col, DESC_EX_STATE.sort.dir) : matched;
      const pg = paginateRows(sorted, DESC_EX_STATE.page, descExPageSize());
      DESC_EX_STATE.page = pg.page;
      const widths = descExColWidths(tb, tools);

      const head = tb.header.map(function (h, k) {
        if (!tools) return '<th>' + inlineMarkdown(h.raw) + '</th>';
        const arrow = DESC_EX_STATE.sort.col === k ? (DESC_EX_STATE.sort.dir === 1 ? '▲' : '▼') : '⇅';
        const on = String(DESC_EX_STATE.filters[k] || '').trim() !== '';
        return '<th>' +
          '<span class="descex-head" data-descex-sort="' + k + '" title="' + ctx.esc(ctx.t('descExSortTitle')) + '">' + inlineMarkdown(h.raw) +
          ' <span class="sort-arrow">' + arrow + '</span></span>' +
          '<button class="descex-fbtn' + (on ? ' active' : '') + '" data-descex-filter-btn="' + k + '" title="' + ctx.esc(ctx.t('descExFilter')) + '"' +
          ' aria-label="' + ctx.esc(ctx.t('descExFilter') + ' ' + h.text) + '">⚲</button></th>';
      }).join('');

      const body = pg.slice.map(function (row) {
        return '<tr>' + row.map(function (c) {
          return '<td>' + inlineMarkdown(c.raw) + '</td>';
        }).join('') + '</tr>';
      }).join('') || '<tr><td colspan="' + tb.header.length + '" class="empty">' + ctx.esc(ctx.t('descExNoMatch')) + '</td></tr>';

      const cols = '<colgroup>' + widths.map(function (w) { return '<col style="width:' + w + 'px">'; }).join('') + '</colgroup>';
      // table-layout: fixed 需显式给出表格宽度（= 各列之和），否则浏览器会按「撑满可用宽度」计算而忽略 col 宽度。
      const totalW = widths.reduce(function (a, b) { return a + b; }, 0);
      // 页码控件：竖向、位于表格右侧，默认收起（▸ 展开 / ▾ 收起）；仅有 1 页时不占位。
      const pager = pg.pages > 1 ? descexPagerHTML(pg.page, pg.pages) : '';

      return '<div class="descex-frame"><div class="descex-flex">' +
          '<div class="descex-scroll"><table class="descex-table descex-fixed" style="width:' + totalW + 'px">' + cols + '<thead>' +
            '<tr>' + head + '</tr>' +
          '</thead><tbody>' + body + '</tbody></table></div>' +
          pager +
        '</div></div>';
    }

    // 纯文本渲染器（未知 contentType / 解析失败的回退）。
    function renderDescExTextBlock(ctx) {
      return '<div class="descex-text">' + ctx.esc(DESC_EX_STATE.ex.plainContent) + '</div>';
    }

    // creationType：batch-meta.json 优先（经扫描器写入索引），回退到数据文件顶层；缺省视为 sample。
    function currentCreationType() {
      if (BATCH_STATE.active && BATCH_STATE.active.creationType) return BATCH_STATE.active.creationType;
      if (DATA && DATA.creationType) return DATA.creationType;
      return 'sample';
    }
    // 示例数据提示：creationType === 'user' 时不展示；'sample'（或缺省）时展示。
    function applyCreationType() {
      const el = document.getElementById('sampleDataNote');
      if (!el) return;
      el.style.display = currentCreationType() === 'user' ? 'none' : '';
    }

    function renderTabs() {
      const s = scopeStats();
      const tabs = [
        ['fields', t('tabFields'), s.total, null],
        ['warnings', t('tabWarnings'), s.warnings + '/' + s.warningsIgnored, null],
        ['errors', t('tabErrors'), s.errors, null],
      ];
      if (APP_FEATURES.uncomparedXpath || APP_FEATURES.uncomparedCsv) tabs.push(['uncompared', t('tabUncompared'), s.uncompared + '/' + s.uncomparedIgnored, t('tipUncompared')]);
      if (APP_FEATURES.uncomparedItems) tabs.push(['uncomparedItems', t('tabUncomparedItems'), s.skipped, t('tipUncomparedItems')]);
      if (APP_FEATURES.logs) tabs.push(['logs', t('tabLogs'), s.logs, null]);
      if (APP_FEATURES.compare) tabs.push(['compare', t('tabCompare'), null, null]);
      document.getElementById('tabs').innerHTML = tabs.map(function (t) {
        const cls = state.tab === t[0] ? 'tab active' : 'tab';
        return '<button class="' + cls + '" data-tab="' + t[0] + '"' + (t[3] ? ' title="' + esc(t[3]) + '"' : '') + '>' + t[1] +
          (t[2] === null ? '' : '<span class="tab-count">' + t[2] + '</span>') + '</button>';
      }).join('');
    }

    function channelCount(chName, tab) {
      const it = currentItem();
      if (!it) return 0;
      const enabled = it.enabledChannels || [];
      const activeNames = chName === 'ALL' ? enabled : [chName];
      if (tab === 'fields') return flatFields(it).filter(r => activeNames.indexOf(r.channel) !== -1 && sourceMatches(r.source)).length;
      if (tab === 'warnings') return (it.warnings || []).filter(w => activeNames.indexOf(w.channel) !== -1 && sourceMatches(w.source) && !msgIsIgnored('warnings', enrichMsg(w))).length;
      if (tab === 'errors') return (it.errors || []).filter(e => activeNames.indexOf(e.channel) !== -1 && sourceMatches(e.source)).length;
      if (tab === 'uncompared') return (it.uncompared || []).filter(u => (u.channel == null || activeNames.indexOf(u.channel) !== -1) && sourceMatches(u.source) && !msgIsIgnored('uncompared', enrichMsg(u))).length;
      if (tab === 'uncomparedItems') {
        const list = DATA.skippedItems || [];
        return list.filter(s => (chName === 'ALL' || s.channel == null || s.channel === chName) && sourceMatches(s.source)).length;
      }
      if (tab === 'logs') return (it.logs || []).filter(l => (chName === 'ALL' || l.channel === chName) && sourceMatches(l.source)).length;
      return 0;
    }

    function sourceCount(srcName, tab) {
      const it = currentItem();
      if (!it) return 0;
      const enabled = it.enabledChannels || [];
      const chNames = state.channel === 'ALL' ? enabled : [state.channel];
      const srcMatch = function (s) { return srcName === 'ALL' || s === srcName; };
      if (tab === 'fields') return flatFields(it).filter(r => chNames.indexOf(r.channel) !== -1 && srcMatch(r.source)).length;
      if (tab === 'warnings') return (it.warnings || []).filter(w => chNames.indexOf(w.channel) !== -1 && srcMatch(w.source) && !msgIsIgnored('warnings', enrichMsg(w))).length;
      if (tab === 'errors') return (it.errors || []).filter(e => chNames.indexOf(e.channel) !== -1 && srcMatch(e.source)).length;
      if (tab === 'uncompared') {
        const list = it.uncompared || [];
        return list.filter(u => (u.channel == null || chNames.indexOf(u.channel) !== -1) && srcMatch(u.source) && !msgIsIgnored('uncompared', enrichMsg(u))).length;
      }
      if (tab === 'uncomparedItems') {
        const list = DATA.skippedItems || [];
        return list.filter(s => (s.channel == null || chNames.indexOf(s.channel) !== -1) && srcMatch(s.source)).length;
      }
      if (tab === 'logs') return (it.logs || []).filter(l => chNames.indexOf(l.channel) !== -1 && srcMatch(l.source)).length;
      return 0;
    }

    function renderChannelTabs() {
      const it = currentItem();
      const chs = [['ALL', t('all')]].concat(it.channels.map(ch => [ch.name, ch.name]));
      const html = chs.map(([k, label]) => {
        const disabled = k !== 'ALL' && it.enabledChannels.indexOf(k) === -1;
        const cls = 'ctab' + (state.channel === k ? ' active' : '') + (disabled ? ' disabled' : '');
        const count = disabled ? '—' : channelCount(k, state.tab);
        return '<button class="' + cls + '" data-channel="' + k + '" title="' + (disabled ? t('channelDisabled') : '') + '">' + esc(label) +
          '<span class="ctab-count">' + count + '</span></button>';
      }).join('');

      // 来源渠道筛选（可配置；来源数量 > 1 时显示）：与报告渠道联合筛选，统计联动。
      let sourceHtml = '';
      const srcNames = currentSources();
      if (APP_FEATURES.sourceFilter && srcNames.length > 1) {
        const srcs = [['ALL', t('all')]].concat(srcNames.map(function (n) { return [n, n]; }));
        sourceHtml = '<span class="source-sep"></span>' +
          srcs.map(function ([k, label]) {
            const cls = 'stab' + (state.source === k ? ' active' : '');
            const count = sourceCount(k, state.tab);
            return '<button class="' + cls + '" data-source="' + esc(k) + '" title="' + t('filterSourceTitle') + '">' + esc(label) +
              '<span class="stab-count">' + count + '</span></button>';
          }).join('');
      }

      // 「显示警告错误标记」开关：图标式按钮，仅在字段比较 tab 显示，紧邻「列选择」左侧（hover 显示名称）。
      const fieldMsgBtn = state.tab === 'fields'
        ? '<button class="field-msg-toggle' + (state.showFieldMsg ? ' active' : '') + '" id="fieldMsgToggle" type="button" aria-pressed="' + (state.showFieldMsg ? 'true' : 'false') + '"' +
          ' title="' + esc(t(state.showFieldMsg ? 'fieldMsgToggleOn' : 'fieldMsgToggle')) + '" aria-label="' + esc(t(state.showFieldMsg ? 'fieldMsgToggleOn' : 'fieldMsgToggle')) + '">' +
          '<span class="fmt-glyph" aria-hidden="true"></span></button>'
        : '';
      const colBtn = state.tab === 'fields' ? '<button class="col-toggle" id="colToggle">' + t('colSelector') + ' ▾</button>' : '';
      document.getElementById('channelTabs').innerHTML = html + sourceHtml + fieldMsgBtn + colBtn;
    }

    function activeFilters() {
      const list = [];
      // 报告渠道/来源渠道统一由作用域 chip 表示（标签取列名），避免与列头过滤器 chip 重复。
      if (state.channel !== 'ALL') {
        list.push({
          label: t('colChannel') + ': ' + state.channel,
          clear: function () { state.channel = 'ALL'; state.colFilter.channel = 'ALL'; state.msgFilter.channel = 'ALL'; },
        });
      }
      if (state.source && state.source !== 'ALL') {
        list.push({
          label: t('colSource') + ': ' + state.source,
          clear: function () { state.source = 'ALL'; state.colFilter.source = 'ALL'; state.msgFilter.source = 'ALL'; },
        });
      }
      if (state.search.trim()) list.push({ label: '搜索: ' + state.search.trim(), clear: function () { state.search = ''; document.getElementById('search').value = ''; } });
      if (state.tab === 'fields') {
        COLUMNS.forEach(function (c) {
          if (c.key === 'channel' || c.key === 'source') return; // 已由上面的作用域 chip 表示
          const v = state.colFilter[c.key];
          if (v && v !== 'ALL') {
            const shown = c.key === 'type' ? valueTypeLabel(v) : v;
            list.push({
              label: colLabel(c) + ': ' + shown,
              clear: (function (key) {
                return function () {
                  const def = COLUMNS.find(function (x) { return x.key === key; });
                  state.colFilter[key] = def.filterable === 'select' ? 'ALL' : '';
                };
              })(c.key),
            });
          }
        });
        ['eo', 'ao'].forEach(function (col) {
          const sv = state.specialFilter[col];
          if (sv && sv !== 'ALL') {
            const label = col === 'eo' ? t('colEO') : t('colAO');
            const map = { empty: t('specialEmpty'), blank: t('specialBlank'), special: t('specialSpecial') };
            list.push({ label: label + '(' + (map[sv] || sv) + ')', clear: function () { state.specialFilter[col] = 'ALL'; } });
          }
        });
      } else if (MSG_COLUMNS[state.tab]) {
        MSG_COLUMNS[state.tab].forEach(function (c) {
          if (c.key === 'channel' || c.key === 'source') return; // 已由上面的作用域 chip 表示
          const v = state.msgFilter[c.key];
          if (v && v !== 'ALL') {
            const shown = c.key === 'type' ? (state.tab === 'errors' ? errorTypeLabel(v) : typeLabel(v)) : v;
            list.push({
              label: t(c.label) + ': ' + shown,
              clear: (function (key) {
                return function () { state.msgFilter[key] = c.filter === 'select' ? 'ALL' : ''; };
              })(c.key),
            });
          }
        });
      }
      return list;
    }

    function renderFilterChips() {
      ACTIVE_FILTERS = activeFilters();
      const html = ACTIVE_FILTERS.map((f, i) =>
        '<span class="filter-chip">' + esc(f.label) +
        '<button data-clear="' + i + '" title="' + t('filterClearThis') + '">✕</button></span>'
      ).join('');
      const clearAll = ACTIVE_FILTERS.length > 1
        ? '<button class="filter-clear-all" data-clear-all="1" title="' + t('clearAllFilters') + '">' + t('clearAllFilters') + '</button>'
        : '';
      document.getElementById('filterChips').innerHTML = html + clearAll;
    }

    // 清除全部过滤标签，并把主列表的报告渠道/来源渠道重置为「全部」。
    function clearAllFilters() {
      state.channel = 'ALL';
      state.source = 'ALL';
      state.colFilter = { channel: 'ALL', source: 'ALL', field: '', userTag: 'ALL', eoEl: '', aoEl: '', eoCvtEl: '', aoCvtEl: '', vdtEl: '', type: 'ALL', ctxs: '', eoUnconverted: '', eo: '', aoUnconverted: '', ao: '', result: 'ALL', remarks: '' };
      state.specialFilter = { eo: 'ALL', ao: 'ALL' };
      state.msgFilter = {};
      state.search = '';
      state.page = 1;
      const searchEl = document.getElementById('search');
      if (searchEl) searchEl.value = '';
      render();
    }

    function renderPagination(total, pages) {
      if (total === 0) return '';
      const p = state.page;
      const from = Math.max(1, p - 2), to = Math.min(pages, p + 2);
      let parts = [];
      if (pages > 3) parts.push('<button class="pg" data-page="1"' + (p === 1 ? ' disabled' : '') + ' title="' + t('pageFirst') + '">«</button>');
      parts.push('<button class="pg" data-page="' + (p - 1) + '"' + (p === 1 ? ' disabled' : '') + ' title="' + t('pagePrev') + '">‹</button>');
      for (let i = from; i <= to; i++) {
        parts.push('<button class="pg' + (i === p ? ' cur' : '') + '" data-page="' + i + '">' + i + '</button>');
      }
      parts.push('<button class="pg" data-page="' + (p + 1) + '"' + (p === pages ? ' disabled' : '') + ' title="' + t('pageNext') + '">›</button>');
      if (pages > 3) parts.push('<button class="pg" data-page="' + pages + '"' + (p === pages ? ' disabled' : '') + ' title="' + t('pageLast') + '">»</button>');
      return '<div class="pagination">' + parts.join('') +
        '<span class="pg-info">' + p + ' / ' + pages + ' ' + t('pageOf') + '</span>' +
        '<select id="pageSize">' +
        APP_LIMITS.pageSizeOptions.map(n => '<option' + (state.pageSize === n ? ' selected' : '') + '>' + n + '</option>').join('') +
        '</select></div>';
    }

    /* ---- 浮层（popover）管理 ---- */
    function closePopover() {
      if (POPOVER.el) { POPOVER.el.remove(); POPOVER.el = null; }
      if (POPOVER.cleanup) { POPOVER.cleanup(); POPOVER.cleanup = null; }
      closeValPanel();
      document.querySelectorAll('.hf-toggle.active, .col-toggle.active, .side-multi.active, .cal-btn.active, .bp-cal.active, .item-meta-link.active').forEach(b => b.classList.remove('active'));
    }

    function openPopover(anchor, contentHTML, title, width) {
      closePopover();
      const pop = document.createElement('div');
      pop.className = 'popover';
      pop.innerHTML = (title ? '<p class="popover-title">' + esc(title) + '</p>' : '') + contentHTML;
      document.body.appendChild(pop);
      const r = anchor.getBoundingClientRect();
      const w = width ? Math.min(width, window.innerWidth - 16) : Math.min(260, window.innerWidth - 16);
      pop.style.width = w + 'px';
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
      // 选项过多时：限高 + 内部滚动，保证能滚动看到全部选项；优先向下，下方空间不足则向上展开。
      const gap = 6;
      const below = window.innerHeight - r.bottom - gap;
      const above = r.top - gap;
      const openUp = below < above && above > 120;
      const space = openUp ? above : below;
      pop.style.maxHeight = Math.max(120, Math.min(space, window.innerHeight - 16)) + 'px';
      pop.style.overflowY = 'auto';
      if (openUp) pop.style.bottom = (window.innerHeight - r.top + gap) + 'px';
      else pop.style.top = (r.bottom + gap) + 'px';
      anchor.classList.add('active');
      POPOVER.el = pop;
      const docClick = function (e) {
        if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closePopover();
      };
      document.addEventListener('click', docClick);
      POPOVER.cleanup = function () { document.removeEventListener('click', docClick); };
      return pop;
    }

    /* 值/说明长文本浮层面板：position:fixed + resize:both，右下角手柄可自由拉伸宽高。 */
    function closeValPanel() {
      if (VAL_PANEL) { VAL_PANEL.remove(); VAL_PANEL = null; }
    }
    function openValPanel(anchor, text) {
      if (VAL_PANEL && VAL_PANEL.__anchor === anchor) { closeValPanel(); return; }
      closeValPanel();
      closePopover();
      closeCtxDefPopup();
      closeRulePopup();
      const panel = document.createElement('div');
      panel.className = 'val-panel';
      panel.innerHTML =
        '<pre class="val-panel-pre">' + esc(text) + '</pre>' +
        '<button class="val-panel-copy" type="button" data-val-copy="1" title="' + t('copyValue') + '" aria-label="' + t('copyValue') + '">⧉</button>';
      document.body.appendChild(panel);
      const r = anchor.getBoundingClientRect();
      const pw = panel.offsetWidth, ph = panel.offsetHeight;
      let left = r.left, top = r.bottom + 6;
      if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
      if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
      panel.__anchor = anchor;
      panel.__text = text;
      panel.addEventListener('click', function (e) {
        const cp = e.target.closest('[data-val-copy]');
        if (cp) { copyText(panel.__text); cp.classList.add('copied'); setTimeout(function () { cp.classList.remove('copied'); }, 1200); return; }
      });
      VAL_PANEL = panel;
    }

    function selectOptionsFor(col, table) {
      let arr;
      if (table === 'fields') {
        if (col === 'type') arr = ['ALL', 'id', 'num', 'date', 'code', 'product', 'text', 'multi'];
        else if (col === 'userTag') arr = ['ALL', 'platformAssertion', 'productAssertion', 'contextAssertion'];
        else if (col === 'result') arr = ['ALL', 'PASSED', 'FAILED'];
        else if (col === 'channel') arr = ['ALL'].concat(channelNames());
        else if (col === 'source') arr = ['ALL'].concat(sourceNames());
        else arr = ['ALL'];
      } else {
        if (col === 'type') arr = state.tab === 'errors' ? ['ALL'].concat(Object.keys(ERROR_TYPE_META)) : ['ALL', 'platformAssertion', 'productAssertion', 'contextAssertion'];
        else if (col === 'channel') arr = ['ALL'].concat(channelNames());
        else if (col === 'source') arr = ['ALL'].concat(sourceNames());
        else if (col === 'level') arr = ['ALL', 'WARN', 'INFO', 'NOTICE', 'DEBUG', 'ERROR', 'FATAL', 'SEVERE'];
        else arr = ['ALL'];
      }
      return arr.map(function (v) {
        let l = v;
        if (v === 'ALL') l = t('all');
        else if (col === 'source') l = v;
        else if (table === 'fields' && col === 'type') l = valueTypeLabel(v);
        else if (table === 'fields' && col === 'userTag') l = userTagLabel(v);
        else if (table === 'msg' && col === 'type') l = state.tab === 'errors' ? errorTypeLabel(v) : typeLabel(v);
        return [v, l];
      });
    }

    function openFilterPopover(btn, filterObj, col, kind, placeholder, onApply, table) {
      if (btn.classList.contains('active')) { closePopover(); return; }
      let control;
      if (kind === 'select') {
        const opts = selectOptionsFor(col, table);
        control = '<select class="pop-control">' +
          opts.map(function (o) { return '<option value="' + o[0] + '"' + (filterObj[col] === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
      } else {
        control = '<input class="pop-control" placeholder="' + esc(placeholder || t('search')) + '" value="' + esc(filterObj[col] || '') + '">';
      }
      const pop = openPopover(btn, control);
      const ctrl = pop.querySelector('.pop-control');
      if (ctrl.tagName === 'INPUT') ctrl.focus();
      ctrl.addEventListener(kind === 'select' ? 'change' : 'input', function () {
        filterObj[col] = ctrl.value;
        state.page = 1;
        state.msgPage = 1;
        if (onApply) onApply();
        if (kind === 'select') closePopover();
      });
    }

    function openHfPopover(btn) {
      const col = btn.getAttribute('data-hf');
      const kind = btn.getAttribute('data-kind');
      const def = COLUMNS.find(function (c) { return c.key === col; });
      openFilterPopover(btn, state.colFilter, col, kind, def ? colLabel(def) : t('toolbarSearch'), function () {
        if (col === 'channel') { state.channel = state.colFilter.channel; renderChannelTabs(); }
        else if (col === 'source') { state.source = state.colFilter.source; renderChannelTabs(); }
        refreshFieldsBody(); renderFilterChips();
      }, 'fields');
    }

    function openMsgFilterPopover(btn) {
      const col = btn.getAttribute('data-hf');
      const kind = btn.getAttribute('data-kind');
      openFilterPopover(btn, state.msgFilter, col, kind, btn.getAttribute('data-title') || '搜索', function () {
        if (col === 'channel') { state.channel = state.msgFilter.channel; state.colFilter.channel = state.channel; renderChannelTabs(); }
        else if (col === 'source') { state.source = state.msgFilter.source; state.colFilter.source = state.source; renderChannelTabs(); }
        renderContent(); renderFilterChips();
      }, 'msg');
    }

    function openSpecialPopover(btn) {
      const col = btn.getAttribute('data-special');
      const opts = [['ALL', t('all')], ['empty', t('specialEmpty')], ['blank', t('specialBlank')], ['special', t('specialSpecial')]];
      const control = '<select class="pop-control">' +
        opts.map(function (o) { return '<option value="' + o[0] + '"' + (state.specialFilter[col] === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>';
      const pop = openPopover(btn, control);
      pop.querySelector('.pop-control').addEventListener('change', function (e) {
        state.specialFilter[col] = e.target.value;
        state.page = 1;
        refreshFieldsBody(); renderFilterChips();
        closePopover();
      });
    }

    function openColumnMenu(anchor) {
      if (anchor.classList.contains('active')) { closePopover(); return; }
      const buildContent = function () {
        const cols = COLUMNS.filter(isColSelectable);
        const allChecked = cols.every(function (c) { return state.columns[c.key]; });
        let html = '<label class="col-option"><input type="checkbox" data-colkey="__ALL__"' + (allChecked ? ' checked' : '') + '> ' + t('all') + '</label>';
        cols.forEach(function (c) {
          html += '<label class="col-option"><input type="checkbox" data-colkey="' + c.key + '"' + (state.columns[c.key] ? ' checked' : '') + '> ' + colLabel(c) + '</label>';
        });
        return html;
      };
      const pop = openPopover(anchor, buildContent(), t('popColTitle'));
      const bind = function () {
        pop.querySelectorAll('input[data-colkey]').forEach(function (cb) {
          cb.addEventListener('change', function () {
            const key = cb.getAttribute('data-colkey');
            if (key === '__ALL__') COLUMNS.forEach(function (c) { state.columns[c.key] = cb.checked; });
            else state.columns[key] = cb.checked;
            renderFields();
            savePrefs();
            syncHash();
            pop.innerHTML = buildContent();
            bind();
          });
        });
      };
      bind();
    }

    function distinctValues(prop) {
      const s = [];
      DATA.items.forEach(it => { if (s.indexOf(it[prop]) === -1) s.push(it[prop]); });
      return s;
    }

    function productCategoryLabel(cat) {
      const m = PRODUCT_CATEGORIES[cat];
      return m ? t(m.label) : (cat || '');
    }

    function allowedProductPairs() {
      // 根据已选平台过滤可用「类别/子产品」组合
      const pairs = [];
      const seen = {};
      DATA.items.forEach(function (it) {
        if (state.itemPlatforms.length && state.itemPlatforms.indexOf(it.platform) === -1) return;
        const cat = it.productCategory || '';
        const sub = it.product || '';
        const k = cat + '|' + sub;
        if (!seen[k]) { seen[k] = 1; pairs.push({ cat: cat, sub: sub }); }
      });
      pairs.sort(function (a, b) { return a.cat === b.cat ? (a.sub < b.sub ? -1 : 1) : (a.cat < b.cat ? -1 : 1); });
      return pairs;
    }

    function pruneItemProducts() {
      const valid = {};
      allowedProductPairs().forEach(function (p) { valid[p.sub] = true; });
      state.itemProducts = state.itemProducts.filter(function (v) { return valid[v]; });
    }

    function openSideMulti(btn) {
      if (btn.classList.contains('active')) { closePopover(); return; }
      const field = btn.getAttribute('data-field');
      const isProduct = field === 'itemProducts';
      const isTradeId = field === 'itemTradeIds';
      const title = isProduct ? t('sidebarProduct') : (isTradeId ? t('sidebarTradeId') : t('sidebarPlatform'));
      const buildContent = function () {
        const allChecked = state[field].length === 0;
        let html = '<label class="col-option"><input type="checkbox" data-val="__ALL__"' + (allChecked ? ' checked' : '') + '> ' + t('all') + '</label>';
        if (isProduct) {
          const pairs = allowedProductPairs();
          let lastCat = null;
          pairs.forEach(function (p) {
            if (p.cat !== lastCat) {
              lastCat = p.cat;
              html += '<div class="pop-cat">' + esc(productCategoryLabel(p.cat)) + '</div>';
            }
            html += '<label class="col-option cat-sub"><input type="checkbox" data-val="' + esc(p.sub) + '"' + (state[field].indexOf(p.sub) !== -1 ? ' checked' : '') + '> ' + esc(p.sub) + '</label>';
          });
          if (!pairs.length) html += '<div class="pop-empty">—</div>';
        } else {
          const prop = isTradeId ? 'platformTradeId' : 'platform';
          distinctValues(prop).forEach(v => {
            html += '<label class="col-option"><input type="checkbox" data-val="' + esc(v) + '"' + (state[field].indexOf(v) !== -1 ? ' checked' : '') + '> ' + esc(v) + '</label>';
          });
        }
        return html;
      };
      const pop = openPopover(btn, buildContent(), title);
      const bind = function () {
        pop.querySelectorAll('input[data-val]').forEach(cb => {
          cb.addEventListener('change', function () {
            const v = cb.getAttribute('data-val');
            if (v === '__ALL__') {
              state[field] = [];
            } else {
              const arr = state[field];
              const idx = arr.indexOf(v);
              if (cb.checked && idx === -1) arr.push(v);
              else if (!cb.checked && idx !== -1) arr.splice(idx, 1);
            }
            if (field === 'itemPlatforms') pruneItemProducts();
            state.sidebarPage = 1;
            renderSidebar();
            renderSidebarChips();
            pop.innerHTML = buildContent();
            bind();
          });
        });
      };
      bind();
    }

    /* ---- 字段比较列表 ---- */
    function valueCellHTML(v) {
      const s = String(v);
      const long = s.length > 32 || /\r?\n/.test(s);
      if (!long) return '<span class="val-full">' + esc(s) + '</span>';
      return '<button class="val-expand" type="button" data-val-expand="1" data-val="' + esc(s) + '" title="' + t('expandValue') + '">' + esc(preview(s)) + '</button>';
    }

    function hoverCellHTML(v) {
      const s = String(v);
      const long = s.length > 40 || /\r?\n/.test(s);
      if (!long) return '<span class="text-full">' + esc(s) + '</span>';
      return '<button class="val-expand" type="button" data-val-expand="1" data-val="' + esc(s) + '" title="' + t('expandValue') + '">' + esc(preview(s)) + '</button>';
    }

    // 统计与某字段（报告渠道-来源渠道-关联字段）关联的警告/错误条数。
    // 警告仅统计未忽略项（错误没有忽略机制，恒计）。
    function fieldMsgCount(kind, r) {
      const it = currentItem();
      if (!it) return 0;
      const arr = it[kind];
      if (!Array.isArray(arr)) return 0;
      const ch = r.channel, src = r.source, f = r.field;
      if (!ch || !src || !f) return 0;
      let n = 0;
      for (let i = 0; i < arr.length; i++) {
        const m = arr[i];
        if (m && m.channel === ch && m.source === src && m.field === f) {
          if (kind === 'warnings' && msgIsIgnored('warnings', enrichMsg(m))) continue;
          n++;
        }
      }
      return n;
    }

    function fieldMsgIconHTML(kind, count, r) {
      const key = kind === 'errors' ? 'fieldErrIconTitle' : 'fieldWarnIconTitle';
      const cls = kind === 'errors' ? 'err' : 'warn';
      const tip = t(key).replace('{n}', String(count));
      // 纯色圆点标记：警告/错误分别以琥珀 #f59e0b / 红 #ef4444 填充（无字形，圆点由 CSS 绘制）。
      return '<button class="field-msg-ico ' + cls + '" type="button" data-field-msg="' + kind + '"' +
        ' data-fch="' + esc(r.channel) + '" data-fsrc="' + esc(r.source) + '" data-ffield="' + esc(r.field) + '"' +
        ' title="' + esc(tip) + '" aria-label="' + esc(tip) + '"></button>';
    }

    function fieldCellHTML(r, key) {
      switch (key) {
        case 'channel': return '<td><span class="chip channel-chip">' + esc(r.channel) + '</span></td>';
        case 'source': return '<td>' + esc(r.source) + '</td>';
        case 'field': {
          const warnN = fieldMsgCount('warnings', r);
          const errN = fieldMsgCount('errors', r);
          let icos = '';
          if (warnN > 0) icos += fieldMsgIconHTML('warnings', warnN, r);
          if (errN > 0) icos += fieldMsgIconHTML('errors', errN, r);
          return '<td class="mono"><a class="val-link" data-detail="' + esc(fieldLocKey(r.channel, r.source, r.id)) + '" title="' + t('viewCompareDetail') + '">' + esc(r.field) + '</a>' + icos + '</td>';
        }
        case 'userTag': return '<td>' + userTagHTML(r.userTag) + '</td>';
        case 'aoEl': {
          const chip = COL_TAG
            ? (r.srcType === 2
              ? '<span class="chip vt-code" title="' + t('modalAoCsvField') + '">CSV</span> '
              : '<span class="chip channel-chip" title="' + t('modalXPath') + '">XPath</span> ')
            : '';
          return '<td>' + chip + valueCellHTML(r.aoEl || '—') + '</td>';
        }
        case 'eoEl': return '<td class="mono">' + valueCellHTML(r.eoEl || '—') + '</td>';
        case 'eoCvtEl': return '<td class="mono">' + valueCellHTML(r.eoCvtEl || '—') + '</td>';
        case 'aoCvtEl': return '<td class="mono">' + valueCellHTML(r.aoCvtEl || '—') + '</td>';
        case 'vdtEl': return '<td class="mono">' + valueCellHTML(r.vdtEl || '—') + '</td>';
        case 'eoUnconverted': return '<td>' + valueCellHTML(r.eoUnconverted || '—') + '</td>';
        case 'aoUnconverted': return '<td>' + valueCellHTML(r.aoUnconverted || '—') + '</td>';
        case 'type': return '<td><span class="vt-plain">' + esc(valueTypeLabel(r.type)) + '</span></td>';
        case 'ctxs': return '<td><div class="ctx-tags">' + (ctxTagsHTML(r.ctxs) || '') + '</div></td>';
        case 'eo': return '<td>' + valueCellHTML(r.eo) + '</td>';
        case 'ao': return '<td>' + valueCellHTML(r.ao) + '</td>';
        case 'result': {
          const pass = r.result === 'PASSED';
          return '<td><span class="badge ' + (pass ? 'pass' : 'fail') + '">' + r.result + '</span></td>';
        }
        case 'remarks': return '<td>' + hoverCellHTML(r.remarks || '—') + '</td>';
        default: return '<td></td>';
      }
    }

    function computeFieldPage() {
      const rows = filteredFields(currentItem());
      const total = rows.length;
      const pages = Math.max(1, Math.ceil(total / state.pageSize));
      if (state.page > pages) state.page = pages;
      const start = (state.page - 1) * state.pageSize;
      return { pageRows: rows.slice(start, start + state.pageSize), total: total, pages: pages };
    }

    function buildFieldRows(pageRows) {
      const visible = COLUMNS.filter(isFieldColVisible);
      const trs = pageRows.map(r => {
        const pass = r.result === 'PASSED';
        return '<tr class="' + (pass ? '' : 'row-fail') + '" tabindex="0" data-fid="' + esc(fieldLocKey(r.channel, r.source, r.id)) + '" data-rid="' + r._idx + '">' +
          visible.map(c => cellWithWidth(c.key, fieldCellHTML(r, c.key))).join('') + '</tr>';
      }).join('');
      return trs || '<tr><td colspan="' + visible.length + '" class="empty">无匹配记录</td></tr>';
    }

    const COL_WIDTHS = {
      channel: { def: 110, min: 80,  max: 280, resizable: false },
      source:  { def: 110, min: 80,  max: 280, resizable: false },
      field:   { def: 150, min: 80,  max: 420 },
      userTag: { def: 110, min: 80,  max: 280, resizable: false },
      eoEl:    { def: 200, min: 120, max: 600 },
      aoEl:    { def: 200, min: 120, max: 600 },
      eoCvtEl: { def: 200, min: 120, max: 600 },
      aoCvtEl: { def: 200, min: 120, max: 600 },
      vdtEl:   { def: 200, min: 120, max: 600 },
      type:    { def: 110, min: 80,  max: 240, resizable: false },
      ctxs:    { def: 260, min: 140, max: 560 },
      eoUnconverted: { def: 200, min: 120, max: 600 },
      eo:      { def: 240, min: 120, max: 600 },
      aoUnconverted: { def: 200, min: 120, max: 600 },
      ao:      { def: 240, min: 120, max: 600 },
      result:  { def: 100, min: 80,  max: 240 },
      remarks: { def: 200, min: 120, max: 600 },
    };

    function colWidth(key) {
      const w = state.colWidths[key];
      if (w != null) return w;
      const cfg = COL_WIDTHS[key];
      return cfg ? cfg.def : 120;
    }

    function cellWithWidth(key, tdHTML) {
      const w = colWidth(key);
      const gt = tdHTML.indexOf('>');
      return tdHTML.slice(0, gt) + ' data-col="' + key + '" style="width:' + w + 'px; min-width:' + w + 'px;">' + tdHTML.slice(gt + 1);
    }

    function applyColWidth(key) {
      const w = colWidth(key);
      document.querySelectorAll('[data-col="' + key + '"]').forEach(function (el) {
        el.style.width = w + 'px';
        el.style.minWidth = w + 'px';
      });
    }

    function fieldsHeaderHTML() {
      const cells = COLUMNS.filter(isFieldColVisible).map(c => {
        let cls = c.sortable ? 'sortable' : '';
        let extra = '';
        const cw = COL_WIDTHS[c.key];
        if (cw) {
          const w = colWidth(c.key);
          extra = ' data-col="' + c.key + '" style="width:' + w + 'px; min-width:' + w + 'px;"';
        }
        const resizable = cw && cw.resizable !== false;
        if (resizable) cls += (cls ? ' ' : '') + 'col-resizable';
        const sortAttr = cls ? ' class="' + cls + '"' + (c.sortable ? ' data-sort="' + c.key + '"' : '') : '';
        let btn = '';
        if (c.filterable) {
          btn = '<button class="hf-toggle" data-hf="' + c.key + '" data-kind="' + c.filterable + '" title="' + t('filterTitle') + '">⚲</button>';
        }
        let specialBtn = '';
        if (c.key === 'eo' || c.key === 'ao') {
          specialBtn = '<button class="special-toggle" data-special="' + c.key + '" title="' + t('specialFilterTitle') + '">∅</button>';
        }
        const handle = resizable ? '<span class="col-resize" data-resize="' + c.key + '" title="' + t('colResizeTitle') + '"></span>' : '';
        return '<th' + sortAttr + extra + ' scope="col">' + colLabel(c) +
          (c.sortable ? ' <span class="sort-arrow">' + sortArrow(c.key) + '</span>' : '') +
          btn + specialBtn + handle + '</th>';
      }).join('');
      return '<thead><tr>' + cells + '</tr></thead>';
    }

    function fieldsFooterHTML(total, pages) {
      return renderPagination(total, pages) +
        '<div class="meta-note">' + total + ' ' + t('metaFields') + '</div>';
    }

    function refreshFieldsBody() {
      const p = computeFieldPage();
      const tbody = document.getElementById('fTbody');
      if (tbody) tbody.innerHTML = buildFieldRows(p.pageRows);
      const footer = document.getElementById('fFooter');
      if (footer) footer.innerHTML = fieldsFooterHTML(p.total, p.pages);
    }

    function renderFields() {
      const p = computeFieldPage();
      document.getElementById('content').innerHTML =
        '<div class="table-wrap' + (state.showFieldMsg ? ' show-field-msg' : '') + '"><table>' + fieldsHeaderHTML() +
        '<tbody id="fTbody">' + buildFieldRows(p.pageRows) + '</tbody></table></div>' +
        '<div id="fFooter">' + fieldsFooterHTML(p.total, p.pages) + '</div>';
      restoreRowSelection();
    }

    // 深链接恢复：渲染后聚焦并滚动到 URL 指定的选中行（字段/警告/错误/未比较/未比较Item），仅应用 hash 时触发一次。
    function restoreRowSelection() {
      if (state.rowId < 0 || !RESTORE_ROW) return;
      const msgTabs = ['warnings', 'errors', 'uncompared', 'uncomparedItems'];
      if (state.tab !== 'fields' && msgTabs.indexOf(state.tab) === -1) return;
      RESTORE_ROW = false;
      const sel = state.tab === 'fields' ? '#fTbody tr[data-rid]' : '#mTbody tr[data-rid]';
      requestAnimationFrame(function () {
        const trs = document.querySelectorAll(sel);
        for (let i = 0; i < trs.length; i++) {
          if (parseInt(trs[i].getAttribute('data-rid'), 10) === state.rowId) {
            trs[i].scrollIntoView({ block: 'nearest' });
            try { trs[i].focus({ preventScroll: true }); } catch (e) { trs[i].focus(); }
            return;
          }
        }
      });
    }

    // 计算深链接行ID（源数组下标）在指定 tab 列表中的页码。
    function rowPageFor(tab, rid) {
      if (rid < 0) return null;
      if (tab === 'fields') {
        const list = filteredFields(currentItem());
        for (let i = 0; i < list.length; i++) {
          if (list[i]._idx === rid) return Math.floor(i / state.pageSize) + 1;
        }
        return null;
      }
      if (['warnings', 'errors', 'uncompared', 'uncomparedItems'].indexOf(tab) !== -1) {
        const list = getMsgRows(tab);
        for (let i = 0; i < list.length; i++) {
          if (list[i]._idx === rid) return Math.floor(i / state.msgPageSize) + 1;
        }
      }
      return null;
    }

    /* ---- 消息类列表通用引擎（警告/错误/未比较/未比较Item） ---- */
    const MSG_COLUMNS = {
      warnings: [
        { key: 'channel', label: 'colChannel', sortable: true, filter: 'select' },
        { key: 'source',  label: 'colSource',  sortable: true, filter: 'select' },
        { key: 'type',    label: 'colType',    sortable: true, filter: 'select' },
        { key: 'level',   label: 'colLevel',   sortable: true, filter: null },
        { key: 'text',    label: 'colText',    sortable: true, filter: 'text', title: '搜索信息' },
        { key: 'field',   label: 'colRelField', sortable: true, filter: 'text', title: '搜索关联字段' },
        { key: 'ignored', label: 'colIgnored', sortable: true, filter: null, bulk: true },
      ],
      errors: [
        { key: 'channel', label: 'colChannel', sortable: true, filter: 'select' },
        { key: 'source',  label: 'colSource',  sortable: true, filter: 'select' },
        { key: 'type',    label: 'colType',    sortable: true, filter: 'select' },
        { key: 'level',   label: 'colLevel',   sortable: true, filter: null },
        { key: 'text',    label: 'colText',    sortable: true, filter: 'text', title: '搜索信息' },
        { key: 'field',   label: 'colRelField', sortable: true, filter: 'text', title: '搜索关联字段' },
      ],
      uncompared: [
        { key: 'channel', label: 'colChannel', sortable: true, filter: 'select' },
        { key: 'source',  label: 'colSource',  sortable: true, filter: 'select' },
        { key: 'type',    label: 'colType',    sortable: true, filter: 'select' },
        { key: 'value',   label: 'colElement', sortable: true, filter: 'text', title: '搜索元素' },
        { key: 'note',    label: 'colNote',    sortable: true, filter: 'text', title: '搜索说明' },
        { key: 'ignored', label: 'colIgnored', sortable: true, filter: null, bulk: true },
      ],
      uncomparedItems: [
        { key: 'itemId',  label: 'colItemId',  sortable: true, filter: 'text', title: '搜索 Item ID' },
        { key: 'channel', label: 'colChannel', sortable: true, filter: 'select' },
        { key: 'source',  label: 'colSource',  sortable: true, filter: 'select' },
        { key: 'reason',  label: 'colReason',  sortable: true, filter: 'text', title: '搜索原因' },
      ],
    };

    function msgValue(tab, m, key) {
      switch (key) {
        case 'channel': return m.channel || '';
        case 'source': return m.source || '';
        case 'type': return m.type == null ? '' : String(m.type);
        case 'level': return m.level || '';
        case 'text': return m.text || '';
        case 'field': return m.field || '';
        case 'ignored': return msgIsIgnored(tab, m) ? '1' : '0';
        case 'value': return m.value || '';
        case 'note': return m.note || '';
        case 'itemId': return m.itemId || '';
        case 'reason': return m.reason || '';
        default: return '';
      }
    }

    function getMsgRows(tab) {
      let list;
      if (tab === 'warnings') list = scopeWarnings();
      else if (tab === 'errors') list = scopeErrors();
      else if (tab === 'uncompared') list = scopeUncompared();
      else list = scopeSkippedItems();
      if (state.search.trim()) {
        const q = state.search.trim().toLowerCase();
        list = list.filter(function (m) { return JSON.stringify(m).toLowerCase().indexOf(q) !== -1; });
      }
      MSG_COLUMNS[tab].forEach(function (c) {
        const v = state.msgFilter[c.key];
        if (!v || v === 'ALL') return;
        if (c.filter === 'select') list = list.filter(function (m) { return msgValue(tab, m, c.key) === v; });
        else if (c.filter === 'text') list = list.filter(function (m) { return String(msgValue(tab, m, c.key)).toLowerCase().indexOf(v.toLowerCase()) !== -1; });
      });
      if (state.msgSort.key) {
        const k = state.msgSort.key, d = state.msgSort.dir;
        list.sort(function (a, b) {
          const va = msgValue(tab, a, k), vb = msgValue(tab, b, k);
          if (va < vb) return -1 * d;
          if (va > vb) return 1 * d;
          return 0;
        });
      }
      return list;
    }

    function msgSortArrow(key) {
      if (state.msgSort.key !== key) return '⇅';
      return state.msgSort.dir === 1 ? '▲' : '▼';
    }

    function scopeLabel() {
      const ch = state.channel === 'ALL' ? t('scopeItem') : state.channel + ' ' + t('scopeChannel');
      const src = state.source === 'ALL' ? '' : ' · ' + t('colSource') + ' ' + state.source;
      return ch + src;
    }

    function msgHeaderHTML(tab) {
      const cells = MSG_COLUMNS[tab].map(function (c) {
        const sortAttr = c.sortable ? ' class="sortable" data-sort="' + c.key + '"' : '';
        let filterBtn = '';
        if (c.filter) filterBtn = '<button class="mhf-toggle" data-hf="' + c.key + '" data-kind="' + c.filter + '" data-title="' + t(c.label) + '" title="' + t('filterTitle') + '">⚲</button>';
        let bulkBtn = '';
        if (c.bulk) bulkBtn = '<button class="bulk-toggle" data-bulk-open="1" title="' + t('bulkToggleTitle') + '">☰</button>';
        return '<th' + sortAttr + ' scope="col">' + t(c.label) +
          (c.sortable ? ' <span class="sort-arrow">' + msgSortArrow(c.key) + '</span>' : '') +
          filterBtn + bulkBtn + '</th>';
      }).join('');
      return '<thead><tr>' + cells + '</tr></thead>';
    }

    function uncomparedTypeChip(tp) {
      return tp === 2 ? '<span class="chip vt-code">CSV</span>' : '<span class="chip channel-chip">XPath</span>';
    }
    function msgCellHTML(tab, m, c) {
      switch (c.key) {
        case 'channel': {
          const ch = (m.channel == null || m.channel === 'ALL') ? 'ALL' : m.channel;
          return '<td><span class="chip channel-chip">' + esc(ch) + '</span></td>';
        }
        case 'source': return '<td>' + esc(m.source || '—') + '</td>';
        case 'type':
          if (tab === 'uncompared') return '<td>' + uncomparedTypeChip(m.type) + '</td>';
          return '<td>' + (tab === 'errors' ? errorTypeChip(m.type) : typeChip(m.type)) + '</td>';
        case 'level': {
          const isWarn = tab === 'warnings';
          return '<td><span class="badge ' + (isWarn ? 'warn' : 'fail') + '">' + esc(m.level || '') + '</span></td>';
        }
        case 'text': return '<td>' + hoverCellHTML(m.text) + '</td>';
        case 'field':
          if (m.field) {
            return '<td class="mono"><a class="val-link" data-jump-field="' + esc(m.field) + '" data-jch="' + esc(m.channel || '') + '" data-jsrc="' + esc(m.source || '') + '" title="' + t('jumpToFieldTip') + '">' + esc(m.field) + '</a></td>';
          }
          return '<td class="mono">' + esc(m.field || '—') + '</td>';
        case 'ignored': {
          const ignored = msgIsIgnored(tab, m);
          const k = msgIgnoreKey(tab, m);
          return '<td><button class="ignore-btn' + (ignored ? ' ignored' : '') + '" data-ignore="' + esc(k) + '">' + (ignored ? t('unignore') : t('ignore')) + '</button></td>';
        }
        case 'value': return '<td>' + valueCellHTML(m.value) + '</td>';
        case 'note': return '<td>' + hoverCellHTML(m.note) + '</td>';
        case 'itemId': return '<td class="mono">' + esc(m.itemId) + '</td>';
        case 'reason': return '<td>' + hoverCellHTML(m.reason) + '</td>';
        default: return '<td></td>';
      }
    }

    function renderMsgTable(tab, metaText) {
      const list = getMsgRows(tab);
      const cols = MSG_COLUMNS[tab];
      const pages = Math.max(1, Math.ceil(list.length / state.msgPageSize));
      if (state.msgPage > pages) state.msgPage = pages;
      const start = (state.msgPage - 1) * state.msgPageSize;
      const pageRows = list.slice(start, start + state.msgPageSize);
      const rows = pageRows.map(function (m) {
        const ignoredRow = msgIsIgnored(tab, m);
        return '<tr class="' + (ignoredRow ? 'row-ignored' : '') + '" tabindex="0" data-rid="' + m._idx + '">' +
          cols.map(function (c) { return msgCellHTML(tab, m, c); }).join('') + '</tr>';
      }).join('');
      let pagerHtml = '';
      if (list.length > state.msgPageSize) {
        const p = state.msgPage;
        const from = Math.max(1, p - 2), to = Math.min(pages, p + 2);
        let parts = [];
        parts.push('<button class="pg" data-msg-page="' + (p - 1) + '"' + (p === 1 ? ' disabled' : '') + '>‹</button>');
        for (let i = from; i <= to; i++) parts.push('<button class="pg' + (i === p ? ' cur' : '') + '" data-msg-page="' + i + '">' + i + '</button>');
        parts.push('<button class="pg" data-msg-page="' + (p + 1) + '"' + (p === pages ? ' disabled' : '') + '>›</button>');
        pagerHtml = '<div class="pagination">' + parts.join('') + '<span class="pg-info">' + p + ' / ' + pages + ' ' + t('pageOf') + '</span>' +
          '<select id="msgPageSize">' + APP_LIMITS.pageSizeOptions.map(function (n) { return '<option' + (state.msgPageSize === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div>';
      }
      document.getElementById('content').innerHTML =
        ((tab === 'warnings' || tab === 'uncompared') ? '<div class="warn-toolbar"><button class="export-btn" id="manageIgnoreBtn">' + t('ignoreManage') + '</button><button class="export-btn" id="importIgnoreBtn">' + t('importIgnore') + '</button><button class="export-btn" id="exportIgnoreBtn">' + t('export') + '</button></div>' : '') +
        '<div class="table-wrap"><table>' + msgHeaderHTML(tab) +
        '<tbody id="mTbody">' + (rows || '<tr><td colspan="' + cols.length + '" class="empty">无记录</td></tr>') + '</tbody></table></div>' +
        pagerHtml +
        '<div class="meta-note">' + metaText + '</div>';
      restoreRowSelection();
    }

    function openBulkIgnoreDialog() {
      const tab = state.tab;
      const list = getMsgRows(tab);
      const keys = list.map(function (m) { return msgIgnoreKey(tab, m); }).filter(function (k) { return k; });
      const active = keys.filter(function (k) { return !IGNORE_CONFIG[k]; }).length;
      const ignored = keys.length - active;
      const unit = tab === 'uncompared' ? t('bulkUnitUncompared') : t('bulkUnitWarn');
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML =
        '<div class="modal"><div class="modal-head"><h3>' + t('bulkTitle') + '</h3><button class="modal-close" aria-label="' + t('closeLabel') + '">✕</button></div>' +
        '<div class="modal-body">' +
        '<p class="bulk-desc">' + t('bulkDesc1') + keys.length + ' ' + unit + t('bulkDesc2') + active + t('bulkDesc3') + ignored + t('bulkDesc4') + '</p>' +
        '<div class="bulk-actions">' +
        '<button class="bulk-btn ignore-all" data-bulk="ignore">' + t('bulkIgnoreAll') + active + t('bulkCount') + '</button>' +
        '<button class="bulk-btn unignore-all" data-bulk="unignore">' + t('bulkUnignoreAll') + ignored + t('bulkCount') + '</button>' +
        '</div></div></div>';
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop || e.target.closest('.modal-close')) { backdrop.remove(); return; }
        const btn = e.target.closest('[data-bulk]');
        if (!btn) return;
        const op = btn.getAttribute('data-bulk');
        const bulkApply = function () { keys.forEach(function (k) { if (op === 'ignore') IGNORE_CONFIG[k] = true; else delete IGNORE_CONFIG[k]; }); };
        bulkApply();
        saveIgnoreConfig(bulkApply);
        backdrop.remove();
        renderSummary(); renderTabs(); renderChannelTabs();
        renderSidebar(); renderSidebarChips(); renderContent();
      });
      document.body.appendChild(backdrop);
    }

    /* ---------- 忽略配置管理（查看 / 删除）：警告 / 未比较 XPath / 未比较 CSV ----------
     * 入口：警告 / 未比较选项卡工具栏的「管理忽略配置」（默认展示入口对应类型）。
     * 窗口只做查看与删除（不做新增 / 编辑）；列表支持表头排序与字段级下拉筛选（与主列表同一交互）。
     * 删除即：更新运行时扁平配置 -> 回写配置文件（POST /api/ignore，带 If-Match）-> 重绘当前数据集。 */
    let IGNORE_MGR = { kind: 'warn', sort: { col: -1, dir: 1 }, filters: [], page: 1 };
    // 分页行数：`limits.ignoreMgrPageSize`（默认 10，无页大小选择器）。
    // 排序 / 筛选图标的显隐按**条数**（而非页数）：超过该阈值才展示，否则保持列表简洁。
    const IGNORE_MGR_TOOLS_MIN_ROWS = 20;
    function ignoreMgrPageSize() {
      const n = APP_LIMITS.ignoreMgrPageSize;
      return (typeof n === 'number' && n > 0) ? Math.floor(n) : 10;
    }

    function ignoreKindDefs() {
      return [
        ['warn', 'ignoreManageKindWarn'],
        ['xpath', 'ignoreManageKindXpath'],
        ['csv', 'ignoreManageKindCsv'],
      ];
    }

    // 各类型条目表头（warn 多出作用域/类型/级别/关联字段；xpath/csv 共用平台/渠道/来源/元素）
    function ignoreMgrColumns(kind) {
      if (kind === 'warn') return ['sidebarPlatform', 'colChannel', 'colSource', 'colScope', 'colType', 'colLevel', 'colRelField'];
      return ['sidebarPlatform', 'colChannel', 'colSource', 'colElement'];
    }

    function ignoreMgrRowCells(e) {
      if (e.kind === 'warn') {
        return [e.platform, e.channel, e.source, e.scope === 'field' ? t('scopeField') : t('scopeChannel'), e.type, e.level, e.field];
      }
      return [e.platform, e.channel, e.source, e.value];
    }

    // 每条配置「实际忽略了多少条数据」：只统计当前 item 内命中该 key 的已忽略消息。
    // 说明：数据文件按 item 懒加载，跨 item 统计需要拉取全部 item 文件，因此不做（列头 tooltip 已声明口径）。
    function ignoredRowCounts(kind) {
      const it = currentItem();
      if (!it) return {};
      const tab = kind === 'warn' ? 'warnings' : 'uncompared';
      const list = (tab === 'warnings' ? (it.warnings || []) : (it.uncompared || [])).map(enrichMsg);
      return countIgnoredByKey(tab, list, IGNORE_CONFIG);
    }

    // 表头定义（列顺序 = 展示顺序）：数据列 + 「忽略条数」+ 「操作」。
    // 筛选交互：默认下拉框（选项取自当前数据的不同取值，精确匹配）；字段列（关联字段 / 元素）保留自由输入（包含匹配）。
    const IGNORE_MGR_TEXT_COLS = ['colRelField', 'colElement'];
    function ignoreMgrCols(kind) {
      const cols = ignoreMgrColumns(kind).map(function (k) {
        return { label: t(k), text: IGNORE_MGR_TEXT_COLS.indexOf(k) !== -1 };
      });
      // 「忽略条数」只参与排序，不做字段级筛选（数值列无需下拉筛选）。
      cols.push({ label: t('ignoreManageAffected'), tip: t('ignoreManageAffectedTip'), noFilter: true });
      cols.push({ label: t('colIgnored'), tools: false });
      return cols;
    }

    // 下拉框选项：该列在当前数据中的不同取值（码位排序保证次序确定），空格子单独提供一个「空值」选项。
    function ignoreMgrColOptions(rows, k) {
      const values = [];
      let hasEmpty = false;
      rows.forEach(function (r) {
        const v = String((r[k] && r[k].text) || '');
        if (v === '') { hasEmpty = true; return; }
        if (values.indexOf(v) === -1) values.push(v);
      });
      values.sort(function (a, b) { return a < b ? -1 : (a > b ? 1 : 0); });
      return { values: values, hasEmpty: hasEmpty };
    }

    // 行模型：每个单元格为 { text, cls }（供 filterTableRows / sortTableRows 复用），
    // 行数组 → 配置 key 的映射放在 Map 里（不污染数组对象）。
    function ignoreMgrRows(kind) {
      const list = listIgnoreEntries(IGNORE_CONFIG, kind);
      const hit = ignoredRowCounts(kind);
      const rowKey = new Map();
      const rows = list.map(function (e) {
        const cells = ignoreMgrRowCells(e).map(function (v) { return { text: v === '' ? '' : v, cls: '' }; });
        // 忽略条数：空串代表 0（渲染为 —），sortTableRows 会按数值排序且空值恒在后。
        const n = hit[e.key] || 0;
        cells.push({ text: n ? String(n) : '', cls: 'ignore-mgr-n', tip: t('ignoreManageAffectedTip') });
        cells.push({ text: '', cls: '' });                          // 操作列（不排序 / 不筛选）
        rowKey.set(cells, e.key);
        return cells;
      });
      return { rows: rows, rowKey: rowKey, total: list.length };
    }

    function renderIgnoreMgrBody() {
      const kind = IGNORE_MGR.kind;
      const counts = {};
      ignoreKindDefs().forEach(function (kv) { counts[kv[0]] = listIgnoreEntries(IGNORE_CONFIG, kv[0]).length; });
      const kinds = ignoreKindDefs().map(function (kv) {
        return '<button class="ignore-kind' + (kv[0] === kind ? ' active' : '') + '" data-ignore-kind="' + kv[0] + '">' +
          esc(t(kv[1])) + ' (' + counts[kv[0]] + ')</button>';
      }).join('');

      const cols = ignoreMgrCols(kind);
      const built = ignoreMgrRows(kind);
      // 工具显隐按「总条数」判定（与 descriptionEx 的按页数不同，避免 11~30 条时既不能排序也不能筛选）。
      // 工具隐藏时同时忽略已存的排序 / 筛选状态，避免筛选态与不可清除的隐藏行共存。
      const tools = built.total > IGNORE_MGR_TOOLS_MIN_ROWS;
      const pageSize = ignoreMgrPageSize();
      // 筛选规则：下拉列精确匹配（含「空值」哨兵），字段列包含匹配；列间 AND。
      const rules = [];
      if (tools) cols.forEach(function (c, k) {
        if (c.tools === false || c.noFilter) return;
        const v = IGNORE_MGR.filters[k];
        if (v == null || v === '') return;
        rules.push({ col: k, mode: c.text ? 'contains' : 'exact', value: v });
      });
      const matched = tools ? filterRowsByRules(built.rows, rules) : built.rows;
      const sorted = tools ? sortTableRows(matched, IGNORE_MGR.sort.col, IGNORE_MGR.sort.dir) : matched;
      const pg = paginateRows(sorted, IGNORE_MGR.page, pageSize);
      IGNORE_MGR.page = pg.page;                          // 越界（删除 / 筛选后）自动收敛

      // 表头：可排序列点击三态切换（升序 → 降序 → 原序）；可筛选列右侧 ⚲ 弹框做字段级筛选（列间 AND）。
      const head = cols.map(function (c, k) {
        const tipAttr = c.tip ? ' title="' + esc(c.tip) + '"' : '';
        if (c.tools === false || !tools) return '<th' + tipAttr + '>' + esc(c.label) + '</th>';
        const arrow = IGNORE_MGR.sort.col === k ? (IGNORE_MGR.sort.dir === 1 ? '▲' : '▼') : '⇅';
        const on = String(IGNORE_MGR.filters[k] || '').trim() !== '';
        const fbtn = c.noFilter ? '' : '<button class="mgr-fbtn' + (on ? ' active' : '') + '" data-mgr-filter="' + k + '" title="' + esc(t('ignoreManageFilterCol')) + '"' +
          ' aria-label="' + esc(t('ignoreManageFilterCol') + ' ' + c.label) + '">⚲</button>';
        return '<th' + tipAttr + '>' +
          '<span class="mgr-head" data-mgr-sort="' + k + '" title="' + esc(t('ignoreManageSortTitle')) + '">' + esc(c.label) +
          ' <span class="sort-arrow">' + arrow + '</span></span>' + fbtn + '</th>';
      }).join('');

      const last = cols.length - 1;
      const rows = pg.slice.map(function (r) {
        const key = built.rowKey.get(r);
        const tds = r.slice(0, last).map(function (c) {
          const cls = (c.cls ? ' class="' + c.cls + (c.text === '' ? ' zero' : '') + '"' : '');
          const tip = c.tip ? ' title="' + esc(c.tip) + '"' : '';
          return '<td' + cls + tip + '>' + (c.text === '' ? '—' : esc(c.text)) + '</td>';
        }).join('');
        return '<tr>' + tds + '<td><button class="del-btn" data-ignore-del="' + esc(key) + '" title="' +
          esc(t('ignoreManageDelete')) + '">' + esc(t('ignoreManageDelete')) + '</button></td></tr>';
      }).join('');

      let body;
      if (!built.total) {
        body = '<p class="ignore-mgr-empty">' + esc(t('ignoreManageEmpty')) + '</p>';
      } else {
        const emptyRow = rows ? '' : '<tr><td colspan="' + cols.length + '" class="empty">' + esc(t('ignoreManageNoMatch')) + '</td></tr>';
        // 仅 1 页时不展示分页控件。
        const pager = pg.pages > 1 ? ignoreMgrPagerHTML(pg.page, pg.pages) : '';
        body = '<div class="table-wrap"><table><thead><tr>' + head + '</tr></thead><tbody>' + rows + emptyRow + '</tbody></table></div>' + pager;
      }

      return '<div class="ignore-kinds">' + kinds + '</div>' + body;
    }

    function paintIgnoreMgr(backdrop) {
      const box = backdrop.querySelector('#ignoreMgrBody');
      if (box) box.innerHTML = renderIgnoreMgrBody();
    }

    // 分页控件（横向，跟进主列表的 .pagination / .pg 样式；每页条数由 limits.ignoreMgrPageSize 决定，无页大小选择器）。
    function ignoreMgrPagerHTML(page, pages) {
      let html = '<div class="pagination">';
      html += '<button class="pg" data-mgr-page="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + ' title="' + esc(t('pagePrev')) + '">‹</button>';
      pageItems(page, pages).forEach(function (it) {
        html += it === null
          ? '<span class="pg-gap">…</span>'
          : '<button class="pg' + (it === page ? ' cur' : '') + '" data-mgr-page="' + it + '">' + it + '</button>';
      });
      html += '<button class="pg" data-mgr-page="' + (page + 1) + '"' + (page >= pages ? ' disabled' : '') + ' title="' + esc(t('pageNext')) + '">›</button>';
      html += '<span class="pg-info">' + page + ' / ' + pages + ' ' + esc(t('pageOf')) + '</span>';
      return html + '</div>';
    }

    function openIgnoreManager() {
      const c = {};
      ignoreKindDefs().forEach(function (kv) { c[kv[0]] = listIgnoreEntries(IGNORE_CONFIG, kv[0]).length; });
      // 默认显示入口对应的配置：警告 tab -> 警告；未比较 tab -> 有内容的未比较类型（XPath 优先）。
      const defaultKind = state.tab === 'uncompared' ? (c.xpath ? 'xpath' : (c.csv ? 'csv' : 'xpath')) : 'warn';
      IGNORE_MGR = { kind: defaultKind, sort: { col: -1, dir: 1 }, filters: [], page: 1 };

      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML =
        '<div class="modal ignore-mgr" style="max-width:960px"><div class="modal-head"><h3>' + esc(t('ignoreManage')) + '</h3>' +
        '<button class="modal-close" aria-label="' + esc(t('closeLabel')) + '">✕</button></div>' +
        '<div class="modal-body"><div id="ignoreMgrBody"></div></div></div>';

      backdrop.addEventListener('click', function (e) {
        // 注意：这里不能用 openIgnoreManager 时的 kind（用户可能已切过类型），一律以 IGNORE_MGR.kind 为准。
        if (e.target === backdrop || e.target.closest('.modal-close')) { closePopover(); backdrop.remove(); return; }
        const kindBtn = e.target.closest('[data-ignore-kind]');
        if (kindBtn) {
          // 切类型时关闭筛选浮层（列数/列义不同）并重置排序 / 筛选 / 页码。
          closePopover();
          IGNORE_MGR = { kind: kindBtn.getAttribute('data-ignore-kind'), sort: { col: -1, dir: 1 }, filters: [], page: 1 };
          paintIgnoreMgr(backdrop);
          return;
        }
        const mgrPage = e.target.closest('[data-mgr-page]');
        if (mgrPage) {
          if (mgrPage.disabled) return;
          closePopover();
          IGNORE_MGR.page = parseInt(mgrPage.getAttribute('data-mgr-page'), 10) || 1;
          paintIgnoreMgr(backdrop);
          return;
        }
        const sortEl = e.target.closest('[data-mgr-sort]');
        if (sortEl) {
          IGNORE_MGR.sort = cycleSort(IGNORE_MGR.sort, parseInt(sortEl.getAttribute('data-mgr-sort'), 10));
          IGNORE_MGR.page = 1;
          paintIgnoreMgr(backdrop);
          return;
        }
        const fbtn = e.target.closest('[data-mgr-filter]');
        if (fbtn) {
          const k = parseInt(fbtn.getAttribute('data-mgr-filter'), 10);
          const curKind = IGNORE_MGR.kind;                        // 当前实际类型（可能已切过页签）
          // 再次点击同一列的 ⚲ = 关闭浮层（不改变筛选值）；重绘后锚点是新节点，故按「类型 + 列」判断。
          const colId = curKind + ':' + k;
          if (POPOVER.el && POPOVER.el.__mgrFilter === colId) { closePopover(); return; }
          const col = ignoreMgrCols(curKind)[k];
          const cur = IGNORE_MGR.filters[k] || '';
          const width = 220;
          let content;
          if (col && col.text) {
            // 字段列（关联字段 / 元素）：自由输入 + 包含匹配（与之前一致）。
            const wrap = document.createElement('div');
            wrap.innerHTML = '<input type="search" class="pop-control" placeholder="' + esc(t('ignoreManageFilterCol')) +
              '" value="' + esc(cur) + '">';
            content = wrap.firstChild.outerHTML;
          } else {
            // 其它列：下拉框式筛选，选项为该列在当前数据中的不同取值（精确匹配）。
            const opts = ignoreMgrColOptions(ignoreMgrRows(curKind).rows, k);
            content = '<select class="pop-control">' +
              '<option value=""' + (cur === '' ? ' selected' : '') + '>' + esc(t('all')) + '</option>' +
              opts.values.map(function (v) {
                return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(v) + '</option>';
              }).join('') +
              (opts.hasEmpty ? '<option value="' + FILTER_EMPTY + '"' + (cur === FILTER_EMPTY ? ' selected' : '') + '>' +
                esc(t('specialEmpty')) + '</option>' : '') +
              '</select>';
          }
          const pop = openPopover(fbtn, content, '', width);
          pop.__mgrFilter = colId;
          pop.classList.add('popover-raised');            // 需高于 .modal-backdrop（z-index 50）
          const ctrl = pop.querySelector('.pop-control');
          if (ctrl && ctrl.tagName === 'SELECT') {
            ctrl.addEventListener('change', function () {
              IGNORE_MGR.filters[k] = ctrl.value;
              IGNORE_MGR.page = 1;
              paintIgnoreMgr(backdrop);
              closePopover();
            });
          } else if (ctrl) {
            ctrl.focus();
            ctrl.addEventListener('input', function () {
              IGNORE_MGR.filters[k] = ctrl.value;
              IGNORE_MGR.page = 1;
              paintIgnoreMgr(backdrop);                   // 只重绘列表，输入框在浮层内不受影响
            });
          }
          return;
        }
        const del = e.target.closest('[data-ignore-del]');
        if (del) {
          const key = del.getAttribute('data-ignore-del');
          IGNORE_CONFIG = removeIgnoreKeys(IGNORE_CONFIG, [key]);
          // 回写配置文件（带 If-Match 乐观并发；冲突时按服务端收敛并重放本次删除）。
          saveIgnoreConfig(function () { IGNORE_CONFIG = removeIgnoreKeys(IGNORE_CONFIG, [key]); });
          renderAfterIgnoreChange();
        }
      });

      document.body.appendChild(backdrop);
      paintIgnoreMgr(backdrop);
    }

    // 主列表字段的 警告/错误 图标跳转：切到对应选项卡并填充 报告渠道+来源渠道+关联字段 筛选项。
    // 无有效值的属性不参与筛选。
    function jumpToFieldMsg(kind, channel, source, field) {
      state.tab = kind === 'errors' ? 'errors' : 'warnings';
      state.rowId = -1;
      state.page = 1;
      state.msgPage = 1;
      state.msgSort = { key: '', dir: 1 };
      state.msgFilter = {};
      // 清空全局搜索，避免遗留搜索词过滤掉目标消息；同步列筛选，保持筛选 chips 一致。
      state.search = '';
      const searchEl = document.getElementById('search');
      if (searchEl) searchEl.value = '';
      if (channel) { state.channel = channel; state.colFilter.channel = channel; }
      if (source) { state.source = source; state.colFilter.source = source; }
      if (field) state.msgFilter.field = field;
      closePopover();
      render();
    }

    // 从警告/错误选项卡点击「关联字段」：跳转到主列表（字段比较）并定位到该字段行。
    function jumpToFieldRow(channel, source, fieldName) {
      const it = currentItem();
      if (!it || !fieldName) return;
      const ch = (it.channels || []).find(function (c) { return c.name === channel; });
      if (!ch) return;
      const fd = (ch.fields || []).find(function (f) { return f.name === fieldName; });
      if (!fd) return;
      // 切到字段比较 tab，并清空可能遮挡目标行的筛选/搜索/排序。
      state.tab = 'fields';
      state.channel = channel || 'ALL';
      state.source = source || 'ALL';
      state.colFilter = { channel: state.channel, source: state.source, field: '', userTag: 'ALL', eoEl: '', aoEl: '', eoCvtEl: '', aoCvtEl: '', vdtEl: '', type: 'ALL', ctxs: '', eoUnconverted: '', eo: '', aoUnconverted: '', ao: '', result: 'ALL', remarks: '' };
      state.specialFilter = { eo: 'ALL', ao: 'ALL' };
      state.sort = { key: '', dir: 1 };
      state.search = '';
      const searchEl = document.getElementById('search');
      if (searchEl) searchEl.value = '';
      // 计算目标行所在页码（分页可能让字段不在第 1 页）。
      const rows = filteredFields(it);
      let targetKey = null;
      let targetIdx = -1;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.channel === channel && r.field === fieldName && (!source || r.source === source)) {
          state.page = Math.floor(i / state.pageSize) + 1;
          targetKey = fieldLocKey(r.channel, r.source, r.id);
          targetIdx = r._idx;
          break;
        }
      }
      if (!targetKey) state.page = 1;
      state.rowId = targetIdx;
      closePopover();
      render();
      // 渲染完成后滚动到目标行并高亮。
      const key = targetKey;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (!key) return;
          const trs = document.querySelectorAll('#fTbody tr[data-fid]');
          for (let i = 0; i < trs.length; i++) {
            if (trs[i].getAttribute('data-fid') === key) {
              trs[i].scrollIntoView({ block: 'center', behavior: 'smooth' });
              trs[i].classList.add('flash-row');
              setTimeout(function () { trs[i].classList.remove('flash-row'); }, 1800);
              // 选中该行：聚焦使其进入选中态（蓝框），focusin 会同步 fr 到 URL。
              try { trs[i].focus({ preventScroll: true }); } catch (e) { trs[i].focus(); }
              return;
            }
          }
        });
      });
    }

    function renderMessages(level) {
      const tab = level === 'warning' ? 'warnings' : 'errors';
      const list = getMsgRows(tab);
      const isWarn = tab === 'warnings';
      const unignored = isWarn ? list.filter(function (m) { return !msgIsIgnored('warnings', m); }).length : 0;
      const ignoredN = isWarn ? list.length - unignored : 0;
      const meta = list.length + ' ' + (isWarn ? t('metaWarnings') + '（' + t('metaUnignored') + ' ' + unignored + ' / ' + t('metaIgnored') + ' ' + ignoredN + '）' : t('metaErrors')) + t('metaInfo') + scopeLabel() + t('metaClose');
      renderMsgTable(tab, meta);
    }

    function renderUncompared() {
      renderMsgTable('uncompared', getMsgRows('uncompared').length + ' ' + t('metaUncompared') + scopeLabel() + t('metaClose'));
    }

    function renderUncomparedItems() {
      renderMsgTable('uncomparedItems', getMsgRows('uncomparedItems').length + ' ' + t('metaUncomparedItems') + scopeLabel() + t('metaClose'));
    }

    function renderLogs() {
      let lines = scopeLogs();
      if (state.search.trim()) {
        const q = state.search.trim().toLowerCase();
        lines = lines.filter(l => String(l.text || '').toLowerCase().includes(q));
      }
      const html = lines.map(l => '<div class="log-line">' + esc(l.text || '') + '</div>').join('');
      document.getElementById('content').innerHTML =
        '<div class="log-box">' + (html || '<div>无日志</div>') + '</div>' +
        '<div class="meta-note">' + lines.length + ' ' + t('metaLogs') + scopeLabel() + t('metaClose') + '</div>';
    }

    function renderDisabledChannel(name) {
      const ch = CHANNELS.find(function (c) { return c.name === name; });
      document.getElementById('content').innerHTML =
        '<div class="channel-disabled">' +
        '<div class="cd-title">' + t('disabledTitle1') + esc(name) + t('disabledTitle2') + '</div>' +
        '<div class="cd-desc">' + channelDesc(name) + ' ' + t('disabledDesc') + '</div>' +
        '</div>';
    }

    function renderContent() {
      if (!isTabEnabled(state.tab)) state.tab = 'fields';
      if (!currentItem()) { document.getElementById('content').innerHTML = '<div class="empty">' + t('emptyDataHint') + '</div>'; return; }
      if (state.channel !== 'ALL' && currentItem().enabledChannels.indexOf(state.channel) === -1) {
        renderDisabledChannel(state.channel);
        return;
      }
      if (state.tab === 'fields') renderFields();
      else if (state.tab === 'warnings') renderMessages('warning');
      else if (state.tab === 'errors') renderMessages('error');
      else if (state.tab === 'uncompared') renderUncompared();
      else if (state.tab === 'uncomparedItems') renderUncomparedItems();
      else if (state.tab === 'logs') renderLogs();
      else if (state.tab === 'compare') renderCompare();
      syncHash();
    }

    function render() {
      closePopover();
      updateEnvBadge();
      if (!isTabEnabled(state.tab)) state.tab = 'fields';
      if (!DATA.items.length) { renderEmptyState(); return; }
      renderSidebar();
      renderSidebarChips();
      renderSummary();
      renderMeta();
      renderFiles();
      renderTaskNote();
      applyCreationType();
      renderCharts();
      renderReportCats();
      renderTabs();
      renderChannelTabs();
      renderFilterChips();
      renderContent();
      syncHash();
    }

    // 「显示警告错误标记」开关：开启后显式显示字段列中所有关联警告/错误的图标（无需悬停）。
    function setFieldMsgShow(on) {
      state.showFieldMsg = !!on;
      renderChannelTabs();
      if (state.tab === 'fields') {
        const wrap = document.querySelector('#content .table-wrap');
        if (wrap) wrap.classList.toggle('show-field-msg', state.showFieldMsg);
      }
    }
    function toggleFieldMsg() { setFieldMsgShow(!state.showFieldMsg); }

    // 空数据集（0 个 item）时的友好空状态。
    function renderEmptyState() {
      renderSidebar();
      renderSidebarChips();
      document.getElementById('summary').innerHTML = '<div class="empty-hint">' + t('emptyDataTitle') + '</div>';
      document.getElementById('itemMeta').innerHTML = '';
      document.getElementById('reportMeta').textContent = '';
      document.getElementById('channelMeta').textContent = '';
      const ri = document.getElementById('reportInfo');
      if (ri) ri.style.display = 'none';
      document.getElementById('tabs').innerHTML = '';
      document.getElementById('channelTabs').innerHTML = '';
      document.getElementById('filterChips').innerHTML = '';
      document.getElementById('content').innerHTML = '<div class="empty">' + t('emptyDataHint') + '</div>';
      updateMiniSummary({ rate: 0, failed: 0, warnings: 0, warningsIgnored: 0 });
      syncHash();
    }

    /* ---------- 详情弹窗 ---------- */
    let CTX_DEF_POPUP = null;
    let RULE_POPUP = null;
    const RULE_POPUPS = {};
    function closeRulePopup() {
      if (RULE_POPUP) { RULE_POPUP.remove(); RULE_POPUP = null; }
    }
    let LAST_FOCUS = null;
    function closeCtxDefPopup() {
      if (CTX_DEF_POPUP) { CTX_DEF_POPUP.remove(); CTX_DEF_POPUP = null; }
    }
    function closeModal() {
      const b = document.querySelector('.modal-backdrop');
      if (b) b.remove();
      closeCtxDefPopup();
      closeRulePopup();
      closeValPanel();
      if (LAST_FOCUS && document.body.contains(LAST_FOCUS)) { try { LAST_FOCUS.focus(); } catch (e) {} }
      LAST_FOCUS = null;
    }

    // CtxKey 类型（数组）：1 字段映射规则 / 2 值转换规则 / 3 终值校验规则。
    // 同一个 ctx key 的定义与求值可被多种规则共享，因此 type 为数组；
    // 兼容旧数据的单值 number（归一化为单元素数组）。
    const CTX_TYPE_META = {
      1: { label: 'ctxTypeMapping' },
      2: { label: 'ctxTypeConversion' },
      3: { label: 'ctxTypeValidation' },
    };
    function ctxDefsOf() {
      const it = currentItem();
      return (it && it.ctxDefs) || {};
    }
    function ctxDefById(id) {
      const defs = ctxDefsOf();
      // data-ctx 属性为字符串，而 ctxDefs.id 为数字，统一按数值匹配。
      const num = Number(id);
      for (const k in defs) {
        if (Number(defs[k].id) === num) return { key: k, def: defs[k] };
      }
      return { key: String(id), def: {} };
    }
    function ctxScopes(id) {
      const d = ctxDefById(id).def;
      const s = d.scopes;
      if (Array.isArray(s)) return s.filter(function (t) { return t === 1 || t === 2 || t === 3; });
      if (s === 1 || s === 2 || s === 3) return [s];
      return [];
    }
    function ctxTagsHTML(ctxArr) {
      return (ctxArr || []).map(function (id) {
        const key = ctxDefById(id).key;
        return '<span class="ctx-tag" data-ctx="' + esc(id) + '">' + esc(key) + '</span>';
      }).join('');
    }

    function ruleValueHTML(value) {
      const s = value == null ? '' : String(value);
      return valueCellHTML(s || '—');
    }

    function extraResultsHTML(f) {
      let items = (Array.isArray(f.resultDetails) && f.resultDetails.length) ? f.resultDetails : [];
      if (!items.length && f.cvtLeft && f.cvtLeft.raw != null) items = [{ label: t('modalEOUnconverted'), value: f.cvtLeft.raw }];
      return items.map(function (r) {
        return '<div class="result-extra"><div class="ri-label">' + esc(r.label) + '</div><div class="ri-value">' + esc(r.value == null ? '' : r.value) + '</div></div>';
      }).join('');
    }

    function showCtxDefPopup(anchor, ctxId) {
      // 再次点击同一标签：关闭（切换）；点击其他标签：直接切换展开当前标签。
      if (CTX_DEF_POPUP && CTX_DEF_POPUP.__ctxKey === ctxId) { closeCtxDefPopup(); return; }
      closeCtxDefPopup();
      closeRulePopup();
      const found = ctxDefById(ctxId);
      const def = found.def;
      // 来源类型（builtin / user）放在 scopes 标签最前面，以不同样式区分。
      const origin = def.type === 'user' ? 'user' : 'builtin';
      const originBadge = '<span class="ctx-origin-badge ' + origin + '">' + (origin === 'user' ? t('ctxOriginUser') : t('ctxOriginBuiltin')) + '</span>';
      // 命中详情显示所有 scopes（一个 ctx 可能同时用于多种规则）。
      const typeBadges = ctxScopes(ctxId).map(function (tp) {
        return '<span class="ctx-type-badge t' + tp + '">' + t(CTX_TYPE_META[tp].label) + '</span>';
      }).join(' ');
      const pop = document.createElement('div');
      pop.className = 'ctx-def-popup';
      pop.innerHTML =
        '<div class="ctx-def-key">' + esc(found.key) + '</div>' +
        '<div class="ctx-def-type">' + originBadge + (typeBadges ? ' ' + typeBadges : '') + '</div>' +
        '<div class="ctx-def-row"><span class="ctx-def-label">' + t('ctxDefLabel') + '</span><span class="ctx-def-value">' + esc(def.def || '—') + '</span></div>' +
        '<div class="ctx-def-row"><span class="ctx-def-label">' + t('ctxHitLabel') + '</span><span class="ctx-def-value">' + esc(def.hits || '—') + '</span></div>';
      document.body.appendChild(pop);
      const r = anchor.getBoundingClientRect();
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      let left = r.left, top = r.bottom + 6;
      if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
      if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
      pop.__ctxKey = ctxId;
      CTX_DEF_POPUP = pop;
    }

    // 规则详情弹窗：点击规则标题，只读取对应对象的 elRaw 数据字段并展示（直接切换，再次点击同一标题才关闭）。
    function showRulePopup(anchor, key) {
      const cfg = RULE_POPUPS[key];
      if (!cfg) return;
      if (RULE_POPUP && RULE_POPUP.__key === key) { closeRulePopup(); return; }
      closeRulePopup();
      closeCtxDefPopup();
      const pop = document.createElement('div');
      pop.className = 'ctx-def-popup rule-popup';
      const raw = (cfg.raw == null || cfg.raw === '') ? t('rcNone') : cfg.raw;
      pop.innerHTML =
        '<div class="ctx-def-key">' + esc(cfg.title) + '</div>' +
        '<div class="rp-field"><div class="rp-field-label">' + t('rcRawConfig') + '</div>' +
        '<pre class="rp-text">' + esc(raw) + '</pre></div>';
      document.body.appendChild(pop);
      const r = anchor.getBoundingClientRect();
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      let left = r.left, top = r.bottom + 6;
      if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
      if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
      pop.style.left = left + 'px';
      pop.style.top = top + 'px';
      pop.__key = key;
      RULE_POPUP = pop;
    }

    function ruleCtxHTML(ctxText, ctxArr) {
      // ctx 头文本：优先显示规则对象的 ctx（命中 ctxKey 的原始字符串表达式，如 "hktr.ctx.default and hktr.ctx.v2"），
      // 其每个元 ctxKey 的 id 引用在同级别 ctxs 数组中；缺失时回退为标签 key 列表。下方再渲染可点击标签。
      const arr = ctxArr || [];
      const keys = arr.map(function (id) { return ctxDefById(id).key; });
      const data = (ctxText != null && ctxText !== '') ? ctxText : keys.join(' ');
      const tags = ctxTagsHTML(arr);
      return '<div class="rc-row rc-ctx">' +
        '<span class="rc-label">' + t('rcCtxLabel') + '</span>' +
        '<div class="rc-ctx-body">' +
        '<span class="rc-ctx-data">' + (data ? esc(data) : '—') + '</span>' +
        (tags ? '<div class="rc-ctx-tags">' + tags + '</div>' : '') +
        '</div>' +
        '</div>';
    }
    function ruleNoneHTML() { return '<span class="rc-none">' + t('rcNone') + '</span>'; }
    // 规则 section：标题可点击弹出该对象的 elRaw；正文先显示「值」，再显示 ctx。
    function ruleSectionHTML(key, title, valueHTML, ctxHTML) {
      return '<div class="rule-section">' +
        '<button class="rule-section-title" data-rule-popup="' + key + '">' + esc(title) + '</button>' +
        '<div class="rule-body">' +
        '<div class="rc-row"><span class="rc-label">' + t('rcValueLabel') + '</span><div class="rc-value">' + valueHTML + '</div></div>' +
        ctxHTML +
        '</div>' +
        '</div>';
    }
    // 规则对（EO / AO 两栏并排，与期望值/实际值两栏布局一致）。
    function rulePairHTML(leftSection, rightSection) {
      return '<div class="rule-pair">' + leftSection + rightSection + '</div>';
    }

    function openModal(channel, source, id, fromGlobal) {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      document.body.appendChild(backdrop);

      const navState = { channel: channel, source: source, id: id, fromGlobal: !!fromGlobal };
      const view = { navInfo: null, rulesExpanded: false };

      // 依据 (channel, source, id) 构建弹窗内容；返回 html 与 navInfo。
      function buildContent(ch, src, fid, isGlobal) {
        const found = findField(currentItem(), ch, src, fid);
        if (!found) return null;
        const f = found.field;
        const def = fieldDef(found.ch, fid) || {};
        let navInfo = null;
        if (!isGlobal) {
          const rows = filteredFields(currentItem());
          const idx = rows.findIndex(function (r) { return r.channel === found.channel && r.source === found.source && r.id === fid; });
          navInfo = {
            prev: idx > 0 ? rows[idx - 1] : null,
            next: idx >= 0 && idx < rows.length - 1 ? rows[idx + 1] : null,
          };
        }
        const pass = f.result === 'PASSED';
        const left = f.cmpLeft || {};
        const right = f.cmpRight || {};
        const cvtLeft = f.cvtLeft || null;
        const cvtRight = f.cvtRight || null;
        const vdt = f.vdt || null;
        const eoBox = '<div class="result-cell"><div class="ri-label">' + t('modalEO') + '</div><div class="ri-value">' + (pass ? esc(left.value) : diffPairHTML(left.value, right.value).eo) + '</div></div>';
        const aoBox = '<div class="result-cell"><div class="ri-label">' + t('modalAO') + '</div><div class="ri-value">' + (pass ? esc(right.value) : diffPairHTML(left.value, right.value).ao) + '</div></div>';
        const extraHtml = extraResultsHTML(f);

        RULE_POPUPS.mappingEO = { title: t('modalMappingRuleEO'), raw: left.elRaw };
        RULE_POPUPS.mappingAO = { title: t('modalMappingRuleAO'), raw: right.elRaw };
        RULE_POPUPS.convEO = { title: t('modalConversionRuleEO'), raw: cvtLeft ? cvtLeft.elRaw : null };
        RULE_POPUPS.convAO = { title: t('modalConversionRuleAO'), raw: cvtRight ? cvtRight.elRaw : null };
        RULE_POPUPS.validation = { title: t('modalValidationRule'), raw: vdt ? vdt.elRaw : null };

        const noneHtml = ruleNoneHTML();
        const mapRuleHtml = APP_FEATURES.excelMapping
          ? rulePairHTML(
              ruleSectionHTML('mappingEO', t('modalMappingRuleEO'), ruleValueHTML(left.el || '—'), ruleCtxHTML(left.ctx, left.ctxs)),
              ruleSectionHTML('mappingAO', t('modalMappingRuleAO'), ruleValueHTML(right.el || '—'), ruleCtxHTML(right.ctx, right.ctxs)))
          : '';
        const convRuleHtml = APP_FEATURES.conversionRule
          ? rulePairHTML(
              ruleSectionHTML('convEO', t('modalConversionRuleEO'), cvtLeft ? ruleValueHTML(cvtLeft.el || '—') : noneHtml, ruleCtxHTML(cvtLeft ? cvtLeft.ctx : null, cvtLeft ? cvtLeft.ctxs : null)),
              ruleSectionHTML('convAO', t('modalConversionRuleAO'), cvtRight ? ruleValueHTML(cvtRight.el || '—') : noneHtml, ruleCtxHTML(cvtRight ? cvtRight.ctx : null, cvtRight ? cvtRight.ctxs : null)))
          : '';
        const valRuleHtml = APP_FEATURES.validationRule
          ? ruleSectionHTML('validation', t('modalValidationRule'), vdt ? ruleValueHTML(vdt.el || '—') : noneHtml, ruleCtxHTML(vdt ? vdt.ctx : null, vdt ? vdt.ctxs : null))
          : '';

        const eoElLabel = t('sourceChannelRule');
        const aoElLabel = t('reportChannelRule');
        const eoElValue = left.el || '—';
        const aoElValue = right.el || '—';
        const navBtns = (!isGlobal && navInfo)
          ? '<button class="modal-nav" data-modal-nav="prev" title="' + t('modalPrevField') + '"' + (navInfo.prev ? '' : ' disabled') + '>←</button>' +
            '<button class="modal-nav" data-modal-nav="next" title="' + t('modalNextField') + '"' + (navInfo.next ? '' : ' disabled') + '>→</button>'
          : '';

        const html =
          '<div class="modal">' +
          '<div class="modal-head"><div class="modal-head-left"><h3>' + t('modalTitle') + '：' + esc(def.name) + '</h3><span class="modal-item-chip">' + esc(currentItem().tradeId) + '</span></div>' +
          '<div class="modal-head-right">' + (isGlobal ? '<button class="modal-goto" data-modal-jump="1">' + t('backToItem') + '</button>' : '') + navBtns + '<button class="modal-close" title="' + t('closeLabel') + '">✕</button></div></div>' +
          '<div class="modal-body">' +
          '<div class="kv">' +
          '<span class="k">' + t('modalChannel') + '</span><span class="v">' + esc(found.channel) + '</span>' +
          '<span class="k">' + t('modalSource') + '</span><span class="v">' + esc(found.source) + '</span>' +
          '<span class="k">' + t('modalField') + '</span><span class="v">' + esc(def.name) + '</span>' +
          '<span class="k">' + eoElLabel + '</span><span class="v">' + esc(eoElValue) + '</span>' +
          '<span class="k">' + aoElLabel + '</span><span class="v">' + esc(aoElValue) + '</span>' +
          '<span class="k">' + t('modalUserTag') + '</span><span class="v">' + userTagHTML(def.userTag) + '</span>' +
          '<span class="k">' + t('modalResult') + '</span><span class="v"><span class="badge ' + (pass ? 'pass' : 'fail') + '">' + f.result + '</span>' +
          (f.resultText ? '　' + hoverCellHTML(f.resultText) : '') + '</span>' +
          '</div>' +
          '<div class="modal-part">' +
          '<div class="result-pair">' + eoBox + aoBox + '</div>' +
          extraHtml +
          '</div>' +
          (APP_FEATURES.modalRules && (mapRuleHtml || convRuleHtml || valRuleHtml)
            ? '<div class="modal-part modal-rules">' +
              '<button class="modal-part-head" data-rules-toggle="1">' +
              '<span>' + t('modalRulesTitle') + '</span>' +
              '<span class="rules-arrow">▸</span>' +
              '</button>' +
              '<div class="modal-part-body" hidden>' + mapRuleHtml + convRuleHtml + valRuleHtml + '</div>' +
              '</div>'
            : '') +
          (APP_FEATURES.modalPrints ? '<div class="print-box"><div class="pb-head">' + t('modalPrints') + '</div>' +
          '<div class="log-box">' + (f.prints || []).map(p => '<div class="log-line">' + esc(p) + '</div>').join('') + '</div>' +
          '</div>' : '') +
          '</div></div>';
        return { html: html, navInfo: navInfo };
      }

      function focusableEls() {
        return backdrop.querySelectorAll('button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
      }

      function render(animate, focusDir) {
        const b = buildContent(navState.channel, navState.source, navState.id, navState.fromGlobal);
        if (!b) { backdrop.remove(); return; }
        view.navInfo = b.navInfo;
        view.rulesExpanded = false;
        backdrop.innerHTML = b.html;
        const modal = backdrop.querySelector('.modal');
        if (modal && animate) {
          modal.classList.remove('content-swap');
          void modal.offsetWidth;
          modal.classList.add('content-swap');
        }
        const mb = backdrop.querySelector('.modal-body');
        if (mb) mb.scrollTop = 0;
        let focused = false;
        if (focusDir) {
          const navBtn = backdrop.querySelector('[data-modal-nav="' + focusDir + '"]:not([disabled])');
          if (navBtn) { navBtn.focus(); focused = true; }
        }
        if (!focused) {
          const list = focusableEls();
          if (list.length) list[0].focus();
        }
      }

      function navigateTo(target, dir) {
        if (!target) return;
        closeCtxDefPopup();
        closeRulePopup();
        closeValPanel();
        navState.channel = target.channel;
        navState.source = target.source;
        navState.id = target.id;
        navState.fromGlobal = false;
        render(true, dir);
      }

      backdrop.addEventListener('click', function (e) {
        const tag = e.target.closest('.ctx-tag');
        if (tag) { showCtxDefPopup(tag, tag.getAttribute('data-ctx')); return; }
        const valExp = e.target.closest('[data-val-expand]');
        if (valExp) { openValPanel(valExp, valExp.getAttribute('data-val')); return; }
        const rp = e.target.closest('[data-rule-popup]');
        if (rp) { showRulePopup(rp, rp.getAttribute('data-rule-popup')); return; }
        const rt = e.target.closest('[data-rules-toggle]');
        if (rt) {
          view.rulesExpanded = !view.rulesExpanded;
          const body = backdrop.querySelector('.modal-part-body');
          if (body) body.hidden = !view.rulesExpanded;
          const arrow = rt.querySelector('.rules-arrow');
          if (arrow) arrow.textContent = view.rulesExpanded ? '▾' : '▸';
          return;
        }
        const nav = e.target.closest('[data-modal-nav]');
        if (nav && !nav.disabled) {
          const dir = nav.getAttribute('data-modal-nav');
          navigateTo(dir === 'prev' ? view.navInfo.prev : view.navInfo.next, dir);
          return;
        }
        if (e.target.closest('[data-modal-jump]')) {
          closeModal();
          const detail = document.querySelector('.detail');
          if (detail) {
            detail.scrollIntoView({ block: 'start', behavior: 'smooth' });
            detail.classList.add('flash');
            setTimeout(function () { detail.classList.remove('flash'); }, 1200);
          }
          return;
        }
        if (e.target === backdrop || e.target.closest('.modal-close')) closeModal();
      });

      backdrop.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const dir = e.key === 'ArrowLeft' ? 'prev' : 'next';
          const target = view.navInfo && view.navInfo[dir];
          if (target) { e.preventDefault(); navigateTo(target, dir); }
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          // 上下方向键不触发任何聚焦/滚动行为，保持静止。
          e.preventDefault();
          return;
        }
        if (e.key !== 'Tab') return;
        const list = focusableEls();
        if (!list.length) return;
        const first = list[0], last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });

      LAST_FOCUS = document.activeElement;
      render(false);
    }

    /* ---------- URL 深链接（hash） ---------- */
    // 纯函数：把 hash 字符串解析为参数表（便于单测；hashParams() 只是读 location.hash）。
export function parseHash(raw) {
      const p = {};
      String(raw || '').replace(/^#/, '').split('&').forEach(function (kv) {
        if (!kv) return;
        const i = kv.indexOf('=');
        const k = i === -1 ? kv : kv.slice(0, i);
        const v = i === -1 ? '' : kv.slice(i + 1);
        try { p[k] = decodeURIComponent(v); } catch (e) { p[k] = v; }
      });
      return p;
    }
    function hashParams() {
      return parseHash(location.hash);
    }
    function stateToHash() {
      const parts = [];
      if (BATCH_STATE.active) parts.push('batch=' + encodeURIComponent(BATCH_STATE.active.batchId));
      parts.push('item=' + encodeURIComponent(state.itemId));
      if (state.channel !== 'ALL') parts.push('ch=' + encodeURIComponent(state.channel));
      if (state.tab !== 'fields') parts.push('tab=' + encodeURIComponent(state.tab));
      if (state.search) parts.push('q=' + encodeURIComponent(state.search));
      if (state.tab === 'fields' && state.colFilter.result && state.colFilter.result !== 'ALL') parts.push('result=' + encodeURIComponent(state.colFilter.result));
      if (state.rowId >= 0) parts.push('fr=' + state.rowId);
      if (state.page > 1) parts.push('page=' + state.page);
      if (state.sort.key) parts.push('sort=' + encodeURIComponent(state.sort.key) + (state.sort.dir < 0 ? ':d' : ''));
      // 列可见性：仅编码与默认值不同的键，减小 URL 体积。
      const cols = Object.keys(state.columns).filter(function (k) { return state.columns[k] !== DEFAULT_COLUMNS[k]; });
      if (cols.length) parts.push('cols=' + encodeURIComponent(cols.map(function (k) { return k + '=' + (state.columns[k] ? '1' : '0'); }).join(',')));
      // 列过滤器：仅编码非默认值。
      const filters = {};
      Object.keys(state.colFilter).forEach(function (k) {
        const v = state.colFilter[k];
        if (v && v !== 'ALL') filters[k] = v;
      });
      if (Object.keys(filters).length) parts.push('filters=' + encodeURIComponent(JSON.stringify(filters)));
      // 侧栏 item 筛选器
      if (state.itemSearch) parts.push('is=' + encodeURIComponent(state.itemSearch));
      if (state.itemFilter !== 'ALL') parts.push('st=' + encodeURIComponent(state.itemFilter));
      if (state.itemPlatforms.length) parts.push('pf=' + encodeURIComponent(state.itemPlatforms.join(',')));
      if (state.itemProducts.length) parts.push('pd=' + encodeURIComponent(state.itemProducts.join(',')));
      if (state.itemTradeIds.length) parts.push('td=' + encodeURIComponent(state.itemTradeIds.join(',')));
      if (state.reportDateFilter) parts.push('dt=' + encodeURIComponent(state.reportDateFilter));
      if (state.sidebarPage > 1) parts.push('sp=' + state.sidebarPage);
      return '#' + parts.join('&');
    }
    function syncHash() {
      if (HASH_SYNC.applying) return;
      const h = stateToHash();
      if (location.hash !== h) { try { history.replaceState(null, '', h); } catch (e) { location.hash = h; } }
    }
    function applyHash() {
      const p = hashParams();
      if (!p.item) return;
      HASH_SYNC.applying = true;
      try {
        if (DATA.items.some(function (it) { return it.tradeId === p.item; })) state.itemId = p.item;
        if (p.ch === 'ALL') state.channel = 'ALL';
        else if (p.ch && CHANNELS.some(function (c) { return c.name === p.ch; })) state.channel = p.ch;
        if (p.tab) state.tab = p.tab;
        if (p.q !== undefined) state.search = p.q;
        if (p.result === 'PASSED' || p.result === 'FAILED') state.colFilter.result = p.result;
        if (p.page) state.page = parseInt(p.page, 10) || 1;
        if (p.sort) {
          const m = /^([^:]+)(?::([ad]))?$/.exec(p.sort);
          if (m && COLUMNS.some(function (c) { return c.key === m[1]; })) state.sort = { key: m[1], dir: m[2] === 'd' ? -1 : 1 };
        }
        if (p.cols) {
          p.cols.split(',').forEach(function (kv) {
            const i = kv.indexOf('=');
            if (i === -1) return;
            const k = kv.slice(0, i);
            if (COLUMNS.some(function (c) { return c.key === k; })) state.columns[k] = kv.slice(i + 1) === '1';
          });
        }
        if (p.filters) {
          try {
            const f = JSON.parse(p.filters);
            if (f && typeof f === 'object') Object.keys(f).forEach(function (k) {
              if (COLUMNS.some(function (c) { return c.key === k; })) state.colFilter[k] = String(f[k]);
            });
          } catch (e) {}
        }
        // 来源渠道作用域与列筛选在 UI 中始终同步：由 colFilter.source 回写 state.source（URL 未单列 source 参数）。
        state.source = state.colFilter.source;
        // 行选中（fr 行ID）必须在排序/筛选/列解析之后处理，rowPageFor 才能按最终列表定位页码。
        if (p.fr !== undefined) {
          state.rowId = parseInt(p.fr, 10);
          if (isNaN(state.rowId)) state.rowId = -1;
          else {
            RESTORE_ROW = true;
            const rp = rowPageFor(state.tab, state.rowId);
            if (rp != null) {
              if (state.tab === 'fields') state.page = rp;
              else state.msgPage = rp;
            }
          }
        } else {
          // URL 未指定行选中 → 破坏式清除选中态，避免手动去掉 fr 后旧 rowId 残留到其它 tab。
          state.rowId = -1;
          RESTORE_ROW = false;
        }
        // 侧栏 item 筛选器
        if (p.is !== undefined) state.itemSearch = p.is;
        if (p.st === 'PASSED' || p.st === 'FAILED' || p.st === 'WARN') state.itemFilter = p.st;
        else if (p.st === 'ALL') state.itemFilter = 'ALL';
        if (p.pf !== undefined) state.itemPlatforms = String(p.pf).split(',').filter(Boolean);
        if (p.pd !== undefined) state.itemProducts = String(p.pd).split(',').filter(Boolean);
        if (p.td !== undefined) state.itemTradeIds = String(p.td).split(',').filter(Boolean);
        if (p.dt !== undefined) state.reportDateFilter = p.dt;
        if (p.sp) state.sidebarPage = parseInt(p.sp, 10) || 1;
      } finally { HASH_SYNC.applying = false; }
      const searchEl = document.getElementById('search');
      if (searchEl) searchEl.value = state.search || '';
      const itemSearchEl = document.getElementById('itemSearch');
      if (itemSearchEl) itemSearchEl.value = state.itemSearch || '';
      // 状态筛选下拉不参与输入事件，必须显式回写，否则深链接（st=…）生效时下拉仍显示「全部状态」。
      const statusSel = document.getElementById('itemFilter');
      if (statusSel) statusSel.value = state.itemFilter || 'ALL';
      const dateInput = document.getElementById('reportDateFilter');
      if (dateInput) { dateInput.value = state.reportDateFilter || ''; dateInput.parentElement.classList.toggle('has-value', !!state.reportDateFilter); }
    }

    async function onHashChange() {
      const p = hashParams();
      const cur = BATCH_STATE.active && BATCH_STATE.active.batchId;
      if (p.batch && p.batch !== cur) {
        const b = batchById(p.batch);
        if (b && batchCompatible(b)) { loadBatch(b, false, true); return; }
        const msg = b ? t('batchUrlIncompat') : t('batchUrlMissing');
        await fallbackToDefaultReport(msg);
        return;
      }
      await ensureHashItemLoaded();
      applyHash();
      render();
    }

    /* ---------- 字段差异高亮（FAILED 字段逐字符 diff，核心算法见 core.js） ---------- */
    function diffHTML(segments) {
      return segments.map(function (seg) {
        const s = esc(seg.s);
        if (seg.t === 0) return s;
        return '<span class="' + (seg.t === 1 ? 'diff-del' : 'diff-add') + '">' + s + '</span>';
      }).join('');
    }
    function diffPairHTML(eo, ao) {
      const d = diffSegments(eo, ao);
      return { eo: diffHTML(d.a), ao: diffHTML(d.b) };
    }

    /* ---------- 统计图表（纯 CSS） ---------- */
    function renderCharts() {
      const it = currentItem();
      let chs = it.channels.filter(function (c) { return it.enabledChannels.indexOf(c.name) !== -1; });
      if (state.channel !== 'ALL') chs = chs.filter(function (c) { return c.name === state.channel; });
      let total = 0, passed = 0, failed = 0;
      const perCh = chs.map(function (ch) {
        let t = 0, p = 0, f = 0;
        ch.sources.forEach(function (s) { s.fields.forEach(function (fd) { t++; fd.result === 'PASSED' ? p++ : f++; }); });
        total += t; passed += p; failed += f;
        return { name: ch.name, total: t, passed: p, failed: f, rate: t ? Math.round(p / t * 100) : 0 };
      });
      const rate = total ? Math.round(passed / total * 100) : 0;
      const ring = '<div class="chart-ring" style="background:conic-gradient(var(--pass) ' + rate + '%, var(--bar-bg) ' + rate + '% 100%)"><div class="chart-ring-val">' + rate + '%</div></div>';
      const bars = perCh.map(function (c) {
        return '<div class="chart-bar-row"><div class="chart-bar-label"><span>' + esc(c.name) + '</span><b>' + c.passed + '/' + c.total + '</b></div>' +
          '<div class="chart-bar"><div class="chart-bar-fill pass" style="width:' + c.rate + '%"></div></div></div>';
      }).join('');
      const failBars = perCh.map(function (c) {
        const pct = c.total ? Math.round(c.failed / c.total * 100) : 0;
        return '<div class="chart-bar-row"><div class="chart-bar-label"><span>' + esc(c.name) + '</span><b>' + c.failed + '</b></div>' +
          '<div class="chart-bar"><div class="chart-bar-fill fail" style="width:' + pct + '%"></div></div></div>';
      }).join('');
      document.getElementById('charts').innerHTML =
        '<div class="chart-card"><div class="chart-title">' + t('chartOverall') + '</div><div class="chart-ring-row">' + ring +
        '<div style="font-size:12px;color:var(--muted);line-height:1.7">' + t('fieldsTotal') + ' ' + total + '<br>' + t('passed') + ' ' + passed + '<br>' + t('failed') + ' ' + failed + '</div></div></div>' +
        '<div class="chart-card"><div class="chart-title">' + t('chartChannelRate') + '</div>' + bars + '</div>' +
        '<div class="chart-card"><div class="chart-title">' + t('chartFailDist') + '</div>' + (failBars || '<div class="empty">无失败</div>') + '</div>';
    }

    /* ---------- 双渠道 / 双 item 对比 ---------- */
    function compareRows() {
      const it = currentItem();
      const mode = state.compare.mode;
      let chNameA = state.compare.channelA, chNameB = state.compare.channelB, itemB = it;
      if (mode === 'item') { itemB = DATA.items.find(function (x) { return x.tradeId === state.compare.itemB; }) || it; chNameB = chNameA; }
      const chA = it.channels.find(function (c) { return c.name === chNameA; });
      const chB = (itemB.channels || []).find(function (c) { return c.name === chNameB; });
      if (!chA || !chB) return [];
      const rows = [];
      chA.sources.forEach(function (sA) {
        sA.fields.forEach(function (fA) {
          const defA = fieldDef(chA, fA.id) || {};
          const sB = chB.sources.find(function (s) { return s.name === sA.name; });
          const fB = sB ? sB.fields.find(function (f) { const d = fieldDef(chB, f.id) || {}; return d.name === defA.name; }) : null;
          rows.push({ f: defA.name, source: sA.name, a: fA, b: fB });
        });
      });
      return rows;
    }
    function compareCell(f) {
      if (!f) return '<span class="cmp-val">' + t('compareNone') + '</span>';
      const pass = f.result === 'PASSED';
      return '<span class="badge ' + (pass ? 'pass' : 'fail') + '" title="' + f.result + '">' + (pass ? '✓' : '✕') + '</span> ' +
        '<span class="cmp-val">' + esc(preview((f.cmpLeft || {}).value)) + ' → ' + esc(preview((f.cmpRight || {}).value)) + '</span>';
    }
    function compareDiffOf(r) {
      if (!r.b) return 'diff';
      return (r.a.result === r.b.result && (r.a.cmpLeft || {}).value === (r.b.cmpLeft || {}).value && (r.a.cmpRight || {}).value === (r.b.cmpRight || {}).value) ? 'same' : 'diff';
    }
    function compareSortValue(r, key) {
      if (key === 'f') return r.f;
      if (key === 'source') return r.source;
      if (key === 'aResult') return r.a ? r.a.result : '';
      if (key === 'bResult') return r.b ? r.b.result : '';
      if (key === 'diff') return compareDiffOf(r);
      return '';
    }
    function compareSortArrow(key) {
      if (state.compare.sort.key !== key) return '⇅';
      return state.compare.sort.dir === 1 ? '▲' : '▼';
    }
    function compareFilterLabel(key, val) {
      if (val === 'ALL') return t('all');
      if (val === 'NONE') return t('compareNone');
      if (val === 'diff') return t('compareDiff');
      if (val === 'same') return t('compareSame');
      if (key === 'source') return val;
      return val;
    }
    function openCompareFilter(btn) {
      const key = btn.getAttribute('data-cf');
      const kind = btn.getAttribute('data-kind');
      const filter = state.compare.filter;
      let control;
      if (kind === 'select') {
        let opts;
        if (key === 'source') opts = ['ALL'].concat(sourceNames());
        else if (key === 'aResult' || key === 'bResult') opts = ['ALL', 'PASSED', 'FAILED', 'NONE'];
        else if (key === 'diff') opts = ['ALL', 'diff', 'same'];
        else opts = ['ALL'];
        control = '<select class="pop-control">' + opts.map(function (o) { return '<option value="' + o + '"' + (filter[key] === o ? ' selected' : '') + '>' + esc(compareFilterLabel(key, o)) + '</option>'; }).join('') + '</select>';
      } else {
        control = '<input class="pop-control" placeholder="' + t('toolbarSearch') + '" value="' + esc(filter[key] || '') + '">';
      }
      const pop = openPopover(btn, control);
      const ctrl = pop.querySelector('.pop-control');
      if (ctrl.tagName === 'INPUT') ctrl.focus();
      ctrl.addEventListener(kind === 'select' ? 'change' : 'input', function () {
        filter[key] = ctrl.value;
        state.compare.page = 1;
        renderContent();
        if (kind === 'select') closePopover();
      });
    }
    function filteredCompareRows() {
      let rows = compareRows();
      const f = state.compare.filter;
      if (f.f) rows = rows.filter(function (r) { return String(r.f).toLowerCase().indexOf(f.f.toLowerCase()) !== -1; });
      if (f.source !== 'ALL') rows = rows.filter(function (r) { return r.source === f.source; });
      if (f.aResult !== 'ALL') rows = rows.filter(function (r) { return (r.a ? r.a.result : 'NONE') === f.aResult; });
      if (f.bResult !== 'ALL') rows = rows.filter(function (r) { return (r.b ? r.b.result : 'NONE') === f.bResult; });
      if (f.diff !== 'ALL') rows = rows.filter(function (r) { return compareDiffOf(r) === f.diff; });
      const s = state.compare.sort;
      if (s.key) {
        const k = s.key, d = s.dir;
        rows.sort(function (a, b) { const va = compareSortValue(a, k), vb = compareSortValue(b, k); if (va < vb) return -1 * d; if (va > vb) return 1 * d; return 0; });
      }
      return rows;
    }
    function renderCompare() {
      const it = currentItem();
      const enabled = it.channels.filter(function (c) { return it.enabledChannels.indexOf(c.name) !== -1; });
      if (enabled.length === 0) { document.getElementById('content').innerHTML = '<div class="empty">无可用渠道</div>'; return; }
      if (!enabled.some(function (c) { return c.name === state.compare.channelA; })) state.compare.channelA = enabled[0].name;
      if (state.compare.mode === 'channel' && !enabled.some(function (c) { return c.name === state.compare.channelB; })) state.compare.channelB = enabled.length > 1 ? enabled[1].name : enabled[0].name;
      const otherItems = DATA.items.filter(function (x) { return x.tradeId !== it.tradeId; });
      if (state.compare.mode === 'item') { if (!otherItems.some(function (x) { return x.tradeId === state.compare.itemB; })) state.compare.itemB = otherItems[0] ? otherItems[0].tradeId : it.tradeId; }
      const chOpts = enabled.map(function (c) { return '<option value="' + c.name + '"' + (state.compare.channelA === c.name ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');
      const chOptsB = enabled.map(function (c) { return '<option value="' + c.name + '"' + (state.compare.channelB === c.name ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');
      const itemOptsB = otherItems.map(function (x) { return '<option value="' + esc(x.tradeId) + '"' + (state.compare.itemB === x.tradeId ? ' selected' : '') + '>' + esc(x.tradeId) + '</option>'; }).join('');
      const modeSel = '<select id="compareMode">' +
        '<option value="channel"' + (state.compare.mode === 'channel' ? ' selected' : '') + '>' + t('compareModeChannel') + '</option>' +
        '<option value="item"' + (state.compare.mode === 'item' ? ' selected' : '') + '>' + t('compareModeItem') + '</option></select>';
      const selA = '<label>' + t('compareChannelA') + '<select id="compareChannelA">' + chOpts + '</select></label>';
      const selB = state.compare.mode === 'channel'
        ? '<label>' + t('compareChannelB') + '<select id="compareChannelB">' + chOptsB + '</select></label>'
        : '<label>' + t('compareItemB') + '<select id="compareItemB">' + itemOptsB + '</select></label>';
      const rows = filteredCompareRows();
      const pages = Math.max(1, Math.ceil(rows.length / state.compare.pageSize));
      if (state.compare.page > pages) state.compare.page = pages;
      const start = (state.compare.page - 1) * state.compare.pageSize;
      const pageRows = rows.slice(start, start + state.compare.pageSize);
      const headerB = state.compare.mode === 'channel' ? (esc(it.tradeId) + ' · ' + esc(state.compare.channelB)) : (esc(state.compare.itemB) + ' · ' + esc(state.compare.channelA));
      function hdr(key, label, kind) {
        const sortAttr = key ? ' class="sortable" data-sort="' + key + '"' : '';
        const filterBtn = kind ? '<button class="hf-toggle" data-cf="' + key + '" data-kind="' + kind + '" title="' + t('filterTitle') + '">⚲</button>' : '';
        return '<th' + sortAttr + ' scope="col">' + label + (key ? ' <span class="sort-arrow">' + compareSortArrow(key) + '</span>' : '') + filterBtn + '</th>';
      }
      const trs = pageRows.map(function (r) {
        const diff = compareDiffOf(r) === 'diff';
        return '<tr class="' + (diff ? 'row-fail' : '') + '">' +
          '<td class="mono"><a class="val-link" data-detail="' + esc(fieldLocKey(state.compare.channelA, r.source, r.a.id)) + '">' + esc(r.f) + '</a></td>' +
          '<td>' + esc(r.source) + '</td>' +
          '<td>' + compareCell(r.a) + '</td>' +
          '<td>' + compareCell(r.b) + '</td>' +
          '<td>' + (diff ? '<span class="cmp-diff">' + t('compareDiff') + '</span>' : '<span class="cmp-same">' + t('compareSame') + '</span>') + '</td>' +
          '</tr>';
      }).join('');
      let pagerHtml = '';
      if (rows.length > state.compare.pageSize) {
        const p = state.compare.page;
        const from = Math.max(1, p - 2), to = Math.min(pages, p + 2);
        let parts = [];
        parts.push('<button class="pg" data-cp-page="' + (p - 1) + '"' + (p === 1 ? ' disabled' : '') + '>‹</button>');
        for (let i = from; i <= to; i++) parts.push('<button class="pg' + (i === p ? ' cur' : '') + '" data-cp-page="' + i + '">' + i + '</button>');
        parts.push('<button class="pg" data-cp-page="' + (p + 1) + '"' + (p === pages ? ' disabled' : '') + '>›</button>');
        pagerHtml = '<div class="pagination">' + parts.join('') + '<span class="pg-info">' + p + ' / ' + pages + ' ' + t('pageOf') + '</span>' +
          '<select id="comparePageSize">' + APP_LIMITS.pageSizeOptions.map(function (n) { return '<option' + (state.compare.pageSize === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div>';
      }
      document.getElementById('content').innerHTML =
        '<div class="compare-toolbar"><label>' + t('compareModeLabel') + '</label>' + modeSel + selA + selB + '</div>' +
        '<div class="table-wrap"><table><thead><tr>' +
        hdr('f', t('colField'), 'text') +
        hdr('source', t('colSource'), 'select') +
        hdr('aResult', esc(it.tradeId) + ' · ' + esc(state.compare.channelA) + ' ' + t('colResult'), 'select') +
        hdr('bResult', headerB + ' ' + t('colResult'), 'select') +
        hdr('diff', t('compareDiff'), 'select') +
        '</tr></thead><tbody>' +
        (trs || '<tr><td colspan="5" class="empty">无匹配记录</td></tr>') + '</tbody></table></div>' +
        pagerHtml +
        '<div class="meta-note">' + rows.length + ' ' + t('metaFields') + '</div>';
    }

    /* ---------- 报告日期选择（与数据联动） ---------- */
    function reportDates() {
      const m = {};
      DATA.items.forEach(function (it) { m[it.reportDate] = (m[it.reportDate] || 0) + 1; });
      return m;
    }
    function updateReportDateHint() {
      const el = document.getElementById('reportDateHint');
      if (!el) return;
      if (state.reportDateFilter) { el.textContent = ''; return; }
      const n = Object.keys(reportDates()).length;
      el.textContent = t('reportDateCount').replace('{N}', n);
    }
    function openReportDatePicker(anchor) {
      if (anchor.classList.contains('active')) { closePopover(); return; }
      const counts = reportDates();
      const dates = Object.keys(counts).sort().reverse();
      let html = '<label class="col-option date-all"><input type="checkbox" data-date="ALL"' + (!state.reportDateFilter ? ' checked' : '') + '> ' + t('healthAllDates') + '（' + DATA.items.length + '）</label>';
      dates.forEach(function (d) {
        const active = state.reportDateFilter === d;
        html += '<div class="date-option' + (active ? ' active' : '') + '" data-date="' + d + '">' +
          '<span>' + esc(d) + (active ? ' ✓' : '') + '</span>' +
          '<span class="date-opt-count">' + counts[d] + '</span></div>';
      });
      const pop = openPopover(anchor, '<div class="date-list">' + html + '</div>', t('sidebarDate') + '（' + dates.length + '）');
      pop.querySelectorAll('.date-option').forEach(function (el) {
        el.addEventListener('click', function () {
          state.reportDateFilter = el.getAttribute('data-date');
          state.sidebarPage = 1;
          const input = document.getElementById('reportDateFilter');
          input.value = state.reportDateFilter;
          input.parentElement.classList.toggle('has-value', true);
          renderSidebar();
          renderSidebarChips();
          closePopover();
        });
      });
      const allCb = pop.querySelector('.date-all input');
      if (allCb) allCb.addEventListener('change', function () {
        state.reportDateFilter = '';
        state.sidebarPage = 1;
        const input = document.getElementById('reportDateFilter');
        input.value = '';
        input.parentElement.classList.toggle('has-value', false);
        renderSidebar();
        renderSidebarChips();
        closePopover();
      });
    }

    /* ---------- 健康总览（跨全部 item，支持按报告日期；纯计算在 core.js / Worker） ---------- */
    function computeHealthSync(date, channel) {
      return computeHealthPure(DATA.items, date, channel, IGNORE_CONFIG);
    }

    let WORKER = null;
    let WORKER_CALL_ID = 0;
    const WORKER_PENDING = new Map();
    function getWorker() {
      if (WORKER) return WORKER;
      try {
        WORKER = new Worker('./worker.js', { type: 'module' });
        WORKER.onmessage = function (e) {
          const d = e.data || {};
          const cb = WORKER_PENDING.get(d.id);
          if (!cb) return;
          WORKER_PENDING.delete(d.id);
          if (d.ok) cb.resolve(d.result); else cb.reject(new Error(d.error || 'worker error'));
        };
        WORKER.onerror = function (err) {
          try { WORKER.terminate(); } catch (e) {}
          WORKER = null;
          WORKER_PENDING.forEach(function (cb) { cb.reject(new Error(err && err.message ? err.message : 'worker error')); });
          WORKER_PENDING.clear();
        };
      } catch (e) { WORKER = null; }
      return WORKER;
    }
    function workerCall(type, payload, timeoutMs) {
      const w = getWorker();
      if (!w) return Promise.reject(new Error('worker unavailable'));
      const id = ++WORKER_CALL_ID;
      return new Promise(function (resolve, reject) {
        const timer = setTimeout(function () {
          WORKER_PENDING.delete(id);
          reject(new Error('worker timeout'));
        }, timeoutMs || 4000);
        WORKER_PENDING.set(id, {
          resolve: function (v) { clearTimeout(timer); resolve(v); },
          reject: function (e) { clearTimeout(timer); reject(e); },
        });
        w.postMessage({ id: id, type: type, payload: payload });
      });
    }
    async function computeHealthWorker(date, channel) {
      if (isMultiMode()) await ensureAllLoaded();
      try {
        return await workerCall('health', { items: DATA.items, date: date, channel: channel, ignoreConfig: IGNORE_CONFIG });
      } catch (e) {
        return computeHealthSync(date, channel);
      }
    }
    let HEALTH_DATE = 'ALL';
    let HEALTH_CHANNEL = 'ALL';
    const HEALTH_PAGE_SIZE = 20;
    const HEALTH_PERITEM_PAGE_SIZE = 30;
    const HEALTH_SORT = { err: { key: 'count', dir: -1 }, warn: { key: 'count', dir: -1 } };
    const HEALTH_PAGE = { err: 1, warn: 1, peritem: 1 };
    const HEALTH_COLLAPSED = { err: true, warn: true, peritem: false };

    function healthAggEntries(agg) {
      return Object.keys(agg).map(function (k) {
        const i = k.indexOf('|');
        return { type: k.slice(0, i), channel: k.slice(i + 1), count: agg[k] };
      });
    }
    function healthSortArrow(sort, key) {
      if (sort.key !== key) return '⇅';
      return sort.dir === 1 ? '▲' : '▼';
    }
    function healthPagerHTML(kind, pages, page) {
      if (pages <= 1) return '';
      let html = '<div class="health-pager">';
      html += '<button class="pg" data-hpage="' + (page - 1) + '" data-kind="' + kind + '"' + (page <= 1 ? ' disabled' : '') + '>‹</button>';
      for (let i = 1; i <= pages; i++) html += '<button class="pg' + (i === page ? ' cur' : '') + '" data-hpage="' + i + '" data-kind="' + kind + '">' + i + '</button>';
      html += '<button class="pg" data-hpage="' + (page + 1) + '" data-kind="' + kind + '"' + (page >= pages ? ' disabled' : '') + '>›</button>';
      html += '<span class="pg-info">' + page + '/' + pages + '</span></div>';
      return html;
    }
    function renderHealthAggTable(kind, agg, isErr, title) {
      const entries = healthAggEntries(agg);
      const sort = HEALTH_SORT[kind];
      if (sort.key) {
        entries.sort(function (a, b) {
          const key = sort.key;
          const va = a[key], vb = b[key];
          if (va < vb) return -1 * sort.dir;
          if (va > vb) return 1 * sort.dir;
          return 0;
        });
      }
      const pages = Math.max(1, Math.ceil(entries.length / HEALTH_PAGE_SIZE));
      if (HEALTH_PAGE[kind] > pages) HEALTH_PAGE[kind] = pages;
      const start = (HEALTH_PAGE[kind] - 1) * HEALTH_PAGE_SIZE;
      const pageRows = entries.slice(start, start + HEALTH_PAGE_SIZE);
      const collapsed = HEALTH_COLLAPSED[kind];
      let html = '<button class="health-fold" data-fold="' + kind + '">' + title + ' <span class="chev">' + (collapsed ? '▸' : '▾') + '</span></button>';
      if (!collapsed) {
        const th = function (key, label) {
          return '<th class="health-sortable" data-kind="' + kind + '" data-sort="' + key + '">' + label + ' <span class="sort-arrow">' + healthSortArrow(sort, key) + '</span></th>';
        };
        html += '<table class="health-table"><thead><tr>' +
          th('type', t('colType')) + th('channel', t('healthChannelCol')) + th('count', t('healthCountCol')) +
          '</tr></thead><tbody>' +
          (pageRows.map(function (e) {
            return '<tr><td>' + (isErr ? errorTypeChip(e.type) : typeChip(e.type)) + '</td><td><span class="chip channel-chip">' + esc(e.channel) + '</span></td><td class="health-count">' + e.count + '</td></tr>';
          }).join('') || '<tr><td colspan="3" class="empty">无记录</td></tr>') +
          '</tbody></table>' +
          healthPagerHTML(kind, pages, HEALTH_PAGE[kind]);
      }
      return html;
    }
    function healthChartsHTML(h, channel) {
      const chStats = {};
      h.items.forEach(function (it) {
        (it.channels || []).forEach(function (ch) {
          if (channel && channel !== 'ALL' && ch.name !== channel) return;
          const st = chStats[ch.name] || (chStats[ch.name] = { total: 0, passed: 0, failed: 0 });
          (ch.sources || []).forEach(function (s) { (s.fields || []).forEach(function (fd) { st.total++; fd.result === 'PASSED' ? st.passed++ : st.failed++; }); });
        });
      });
      const chList = CHANNELS.filter(function (c) { return chStats[c.name]; }).map(function (c) {
        const s = chStats[c.name];
        return { name: c.name, total: s.total, passed: s.passed, failed: s.failed, rate: s.total ? Math.round(s.passed / s.total * 100) : 0 };
      });
      const ring = '<div class="chart-ring" style="background:conic-gradient(var(--pass) ' + h.rate + '%, var(--bar-bg) ' + h.rate + '% 100%)"><div class="chart-ring-val">' + h.rate + '%</div></div>';
      const rateBars = chList.map(function (c) {
        return '<div class="chart-bar-row"><div class="chart-bar-label"><span>' + esc(c.name) + '</span><b>' + c.rate + '%</b></div>' +
          '<div class="chart-bar"><div class="chart-bar-fill pass" style="width:' + c.rate + '%"></div></div></div>';
      }).join('');
      const failBars = chList.map(function (c) {
        const pct = c.total ? Math.round(c.failed / c.total * 100) : 0;
        return '<div class="chart-bar-row"><div class="chart-bar-label"><span>' + esc(c.name) + '</span><b>' + c.failed + '</b></div>' +
          '<div class="chart-bar"><div class="chart-bar-fill fail" style="width:' + pct + '%"></div></div></div>';
      }).join('');
      return '<div class="chart-card"><div class="chart-title">' + t('chartOverall') + '</div><div class="chart-ring-row">' + ring +
        '<div style="font-size:12px;color:var(--muted);line-height:1.7">' + t('fieldsTotal') + ' ' + h.total + '<br>' + t('passed') + ' ' + h.passed + '<br>' + t('failed') + ' ' + h.failed + '</div></div></div>' +
        '<div class="chart-card"><div class="chart-title">' + t('chartChannelRate') + '</div>' + (rateBars || '<div class="empty">无记录</div>') + '</div>' +
        '<div class="chart-card"><div class="chart-title">' + t('chartFailDist') + '</div>' + (failBars || '<div class="empty">无失败</div>') + '</div>';
    }
    function renderHealthPerItem(h) {
      const entries = h.perItem.slice().sort(function (a, b) { return b.failed - a.failed; });
      const pages = Math.max(1, Math.ceil(entries.length / HEALTH_PERITEM_PAGE_SIZE));
      if (HEALTH_PAGE.peritem > pages) HEALTH_PAGE.peritem = pages;
      const start = (HEALTH_PAGE.peritem - 1) * HEALTH_PERITEM_PAGE_SIZE;
      const pageRows = entries.slice(start, start + HEALTH_PERITEM_PAGE_SIZE);
      const collapsed = HEALTH_COLLAPSED.peritem;
      let html = '<button class="health-fold" data-fold="peritem">' + t('healthPerItem') + ' <span class="chev">' + (collapsed ? '▸' : '▾') + '</span></button>';
      if (!collapsed) {
        const rows = pageRows.map(function (p) {
          return '<div class="chart-bar-row"><div class="chart-bar-label"><span class="mono">' + esc(p.id) + '</span><b>' + p.failed + '/' + p.total + '</b></div>' +
            '<div class="chart-bar"><div class="chart-bar-fill pass" style="width:' + p.rate + '%"></div></div></div>';
        }).join('');
        html += '<div class="health-card" style="margin-bottom:14px">' + (rows || '<div class="empty">无记录</div>') + '</div>' +
          healthPagerHTML('peritem', pages, HEALTH_PAGE.peritem);
      }
      return html;
    }
    let HEALTH_RENDER_SEQ = 0;
    async function renderHealthBody(date, channel) {
      HEALTH_DATE = date;
      HEALTH_CHANNEL = channel;
      const seq = ++HEALTH_RENDER_SEQ;
      const h = await computeHealthWorker(date, channel);
      if (seq !== HEALTH_RENDER_SEQ) return; // 丢弃过期渲染结果，保证显示与选择一致。
      const box = document.getElementById('healthBody');
      if (!box) return;
      box.innerHTML =
        '<div class="health-grid">' +
        '<div class="health-card"><div class="h-label">' + t('healthItems') + '</div><div class="h-value">' + h.items.length + '</div></div>' +
        '<div class="health-card"><div class="h-label">' + t('fieldsTotal') + '</div><div class="h-value">' + h.total + '</div></div>' +
        '<div class="health-card"><div class="h-label">' + t('passRate') + '</div><div class="h-value ok">' + h.rate + '%</div></div>' +
        '<div class="health-card"><div class="h-label">' + t('warnings') + '</div><div class="h-value warn">' + h.warnings + '</div></div>' +
        '<div class="health-card"><div class="h-label">' + t('errors') + '</div><div class="h-value bad">' + h.errors + '</div></div>' +
        '</div>' +
        '<div class="health-charts">' + healthChartsHTML(h, channel) + '</div>' +
        renderHealthPerItem(h) +
        renderHealthAggTable('err', h.errAgg, true, t('healthErrByType')) +
        renderHealthAggTable('warn', h.warnAgg, false, t('healthWarnByType'));
    }
    async function openHealthOverview() {
      if (isMultiMode()) await ensureAllLoaded();
      const counts = reportDates();
      const dates = Object.keys(counts).sort().reverse();
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML =
        '<div class="modal" style="max-width:960px"><div class="modal-head"><h3>' + t('healthTitle') + '</h3><button class="modal-close" aria-label="' + t('closeLabel') + '">✕</button></div><div class="modal-body">' +
        '<div class="health-datebar">' +
        '<label>' + t('sidebarReportDate') + '</label>' +
        '<select id="healthDate"><option value="ALL" selected>' + t('healthAllDates') + '（' + DATA.items.length + '）</option>' +
        dates.map(function (d) { return '<option value="' + d + '">' + d + '（' + counts[d] + '）</option>'; }).join('') +
        '</select>' +
        '<label>' + t('colChannel') + '</label>' +
        '<select id="healthChannel"><option value="ALL" selected>' + t('healthAllChannels') + '</option>' +
        CHANNELS.map(function (c) { return '<option value="' + c.name + '">' + c.name + '</option>'; }).join('') +
        '</select>' +
        '<button class="tool-btn" id="healthUseSidebar">' + t('healthUseSidebarDate') + '</button>' +
        '</div>' +
        '<div id="healthBody"></div>' +
        '</div></div>';
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop || e.target.closest('.modal-close')) { backdrop.remove(); return; }
        if (e.target.id === 'healthUseSidebar') {
          document.getElementById('healthDate').value = state.reportDateFilter || 'ALL';
          renderHealthBody(state.reportDateFilter || 'ALL', HEALTH_CHANNEL);
          return;
        }
        const hs = e.target.closest('.health-sortable');
        if (hs) {
          const kind = hs.getAttribute('data-kind');
          const key = hs.getAttribute('data-sort');
          const s = HEALTH_SORT[kind];
          if (s.key === key) {
            if (s.dir === 1) s.dir = -1;
            else if (s.dir === -1) { s.key = ''; s.dir = 1; }
          } else { s.key = key; s.dir = key === 'count' ? -1 : 1; }
          HEALTH_PAGE[kind] = 1;
          renderHealthBody(HEALTH_DATE, HEALTH_CHANNEL);
          return;
        }
        const hp = e.target.closest('[data-hpage]');
        if (hp && !hp.disabled) {
          HEALTH_PAGE[hp.getAttribute('data-kind')] = parseInt(hp.getAttribute('data-hpage'), 10);
          renderHealthBody(HEALTH_DATE, HEALTH_CHANNEL);
          return;
        }
        const hf = e.target.closest('.health-fold');
        if (hf) {
          const kind = hf.getAttribute('data-fold');
          HEALTH_COLLAPSED[kind] = !HEALTH_COLLAPSED[kind];
          renderHealthBody(HEALTH_DATE, HEALTH_CHANNEL);
          return;
        }
      });
      backdrop.addEventListener('change', function (e) {
        if (e.target.id === 'healthDate') renderHealthBody(e.target.value, HEALTH_CHANNEL);
        if (e.target.id === 'healthChannel') renderHealthBody(HEALTH_DATE, e.target.value);
      });
      document.body.appendChild(backdrop);
      renderHealthBody('ALL', 'ALL');
    }

    function openHelp() {
      const shortcuts = [
        ['/', t('helpSearch')],
        ['G', t('helpGlobal')],
        ['H', t('helpHealth')],
        ['J / K', t('helpNav')],
        ['↑ / ↓', t('helpRowNav')],
        ['Enter', t('helpRowOpen')],
        ['Space', t('helpRowIgnore')],
        ['Esc', t('helpEsc')],
      ];
      const syntax = [
        ['field:', t('helpSyntaxField')],
        ['tag:', t(tagSyntaxHelpKey())],
        ['xpath:', t('helpSyntaxXpath')],
        ['csv:', t('helpSyntaxCsv')],
        ['eo:', t('helpSyntaxEo')],
        ['ao:', t('helpSyntaxAo')],
        ['ctx:', t('helpSyntaxCtx')],
        ['desc:', t('helpSyntaxDesc')],
      ];
      const regexRows = [
        ['regex:', t('helpRegexAll')],
        ['regex:xpath:', t('helpRegexField')],
        ['xpath:regex:', t('helpRegexExample')],
      ];
      const row = function (r) { return '<div class="help-row"><kbd>' + esc(r[0]) + '</kbd><span class="help-desc">' + esc(r[1]) + '</span></div>'; };
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML =
        '<div class="modal" style="max-width:600px"><div class="modal-head"><h3>' + t('helpTitle') + '</h3><button class="modal-close" aria-label="' + t('closeLabel') + '">✕</button></div>' +
        '<div class="modal-body">' +
        '<div class="help-section"><div class="help-section-title"><span class="help-badge help-badge-kbd">' + t('helpShortcutsTitle') + '</span></div>' +
        '<div class="help-grid">' + shortcuts.map(row).join('') + '</div></div>' +
        '<div class="help-section"><div class="help-section-title"><span class="help-badge help-badge-syntax">' + t('helpSearchSyntaxTitle') + '</span></div>' +
        '<div class="help-note">' + t('helpSyntaxDefault') + '</div>' +
        '<div class="help-grid">' + syntax.map(row).join('') + '</div></div>' +
        '<div class="help-section"><div class="help-section-title"><span class="help-badge help-badge-regex">' + t('helpRegexTitle') + '</span></div>' +
        '<div class="help-list">' + regexRows.map(row).join('') + '</div></div>' +
        '</div></div>';
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop || e.target.closest('.modal-close')) backdrop.remove();
      });
      document.body.appendChild(backdrop);
    }

    /* ---------- 全局搜索（跨 item，重计算在 Worker） ---------- */
    // 用户标签的搜索能力与 columns.userTag.raw 联动（与界面显示保持一致）：
    //   raw = true  → 界面显示原始值 → 返回空映射，只按原始值搜索；
    //   raw = false → 界面显示当前语言标签（columns.userTag.labels）→ 返回「原始值 → 标签」映射，原始值与标签都能搜。
    function searchTagLabels() {
      const m = {};
      if (USER_TAG_RAW) return m;
      const vals = Object.keys(TYPE_META).concat(Object.keys(USER_TAG_LABELS));
      vals.forEach(function (v) {
        const l = userTagLabel(v);
        if (l && l !== v && m[v] == null) m[v] = l;
      });
      return m;
    }
    // 标签搜索能力的文案：与上面同一开关，避免提示与实际能力不符。
    function tagSyntaxHelpKey() { return USER_TAG_RAW ? 'helpSyntaxTagRaw' : 'helpSyntaxTag'; }
    async function globalSearchResults(q) {
      if (isMultiMode()) await ensureAllLoaded();
      const tagLabels = searchTagLabels();
      try {
        return await workerCall('globalSearch', { items: DATA.items, q: q, limit: APP_LIMITS.globalSearchLimit, tagLabels: tagLabels });
      } catch (e) {
        return globalSearchPure(DATA.items, q, APP_LIMITS.globalSearchLimit, { tagLabels: tagLabels });
      }
    }
    function openGlobalSearch() {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML =
        '<div class="modal" style="max-width:860px"><div class="modal-head"><h3>' + t('globalSearch') + '</h3><button class="modal-close" aria-label="' + t('closeLabel') + '">✕</button></div>' +
        '<div class="modal-body">' +
        '<input class="pop-control" id="globalSearchInput" placeholder="' + t('globalSearchPlaceholder') + '">' +
        '<div id="globalSearchResults" style="margin-top:12px;max-height:62vh;overflow:auto"></div>' +
        '</div></div>';
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop || e.target.closest('.modal-close')) { backdrop.remove(); return; }
        const row = e.target.closest('[data-goto]');
        if (!row) return;
        const itemId = row.getAttribute('data-goto');
        const fieldId = row.getAttribute('data-field-id');
        const ch = row.getAttribute('data-channel');
        const src = row.getAttribute('data-source');
        backdrop.remove();
        selectItem(itemId);
        if (fieldId) setTimeout(function () { openModal(ch, src, fieldId, true); }, 60);
      });
      document.body.appendChild(backdrop);
      const input = backdrop.querySelector('#globalSearchInput');
      let timer = null;
      const doSearch = async function () {
        const q = input.value.trim();
        const box = backdrop.querySelector('#globalSearchResults');
        if (!q) { box.innerHTML = ''; return; }
        const results = await globalSearchResults(q);
        box.innerHTML = results.length
          ? results.map(function (r) {
              return '<div class="gs-row" data-goto="' + esc(r.itemId) + '" data-field-id="' + esc(r.fieldId) + '" data-channel="' + esc(r.channel) + '" data-source="' + esc(r.source) + '">' +
                '<span class="gs-item mono">' + esc(r.itemId) + '</span>' +
                '<span class="chip channel-chip">' + esc(r.channel) + '</span>' +
                (r.userTag ? userTagHTML(r.userTag) : '') +
                '<span class="mono">' + esc(r.field) + '</span>' +
                '<span class="gs-snippet">' + highlight(r.snippet, q) + '</span>' +
                '</div>';
            }).join('')
          : '<div class="empty">' + t('globalSearchNoResults') + '</div>';
      };
      input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(doSearch, 150); });
      setTimeout(function () { input.focus(); }, 60);
    }

    /* ---------- 忽略配置导入（分部覆盖：以文件为准，只接受分组格式） ---------- */
    // 导入结果提示：逐部分说明「已覆盖 N 条」或「未包含，保持不变」。
    function importResultText(parsed) {
      const parts = [['warn', 'importPartWarnings'], ['xpath', 'importPartXpaths'], ['csv', 'importPartCsvs']];
      const counts = { warn: 0, xpath: 0, csv: 0 };
      Object.keys(parsed.flat || {}).forEach(function (k) {
        try { const a = JSON.parse(k); if (a && counts[a[0]] !== undefined) counts[a[0]]++; } catch (e) {}
      });
      const lines = parts.map(function (p) {
        const covered = parsed.kinds.indexOf(p[0]) !== -1;
        return '• ' + t(p[1]) + '：' + (covered ? t('importPartCount').replace('N', counts[p[0]]) : t('importPartKept'));
      });
      return t('importSuccess') + '\n' + lines.join('\n');
    }
    function importIgnoreConfigFile(file) {
      const reader = new FileReader();
      reader.onload = function () {
        const r = parseIgnoreImport(String(reader.result));
        if (!r.ok) {
          if (r.reason === 'legacy') alert(t('importLegacyFail'));
          else if (r.reason === 'buckets') alert(t('importShapeFail'));
          else alert(t('importFail'));
          return;
        }
        // 分部覆盖：只替换文件里出现的部分（warnings / uncomparedXpaths / uncomparedCsvs），其余保持不变。
        IGNORE_CONFIG = applyIgnoreImport(IGNORE_CONFIG, r);
        saveIgnoreConfig(function () { IGNORE_CONFIG = applyIgnoreImport(IGNORE_CONFIG, r); });
        renderAfterIgnoreChange();
        alert(importResultText(r));
      };
      reader.readAsText(file);
    }

    /* ---------- 事件绑定 ---------- */
    function bindEvents() {
      applyStaticText();
      applyTheme(THEME);
      document.getElementById('themeSelect').addEventListener('change', function (e) { applyTheme(e.target.value); savePrefs(); });
      document.getElementById('langSelect').addEventListener('change', function (e) { setLang(e.target.value); });
      document.getElementById('healthBtn').addEventListener('click', function () { openHealthOverview(); });
      document.getElementById('globalSearchBtn').addEventListener('click', function () { openGlobalSearch(); });
      document.getElementById('helpBtn').addEventListener('click', function () { openHelp(); });
      // 顶栏（与帮助按钮同风格）：清除偏好记忆（受 features.clearLocalCache 控制）与回到站点根主页。
      // 注意：.help-btn 显式声明了 display:inline-flex，会盖掉 UA 的 [hidden]{display:none}，
      // 因此关闭开关时必须同时设置 hidden 与内联 display:none（与其它功能开关的写法一致）。
      const clearPrefsBtn = document.getElementById('clearPrefsBtn');
      if (clearPrefsBtn) {
        if (APP_FEATURES.clearLocalCache) clearPrefsBtn.addEventListener('click', function () { clearLocalCacheNow(); });
        else { clearPrefsBtn.hidden = true; clearPrefsBtn.style.display = 'none'; }
      }
      const homeBtn = document.getElementById('homeBtn');
      if (homeBtn) {
        if (APP_FEATURES.homeButton) {
          homeBtn.addEventListener('click', function () {
            // 「主页」：回到站点根（不带查询参数与深链接）并重新加载。
            // 先 replaceState 去掉 query/hash（不触发 hashchange，避免被 syncHash 写回），再 reload 做一次全新加载。
            try { history.replaceState(null, '', webRootUrl()); } catch (e) {}
            location.reload();
          });
        } else { homeBtn.hidden = true; homeBtn.style.display = 'none'; }
      }
      document.getElementById('importIgnoreFile').addEventListener('change', function (e) {
        if (e.target.files && e.target.files[0]) importIgnoreConfigFile(e.target.files[0]);
        e.target.value = '';
      });
      document.getElementById('sideCollapse').addEventListener('click', function () { document.body.classList.add('sidebar-collapsed'); });
      document.getElementById('sideExpand').addEventListener('click', function () { document.body.classList.remove('sidebar-collapsed'); });
      document.getElementById('topCollapse').addEventListener('click', function () {
        const collapsed = document.body.classList.toggle('top-collapsed');
        const btn = document.getElementById('topCollapse');
        btn.setAttribute('aria-expanded', String(!collapsed));
        // 图标为侧栏折叠同款字符 ⟨（CSS 依 aria-expanded 旋转 90°/-90° 得上下方向），此处不再改文本。
        btn.title = collapsed ? t('topExpandTitle') : t('topCollapseTitle');
        syncMiniSummary();
      });

      document.getElementById('backTop').addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      /* 最近批次面板事件 */
      document.getElementById('batchDock').addEventListener('click', function (e) {
        const toggle = e.target.closest('#batchToggle');
        if (toggle) { toggleBatchPanel(); return; }
        const refresh = e.target.closest('#batchRefreshDock');
        if (refresh) { reloadBatchesIndex(); return; }
        const help = e.target.closest('#batchHelpBtn');
        if (help) { openBatchHelp(); return; }
        const favToggle = e.target.closest('#favToggle');
        if (favToggle) { toggleFavoritesPanel(); return; }
        const chip = e.target.closest('[data-batch]');
        if (chip) {
          const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === chip.getAttribute('data-batch'); });
          if (b) selectBatch(b);
        }
      });
      document.getElementById('batchDock').addEventListener('mousedown', function (e) {
        const grip = e.target.closest('.bd-grip');
        if (!grip) return;
        e.preventDefault();
        const dock = document.getElementById('batchDock');
        const startY = e.clientY;
        const startTop = dock.getBoundingClientRect().top;
        document.body.classList.add('dock-dragging');
        function onMove(ev) {
          const h = dock.offsetHeight;
          const top = Math.max(8, Math.min(window.innerHeight - h - 8, startTop + (ev.clientY - startY)));
          BATCH_STATE.dockY = top;
          dock.style.top = top + 'px';
          dock.style.bottom = 'auto';
          dock.style.transform = 'none';
          positionBatchPanel();
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.classList.remove('dock-dragging');
          savePrefs();
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      document.getElementById('batchDock').addEventListener('mouseover', function (e) {
        const chip = e.target.closest('.bd-chip');
        if (chip) showBdCard(chip, chip.getAttribute('data-batch'));
      });
      document.getElementById('batchDock').addEventListener('mouseout', function (e) {
        if (e.target.closest('.bd-chip')) hideBdCard();
      });
      document.getElementById('batchPanel').addEventListener('click', function (e) {
        const noticeClose = e.target.closest('#batchNoticeClose');
        if (noticeClose) { setBatchNotice(''); return; }
        const delBtn = e.target.closest('[data-batch-del]');
        if (delBtn) { markBatchPending(delBtn.getAttribute('data-batch-del')); return; }
        const pinBtn = e.target.closest('[data-batch-pin]');
        if (pinBtn) { toggleBatchPin(pinBtn.getAttribute('data-batch-pin')); return; }
        const undoBtn = e.target.closest('[data-batch-undo]');
        if (undoBtn) { unmarkBatchPending(undoBtn.getAttribute('data-batch-undo')); return; }
        const confirmBtn = e.target.closest('[data-batch-confirm]');
        if (confirmBtn) { confirmBatchDelete(confirmBtn.getAttribute('data-batch-confirm')); return; }
        const favBtn = e.target.closest('[data-batch-fav]');
        if (favBtn) { toggleBatchFavorite(favBtn.getAttribute('data-batch-fav')); return; }
        const tagBtn = e.target.closest('[data-batch-edit]');
        if (tagBtn) { openBatchEditor(tagBtn.getAttribute('data-batch-edit')); return; }
        const itemFirst = e.target.closest('[data-batch]');
        if (!itemFirst) hideBatchQuickDetail();
        const sideFlip = e.target.closest('#batchSideFlip');
        if (sideFlip) { toggleBatchSide(); return; }
        const close = e.target.closest('#batchClose');
        if (close) { toggleBatchPanel(false); return; }
        const refresh = e.target.closest('#batchRefresh');
        if (refresh) { reloadBatchesIndex(); return; }
        const compatBtn = e.target.closest('#batchCompatFilter');
        if (compatBtn) {
          // 三态循环：≡ 全部批次 -> ✓ 仅看兼容 -> 🗑 全部批次(含已删除) -> ≡
          BATCH_STATE.batchScope = BATCH_STATE.batchScope === 'all' ? 'compat' : (BATCH_STATE.batchScope === 'compat' ? 'allDeleted' : 'all');
          BATCH_STATE.page = 1;
          if (BATCH_STATE.batchScope !== 'allDeleted') hideBatchQuickDetail();
          renderBatchPanel(); renderBatchDock(); return;
        }
        const clearSearch = e.target.closest('#batchSearchClear');
        if (clearSearch) { BATCH_STATE.search = ''; BATCH_STATE.page = 1; renderBatchPanel(); return; }
        const clearCmd = e.target.closest('#batchCmdClear');
        if (clearCmd) { BATCH_STATE.cmd = ''; BATCH_STATE.page = 1; renderBatchPanel(); return; }
        const clearDesc = e.target.closest('#batchDescClear');
        if (clearDesc) { BATCH_STATE.desc = ''; BATCH_STATE.page = 1; renderBatchPanel(); return; }
        const searchToggle = e.target.closest('#batchSearchToggle');
        if (searchToggle) { BATCH_STATE.searchCollapsed = !BATCH_STATE.searchCollapsed; renderBatchPanel(); return; }
        const filtersToggle = e.target.closest('#batchFiltersToggle');
        if (filtersToggle) { BATCH_STATE.filtersCollapsed = !BATCH_STATE.filtersCollapsed; renderBatchPanel(); return; }
        const clearDate = e.target.closest('#batchDateClear');
        if (clearDate) { BATCH_STATE.date = ''; BATCH_STATE.page = 1; renderBatchPanel(); return; }
        const chipAll = e.target.closest('[data-bchip-all]');
        if (chipAll) { clearAllBatchFilters(); return; }
        const chip = e.target.closest('[data-bchip]');
        if (chip) {
          const f = BATCH_FILTERS[parseInt(chip.getAttribute('data-bchip'), 10)];
          if (f) f.clear();
          BATCH_STATE.page = 1;
          renderBatchPanel();
          return;
        }
        const dateCal = e.target.closest('#batchDateCal');
        if (dateCal) { openBatchDatePicker(dateCal); return; }
        const sortBtn = e.target.closest('#batchSort');
        if (sortBtn) { BATCH_STATE.sortDir = BATCH_STATE.sortDir === -1 ? 1 : -1; BATCH_STATE.page = 1; renderBatchPanel(); return; }
        const info = e.target.closest('[data-binfor]');
        if (info) {
          const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === info.getAttribute('data-binfor'); });
          if (b) openBatchInfo(b);
          return;
        }
        const pg = e.target.closest('[data-bpage]');
        if (pg && !pg.disabled) { BATCH_STATE.page = parseInt(pg.getAttribute('data-bpage'), 10); renderBatchList(); return; }
        const lm = e.target.closest('[data-bloadmore]');
        if (lm) { BATCH_STATE.page++; renderBatchList(); return; }
        const item = e.target.closest('[data-batch]');
        if (item) {
          const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === item.getAttribute('data-batch'); });
          if (b) {
            // 已删除批次：仅查看详情，不加载。
            if (b.deleted) openBatchDetail(item, b);
            else if (BATCH_STATE.detailMode === 'quick') showBatchQuickDetail(item, b);
            else selectBatch(b);
          }
          return;
        }
      });
      document.getElementById('favoritesPanel').addEventListener('click', function (e) {
        const close = e.target.closest('#favClose');
        if (close) { toggleFavoritesPanel(false); return; }
        const clearSearch = e.target.closest('#favSearchClear');
        if (clearSearch) { FAV_SEARCH = ''; renderFavoritesPanel(); return; }
        const toggle = e.target.closest('.fav-toggle');
        if (toggle) {
          const pkg = toggle.getAttribute('data-fav-pkg');
          FAV_COLLAPSED[pkg] = !FAV_COLLAPSED[pkg];
          renderFavoritesPanel();
          return;
        }
        const remove = e.target.closest('[data-fav-remove]');
        if (remove) { removeFavorite(remove.getAttribute('data-fav-pkg'), remove.getAttribute('data-fav-remove')); return; }
        const load = e.target.closest('[data-fav-load]');
        if (load) {
          // 收藏项单击：在侧边（与批次列表一致，默认出现在右侧）查看批次详情；双击：加载该批次（见下方 dblclick）。
          const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === load.getAttribute('data-fav-load'); });
          if (b) showBatchQuickDetail(load, b);
          return;
        }
      });
      document.getElementById('favoritesPanel').addEventListener('dblclick', function (e) {
        const load = e.target.closest('[data-fav-load]');
        if (!load) return;
        const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === load.getAttribute('data-fav-load'); });
        if (b) { hideBatchQuickDetail(); selectBatch(b); }
      });
      document.getElementById('favoritesPanel').addEventListener('input', function (e) {
        if (e.target && e.target.id === 'favSearch') {
          FAV_SEARCH = e.target.value;
          renderFavoritesPanel();
          const inp = document.getElementById('favSearch');
          if (inp) { inp.focus(); const v = inp.value; inp.setSelectionRange(v.length, v.length); }
        }
      });
      document.getElementById('batchPanel').addEventListener('dblclick', function (e) {
        if (BATCH_STATE.detailMode !== 'quick') return;
        const item = e.target.closest('[data-batch]');
        if (!item) return;
        const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === item.getAttribute('data-batch'); });
        if (b && !b.deleted) { hideBatchQuickDetail(); selectBatch(b); }
      });
      document.getElementById('batchPanel').addEventListener('scroll', function (e) {
        if (e.target && e.target.id === 'batchList' && BATCH_STATE._slice && BATCH_STATE._slice.length) {
          if (BATCH_SCROLL_PENDING) return;
          BATCH_SCROLL_PENDING = true;
          requestAnimationFrame(function () {
            BATCH_SCROLL_PENDING = false;
            const listEl = document.getElementById('batchList');
            if (listEl && BATCH_STATE._slice) renderBatchListVirtual(listEl, BATCH_STATE._slice);
          });
        }
      }, true);
      document.getElementById('batchPanel').addEventListener('input', function (e) {
        if (e.target.id === 'batchSearch') {
          BATCH_STATE.search = e.target.value; BATCH_STATE.page = 1;
          clearTimeout(BATCH_LIST_TIMER);
          BATCH_LIST_TIMER = setTimeout(renderBatchList, 150);
        } else if (e.target.id === 'batchCmd') {
          BATCH_STATE.cmd = e.target.value; BATCH_STATE.page = 1;
          clearTimeout(BATCH_LIST_TIMER);
          BATCH_LIST_TIMER = setTimeout(renderBatchList, 150);
        } else if (e.target.id === 'batchDesc') {
          BATCH_STATE.desc = e.target.value; BATCH_STATE.page = 1;
          clearTimeout(BATCH_LIST_TIMER);
          BATCH_LIST_TIMER = setTimeout(renderBatchList, 150);
        } else if (e.target.id === 'batchDate') {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
          let formatted = digits;
          if (digits.length > 4) formatted = digits.slice(0, 4) + '-' + digits.slice(4);
          if (digits.length > 6) formatted = digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6);
          if (formatted !== e.target.value) e.target.value = formatted;
          BATCH_STATE.date = formatted;
          BATCH_STATE.page = 1;
          updateBatchDateHint();
          clearTimeout(BATCH_LIST_TIMER);
          BATCH_LIST_TIMER = setTimeout(renderBatchList, 150);
        }
      });
      document.getElementById('batchPanel').addEventListener('change', function (e) {
        if (e.target && e.target.id === 'batchEnv') {
          BATCH_STATE.env = e.target.value;
          BATCH_STATE.page = 1;
          renderBatchList();
        } else if (e.target && e.target.id === 'batchTag') {
          BATCH_STATE.tag = e.target.value;
          BATCH_STATE.page = 1;
          renderBatchList();
        }
      });
      document.getElementById('batchPanel').addEventListener('keydown', function (e) {
        const items = Array.prototype.slice.call(document.querySelectorAll('#batchList .batch-item'));
        const idx = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!items.length) return;
          if (idx === -1) { items[0].focus(); return; }
          const next = e.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
          items[next].focus();
        } else if (e.key === 'Enter') {
          if (idx !== -1) {
            e.preventDefault();
            const item = items[idx];
            const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === item.getAttribute('data-batch'); });
            if (b) { hideBatchQuickDetail(); openBatchDetail(item, b); }
          }
        }
      });
      function startBatchResize(e, isTop) {
        e.preventDefault();
        const panel = document.getElementById('batchPanel');
        const startY = e.clientY;
        const startH = BATCH_STATE.listH != null ? BATCH_STATE.listH : 480;
        document.body.classList.add('bp-resizing');
        function onMove(ev) {
          const minH = 320, maxH = Math.max(320, window.innerHeight - 240);
          const dy = ev.clientY - startY;
          const delta = isTop ? -dy : dy;
          const h = Math.max(minH, Math.min(maxH, startH + delta));
          BATCH_STATE.listH = h;
          panel.style.setProperty('--bp-list-h', h + 'px');
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.classList.remove('bp-resizing');
          savePrefs();
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      }
      document.getElementById('batchPanel').addEventListener('mousedown', function (e) {
        const bottom = e.target.closest('#batchResize');
        if (bottom) { startBatchResize(e, false); return; }
        const top = e.target.closest('#batchResizeTop');
        if (top) startBatchResize(e, true);
      });
      document.getElementById('batchBadge').addEventListener('click', function (e) {
        if (BATCH_STATE.active) showBatchQuickDetailBelow(e.currentTarget, BATCH_STATE.active);
      });
      document.getElementById('batchBadge').addEventListener('mouseover', function (e) {
        if (BATCH_STATE.active) showBatchQuickDetailBelow(e.currentTarget, BATCH_STATE.active);
      });
      document.getElementById('batchBadge').addEventListener('mouseout', function (e) {
        // 移出徽标后延迟隐藏；若移入详情框则由其 mouseenter 取消。
        scheduleBatchQdHide();
      });
      document.getElementById('batchBackDefault').addEventListener('click', function () { fallbackToDefaultReport(); });

      document.getElementById('sideResize').addEventListener('mousedown', function (e) {
        e.preventDefault();
        const startX = e.clientX, startW = SIDEBAR_WIDTH;
        document.body.classList.add('side-resizing');
        function onMove(ev) {
          const w = Math.max(180, Math.min(480, startW + (ev.clientX - startX)));
          SIDEBAR_WIDTH = w;
          document.documentElement.style.setProperty('--side-w', w + 'px');
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.classList.remove('side-resizing');
          savePrefs();
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      window.addEventListener('hashchange', function () { onHashChange(); });
      // 主列表行选中状态（data-rid = 源数组下标，稳定短ID）→ 同步到 URL 深链接（fr 参数）。
      document.addEventListener('focusin', function (e) {
        const el = e.target;
        if (!el || !el.closest) return;
        const tr = el.closest('#fTbody tr[data-rid], #mTbody tr[data-rid]');
        if (!tr) return;
        const rid = parseInt(tr.getAttribute('data-rid'), 10);
        if (!isNaN(rid) && rid !== state.rowId) { state.rowId = rid; syncHash(); }
      });
      window.addEventListener('scroll', syncMiniSummary);

      const dateInput = document.getElementById('reportDateFilter');
      const datePicker = document.getElementById('reportDatePickerHelper');
      function formatDateDigits(v) {
        const digits = v.replace(/\D/g, '').slice(0, 8);
        let out = digits;
        if (digits.length > 4) out = digits.slice(0, 4) + '-' + digits.slice(4);
        if (digits.length > 6) out = digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6);
        return out;
      }
      dateInput.value = state.reportDateFilter || '';
      dateInput.parentElement.classList.toggle('has-value', !!state.reportDateFilter);
      dateInput.addEventListener('input', function (e) {
        const formatted = formatDateDigits(e.target.value);
        if (formatted !== e.target.value) e.target.value = formatted;
        const digits = formatted.replace(/\D/g, '');
        state.sidebarPage = 1;
        if (digits.length === 8) {
          state.reportDateFilter = formatted;
          e.target.parentElement.classList.toggle('has-value', true);
          renderSidebar();
          renderSidebarChips();
        } else if (digits.length === 0) {
          state.reportDateFilter = '';
          e.target.parentElement.classList.toggle('has-value', false);
          renderSidebar();
          renderSidebarChips();
        }
      });
      document.getElementById('reportDateClear').addEventListener('click', function () {
        state.reportDateFilter = '';
        state.sidebarPage = 1;
        dateInput.value = '';
        datePicker.value = '';
        dateInput.parentElement.classList.remove('has-value');
        renderSidebar();
        renderSidebarChips();
      });
      document.getElementById('reportDateCal').addEventListener('click', function () {
        openReportDatePicker(this);
      });
      datePicker.addEventListener('change', function () {
        if (datePicker.value) {
          state.reportDateFilter = datePicker.value;
          state.sidebarPage = 1;
          dateInput.value = datePicker.value;
          dateInput.parentElement.classList.toggle('has-value', true);
          renderSidebar();
          renderSidebarChips();
        }
      });

      document.getElementById('search').addEventListener('input', function (e) {
        state.search = e.target.value; state.page = 1; state.msgPage = 1;
        clearTimeout(SEARCH_TIMER);
        SEARCH_TIMER = setTimeout(function () { renderFilterChips(); renderContent(); }, 150);
      });

      document.getElementById('itemSearch').addEventListener('input', function (e) {
        state.itemSearch = e.target.value;
        state.sidebarPage = 1;
        e.target.parentElement.classList.toggle('has-value', !!e.target.value);
        clearTimeout(ITEM_SEARCH_TIMER);
        ITEM_SEARCH_TIMER = setTimeout(function () { renderSidebar(); }, 150);
      });

      document.getElementById('itemSearchClear').addEventListener('click', function () {
        const input = document.getElementById('itemSearch');
        input.value = '';
        input.parentElement.classList.remove('has-value');
        state.itemSearch = '';
        state.sidebarPage = 1;
        renderSidebar();
      });

      document.getElementById('itemFilter').addEventListener('change', function (e) {
        state.itemFilter = e.target.value;
        state.sidebarPage = 1;
        renderSidebar();
        renderSidebarChips();
      });

      document.getElementById('sidebarChips').addEventListener('click', function (e) {
        if (e.target.closest('[data-side-clear-all]')) { clearAllSidebarFilters(); return; }
        const btn = e.target.closest('[data-sideclear]');
        if (!btn) return;
        const idx = parseInt(btn.getAttribute('data-sideclear'), 10);
        if (SIDEBAR_FILTERS[idx]) SIDEBAR_FILTERS[idx].clear();
        state.sidebarPage = 1;
        renderSidebar();
        renderSidebarChips();
      });

      document.getElementById('platformFilterBtn').addEventListener('click', function () {
        openSideMulti(this);
      });

      document.getElementById('productFilterBtn').addEventListener('click', function () {
        openSideMulti(this);
      });

      document.getElementById('tradeIdFilterBtn').addEventListener('click', function () {
        openSideMulti(this);
      });

      document.getElementById('reportCats').addEventListener('click', function (e) {
        const btn = e.target.closest('.report-cat');
        if (!btn) return;
        const cat = btn.getAttribute('data-cat');
        state.reportCat = (state.reportCat === cat) ? null : cat;
        renderReportCats();
      });

      document.getElementById('summary').addEventListener('click', function (e) {
        const card = e.target.closest('[data-action]');
        if (!card) return;
        const action = card.getAttribute('data-action');
        if (action === 'rate') {
          state.reportCat = (state.reportCat === 'charts') ? null : 'charts';
          renderReportCats();
          return;
        }
        state.page = 1;
        state.rowId = -1;
        if (action === 'fields') { state.tab = 'fields'; state.colFilter.result = 'ALL'; }
        else if (action === 'passed') { state.tab = 'fields'; state.colFilter.result = 'PASSED'; }
        else if (action === 'failed') { state.tab = 'fields'; state.colFilter.result = 'FAILED'; }
        else if (action === 'warnings') { state.tab = 'warnings'; }
        else if (action === 'errors') { state.tab = 'errors'; }
        render();
      });

      document.getElementById('filterChips').addEventListener('click', function (e) {
        if (e.target.closest('[data-clear-all]')) { clearAllFilters(); return; }
        const btn = e.target.closest('[data-clear]');
        if (!btn) return;
        const idx = parseInt(btn.getAttribute('data-clear'), 10);
        if (ACTIVE_FILTERS[idx]) ACTIVE_FILTERS[idx].clear();
        state.page = 1;
        render();
      });

      document.getElementById('sidebar').addEventListener('click', function (e) {
        const nav = e.target.closest('[data-item-nav]');
        if (nav) {
          if (!nav.disabled) moveItem(parseInt(nav.getAttribute('data-item-nav'), 10));
          return;
        }
        const lm = e.target.closest('[data-loadmore]');
        if (lm) {
          state.sidebarPage++;
          renderSidebar();
          return;
        }
        const pg = e.target.closest('[data-sidepage]');
        if (pg && !pg.disabled) {
          state.sidebarPage = parseInt(pg.getAttribute('data-sidepage'), 10);
          if (SIDEBAR_MODE === 'combined') {
            document.getElementById('sidebarList').scrollTop = (state.sidebarPage - 1) * state.sidebarPageSize * SIDEBAR_ROW_H;
          }
          renderSidebar();
          return;
        }
        const el = e.target.closest('[data-id]');
        if (!el) return;
        selectItem(el.getAttribute('data-id'));
      });

      document.getElementById('sidebarList').addEventListener('keydown', function (e) {
        const items = Array.prototype.slice.call(document.querySelectorAll('#sidebarList .item'));
        const idx = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!items.length) return;
          if (idx === -1) { items[0].focus(); return; }
          const next = e.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
          items[next].focus();
        } else if (e.key === 'Enter') {
          if (idx !== -1) { e.preventDefault(); items[idx].click(); }
        }
      });

      document.getElementById('sidebarList').addEventListener('scroll', function () {
        if (SIDEBAR_MODE !== 'combined' || !state._sidebarAll || !state._sidebarAll.length) return;
        if (SIDEBAR_SCROLL_PENDING) return;
        SIDEBAR_SCROLL_PENDING = true;
        requestAnimationFrame(function () {
          SIDEBAR_SCROLL_PENDING = false;
          renderSidebarVirtual(state._sidebarAll);
        });
      });

      window.addEventListener('resize', function () {
        layoutSidebarList();
        syncMiniSummary();
        if (SIDEBAR_MODE === 'combined' && state._sidebarAll && state._sidebarAll.length) renderSidebarVirtual(state._sidebarAll);
      });

      // item id（报告日期左侧）：鼠标悬停展示关联属性浮层（原为点击触发）。
      const itemMetaEl = document.getElementById('itemMeta');
      itemMetaEl.addEventListener('mouseover', function (e) {
        const a = e.target.closest('[data-item-info]');
        if (!a) return;
        // 已为该 id 展开时仅取消收起计时，避免 mouseover 重开。
        if (a.classList.contains('active')) { clearTimeout(ITEM_INFO_HIDE_TIMER); return; }
        openItemInfoPopover(a, currentItem());
      });
      itemMetaEl.addEventListener('mouseout', function (e) {
        if (e.target.closest('[data-item-info]')) scheduleItemInfoHide();
      });

      document.getElementById('tabs').addEventListener('click', function (e) {
        const el = e.target.closest('[data-tab]');
        if (!el) return;
        // 切换选项卡**保留**当前分页：字段比较用 state.page、消息类（警告 / 错误 / 未比较…）用 state.msgPage，
        // 各选项卡页码本身互不干扰，因此无需在切换时重置，否则来回切换会被拽回第 1 页。
        // 页码越界由 renderFields / renderMsgTable 自动收敛（paginateRows）；
        // 真正改变数据集的操作（切 item / 改筛选 / 全局搜索 / 换每页条数 / 汇总卡片等）仍各自重置页码。
        state.tab = el.getAttribute('data-tab');
        state.rowId = -1;
        state.msgSort = { key: '', dir: 1 };
        state.msgFilter = {};
        closePopover();
        renderTabs(); renderChannelTabs(); renderFilterChips(); renderContent();
      });

      document.getElementById('channelTabs').addEventListener('click', function (e) {
        const fieldMsgBtn = e.target.closest('#fieldMsgToggle');
        if (fieldMsgBtn) { toggleFieldMsg(); return; }
        const colToggle = e.target.closest('.col-toggle');
        if (colToggle) { openColumnMenu(colToggle); return; }
        const srcEl = e.target.closest('[data-source]');
        if (srcEl) {
          state.source = srcEl.getAttribute('data-source'); state.page = 1;
          state.colFilter.source = state.source;
          render();
          return;
        }
        const el = e.target.closest('[data-channel]');
        if (!el) return;
        state.channel = el.getAttribute('data-channel'); state.page = 1;
        state.source = 'ALL';
        state.colFilter = { channel: state.channel, source: 'ALL', field: '', userTag: 'ALL', eoEl: '', aoEl: '', eoCvtEl: '', aoCvtEl: '', vdtEl: '', type: 'ALL', ctxs: '', eoUnconverted: '', eo: '', aoUnconverted: '', ao: '', result: 'ALL', remarks: '' };
        render();
      });

      document.getElementById('content').addEventListener('click', function (e) {
        const ctxTag = e.target.closest('.ctx-tag');
        if (ctxTag) { showCtxDefPopup(ctxTag, ctxTag.getAttribute('data-ctx')); return; }
        const valExp = e.target.closest('[data-val-expand]');
        if (valExp) { openValPanel(valExp, valExp.getAttribute('data-val')); return; }
        const pg = e.target.closest('[data-page]');
        if (pg && !pg.disabled) {
          state.page = parseInt(pg.getAttribute('data-page'), 10);
          renderContent();
          return;
        }
        const cpPage = e.target.closest('[data-cp-page]');
        if (cpPage && !cpPage.disabled) {
          state.compare.page = parseInt(cpPage.getAttribute('data-cp-page'), 10);
          renderContent();
          return;
        }
        const msgPage = e.target.closest('[data-msg-page]');
        if (msgPage && !msgPage.disabled) {
          state.msgPage = parseInt(msgPage.getAttribute('data-msg-page'), 10);
          renderContent();
          return;
        }
        const jfield = e.target.closest('[data-jump-field]');
        if (jfield) { jumpToFieldRow(jfield.getAttribute('data-jch'), jfield.getAttribute('data-jsrc'), jfield.getAttribute('data-jump-field')); return; }
        const fmsg = e.target.closest('[data-field-msg]');
        if (fmsg) { jumpToFieldMsg(fmsg.getAttribute('data-field-msg'), fmsg.getAttribute('data-fch'), fmsg.getAttribute('data-fsrc'), fmsg.getAttribute('data-ffield')); return; }
        const detail = e.target.closest('[data-detail]');
        if (detail) { const loc = parseFieldLoc(detail.getAttribute('data-detail')); openModal(loc.channel, loc.source, loc.id); return; }
        const ign = e.target.closest('.ignore-btn');
        if (ign) { toggleIgnoreByKey(ign.getAttribute('data-ignore')); return; }
        const exp = e.target.closest('#exportIgnoreBtn');
        if (exp) { exportIgnoreConfig(); return; }
        const mgr = e.target.closest('#manageIgnoreBtn');
        if (mgr) { openIgnoreManager(); return; }
        const imp = e.target.closest('#importIgnoreBtn');
        if (imp) { document.getElementById('importIgnoreFile').click(); return; }
        const bulk = e.target.closest('.bulk-toggle');
        if (bulk) { openBulkIgnoreDialog(); return; }
        const cf = e.target.closest('[data-cf]');
        if (cf) { openCompareFilter(cf); return; }
        const hf = e.target.closest('.hf-toggle');
        if (hf) { openHfPopover(hf); return; }
        const mhf = e.target.closest('.mhf-toggle');
        if (mhf) { openMsgFilterPopover(mhf); return; }
        const special = e.target.closest('.special-toggle');
        if (special) { openSpecialPopover(special); return; }
        const colToggle = e.target.closest('.col-toggle');
        if (colToggle) { openColumnMenu(colToggle); return; }
        const th = e.target.closest('th.sortable');
        if (th && !e.target.closest('.hf-toggle') && !e.target.closest('.mhf-toggle') && !e.target.closest('.special-toggle') && !e.target.closest('.bulk-toggle') && !e.target.closest('.col-resize')) {
          const key = th.getAttribute('data-sort');
          const sort = state.tab === 'fields' ? state.sort : (state.tab === 'compare' ? state.compare.sort : state.msgSort);
          if (sort.key === key) {
            if (sort.dir === 1) sort.dir = -1;
            else if (sort.dir === -1) { sort.key = ''; sort.dir = 1; }
          } else { sort.key = key; sort.dir = 1; }
          state.page = 1;
          state.msgPage = 1;
          renderContent();
        }
      });

      document.getElementById('content').addEventListener('mousedown', function (e) {
        const handle = e.target.closest('.col-resize');
        if (!handle) return;
        const colKey = handle.getAttribute('data-resize');
        const cw = COL_WIDTHS[colKey];
        if (!cw || cw.resizable === false) return;
        e.preventDefault();
        const startX = e.clientX;
        const startW = colWidth(colKey);
        const guide = document.createElement('div');
        guide.className = 'col-resize-guide';
        document.body.appendChild(guide);
        const header = handle.closest('th');
        if (header) header.classList.add('resizing');
        document.body.classList.add('col-resizing');
        function onMove(ev) {
          const w = Math.max(cw.min, Math.min(cw.max, startW + (ev.clientX - startX)));
          state.colWidths[colKey] = w;
          applyColWidth(colKey);
          guide.style.left = ev.clientX + 'px';
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.classList.remove('col-resizing');
          guide.remove();
          if (header) header.classList.remove('resizing');
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      document.getElementById('content').addEventListener('mouseover', function (e) {
        if (!APP_FEATURES.columnHover) return;
        const cell = e.target.closest('#content th, #content td');
        if (!cell) {
          document.querySelectorAll('#content .col-hover').forEach(function (el) { el.classList.remove('col-hover'); });
          return;
        }
        const table = cell.closest('table');
        if (!table) return;
        const idx = Array.prototype.indexOf.call(cell.parentElement.children, cell);
        document.querySelectorAll('#content .col-hover').forEach(function (el) { el.classList.remove('col-hover'); });
        table.querySelectorAll('tr').forEach(function (tr) {
          const c = tr.children[idx];
          if (c) c.classList.add('col-hover');
        });
      });

      document.getElementById('content').addEventListener('change', function (e) {
        if (!e.target) return;
        if (e.target.id === 'pageSize') {
          state.pageSize = parseInt(e.target.value, 10);
          state.page = 1;
          renderContent();
        } else if (e.target.id === 'compareMode') {
          state.compare.mode = e.target.value;
          if (isMultiMode() && state.compare.mode === 'item') ensureAllLoaded().then(renderContent);
          else renderContent();
        }
        else if (e.target.id === 'compareChannelA') { state.compare.channelA = e.target.value; renderContent(); }
        else if (e.target.id === 'compareChannelB') { state.compare.channelB = e.target.value; renderContent(); }
        else if (e.target.id === 'compareItemB') { state.compare.itemB = e.target.value; renderContent(); }
        else if (e.target.id === 'comparePageSize') { state.compare.pageSize = parseInt(e.target.value, 10); state.compare.page = 1; renderContent(); }
        else if (e.target.id === 'msgPageSize') { state.msgPageSize = parseInt(e.target.value, 10); state.msgPage = 1; renderContent(); }
      });

      document.addEventListener('keydown', function (e) {
        const t = e.target;
        const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
        if (e.key === 'Escape') {
          if (CTX_DEF_POPUP) { closeCtxDefPopup(); return; }
          if (RULE_POPUP) { closeRulePopup(); return; }
          if (VAL_PANEL) { closeValPanel(); return; }
          if (document.querySelector('.modal-backdrop')) { closeModal(); return; }
          if (POPOVER.el) { closePopover(); return; }
          return;
        }
        if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
        if (document.querySelector('.modal-backdrop')) return;
        if (!APP_FEATURES.keyboardShortcuts) return;
        if (e.key === '/') { e.preventDefault(); const s = document.getElementById('search'); if (s) s.focus(); return; }
        if (e.key === '?') { e.preventDefault(); openHelp(); return; }
        if (e.key === 'g' || e.key === 'G') { if (APP_FEATURES.globalSearch) { e.preventDefault(); openGlobalSearch(); } return; }
        if (e.key === 'h' || e.key === 'H') { if (APP_FEATURES.healthOverview) { e.preventDefault(); openHealthOverview(); } return; }
        if (e.key === 'j' || e.key === 'J') { e.preventDefault(); moveItem(1); return; }
        if (e.key === 'k' || e.key === 'K') { e.preventDefault(); moveItem(-1); return; }
      });

      // 表格行键盘导航：↑/↓ 移动焦点，Enter 打开字段详情，Space 切换忽略。
      document.addEventListener('keydown', function (e) {
        const t = e.target;
        if (!t || t.tagName !== 'TR' || t.getAttribute('tabindex') !== '0') return;
        const tbody = t.parentElement;
        if (!tbody || tbody.tagName !== 'TBODY') return;
        const rows = Array.prototype.filter.call(tbody.children, function (tr) { return tr.getAttribute && tr.getAttribute('tabindex') === '0'; });
        if (!rows.length) return;
        const idx = rows.indexOf(t);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const next = e.key === 'ArrowDown' ? Math.min(idx + 1, rows.length - 1) : Math.max(idx - 1, 0);
          if (rows[next] && rows[next] !== t) rows[next].focus();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const fid = t.getAttribute('data-fid');
          if (fid) { const loc = parseFieldLoc(fid); openModal(loc.channel, loc.source, loc.id); return; }
          const ign = t.querySelector('.ignore-btn');
          if (ign) ign.click();
          return;
        }
        if (e.key === ' ' || e.key === 'Spacebar') {
          const ign = t.querySelector('.ignore-btn');
          if (ign) { e.preventDefault(); ign.click(); }
        }
      });

      document.addEventListener('click', function (e) {
        if (CTX_DEF_POPUP && !e.target.closest('.ctx-def-popup') && !e.target.closest('.ctx-tag')) closeCtxDefPopup();
        if (RULE_POPUP && !e.target.closest('.rule-popup') && !e.target.closest('[data-rule-popup]')) closeRulePopup();
        if (VAL_PANEL && !e.target.closest('.val-panel') && !e.target.closest('[data-val-expand]')) closeValPanel();
        if (BATCH_QD && !e.target.closest('#batchPanel') && !e.target.closest('#favoritesPanel') && !e.target.closest('.batch-qd') && !e.target.closest('#batchBadge')) hideBatchQuickDetail();
        const cp = e.target.closest('[data-copy]');
        if (cp) {
          copyText(cp.getAttribute('data-copy'));
          const old = cp.textContent;
          cp.textContent = '✓';
          cp.classList.add('copied');
          setTimeout(function () { cp.textContent = old; cp.classList.remove('copied'); }, 1200);
        }
      });

      // 批次目录双击：在系统文件管理器中打开对应目录（需服务端 features.revealPath 开启）。
      document.addEventListener('dblclick', function (e) {
        const el = e.target.closest('[data-reveal-dir]');
        if (!el) return;
        e.preventDefault();
        revealBatchDir(el.getAttribute('data-reveal-dir'));
      });

      // 列表/页面滚动时关闭 Ctx 详情弹框（捕获阶段，覆盖嵌套滚动容器）；
      // 弹框自身内部滚动（命中情况/规则原始配置）不关闭。
      document.addEventListener('scroll', function (e) {
        if (CTX_DEF_POPUP && !CTX_DEF_POPUP.contains(e.target)) closeCtxDefPopup();
        if (RULE_POPUP && !RULE_POPUP.contains(e.target)) closeRulePopup();
        if (VAL_PANEL && !VAL_PANEL.contains(e.target)) closeValPanel();
        // 通用浮层（表头筛选等）在容器滚动后会与锚点脱节，一并关闭；浮层自身内部滚动不关闭。
        if (POPOVER.el && !POPOVER.el.contains(e.target)) closePopover();
      }, true);
    }

    function applyFeatureVisibility() {
      const el = function (id) { return document.getElementById(id); };
      const searchWrap = el('itemSearch') ? el('itemSearch').parentElement : null;
      if (searchWrap) searchWrap.style.display = APP_FEATURES.sidebarSearch ? '' : 'none';
      const tradeIdBtn = el('tradeIdFilterBtn');
      if (tradeIdBtn) tradeIdBtn.style.display = APP_FEATURES.sidebarTradeId ? '' : 'none';
      const gsBtn = el('globalSearchBtn');
      if (gsBtn) gsBtn.style.display = APP_FEATURES.globalSearch ? '' : 'none';
      const hBtn = el('healthBtn');
      if (hBtn) hBtn.style.display = APP_FEATURES.healthOverview ? '' : 'none';
      const dock = el('batchDock');
      if (dock) dock.hidden = !APP_FEATURES.recentBatches;
      const panel = el('batchPanel');
      if (panel) panel.hidden = !(APP_FEATURES.recentBatches && BATCH_STATE.expanded);
      const favPanel = el('favoritesPanel');
      if (favPanel) favPanel.hidden = !(APP_FEATURES.recentBatches && BATCH_STATE.favoritesOpen);
      const badge = el('batchBadge');
      if (badge) badge.hidden = !(APP_FEATURES.recentBatches && BATCH_STATE.active);
    }

    async function initApp() {
      await loadAppConfig();
      await loadI18n();
      await loadBatchHelp();
      loadPrefs();
      loadPinnedId();
      await loadFavorites();
      applyTheme(THEME);
      applySidebarWidth();
      applyBatchSide();
      applyBatchDockY();
      applyBatchListH();
      await loadBatchesIndex();
      applyFeatureVisibility();
      // 启动加载优先级：URL batch > 置顶 > 上次 > 默认数据。
      const urlBatch = hashParams().batch;
      let loaded = false;
      if (urlBatch) {
        const b = batchById(urlBatch);
        if (b && batchCompatible(b)) {
          const ok = await loadBatchData(b, false, resolveUrl(indexBaseUrl(), b.dataUrl || ''));
          if (ok) loaded = true;
        } else {
          setBatchNotice(b ? t('batchUrlIncompat') : t('batchUrlMissing'));
        }
      }
      if (!loaded) {
        const pinned = restorePinnedBatch();
        if (pinned) {
          const ok = await loadBatchData(pinned.batch, pinned.forced, resolveUrl(indexBaseUrl(), pinned.batch.dataUrl || ''));
          if (ok) loaded = true;
        }
      }
      if (!loaded) {
        const restored = restoreActiveBatch();
        if (restored) {
          const ok = await loadBatchData(restored.batch, restored.forced, resolveUrl(indexBaseUrl(), restored.batch.dataUrl || ''));
          if (ok) loaded = true;
        }
      }
      if (!loaded) {
        await loadIgnoreConfig();
        DATA = await loadData();
      }
      initState();
      await ensureHashItemLoaded();
      applyHash();
      applyDateFilterVisibility();
      applyFeatureVisibility();
      bindEvents();
      render();
      preloadAllItems();
      renderBatchDock();
      renderBatchPanel();
      renderBatchBadge();
      renderForceBanner();
      syncMiniSummary();
      const boot = document.getElementById('boot');
      if (boot) { boot.classList.add('done'); setTimeout(function () { boot.remove(); }, 200); }
    }

    function applyDateFilterVisibility() {
      const dates = {};
      DATA.items.forEach(function (it) { dates[it.reportDate] = true; });
      document.getElementById('reportDateWrap').style.display = Object.keys(dates).length <= 1 ? 'none' : '';
    }

    // 启动期任何未预期异常都不能把用户留在全屏骨架层（观感等同空白页）：
    // 无条件移除 #boot，并用最少 DOM 依赖的方式给出可读提示；
    // 提示后附「或 回到主页」链接，指向 web 根（不含查询参数与深链接）。
    function bootFailed(err) {
      try { console.error('[boot] 初始化失败：', err); } catch (e) {}
      const boot = document.getElementById('boot');
      if (boot) boot.remove();
      if (document.getElementById('bootError')) return;
      const bar = document.createElement('div');
      bar.id = 'bootError';
      bar.className = 'boot-error';
      bar.setAttribute('role', 'alert');
      bar.appendChild(document.createTextNode(t('bootError') + ' ' + t('bootErrorOr') + ' '));
      const home = document.createElement('a');
      home.className = 'boot-error-home';
      home.href = webRootUrl();
      home.textContent = t('bootErrorHome');
      bar.appendChild(home);
      (document.body || document.documentElement).appendChild(bar);
    }

    if (typeof document !== 'undefined' && document.getElementById) initApp().catch(bootFailed);

    // 供 Node 测试与工具使用的导出（纯函数 + 测试挂点）。
    export {
      groupedToFlat, flatToGrouped, parseIgnoreImport, applyIgnoreImport, msgIgnoreKey, msgIsIgnored,
      filteredFields, getMsgRows, diffSegments, sortValue,
      parseSearchQuery, makeMatcher, matchRow, stateToHash,
      fieldMsgCount, rowPageFor,
      // 本地缓存作用域（纯函数）：键清单 / 按作用域清除 / IDB key 判定。
      localCacheKeys, clearLocalCacheStorage, idbKeyInScope,
    };
    export const __test = {
      setState(s) { state = s; },
      setData(d) { DATA = d; },
      setIgnoreConfig(c) { IGNORE_CONFIG = c; },
      getData() { return DATA; },
    };
  