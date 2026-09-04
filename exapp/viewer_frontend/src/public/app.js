
    /* ============================================================
     * 数据模型说明
     * item (tradeId) -> 报告渠道 (HKTR/JSFA/CFTC)
     *   -> 来源渠道 (A/B, 各有一套字段映射)
     *     -> 字段比较结果 { f, xpath, type, ctx, eo, ao, result, note, prints }
     * item 级别: reportDate / generatedAt / overviewLogs
     * 报告渠道级别: files / warnings[] / errors[] / uncompared[] / logs[]
     * ============================================================ */

    import {
      parseSearchQuery, searchValue, fieldHay, makeMatcher, matchRow,
      specialValueMatch, sortValue, flatFields, diffSegments,
      groupedToFlat, normalizeIgnoreConfig, msgIgnoreKey,
      computeHealthPure, globalSearchPure,
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

    // 每个报告渠道的字段定义: [字段, XPath或AO CSV字段, 断言类型, 值类型]
    /* ---------- 数据源与配置（外部 JSON 输入） ---------- */
    let DATA_URL = 'report-validation-data.json';
    let DEFAULT_DATA_URL = 'report-validation-data-default.json';
    let INIT_DATA_URL = 'report-validation-data-init.json';
    let DEFAULT_DATA_MODE = 'default';
    let IGNORE_CONFIG_URL = 'ignore-config-by-platform.json';
    const CONFIG_URL = 'config.json';
    let DATA_MODE = 'single';
    let APP_LIMITS = { pageSize: 20, pageSizeOptions: [10, 20, 50], sidebarPageSize: 8, msgPageSize: 20, globalSearchLimit: 200 };
    let APP_REPORT_CAT_DEFAULT = null;
    let APP_PROGRESS_STYLE = 'status';
    let DATA = { items: [] };
    let APP_FEATURES = {
      uncomparedXpath: true, uncomparedItems: true, uncomparedCsv: true, logs: true,
      conversionRule: true, validationRule: true,
      excelMapping: true, excelConversionRule: true, excelValidationRule: true,
      columnHover: true,
      sidebarSearch: true, sidebarTradeId: true,
      compare: true, healthOverview: true, globalSearch: true,
      keyboardShortcuts: true, modalPrints: true,
      recentBatches: true, batchHelp: true,
    };
    let SIDEBAR_MODE = 'combined';
    const SIDEBAR_ROW_H = 112;
    let SIDEBAR_SCROLL_PENDING = false;

    /* ---------- 最近批次（多批次扫描） ---------- */
    let BATCHES_INDEX_URL = 'batches-index.json';
    let SCAN_API_URL = '';
    const SUPPORTED_FORMAT_VERSIONS = [2];
    const VIEWER_VERSION = '6.0.0';
    const BATCH_STORAGE_KEY = 'reportValidationBatch.v1';
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
      compatOnly: false,
      cmd: '',
      desc: '',
      env: '',
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

    async function loadAppConfig() {
      try {
        const res = await fetch(CONFIG_URL, { cache: 'no-store' });
        if (!res.ok) return;
        const cfg = await res.json();
        if (!cfg || typeof cfg !== 'object') return;
        const warn = function (msg) { try { console.warn('[config] ' + msg); } catch (e) {} };

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
          excelConversionRule: flag('excelConversionRule'),
          excelValidationRule: flag('excelValidationRule'),
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
        };

        if (cfg.urls && typeof cfg.urls === 'object') {
          if (typeof cfg.urls.data === 'string' && cfg.urls.data) DATA_URL = cfg.urls.data;
          if (typeof cfg.urls.defaultData === 'string') DEFAULT_DATA_URL = cfg.urls.defaultData;
          if (typeof cfg.urls.initData === 'string') INIT_DATA_URL = cfg.urls.initData;
          if (typeof cfg.urls.defaultDataMode === 'string') DEFAULT_DATA_MODE = cfg.urls.defaultDataMode;
          if (typeof cfg.urls.ignore === 'string' && cfg.urls.ignore) IGNORE_CONFIG_URL = cfg.urls.ignore;
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

        if (cfg.columns && cfg.columns.default && typeof cfg.columns.default === 'object') {
          Object.keys(cfg.columns.default).forEach(function (k) {
            if (Object.prototype.hasOwnProperty.call(DEFAULT_COLUMNS, k)) DEFAULT_COLUMNS[k] = !!cfg.columns.default[k];
          });
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
      if (tab === 'uncompared') return currentChannelFormat() === 'xml' && APP_FEATURES.uncomparedXpath;
      if (tab === 'uncomparedCsv') return currentChannelFormat() === 'csv' && APP_FEATURES.uncomparedCsv;
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
      const db = await openIdb();
      const cached = db ? await idbGet(db, url) : null;
      const headers = {};
      if (cached && cached.etag) headers['If-None-Match'] = cached.etag;
      const res = await fetch(url, { cache: 'no-store', headers: headers });
      if (res.status === 304 && cached) return JSON.parse(cached.body);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.text();
      const etag = res.headers.get('etag');
      if (db && etag) await idbPut(db, url, { etag: etag, body: body });
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
          if (validDataset(json)) return normalizeLoaded(json);
        } catch (e) { console.warn('[data] init 数据文件加载失败：', e); }
      } else if (mode && mode !== 'default') {
        const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === mode || x.batchName === mode; });
        if (b && b.dataUrl) {
          try {
            const json = await fetchJSON(resolveUrl(indexBaseUrl(), b.dataUrl));
            if (validDataset(json)) { BATCH_STATE.active = b; saveBatchActive(); return normalizeLoaded(json); }
          } catch (e) { console.warn('[data] 批次数据加载失败：' + mode, e); }
        }
      }

      if (DEFAULT_DATA_URL) {
        try {
          const json = await fetchJSON(DEFAULT_DATA_URL);
          if (validDataset(json)) return normalizeLoaded(json);
        } catch (e) { console.warn('[data] 默认数据文件加载失败：', e); }
      }
      try {
        const json = await fetchJSON(DATA_URL);
        if (validDataset(json)) return normalizeLoaded(json);
        throw new Error('数据格式无效');
      } catch (e) {
        console.warn('[data] 外部 JSON 加载失败：', e);
        return { mode: 'single', items: [], reportEnv: DEFAULT_ENV };
      }
    }
    function isMultiMode() { return DATA_MODE === 'multi'; }
    // 多文件模式：按需加载单个 item 的完整数据文件。
    async function loadItemFile(tradeId) {
      const meta = DATA.items.find(function (i) { return i.tradeId === tradeId; });
      if (!meta || !meta.file) return null;
      try {
        const full = await fetchJSON(resolveUrl(location.href, meta.file));
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
    const COLUMNS = [
      { key: 'channel', label: 'colChannel', sortable: true,  filterable: 'select' },
      { key: 'source',  label: 'colSource',  sortable: true,  filterable: 'select' },
      { key: 'f',       label: 'colField',   sortable: true,  filterable: 'text' },
      { key: 'x',       label: 'colXPath',   sortable: true,  filterable: 'text' },
      { key: 'aoCsv',   label: 'colAoCsv',   sortable: true,  filterable: 'text' },
      { key: 't',       label: 'colType',    sortable: true,  filterable: 'select' },
      { key: 'ctx',     label: 'colCtx',     sortable: true,  filterable: 'text' },
      { key: 'eo',      label: 'colEO',      sortable: false, filterable: 'text' },
      { key: 'ao',      label: 'colAO',      sortable: false, filterable: 'text' },
      { key: 'result',  label: 'colResult',  sortable: true,  filterable: 'select' },
      { key: 'note',    label: 'colNote',    sortable: true,  filterable: 'text' },
    ];
    const DEFAULT_COLUMNS = { channel: true, source: true, f: true, x: true, aoCsv: true, t: false, ctx: false, eo: true, ao: true, result: true, note: false };

    let state = null;
    function initState() {
      state = {
        itemId: DATA.items.length ? DATA.items[0].tradeId : '',
        tab: 'fields',
        channel: 'ALL',
        search: '',
        colFilter: { channel: 'ALL', source: 'ALL', f: '', x: '', aoCsv: '', t: 'ALL', ctx: '', eo: '', ao: '', result: 'ALL', note: '' },
        sort: { key: '', dir: 1 },
        page: 1,
        pageSize: APP_LIMITS.pageSize,
        columns: Object.assign({}, DEFAULT_COLUMNS),
        ctxColWidth: 260,
        eoColWidth: 240,
        aoColWidth: 240,
        noteColWidth: 200,
        itemSearch: '',
        itemFilter: 'ALL',
        itemPlatforms: [],
        itemProducts: [],
        itemTradeIds: [],
        reportCat: APP_REPORT_CAT_DEFAULT,
        sidebarPage: 1,
        sidebarPageSize: APP_LIMITS.sidebarPageSize,
        specialFilter: { eo: 'ALL', ao: 'ALL' },
        msgSort: { key: '', dir: 1 },
        msgFilter: {},
        msgPage: 1,
        msgPageSize: APP_LIMITS.msgPageSize,
        reportDateFilter: (function () { const ds = DATA.items.map(function (i) { return i.reportDate; }).sort(); return ds.length ? ds[ds.length - 1] : ''; })(),
        compare: { mode: 'channel', channelA: 'HKTR', channelB: 'JSFA', itemB: '', sort: { key: '', dir: 1 }, filter: { f: '', source: 'ALL', aResult: 'ALL', bResult: 'ALL', diff: 'ALL' }, page: 1, pageSize: 20 },
      };
    }
    let ACTIVE_FILTERS = [];
    let SIDEBAR_FILTERS = [];
    let POPOVER = { el: null, cleanup: null };
    let HASH_SYNC = { applying: false };
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
    const PREF_STORAGE_KEY = 'reportValidationPrefs.v1';
    function loadPrefs() {
      try {
        const p = JSON.parse(localStorage.getItem(PREF_STORAGE_KEY) || '{}');
        if (p.lang && LANGS.some(function (l) { return l[0] === p.lang; })) LANG = p.lang;
        if (p.theme && THEMES.some(function (t) { return t[0] === p.theme; })) THEME = p.theme;
        if (typeof p.sidebarWidth === 'number') SIDEBAR_WIDTH = p.sidebarWidth;
        if (p.batchDockSide === 'left' || p.batchDockSide === 'right') BATCH_STATE.side = p.batchDockSide;
        if (typeof p.dockY === 'number') BATCH_STATE.dockY = p.dockY;
        if (typeof p.listH === 'number') BATCH_STATE.listH = p.listH;
      } catch (e) {}
    }
    function savePrefs() {
      try { localStorage.setItem(PREF_STORAGE_KEY, JSON.stringify({ theme: THEME, lang: LANG, sidebarWidth: SIDEBAR_WIDTH, batchDockSide: BATCH_STATE.side, dockY: BATCH_STATE.dockY, listH: BATCH_STATE.listH })); } catch (e) {}
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
    function sourceName(name) {
      return name;
    }
    function sourceNames() {
      const names = [];
      DATA.items.forEach(function (it) {
        it.channels.forEach(function (ch) {
          ch.sources.forEach(function (s) {
            if (s.name && names.indexOf(s.name) === -1) names.push(s.name);
          });
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
      if (el) el.textContent = t('env') + currentEnv();
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
      document.getElementById('sidebarTitle').textContent = t('sidebarTitle');
      document.getElementById('healthBtn').textContent = t('healthBtn');
      document.getElementById('globalSearchBtn').textContent = t('globalSearch');
      document.getElementById('helpBtn').title = t('helpTitle');
      document.getElementById('helpBtn').setAttribute('aria-label', t('helpTitle'));
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

    /* ---------- 警告忽略配置（动态存储，后续可改为 JSON 字段加载） ---------- */
    const IGNORE_STORAGE_KEY = 'reportValidationIgnoreConfig.v1';
    let IGNORE_CONFIG = {};
    async function loadIgnoreConfig() {
      try {
        const res = await fetch(IGNORE_CONFIG_URL, { cache: 'no-store' });
        if (res.ok) {
          const norm = normalizeIgnoreConfig(await res.json());
          if (norm) { IGNORE_CONFIG = norm; saveIgnoreConfig(); return; }
        }
      } catch (e) {}
      try { IGNORE_CONFIG = JSON.parse(localStorage.getItem(IGNORE_STORAGE_KEY) || '{}'); }
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
      BATCH_STATE.loaded = true;
    }
    function batchCompatible(b) {
      return SUPPORTED_FORMAT_VERSIONS.indexOf(Number(b && b.formatVersion)) !== -1;
    }
    function batchSortVal(b) { return String(b.executedAt || b.date || ''); }
    function isBatchPending(b) { return !!(b && BATCH_STATE.pendingDeletes[b.batchId]); }
    function isNewBatch(b) { return !!(b && NEW_BATCH_IDS[b.batchId]); }
    function liveBatches() { return BATCHES_INDEX.batches.filter(function (b) { return !isBatchPending(b); }); }
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
      const list = liveBatches().filter(function (b) {
        if (BATCH_STATE.compatOnly && !batchCompatible(b)) return false;
        if (nameM && !nameM((b.batchName || '') + ' ' + (b.batchId || ''))) return false;
        if (cmdM && !cmdM(((b.commandLine || []).concat(b.argv || [])).join(' '))) return false;
        if (descM && !descM(b.description || '')) return false;
        if (d) {
          const bd = String(b.date || String(b.executedAt || '').slice(0, 10));
          if (bd !== d) return false;
        }
        if (BATCH_STATE.env && String(b.reportEnv || '') !== BATCH_STATE.env) return false;
        return true;
      });
      list.sort(function (a, b) { return BATCH_STATE.sortDir * batchSortVal(a).localeCompare(batchSortVal(b)); });
      return list;
    }
    function recentBatches() {
      return liveBatches().slice().filter(function (b) {
        return BATCH_STATE.compatOnly ? batchCompatible(b) : true;
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
    function batchItemHTML(b) {
      const compat = batchCompatible(b);
      const active = BATCH_STATE.active && BATCH_STATE.active.batchId === b.batchId;
      const pending = isBatchPending(b);
      const sum = batchSummaryText(b);
      const title = BATCH_STATE.detailMode === 'quick' ? t('batchQuickHint') : '';
      const desc = (typeof b.description === 'string' && b.description.trim()) ? b.description.trim() : '';
      const descLine = desc.split('\n')[0].trim();
      const descHTML = descLine ? '<div class="bi-desc" title="' + esc(desc) + '">' + esc(descLine) + '</div>' : '';
      let infoBtn = '';
      if (BATCH_STATE.detailMode === 'modal' && !pending) {
        infoBtn = '<button class="bi-info" data-binfor="' + esc(b.batchId) + '" title="' + t('batchInfo') + '" aria-label="' + t('batchInfo') + '">ℹ</button>';
      }
      const actions = pending
        ? '<div class="bi-actions"><button class="bi-act undo" data-batch-undo="' + esc(b.batchId) + '">' + t('batchDeleteUndo') + '</button>' +
          '<button class="bi-act confirm" data-batch-confirm="' + esc(b.batchId) + '">' + t('batchDeleteConfirm') + '</button></div>'
        : '<span class="bi-actions2">' +
          '<button class="bi-fav' + (isBatchFavorited(b) ? ' on' : '') + '" data-batch-fav="' + esc(b.batchId) + '" title="' + t('favAdd') + '" aria-label="' + t('favAdd') + '">' + (isBatchFavorited(b) ? '★' : '☆') + '</button>' +
          (isBatchFavorited(b) ? '' : '<button class="bi-del" data-batch-del="' + esc(b.batchId) + '" title="' + t('batchDelete') + '" aria-label="' + t('batchDelete') + '">✕</button>') +
          '</span>';
      const dataAttr = pending ? 'data-batch-pending="' + esc(b.batchId) + '"' : 'data-batch="' + esc(b.batchId) + '"';
      return '<div class="batch-item' + (active ? ' active' : '') + (compat ? '' : ' incompat') + (pending ? ' deleting' : '') + '" ' + dataAttr + (pending ? '' : ' role="button" tabindex="0"') + (title && !pending ? ' title="' + title + '"' : '') + '>' +
        '<div class="bi-top"><span class="bi-name">' + esc(b.batchName || b.batchId) + '</span>' + infoBtn + actions + '</div>' +
        '<div class="bi-time">' + esc(formatBatchTime(b.executedAt)) + '</div>' +
        descHTML +
        '<div class="bi-badges">' +
        '<span class="b-badge bv">v' + esc(String(b.formatVersion)) + '</span>' +
        (isNewBatch(b) ? '<span class="b-badge new">' + t('batchNew') + '</span>' : '') +
        (compat ? '<span class="b-badge ok">✓ ' + t('batchCompat') + '</span>' : '<span class="b-badge bad">⚠ ' + t('batchIncompat') + '</span>') +
        (b.reportEnv ? '<span class="b-badge benv">' + esc(b.reportEnv) + '</span>' : '') +
        (sum ? '<span class="b-badge bsum">' + esc(sum) + '</span>' : '') +
        '</div></div>';
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
    function renderBatchDock() {
      const dock = document.getElementById('batchDock');
      if (!dock) return;
      const rec = recentBatches();
      let chips = '';
      rec.forEach(function (b) {
        const active = BATCH_STATE.active && BATCH_STATE.active.batchId === b.batchId;
        const day = String(b.date || '').slice(-2);
        chips += '<button class="bd-chip' + (active ? ' active' : '') + (batchCompatible(b) ? '' : ' incompat') + (isBatchFavorited(b) ? ' fav' : '') + '" data-batch="' + esc(b.batchId) + '" aria-label="' + esc(b.batchName + ' · ' + formatBatchTime(b.executedAt)) + '">' + esc(day || '?') + (isNewBatch(b) ? '<span class="bd-new-dot" title="' + t('batchNew') + '"></span>' : '') + '</button>';
      });
      if (!chips && liveBatches().length) chips = '<span class="bd-empty" title="' + t('batchNoCompat') + '">' + t('batchNoCompat') + '</span>';
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
      const dateHint = (function () {
        const dates = {};
        liveBatches().forEach(function (b) { dates[String(b.date || '')] = true; });
        return Object.keys(dates).length + ' ' + t('batchDateHint');
      })();
      const envs = [];
      liveBatches().forEach(function (b) {
        const e = String(b.reportEnv || '').trim();
        if (e && envs.indexOf(e) === -1) envs.push(e);
      });
      const envOpts = '<option value="">' + t('batchEnvAll') + '</option>' +
        envs.map(function (e) { return '<option value="' + esc(e) + '"' + (BATCH_STATE.env === e ? ' selected' : '') + '>' + esc(e) + '</option>'; }).join('');
      panel.innerHTML =
        '<div class="bp-head"><span class="bp-title">' + t('batchTitle') + '</span>' +
        '<span class="bp-count" id="batchCount"' + (BATCHES_INDEX.generatedAt ? ' title="' + esc(t('batchScannedAt') + ' ' + batchScanTimeText()) + '"' : '') + '>' + liveBatches().length + '</span>' +
        '<button class="bp-compat' + (BATCH_STATE.compatOnly ? ' on' : '') + '" id="batchCompatFilter" title="' + (BATCH_STATE.compatOnly ? t('batchCompatOnly') : t('batchAll')) + '" aria-label="' + (BATCH_STATE.compatOnly ? t('batchCompatOnly') : t('batchAll')) + '">' + (BATCH_STATE.compatOnly ? '✓' : '≡') + '</button>' +
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
          '<div class="bp-date-hint" id="batchDateHint">' + dateHint + '</div>' +
          '<div class="bp-row"><select id="batchEnv" title="' + t('batchEnv') + '">' + envOpts + '</select></div>') +
        '</div>' +
        '<div class="bp-notice" id="batchNotice"' + (BATCH_STATE.notice ? '' : ' hidden') + '>' +
        '<span class="bp-notice-text">' + esc(BATCH_STATE.notice || '') + '</span>' +
        '<button class="bp-notice-close" id="batchNoticeClose" title="' + t('closeLabel') + '" aria-label="' + t('closeLabel') + '">✕</button>' +
        '</div>' +
        '<div class="bp-resize top" id="batchResizeTop" title="' + t('batchResizeHint') + '" aria-label="' + t('batchResizeHint') + '">⠿</div>' +
        '<div class="bp-pending-bar" id="batchPendingBar" hidden></div>' +
        '<div class="bp-list" id="batchList"></div>' +
        '<div class="bp-pager" id="batchPager"></div>' +
        '<div class="bp-resize" id="batchResize" title="' + t('batchResizeHint') + '" aria-label="' + t('batchResizeHint') + '">⠿</div>';
      renderBatchList();
      renderBatchPendingBar();
      positionBatchPanel();
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
      if (b && isBatchFavorited(b)) { setBatchNotice(t('favDeleteBlocked')); return; }
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
      BATCHES_INDEX.batches = BATCHES_INDEX.batches.filter(function (b) { return b.batchId !== id; });
      if (BATCH_STATE.active && BATCH_STATE.active.batchId === id) { BATCH_STATE.active = null; saveBatchActive(); }
      setBatchNotice('');
      renderBatchPanel(); renderBatchDock(); renderBatchBadge(); renderForceBanner();
    }

    /* ---------- 收藏夹（按包名 aa.bb.cc 分层折叠） ---------- */
    const FAV_STORAGE_KEY = 'reportValidationFavorites.v1';
    let FAVORITES = {};
    let FAV_COLLAPSED = {};
    let FAV_SEARCH = '';
    async function loadFavorites() {
      // 优先读取服务端共享收藏（多用户一致）；失败则回退 localStorage。
      try {
        const res = await fetch('/api/favorites', { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          if (j && j.ok === true && j.favorites && typeof j.favorites === 'object' && !Array.isArray(j.favorites)) {
            FAVORITES = j.favorites;
            try { localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(FAVORITES)); } catch (e) {}
            return;
          }
        }
      } catch (e) {}
      try { FAVORITES = JSON.parse(localStorage.getItem(FAV_STORAGE_KEY) || '{}'); } catch (e) { FAVORITES = {}; }
      if (!FAVORITES || typeof FAVORITES !== 'object' || Array.isArray(FAVORITES)) FAVORITES = {};
    }
    function saveFavorites() {
      try { localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(FAVORITES)); } catch (e) {}
      fetch('/api/favorites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorites: FAVORITES }) }).catch(function () {});
    }
    function favPkgList() { return Object.keys(FAVORITES).sort(); }
    function isValidPkg(pkg) { return /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(String(pkg || '').trim()); }
    // 收藏标记回写批次元数据（服务端持久化，扫描后仍在索引中体现）。
    function setBatchFavoriteFlag(batchId, flag) {
      const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === batchId; });
      if (b) b.favorite = flag;
      fetch('/api/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batchId: batchId, favorite: flag }) }).catch(function () {});
    }
    function isBatchFavorited(b) { return !!(b && b.favorite); }
    function favoriteCountFor(batchId) {
      let n = 0;
      Object.keys(FAVORITES).forEach(function (pkg) {
        if ((FAVORITES[pkg] || []).some(function (f) { return f.batchId === batchId; })) n++;
      });
      return n;
    }
    function addFavorite(batchId, pkg) {
      pkg = String(pkg || '').trim();
      if (!isValidPkg(pkg)) return { ok: false, error: t('favInvalidPkg') };
      const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === batchId; });
      if (!b) return { ok: false, error: t('favBatchMissing') };
      if (isBatchPending(b)) return { ok: false, error: t('favPendingBlocked') };
      if (!FAVORITES[pkg]) FAVORITES[pkg] = [];
      if (!FAVORITES[pkg].some(function (f) { return f.batchId === batchId; })) {
        FAVORITES[pkg].push({ batchId: batchId, batchName: b.batchName || b.batchId, date: b.date || '', executedAt: b.executedAt || '', savedAt: new Date().toISOString() });
        saveFavorites();
      }
      setBatchFavoriteFlag(batchId, true);
      renderBatchPanel(); renderBatchDock();
      return { ok: true };
    }
    function removeFavorite(pkg, batchId) {
      if (!FAVORITES[pkg]) return;
      FAVORITES[pkg] = FAVORITES[pkg].filter(function (f) { return f.batchId !== batchId; });
      if (!FAVORITES[pkg].length) delete FAVORITES[pkg];
      saveFavorites();
      if (favoriteCountFor(batchId) === 0) setBatchFavoriteFlag(batchId, false);
      renderFavoritesPanel();
      renderBatchPanel(); renderBatchDock();
    }
    function favoriteBatchExists(batchId) {
      return BATCHES_INDEX.batches.some(function (b) { return b.batchId === batchId; });
    }
    function favItemsHTML(items, pkg) {
      return (items || []).map(function (f) {
        const missing = !favoriteBatchExists(f.batchId);
        const savedHint = t('favSavedAt') + ' ' + formatBatchTime(f.savedAt);
        return '<div class="fav-item' + (missing ? ' missing' : '') + '">' +
          '<button class="fav-load" data-fav-load="' + esc(f.batchId) + '" title="' + esc(savedHint) + '">' + esc(f.batchName) + '</button>' +
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
              '<button class="fav-load" data-fav-load="' + esc(f.batchId) + '" title="' + esc(t('favSavedAt') + ' ' + formatBatchTime(f.savedAt)) + '">' + esc(f.batchName) + '</button>' +
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
        ? '<div class="fav-searchbar"><input class="pop-control" id="favSearch" placeholder="' + t('favSearchPlaceholder') + '" value="' + esc(FAV_SEARCH) + '"><button class="fav-search-clear" id="favSearchClear" title="' + t('batchNone') + '" aria-label="' + t('batchNone') + '">✕</button></div>'
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
    function renderBatchList() {
      const listEl = document.getElementById('batchList');
      const pagerEl = document.getElementById('batchPager');
      if (!listEl) return;
      const list = visibleBatches();
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
        listEl.innerHTML = '<div class="empty">' + (BATCHES_INDEX.batches.length ? t('batchEmptyFiltered') : t('batchEmpty')) + '</div>';
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
        '<div class="bdc-badges"><span class="b-badge bv">v' + esc(String(b.formatVersion)) + '</span>' +
        (batchCompatible(b) ? '<span class="b-badge ok">✓ ' + t('batchCompat') + '</span>' : '<span class="b-badge bad">⚠ ' + t('batchIncompat') + '</span>') +
        (b.reportEnv ? '<span class="b-badge benv">' + esc(b.reportEnv) + '</span>' : '') +
        '</div>';
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
        if (BATCH_STATE.active) localStorage.setItem(BATCH_STORAGE_KEY, JSON.stringify({ id: BATCH_STATE.active.batchId, forced: BATCH_STATE.forced }));
        else localStorage.removeItem(BATCH_STORAGE_KEY);
      } catch (e) {}
    }
    function restoreActiveBatch() {
      try {
        const s = JSON.parse(localStorage.getItem(BATCH_STORAGE_KEY) || 'null');
        if (s && s.id) {
          const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === s.id; });
          if (b) return { batch: b, forced: batchCompatible(b) ? false : !!s.forced };
        }
      } catch (e) {}
      return null;
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
    function selectBatch(b) {
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
      } catch (e) {
        console.warn('[batch] 加载失败：', e);
        setBatchNotice(t('batchLoadError') + ' ' + (b.batchName || b.batchId));
        return false;
      }
      const ignoreUrl = b.ignoreUrl ? resolveUrl(indexBaseUrl(), b.ignoreUrl) : '';
      if (ignoreUrl) {
        try {
          const r = await fetch(ignoreUrl, { cache: 'no-store' });
          if (r.ok) { const norm = normalizeIgnoreConfig(await r.json()); if (norm) IGNORE_CONFIG = norm; }
        } catch (e) {}
        saveIgnoreConfig();
      } else {
        await loadIgnoreConfig();
      }
      BATCH_STATE.active = b; BATCH_STATE.forced = forced;
      setBatchNotice('');
      saveBatchActive();
      return true;
    }
    async function loadBatch(b, forced) {
      BATCH_STATE.loading = true;
      renderBatchPanel(); renderBatchDock();
      const dataUrl = resolveUrl(indexBaseUrl(), b.dataUrl || '');
      const ok = await loadBatchData(b, forced, dataUrl);
      BATCH_STATE.loading = false;
      if (!ok) { renderBatchPanel(); renderBatchDock(); return; }
      // 加载至主列表后移除「新增」徽章。
      if (NEW_BATCH_IDS[b.batchId]) delete NEW_BATCH_IDS[b.batchId];
      initState();
      if (isMultiMode()) await ensureItemLoaded(DATA.items[0].tradeId);
      clearHash();
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
      if (isMultiMode()) await ensureItemLoaded(DATA.items[0].tradeId);
      clearHash();
      applyDateFilterVisibility();
      render();
      preloadAllItems();
      renderBatchPanel(); renderBatchDock(); renderBatchBadge(); renderForceBanner();
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
    function batchDetailKVHTML(b) {
      const compat = batchCompatible(b);
      const dir = b.path || BATCHES_INDEX.basedir || '';
      const rows = [
        [t('batchEnv'), b.reportEnv || t('batchEnvUnknown'), false],
        [t('batchDateLabel'), b.date || '', false],
        [t('batchExecutedAt'), formatBatchTime(b.executedAt), false],
        [t('batchBasedir'), dir, true],
        [t('batchVersion'), 'v' + b.formatVersion + ' · ' + (compat ? t('batchCompat') + ' ✓' : t('batchIncompat') + ' ⚠'), false],
      ];
      if (b.summary && typeof b.summary.items === 'number') rows.push([t('batchItemCount'), b.summary.items, false]);
      return rows.map(function (r) {
        const v = r[1] == null ? '' : String(r[1]);
        if (r[2]) {
          return '<div class="k">' + esc(r[0]) + '</div><div class="v bi-dir"><span class="bi-link" title="' + esc(v) + '">' + esc(v) + '</span><button class="bi-copy" data-copy="' + esc(v) + '" title="' + t('batchCopy') + '" aria-label="' + t('batchCopy') + '">⧉</button></div>';
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
        '<div class="modal-body"><div class="bi-kv">' + batchDetailKVHTML(b) + '</div>' + batchDetailCmdHTML(b) + batchDetailDescHTML(b) + '</div></div>';
      backdrop.addEventListener('click', function (e) {
        if (e.target === backdrop || e.target.closest('.modal-close')) backdrop.remove();
      });
      document.body.appendChild(backdrop);
    }
    let BATCH_QD = null;
    function buildBatchQuickDetail(b) {
      const compat = batchCompatible(b);
      const card = document.createElement('div');
      card.className = 'batch-qd';
      card.id = 'batchQuickDetail';
      card.innerHTML =
        '<div class="bq-name">' + esc(b.batchName || b.batchId) + '</div>' +
        '<div class="bq-time">' + esc(formatBatchTime(b.executedAt)) + '</div>' +
        '<div class="bq-badges"><span class="b-badge bv">v' + esc(String(b.formatVersion)) + '</span>' +
        (compat ? '<span class="b-badge ok">✓ ' + t('batchCompat') + '</span>' : '<span class="b-badge bad">⚠ ' + t('batchIncompat') + '</span>') + '</div>' +
        '<div class="bi-kv">' + batchDetailKVHTML(b) + '</div>' +
        batchDetailCmdHTML(b) +
        batchDetailDescHTML(b);
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
      if (BATCH_QD) { BATCH_QD.remove(); BATCH_QD = null; }
    }

    function msgIsIgnored(tab, m) {
      const k = msgIgnoreKey(tab, m);
      return k ? !!IGNORE_CONFIG[k] : false;
    }
    function saveIgnoreConfig() {
      try { localStorage.setItem(IGNORE_STORAGE_KEY, JSON.stringify(IGNORE_CONFIG)); } catch (e) {}
    }
    function toggleIgnoreByKey(key) {
      if (IGNORE_CONFIG[key]) delete IGNORE_CONFIG[key];
      else IGNORE_CONFIG[key] = true;
      saveIgnoreConfig();
      renderSummary(); renderTabs(); renderChannelTabs();
      renderSidebar(); renderSidebarChips(); renderContent();
    }
    function exportIgnoreConfig() {
      const grouped = {};
      Object.keys(IGNORE_CONFIG).forEach(function (k) {
        if (!IGNORE_CONFIG[k]) return;
        let arr;
        try { arr = JSON.parse(k); } catch (e) { return; }
        let platform, entry;
        if (arr[0] === 'warn') {
          platform = arr[5] || 'UNKNOWN';
          entry = { kind: 'warning', channel: arr[1], field: arr[2], type: arr[3], level: arr[4], product: arr[6] };
        } else if (arr[0] === 'xpath') {
          platform = arr[3] || 'UNKNOWN';
          entry = { kind: 'uncomparedXpath', xpath: arr[1], channel: arr[2], product: arr[4], ctx: arr[5] };
        } else return;
        if (!grouped[platform]) grouped[platform] = { warnings: [], uncomparedXpaths: [] };
        if (entry.kind === 'warning') grouped[platform].warnings.push(entry);
        else grouped[platform].uncomparedXpaths.push(entry);
      });
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
      state.page = 1;
      state.channel = 'ALL';
      state.colFilter = { channel: 'ALL', source: 'ALL', f: '', x: '', aoCsv: '', t: 'ALL', ctx: '', eo: '', ao: '', result: 'ALL', note: '' };
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

    function currentChannelFormat() {
      if (state.channel !== 'ALL') {
        const it = currentItem();
        const ch = it.channels.find(function (c) { return c.name === state.channel; });
        if (ch && ch.format === 'csv') return 'csv';
      }
      return 'xml';
    }
    function isFieldColVisible(c) {
      if (c.key === 'x') return currentChannelFormat() === 'xml' && state.columns.x;
      if (c.key === 'aoCsv') return currentChannelFormat() === 'csv' && state.columns.aoCsv;
      return state.columns[c.key];
    }

    function itemStatsAll(item) {
      if (isMultiMode() && item && !Array.isArray(item.channels)) return item.summary || { total: 0, passed: 0, failed: 0, rate: 0, warnings: 0, warningsIgnored: 0, errors: 0, uncompared: 0, logs: 0 };
      let total = 0, passed = 0, failed = 0;
      item.channels.forEach(ch => ch.sources.forEach(s => s.fields.forEach(f => {
        total++;
        f.result === 'PASSED' ? passed++ : failed++;
      })));
      let warnings = 0, warningsIgnored = 0;
      item.channels.forEach(c => c.warnings.forEach(w => { if (msgIsIgnored('warnings', w)) warningsIgnored++; else warnings++; }));
      const errors = item.channels.reduce((n, c) => n + c.errors.length, 0);
      const uncompared = item.channels.reduce((n, c) => n + c.uncompared.length, 0);
      const logs = item.overviewLogs.length + item.channels.reduce((n, c) => n + c.logs.length, 0);
      return { total: total, passed: passed, failed: failed, rate: total ? Math.round(passed / total * 100) : 0, warnings: warnings, warningsIgnored: warningsIgnored, errors: errors, uncompared: uncompared, logs: logs };
    }

    function scopeWarnings() { const a = []; scopeChannels().forEach(c => c.warnings.forEach(w => a.push(w))); return a; }
    function scopeErrors() { const a = []; scopeChannels().forEach(c => c.errors.forEach(w => a.push(w))); return a; }
    function scopeUncompared() { const a = []; scopeChannels().forEach(c => c.uncompared.forEach(w => a.push(w))); return a; }
    function scopeUncomparedCsv() { const a = []; scopeChannels().forEach(c => c.uncomparedCsv.forEach(w => a.push(w))); return a; }
    function scopeSkippedItems() {
      const it = currentItem();
      if (!it) return [];
      if (state.channel === 'ALL') return it.skippedItems;
      if (it.enabledChannels.indexOf(state.channel) === -1) return [];
      return it.skippedItems.filter(s => s.channel === 'ALL' || s.channel === state.channel);
    }
    function scopeLogs() {
      const it = currentItem();
      if (!it) return [];
      if (state.channel === 'ALL') {
        const lines = it.overviewLogs.slice();
        it.channels.forEach(c => c.logs.forEach(l => lines.push(l)));
        return lines;
      }
      const c = it.channels.find(c => c.name === state.channel);
      return c ? c.logs.slice() : [];
    }

    function scopeStats() {
      let total = 0, passed = 0, failed = 0;
      scopeChannels().forEach(ch => ch.sources.forEach(s => s.fields.forEach(f => {
        total++;
        f.result === 'PASSED' ? passed++ : failed++;
      })));
      return {
        total: total, passed: passed, failed: failed,
        rate: total ? Math.round(passed / total * 100) : 0,
        warnings: scopeWarnings().filter(m => !msgIsIgnored('warnings', m)).length,
        warningsIgnored: scopeWarnings().filter(m => msgIsIgnored('warnings', m)).length,
        errors: scopeErrors().length,
        uncompared: scopeUncompared().filter(u => !msgIsIgnored('uncompared', u)).length,
        uncomparedIgnored: scopeUncompared().filter(u => msgIsIgnored('uncompared', u)).length,
        uncomparedCsv: scopeUncomparedCsv().filter(u => !msgIsIgnored('uncomparedCsv', u)).length,
        uncomparedCsvIgnored: scopeUncomparedCsv().filter(u => msgIsIgnored('uncomparedCsv', u)).length,
        logs: scopeLogs().length,
        skipped: scopeSkippedItems().length,
      };
    }

    function filteredFields(item) {
      let rows = flatFields(item);
      if (state.channel !== 'ALL') rows = rows.filter(r => r.channel === state.channel);
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
    function valueTypeChip(k) {
      const cls = 'vt-' + (VALUE_TYPE_KEYS[k] ? k : 'text');
      return '<span class="chip ' + cls + '">' + esc(valueTypeLabel(k)) + '</span>';
    }

    function sortArrow(key) {
      if (state.sort.key !== key) return '⇅';
      return state.sort.dir === 1 ? '▲' : '▼';
    }

    function findFieldById(item, id) {
      for (const ch of item.channels) {
        for (const s of ch.sources) {
          for (const f of s.fields) if (f.id === id) return { channel: ch.name, source: s.name, field: f };
        }
      }
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
      const barCls = 'bar-fill' + (APP_PROGRESS_STYLE === 'status' && s.failed === 0 && s.warnings > 0 ? ' bar-warn' : '');
      const warnNote = s.warnings > 0 ? ' · ' + s.warnings + ' ' + t('sidebarUnconfirmedWarnings') : '';
      const barTitle = t('passRate') + ' ' + s.rate + '% · ' + t('passed') + ' ' + s.passed + ' / ' + t('failed') + ' ' + s.failed + (s.warnings ? ' · ' + t('warnings') + ' ' + s.warnings : '');
      return '<div class="' + cls + '" data-id="' + it.tradeId + '" tabindex="0">' +
        '<div class="item-id">' + highlight(it.tradeId, q) + '</div>' +
        '<div class="item-sub">' + s.total + ' ' + t('sidebarFields') + ' · <span class="num-fail">' + s.failed + '</span> ' + t('sidebarFailures') + ' · <span class="num-pass">' + s.rate + '%</span> ' + t('sidebarPassRate') + warnNote + '</div>' +
        '<div class="item-sub">' + t('sidebarReportDate') + ' ' + esc(it.reportDate) + '</div>' +
        '<div class="item-sub">' + esc(it.platform) + ' · ' + esc(it.productCategory) + ' · ' + esc(it.product) + '</div>' +
        '<div class="bar" title="' + esc(barTitle) + '"><div class="' + barCls + '" style="width:' + s.rate + '%"></div></div>' +
        '</div>';
    }

    function pagerHTML(p, pages) {
      const from = Math.max(1, p - 1), to = Math.min(pages, p + 1);
      let parts = [];
      if (pages > 3) parts.push('<button class="pg" data-sidepage="1"' + (p === 1 ? ' disabled' : '') + ' title="首页">«</button>');
      parts.push('<button class="pg" data-sidepage="' + (p - 1) + '"' + (p === 1 ? ' disabled' : '') + ' title="上一页">‹</button>');
      for (let i = from; i <= to; i++) parts.push('<button class="pg' + (i === p ? ' cur' : '') + '" data-sidepage="' + i + '">' + i + '</button>');
      parts.push('<button class="pg" data-sidepage="' + (p + 1) + '"' + (p === pages ? ' disabled' : '') + ' title="下一页">›</button>');
      if (pages > 3) parts.push('<button class="pg" data-sidepage="' + pages + '"' + (p === pages ? ' disabled' : '') + ' title="尾页">»</button>');
      return parts.join('') + '<span class="pg-info">' + p + '/' + pages + '</span>';
    }

    function layoutSidebarList() {
      const list = document.getElementById('sidebarList');
      if (!list) return;
      if (window.innerWidth <= 920) { list.style.top = ''; list.style.bottom = ''; return; }
      const chips = document.getElementById('sidebarChips');
      const pager = document.getElementById('sidebarPager');
      const topEl = (chips && chips.offsetHeight) ? chips : document.querySelector('.sidebar-filters');
      const top = topEl ? topEl.offsetTop + topEl.offsetHeight : 0;
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
      const page = Math.min(pages, Math.max(1, Math.floor(listEl.scrollTop / (pageSize * rowH)) + 1));
      document.getElementById('sidebarPager').innerHTML = pagerHTML(page, pages);
      layoutSidebarList();
      const viewH = listEl.clientHeight || 400;
      const overscan = 3;
      const scrollTop = listEl.scrollTop;
      const totalH = all.length * rowH;
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
      updateReportDateHint();
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
      document.getElementById('sidebarChips').innerHTML = chips.map((c, i) =>
        '<span class="filter-chip">' + esc(c.label) + '<button data-sideclear="' + i + '" title="清除">✕</button></span>'
      ).join('');
      document.getElementById('platformFilterBtn').classList.toggle('has-filter', state.itemPlatforms.length > 0);
      document.getElementById('productFilterBtn').classList.toggle('has-filter', state.itemProducts.length > 0);
      document.getElementById('tradeIdFilterBtn').classList.toggle('has-filter', state.itemTradeIds.length > 0);
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
      document.getElementById('itemMeta').innerHTML = '<a class="item-meta-link" data-item-info="1" title="' + t('viewItemAttrs') + '">' + esc(it.tradeId) + '</a>';
      document.getElementById('reportMeta').textContent = t('reportDateLabel') + it.reportDate + '　　' + t('generatedAtLabel') + it.generatedAt;
      document.getElementById('channelMeta').textContent = t('channelMetaLabel') +
        it.channels.map(c => c.name + '（' + channelDesc(c.name) + '）').join('　');
    }

    function openItemInfoPopover(anchor, item) {
      if (anchor.classList.contains('active')) { closePopover(); return; }
      const cp = (item.counterpartyItemId && DATA.items.some(function (x) { return x.tradeId === item.counterpartyItemId; }))
        ? '<a class="cp-link" data-cp-item="' + esc(item.counterpartyItemId) + '" title="' + t('jumpToItem') + '">' + esc(item.counterpartyItemId) + '</a>'
        : '<span class="num-muted">' + t('counterpartyNone') + '</span>';
      const copyBtn = function (v) {
        return v ? '<button class="copy-btn" data-copy="' + esc(v) + '" title="' + t('copyValue') + '" aria-label="' + t('copyValue') + '">⧉</button>' : '';
      };
      const html =
        '<div class="item-info-row"><span class="iir-label">' + t('counterpartyLabel') + '</span>' + cp + copyBtn(item.counterpartyItemId) + '</div>' +
        '<div class="item-info-row"><span class="iir-label">' + t('platformTradeIdLabel') + '</span><span class="mono">' + esc(item.platformTradeId || t('counterpartyNone')) + '</span>' + copyBtn(item.platformTradeId) + '</div>' +
        '<div class="item-info-row"><span class="iir-label">' + t('platformDealIdLabel') + '</span><span class="mono">' + esc(item.platformDealId || t('counterpartyNone')) + '</span>' + copyBtn(item.platformDealId) + '</div>';
      const pop = openPopover(anchor, html, item.tradeId);
      pop.addEventListener('click', function (e) {
        const cb = e.target.closest('.copy-btn');
        if (cb) {
          copyText(cb.getAttribute('data-copy'));
          cb.classList.add('copied');
          setTimeout(function () { cb.classList.remove('copied'); }, 1200);
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
        const eoRows = ch.files.eo.map(function (v) { return fileRowHTML('EO', 'ftag-eo', stripColon(t('filesEO')), v); }).join('');
        const aoTip = stripColon(ch.format === 'csv' ? t('filesAOCsv') : t('filesAO'));
        const aoRows = ch.files.ao.map(function (v) { return fileRowHTML('AO', 'ftag-ao', aoTip, v); }).join('');
        const xlRow = fileRowHTML('XL', 'ftag-xl', stripColon(t('filesExcel')), { name: ch.files.excel.file, path: ch.files.excel.path }, 'sheet: ' + ch.files.excel.sheet);
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
        '<div class="task-note-text">' + esc(desc).replace(/\n/g, '<br>') + '</div>';
    }

    function renderTabs() {
      const s = scopeStats();
      const tabs = [
        ['fields', t('tabFields'), s.total, null],
        ['warnings', t('tabWarnings'), s.warnings + '/' + s.warningsIgnored, null],
        ['errors', t('tabErrors'), s.errors, null],
      ];
      const fmt = currentChannelFormat();
      if (fmt === 'xml' && APP_FEATURES.uncomparedXpath) tabs.push(['uncompared', t('tabUncompared'), s.uncompared + '/' + s.uncomparedIgnored, t('tipUncompared')]);
      if (fmt === 'csv' && APP_FEATURES.uncomparedCsv) tabs.push(['uncomparedCsv', t('tabUncomparedCsv'), s.uncomparedCsv + '/' + s.uncomparedCsvIgnored, t('tipUncomparedCsv')]);
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
      if (chName === 'ALL') {
        if (tab === 'fields') return flatFields(it).length;
        if (tab === 'warnings') return it.channels.reduce((n, c) => n + c.warnings.filter(w => !msgIsIgnored('warnings', w)).length, 0);
        if (tab === 'errors') return it.channels.reduce((n, c) => n + c.errors.length, 0);
        if (tab === 'uncompared') return it.channels.reduce((n, c) => n + c.uncompared.filter(u => !msgIsIgnored('uncompared', u)).length, 0);
        if (tab === 'uncomparedCsv') return it.channels.reduce((n, c) => n + c.uncomparedCsv.filter(u => !msgIsIgnored('uncomparedCsv', u)).length, 0);
        if (tab === 'uncomparedItems') return it.skippedItems.length;
        if (tab === 'logs') return it.overviewLogs.length + it.channels.reduce((n, c) => n + c.logs.length, 0);
      }
      const ch = it.channels.find(c => c.name === chName);
      if (!ch) return 0;
      if (tab === 'fields') return flatFields(it).filter(r => r.channel === chName).length;
      if (tab === 'warnings') return ch.warnings.filter(w => !msgIsIgnored('warnings', w)).length;
      if (tab === 'errors') return ch.errors.length;
      if (tab === 'uncompared') return ch.uncompared.filter(u => !msgIsIgnored('uncompared', u)).length;
      if (tab === 'uncomparedCsv') return ch.uncomparedCsv.filter(u => !msgIsIgnored('uncomparedCsv', u)).length;
      if (tab === 'uncomparedItems') return it.skippedItems.filter(s => s.channel === chName).length;
      if (tab === 'logs') return ch.logs.length;
      return 0;
    }

    function renderChannelTabs() {
      const it = currentItem();
      const chs = [['ALL', t('all')]].concat(it.channels.map(ch => [ch.name, ch.name]));
      const html = chs.map(([k, label]) => {
        const disabled = k !== 'ALL' && it.enabledChannels.indexOf(k) === -1;
        const cls = 'ctab' + (state.channel === k ? ' active' : '') + (disabled ? ' disabled' : '');
        const count = disabled ? '—' : channelCount(k, state.tab);
        return '<button class="' + cls + '" data-channel="' + k + '" title="' + (disabled ? '该渠道未启用' : '') + '">' + esc(label) +
          '<span class="ctab-count">' + count + '</span></button>';
      }).join('');
      const colBtn = state.tab === 'fields' ? '<button class="col-toggle" id="colToggle">' + t('colSelector') + ' ▾</button>' : '';
      document.getElementById('channelTabs').innerHTML = html + colBtn;
    }

    function activeFilters() {
      const list = [];
      if (state.channel !== 'ALL') list.push({ label: '渠道: ' + state.channel, clear: function () { state.channel = 'ALL'; } });
      if (state.search.trim()) list.push({ label: '搜索: ' + state.search.trim(), clear: function () { state.search = ''; document.getElementById('search').value = ''; } });
      if (state.tab === 'fields') {
        COLUMNS.forEach(function (c) {
          const v = state.colFilter[c.key];
          if (v && v !== 'ALL') {
            const shown = c.key === 't' ? valueTypeLabel(v) : v;
            list.push({
              label: t(c.label) + ': ' + shown,
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
        '<button data-clear="' + i + '" title="清除此过滤">✕</button></span>'
      ).join('');
      document.getElementById('filterChips').innerHTML = html;
    }

    function renderPagination(total, pages) {
      if (total === 0) return '';
      const p = state.page;
      const from = Math.max(1, p - 2), to = Math.min(pages, p + 2);
      let parts = [];
      if (pages > 3) parts.push('<button class="pg" data-page="1"' + (p === 1 ? ' disabled' : '') + ' title="首页">«</button>');
      parts.push('<button class="pg" data-page="' + (p - 1) + '"' + (p === 1 ? ' disabled' : '') + ' title="上一页">‹</button>');
      for (let i = from; i <= to; i++) {
        parts.push('<button class="pg' + (i === p ? ' cur' : '') + '" data-page="' + i + '">' + i + '</button>');
      }
      parts.push('<button class="pg" data-page="' + (p + 1) + '"' + (p === pages ? ' disabled' : '') + ' title="下一页">›</button>');
      if (pages > 3) parts.push('<button class="pg" data-page="' + pages + '"' + (p === pages ? ' disabled' : '') + ' title="尾页">»</button>');
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
      document.querySelectorAll('.hf-toggle.active, .col-toggle.active, .side-multi.active, .cal-btn.active, .bp-cal.active, .item-meta-link.active').forEach(b => b.classList.remove('active'));
    }

    function openPopover(anchor, contentHTML, title) {
      closePopover();
      const pop = document.createElement('div');
      pop.className = 'popover';
      pop.innerHTML = (title ? '<p class="popover-title">' + esc(title) + '</p>' : '') + contentHTML;
      document.body.appendChild(pop);
      const r = anchor.getBoundingClientRect();
      const w = Math.min(260, window.innerWidth - 16);
      pop.style.width = w + 'px';
      pop.style.top = (r.bottom + 6) + 'px';
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
      anchor.classList.add('active');
      POPOVER.el = pop;
      const docClick = function (e) {
        if (!pop.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closePopover();
      };
      document.addEventListener('click', docClick);
      POPOVER.cleanup = function () { document.removeEventListener('click', docClick); };
      return pop;
    }

    function selectOptionsFor(col) {
      let arr;
      if (col === 't') arr = ['ALL', 'id', 'num', 'date', 'code', 'product', 'text', 'multi'];
      else if (col === 'type') arr = state.tab === 'errors' ? ['ALL'].concat(Object.keys(ERROR_TYPE_META)) : ['ALL', 'platformAssertion', 'productAssertion', 'contextAssertion'];
      else if (col === 'result') arr = ['ALL', 'PASSED', 'FAILED'];
      else if (col === 'channel') arr = ['ALL', 'HKTR', 'JSFA', 'CFTC'];
      else if (col === 'source') arr = ['ALL'].concat(sourceNames());
      else if (col === 'level') arr = ['ALL', 'WARN', 'INFO', 'NOTICE', 'DEBUG', 'ERROR', 'FATAL', 'SEVERE'];
      else arr = ['ALL'];
      return arr.map(function (v) {
        let l = v;
        if (v === 'ALL') l = t('all');
        else if (col === 'source') l = sourceName(v);
        else if (col === 't') l = valueTypeLabel(v);
        else if (col === 'type') l = state.tab === 'errors' ? errorTypeLabel(v) : typeLabel(v);
        return [v, l];
      });
    }

    function openFilterPopover(btn, filterObj, col, kind, placeholder, onApply) {
      if (btn.classList.contains('active')) { closePopover(); return; }
      let control;
      if (kind === 'select') {
        const opts = selectOptionsFor(col);
        control = '<select class="pop-control">' +
          opts.map(function (o) { return '<option value="' + o[0] + '"' + (filterObj[col] === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
      } else {
        control = '<input class="pop-control" placeholder="' + esc(placeholder || '搜索') + '" value="' + esc(filterObj[col] || '') + '">';
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
      openFilterPopover(btn, state.colFilter, col, kind, def ? t(def.label) : t('toolbarSearch'), function () { refreshFieldsBody(); renderFilterChips(); });
    }

    function openMsgFilterPopover(btn) {
      const col = btn.getAttribute('data-hf');
      const kind = btn.getAttribute('data-kind');
      openFilterPopover(btn, state.msgFilter, col, kind, btn.getAttribute('data-title') || '搜索', function () { renderContent(); renderFilterChips(); });
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
        const fmt = currentChannelFormat();
        const cols = COLUMNS.filter(function (c) {
          if (c.key === 'x') return fmt === 'xml';
          if (c.key === 'aoCsv') return fmt === 'csv';
          return true;
        });
        const allChecked = cols.every(function (c) { return state.columns[c.key]; });
        let html = '<label class="col-option"><input type="checkbox" data-colkey="__ALL__"' + (allChecked ? ' checked' : '') + '> ' + t('all') + '</label>';
        cols.forEach(function (c) {
          html += '<label class="col-option"><input type="checkbox" data-colkey="' + c.key + '"' + (state.columns[c.key] ? ' checked' : '') + '> ' + t(c.label) + '</label>';
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
      return '<details class="val-details"><summary>' + esc(preview(s)) + '</summary><pre>' + esc(s) + '</pre></details>';
    }

    function textCellHTML(v) {
      const s = String(v);
      const long = s.length > 40 || /\r?\n/.test(s);
      if (!long) return '<span class="text-full">' + esc(s) + '</span>';
      return '<details class="text-details"><summary>' + esc(preview(s)) + '</summary><pre>' + esc(s) + '</pre></details>';
    }

    function hoverCellHTML(v) {
      const s = String(v);
      const long = s.length > 40 || /\r?\n/.test(s);
      if (!long) return '<span class="text-full">' + esc(s) + '</span>';
      return '<span class="hover-trunc" title="' + esc(s) + '">' + esc(preview(s)) + '</span>';
    }

    function fieldCellHTML(r, key) {
      switch (key) {
        case 'channel': return '<td><span class="chip channel-chip">' + esc(r.channel) + '</span></td>';
        case 'source': return '<td>' + esc(sourceName(r.source)) + '</td>';
        case 'f': return '<td class="mono"><a class="val-link" data-detail="' + esc(r.id) + '" title="查看比较详情">' + esc(r.f) + '</a></td>';
        case 'x': return '<td>' + valueCellHTML(r.x) + '</td>';
        case 'aoCsv': return '<td class="mono">' + (r.aoCsv ? esc(r.aoCsv) : '—') + '</td>';
        case 't': return '<td><span class="vt-plain">' + esc(valueTypeLabel(r.k)) + '</span></td>';
        case 'ctx': return '<td data-col="ctx" style="width:' + state.ctxColWidth + 'px; min-width:' + state.ctxColWidth + 'px;"><div class="ctx-tags">' + (ctxTagsHTML(r.ctx) || '') + '</div></td>';
        case 'eo': return '<td data-col="eo" style="width:' + state.eoColWidth + 'px; min-width:' + state.eoColWidth + 'px;">' + valueCellHTML(r.eo) + '</td>';
        case 'ao': return '<td data-col="ao" style="width:' + state.aoColWidth + 'px; min-width:' + state.aoColWidth + 'px;">' + valueCellHTML(r.ao) + '</td>';
        case 'result': {
          const pass = r.result === 'PASSED';
          return '<td><span class="badge ' + (pass ? 'pass' : 'fail') + '">' + r.result + '</span></td>';
        }
        case 'note': return '<td data-col="note" style="width:' + state.noteColWidth + 'px; min-width:' + state.noteColWidth + 'px;">' + hoverCellHTML(r.note || '—') + '</td>';
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
        return '<tr class="' + (pass ? '' : 'row-fail') + '" tabindex="0" data-fid="' + esc(r.id) + '">' +
          visible.map(c => fieldCellHTML(r, c.key)).join('') + '</tr>';
      }).join('');
      return trs || '<tr><td colspan="' + visible.length + '" class="empty">无匹配记录</td></tr>';
    }

    const RESIZABLE_COLS = {
      ctx:  { stateKey: 'ctxColWidth',  min: 140, max: 560 },
      eo:   { stateKey: 'eoColWidth',   min: 120, max: 600 },
      ao:   { stateKey: 'aoColWidth',   min: 120, max: 600 },
      note: { stateKey: 'noteColWidth', min: 120, max: 600 },
    };

    function applyColWidth(key) {
      const rc = RESIZABLE_COLS[key];
      if (!rc) return;
      const w = state[rc.stateKey];
      document.querySelectorAll('[data-col="' + key + '"]').forEach(function (el) {
        el.style.width = w + 'px';
        el.style.minWidth = w + 'px';
      });
    }

    function fieldsHeaderHTML() {
      const cells = COLUMNS.filter(isFieldColVisible).map(c => {
        let cls = c.sortable ? 'sortable' : '';
        let extra = '';
        const rc = RESIZABLE_COLS[c.key];
        if (rc) {
          cls += (cls ? ' ' : '') + 'col-resizable';
          const w = state[rc.stateKey];
          extra = ' data-col="' + c.key + '" style="width:' + w + 'px; min-width:' + w + 'px;"';
        }
        const sortAttr = cls ? ' class="' + cls + '"' + (c.sortable ? ' data-sort="' + c.key + '"' : '') : '';
        let btn = '';
        if (c.filterable) {
          btn = '<button class="hf-toggle" data-hf="' + c.key + '" data-kind="' + c.filterable + '" title="过滤">⚲</button>';
        }
        let specialBtn = '';
        if (c.key === 'eo' || c.key === 'ao') {
          specialBtn = '<button class="special-toggle" data-special="' + c.key + '" title="空值/空白/含特殊字符过滤">∅</button>';
        }
        const handle = rc ? '<span class="col-resize" data-resize="' + c.key + '" title="拖动调整列宽"></span>' : '';
        return '<th' + sortAttr + extra + ' scope="col">' + t(c.label) +
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
        '<div class="table-wrap"><table>' + fieldsHeaderHTML() +
        '<tbody id="fTbody">' + buildFieldRows(p.pageRows) + '</tbody></table></div>' +
        '<div id="fFooter">' + fieldsFooterHTML(p.total, p.pages) + '</div>';
    }

    /* ---- 消息类列表通用引擎（警告/错误/未比较XPath/未比较Item） ---- */
    const MSG_COLUMNS = {
      warnings: [
        { key: 'channel', label: 'colChannel', sortable: true, filter: 'select' },
        { key: 'type',    label: 'colType',    sortable: true, filter: 'select' },
        { key: 'level',   label: 'colLevel',   sortable: true, filter: null },
        { key: 'text',    label: 'colText',    sortable: true, filter: 'text', title: '搜索信息' },
        { key: 'field',   label: 'colRelField', sortable: true, filter: 'text', title: '搜索关联字段' },
        { key: 'ignored', label: 'colIgnored', sortable: true, filter: null, bulk: true },
      ],
      errors: [
        { key: 'channel', label: 'colChannel', sortable: true, filter: 'select' },
        { key: 'type',    label: 'colType',    sortable: true, filter: 'select' },
        { key: 'level',   label: 'colLevel',   sortable: true, filter: null },
        { key: 'text',    label: 'colText',    sortable: true, filter: 'text', title: '搜索信息' },
        { key: 'field',   label: 'colRelField', sortable: true, filter: 'text', title: '搜索关联字段' },
      ],
      uncompared: [
        { key: 'channel', label: 'colChannel', sortable: true, filter: 'select' },
        { key: 'xpath',   label: 'colXPath',   sortable: true, filter: 'text', title: '搜索 XPath' },
        { key: 'note',    label: 'colNote',    sortable: true, filter: 'text', title: '搜索说明' },
        { key: 'ignored', label: 'colIgnored', sortable: true, filter: null, bulk: true },
      ],
      uncomparedCsv: [
        { key: 'channel',  label: 'colChannel', sortable: true, filter: 'select' },
        { key: 'csvField', label: 'colAoCsv',   sortable: true, filter: 'text', title: '搜索 CSV 字段' },
        { key: 'note',     label: 'colNote',    sortable: true, filter: 'text', title: '搜索说明' },
        { key: 'ignored',  label: 'colIgnored', sortable: true, filter: null, bulk: true },
      ],
      uncomparedItems: [
        { key: 'itemId',  label: 'colItemId',  sortable: true, filter: 'text', title: '搜索 Item ID' },
        { key: 'channel', label: 'colChannel', sortable: true, filter: 'select' },
        { key: 'reason',  label: 'colReason',  sortable: true, filter: 'text', title: '搜索原因' },
      ],
    };

    function msgValue(tab, m, key) {
      switch (key) {
        case 'channel': return m.channel || '';
        case 'type': return m.type || '';
        case 'level': return m.level || '';
        case 'text': return m.text || '';
        case 'field': return m.field || '';
        case 'ignored': return msgIsIgnored(tab, m) ? '1' : '0';
        case 'xpath': return m.xpath || '';
        case 'csvField': return m.csvField || '';
        case 'ctx': return m.ctx || '';
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
      else if (tab === 'uncomparedCsv') list = scopeUncomparedCsv();
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

    function scopeLabel() { return state.channel === 'ALL' ? t('scopeItem') : state.channel + ' ' + t('scopeChannel'); }

    function msgHeaderHTML(tab) {
      const cells = MSG_COLUMNS[tab].map(function (c) {
        const sortAttr = c.sortable ? ' class="sortable" data-sort="' + c.key + '"' : '';
        let filterBtn = '';
        if (c.filter) filterBtn = '<button class="mhf-toggle" data-hf="' + c.key + '" data-kind="' + c.filter + '" data-title="' + t(c.label) + '" title="过滤">⚲</button>';
        let bulkBtn = '';
        if (c.bulk) bulkBtn = '<button class="bulk-toggle" data-bulk-open="1" title="批量忽略/取消忽略（作用于当前过滤结果集）">☰</button>';
        return '<th' + sortAttr + ' scope="col">' + t(c.label) +
          (c.sortable ? ' <span class="sort-arrow">' + msgSortArrow(c.key) + '</span>' : '') +
          filterBtn + bulkBtn + '</th>';
      }).join('');
      return '<thead><tr>' + cells + '</tr></thead>';
    }

    function msgCellHTML(tab, m, c) {
      switch (c.key) {
        case 'channel':
          return '<td>' + (m.channel === 'ALL' ? '<span class="chip channel-chip">ALL</span>' : '<span class="chip channel-chip">' + esc(m.channel) + '</span>') + '</td>';
        case 'type': return '<td>' + (tab === 'errors' ? errorTypeChip(m.type) : typeChip(m.type)) + '</td>';
        case 'level': {
          const isWarn = tab === 'warnings';
          return '<td><span class="badge ' + (isWarn ? 'warn' : 'fail') + '">' + esc(m.level || '') + '</span></td>';
        }
        case 'text': return '<td>' + hoverCellHTML(m.text) + '</td>';
        case 'field': return '<td class="mono">' + esc(m.field || '—') + '</td>';
        case 'ignored': {
          const ignored = msgIsIgnored(tab, m);
          const k = msgIgnoreKey(tab, m);
          return '<td><button class="ignore-btn' + (ignored ? ' ignored' : '') + '" data-ignore="' + esc(k) + '">' + (ignored ? t('unignore') : t('ignore')) + '</button></td>';
        }
        case 'xpath': return '<td>' + valueCellHTML(m.xpath) + '</td>';
        case 'csvField': return '<td>' + valueCellHTML(m.csvField) + '</td>';
        case 'ctx': return '<td class="mono">' + esc(m.ctx || '—') + '</td>';
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
        return '<tr class="' + (ignoredRow ? 'row-ignored' : '') + '" tabindex="0">' +
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
        ((tab === 'warnings' || tab === 'uncompared' || tab === 'uncomparedCsv') ? '<div class="warn-toolbar"><button class="export-btn" id="importIgnoreBtn">' + t('importIgnore') + '</button><button class="export-btn" id="exportIgnoreBtn">' + t('export') + '</button></div>' : '') +
        '<div class="table-wrap"><table>' + msgHeaderHTML(tab) +
        '<tbody>' + (rows || '<tr><td colspan="' + cols.length + '" class="empty">无记录</td></tr>') + '</tbody></table></div>' +
        pagerHtml +
        '<div class="meta-note">' + metaText + '</div>';
    }

    function openBulkIgnoreDialog() {
      const tab = state.tab;
      const list = getMsgRows(tab);
      const keys = list.map(function (m) { return msgIgnoreKey(tab, m); }).filter(function (k) { return k; });
      const active = keys.filter(function (k) { return !IGNORE_CONFIG[k]; }).length;
      const ignored = keys.length - active;
      const unit = tab === 'uncompared' ? t('bulkUnitXpath') : (tab === 'uncomparedCsv' ? t('bulkUnitCsv') : t('bulkUnitWarn'));
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
        keys.forEach(function (k) { if (op === 'ignore') IGNORE_CONFIG[k] = true; else delete IGNORE_CONFIG[k]; });
        saveIgnoreConfig();
        backdrop.remove();
        renderSummary(); renderTabs(); renderChannelTabs();
        renderSidebar(); renderSidebarChips(); renderContent();
      });
      document.body.appendChild(backdrop);
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
      renderMsgTable('uncompared', getMsgRows('uncompared').length + ' ' + t('metaUncomparedXpath') + scopeLabel() + t('metaClose'));
    }

    function renderUncomparedCsv() {
      renderMsgTable('uncomparedCsv', getMsgRows('uncomparedCsv').length + ' ' + t('metaUncomparedCsv') + scopeLabel() + t('metaClose'));
    }

    function renderUncomparedItems() {
      renderMsgTable('uncomparedItems', getMsgRows('uncomparedItems').length + ' ' + t('metaUncomparedItems') + scopeLabel() + t('metaClose'));
    }

    function renderLogs() {
      let lines = scopeLogs();
      if (state.search.trim()) {
        const q = state.search.trim().toLowerCase();
        lines = lines.filter(l => l.toLowerCase().includes(q));
      }
      const html = lines.map(l => '<div class="log-line">' + esc(l) + '</div>').join('');
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
      else if (state.tab === 'uncomparedCsv') renderUncomparedCsv();
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
      renderCharts();
      renderReportCats();
      renderTabs();
      renderChannelTabs();
      renderFilterChips();
      renderContent();
      syncHash();
    }

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
    let LAST_FOCUS = null;
    function closeCtxDefPopup() {
      if (CTX_DEF_POPUP) { CTX_DEF_POPUP.remove(); CTX_DEF_POPUP = null; }
    }
    function closeModal() {
      const b = document.querySelector('.modal-backdrop');
      if (b) b.remove();
      closeCtxDefPopup();
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
    function ctxTypes(key) {
      const it = currentItem();
      const def = (it && it.ctxDefs ? it.ctxDefs : {})[key] || {};
      const tp = def.type;
      if (Array.isArray(tp)) return tp.filter(function (t) { return t === 1 || t === 2 || t === 3; });
      if (tp === 1 || tp === 2 || tp === 3) return [tp];
      return [];
    }
    function ctxKeysOfType(field, type) {
      return (field && field.ctx ? field.ctx : []).filter(function (k) { return ctxTypes(k).indexOf(type) !== -1; });
    }
    function ctxTagsHTML(ctxArr) {
      return (ctxArr || []).map(function (c) {
        return '<span class="ctx-tag" data-ctx="' + esc(c) + '">' + esc(c) + '</span>';
      }).join('');
    }

    function ruleValueHTML(value) {
      const s = String(value || '');
      if (s.charAt(0) === '@') return '<span class="rule-tag">' + esc(s) + '</span>';
      return '<div class="rule-mono">' + esc(s) + '</div>';
    }

    function extraResultsHTML(f) {
      let items = (Array.isArray(f.extraResults) && f.extraResults.length) ? f.extraResults : [];
      if (!items.length && f.eoConverted && f.eoUnconverted != null) items = [{ label: t('modalEOUnconverted'), value: f.eoUnconverted }];
      return items.map(function (r) {
        return '<div class="result-extra"><div class="ri-label">' + esc(r.label) + '</div><div class="ri-value">' + esc(r.value == null ? '' : r.value) + '</div></div>';
      }).join('');
    }

    function showCtxDefPopup(anchor, ctxKey) {
      // 再次点击同一标签：关闭（切换）。
      if (CTX_DEF_POPUP && CTX_DEF_POPUP.__ctxKey === ctxKey) { closeCtxDefPopup(); return; }
      closeCtxDefPopup();
      const it = currentItem();
      const def = (it && it.ctxDefs ? it.ctxDefs : {})[ctxKey] || {};
      // 命中详情显示所有 type（一个 ctx key 可能同时用于多种规则）。
      const typeBadges = ctxTypes(ctxKey).map(function (tp) {
        return '<span class="ctx-type-badge t' + tp + '">' + t(CTX_TYPE_META[tp].label) + '</span>';
      }).join(' ');
      const pop = document.createElement('div');
      pop.className = 'ctx-def-popup';
      pop.innerHTML =
        '<div class="ctx-def-key">' + esc(ctxKey) + '</div>' +
        (typeBadges ? '<div class="ctx-def-type">' + typeBadges + '</div>' : '') +
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
      pop.__ctxKey = ctxKey;
      CTX_DEF_POPUP = pop;
    }

    function openModal(id, fromGlobal) {
      const found = findFieldById(currentItem(), id);
      if (!found) return;
      const f = found.field;
      const chObj = currentItem().channels.find(function (c) { return c.name === found.channel; });
      const chFormat = chObj && chObj.format === 'csv' ? 'csv' : 'xml';
      const isCsv = chFormat === 'csv';
      const pass = f.result === 'PASSED';
      const ctxTags = ctxTagsHTML(f.ctx);
      const eoBox = '<div class="result-cell"><div class="ri-label">' + t('modalEO') + '</div><div class="ri-value">' + (pass ? esc(f.eo) : diffPairHTML(f.eo, f.ao).eo) + '</div></div>';
      const aoBox = '<div class="result-cell"><div class="ri-label">' + t('modalAO') + '</div><div class="ri-value">' + (pass ? esc(f.ao) : diffPairHTML(f.eo, f.ao).ao) + '</div></div>';
      const extraHtml = extraResultsHTML(f);
      const excelBtn = function (key) {
        return '<button class="excel-btn" data-excel="' + key + '">' + t('excelConfigBtn') + '</button>';
      };
      const excelPanel = function (key, text) {
        return '<div class="excel-detail" data-excel-panel="' + key + '" hidden>' +
          '<div class="excel-detail-head">' + t('excelConfigBtn') + '</div>' +
          '<pre>' + esc(text || '') + '</pre></div>';
      };
      const showConv = APP_FEATURES.conversionRule && f.conversionRule;
      const showVal = APP_FEATURES.validationRule && f.validationRule;
      const showMapBtn = APP_FEATURES.excelMapping;
      const showConvBtn = APP_FEATURES.excelConversionRule;
      const showValBtn = APP_FEATURES.excelValidationRule;
      // 各规则 section 只读取自身 type 对应的 CtxKey。
      const mapRuleHtml = showMapBtn
        ? '<div class="rule-group"><div class="rule-group-title">' + t('modalExcelMapping') + excelBtn('mapping') + '</div>' +
          '<div class="rule-ctx"><span class="rule-ctx-label">' + t('colCtx') + '</span>' + (ctxTagsHTML(ctxKeysOfType(f, 1)) || '—') + '</div>' +
          excelPanel('mapping', f.excelMapping) +
          '</div>'
        : '';
      const convRuleHtml = showConv
        ? '<div class="rule-group"><div class="rule-group-title">' + t('modalConversionRule') + (showConvBtn ? excelBtn('conversion') : '') + '</div>' +
          ruleValueHTML(f.conversionRule.value) +
          '<div class="rule-ctx"><span class="rule-ctx-label">' + t('colCtx') + '</span>' + (ctxTagsHTML(ctxKeysOfType(f, 2)) || '—') + '</div>' +
          (showConvBtn ? excelPanel('conversion', f.excelConversionRule) : '') +
          '</div>'
        : '';
      const valRuleHtml = showVal
        ? '<div class="rule-group"><div class="rule-group-title">' + t('modalValidationRule') + (showValBtn ? excelBtn('validation') : '') + '</div>' +
          ruleValueHTML(f.validationRule.value) +
          '<div class="rule-ctx"><span class="rule-ctx-label">' + t('colCtx') + '</span>' + (ctxTagsHTML(ctxKeysOfType(f, 3)) || '—') + '</div>' +
          (showValBtn ? excelPanel('validation', f.excelValidationRule) : '') +
          '</div>'
        : '';
      const xpathLabel = isCsv ? t('modalAoCsvField') : t('modalXPath');
      const xpathValue = isCsv ? (f.aoCsv || '—') : f.x;
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML =
        '<div class="modal">' +
        '<div class="modal-head"><div class="modal-head-left"><h3>' + t('modalTitle') + '：' + esc(f.f) + '</h3><span class="modal-item-chip">' + esc(currentItem().tradeId) + '</span></div>' +
        '<div class="modal-head-right">' + (fromGlobal ? '<button class="modal-goto" data-modal-jump="1">' + t('backToItem') + '</button>' : '') + '<button class="modal-close" title="' + t('closeLabel') + '">✕</button></div></div>' +
        '<div class="modal-body">' +
        '<div class="kv">' +
        '<span class="k">' + t('modalChannel') + '</span><span class="v">' + esc(found.channel) + '</span>' +
        '<span class="k">' + t('modalSource') + '</span><span class="v">' + esc(sourceName(found.source)) + '</span>' +
        '<span class="k">' + t('modalField') + '</span><span class="v">' + esc(f.f) + '</span>' +
        '<span class="k">' + xpathLabel + '</span><span class="v">' + esc(xpathValue) + '</span>' +
        '<span class="k">' + t('modalType') + '</span><span class="v">' + valueTypeChip(f.k) + '</span>' +
        '<span class="k">' + t('modalCtx') + '</span><span class="v">' + (ctxTags || '—') + '</span>' +
        '<span class="k">' + t('modalResult') + '</span><span class="v"><span class="badge ' + (pass ? 'pass' : 'fail') + '">' + f.result + '</span>' +
        (f.resultNote ? '　' + esc(f.resultNote) : '') + '</span>' +
        '</div>' +
        '<div class="result-pair">' + eoBox + aoBox + '</div>' +
        extraHtml +
        mapRuleHtml + convRuleHtml + valRuleHtml +
        (APP_FEATURES.modalPrints ? '<div class="print-box"><div class="pb-head">' + t('modalPrints') + '</div>' +
        '<div class="log-box">' + f.prints.map(p => '<div class="log-line">' + esc(p) + '</div>').join('') + '</div>' +
        '</div>' : '') +
        '</div></div>';
      backdrop.addEventListener('click', function (e) {
        const tag = e.target.closest('.ctx-tag');
        if (tag) { showCtxDefPopup(tag, tag.getAttribute('data-ctx')); return; }
        const exBtn = e.target.closest('.excel-btn');
        if (exBtn) {
          const key = exBtn.getAttribute('data-excel');
          const panel = backdrop.querySelector('[data-excel-panel="' + key + '"]');
          if (panel) {
            panel.hidden = !panel.hidden;
            exBtn.classList.toggle('active', !panel.hidden);
          }
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
      LAST_FOCUS = document.activeElement;
      document.body.appendChild(backdrop);
      const focusables = backdrop.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
      if (focusables.length) focusables[0].focus();
      backdrop.addEventListener('keydown', function (e) {
        if (e.key !== 'Tab') return;
        const list = backdrop.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])');
        if (!list.length) return;
        const first = list[0], last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
    }

    /* ---------- URL 深链接（hash） ---------- */
    function hashParams() {
      const p = {};
      String(location.hash || '').replace(/^#/, '').split('&').forEach(function (kv) {
        if (!kv) return;
        const i = kv.indexOf('=');
        const k = i === -1 ? kv : kv.slice(0, i);
        const v = i === -1 ? '' : kv.slice(i + 1);
        try { p[k] = decodeURIComponent(v); } catch (e) { p[k] = v; }
      });
      return p;
    }
    function stateToHash() {
      const parts = ['item=' + encodeURIComponent(state.itemId)];
      if (state.channel !== 'ALL') parts.push('ch=' + encodeURIComponent(state.channel));
      if (state.tab !== 'fields') parts.push('tab=' + encodeURIComponent(state.tab));
      if (state.search) parts.push('q=' + encodeURIComponent(state.search));
      if (state.tab === 'fields' && state.colFilter.result && state.colFilter.result !== 'ALL') parts.push('result=' + encodeURIComponent(state.colFilter.result));
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
      } finally { HASH_SYNC.applying = false; }
      const searchEl = document.getElementById('search');
      if (searchEl) searchEl.value = state.search || '';
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
      const chB = itemB.channels.find(function (c) { return c.name === chNameB; });
      if (!chA || !chB) return [];
      const rows = [];
      chA.sources.forEach(function (sA) {
        sA.fields.forEach(function (fA) {
          const sB = chB.sources.find(function (s) { return s.name === sA.name; });
          const fB = sB ? sB.fields.find(function (f) { return f.f === fA.f; }) : null;
          rows.push({ f: fA.f, source: sA.name, a: fA, b: fB });
        });
      });
      return rows;
    }
    function compareCell(f) {
      if (!f) return '<span class="cmp-val">' + t('compareNone') + '</span>';
      const pass = f.result === 'PASSED';
      return '<span class="badge ' + (pass ? 'pass' : 'fail') + '" title="' + f.result + '">' + (pass ? '✓' : '✕') + '</span> ' +
        '<span class="cmp-val">' + esc(preview(f.eo)) + ' → ' + esc(preview(f.ao)) + '</span>';
    }
    function compareDiffOf(r) {
      if (!r.b) return 'diff';
      return (r.a.result === r.b.result && r.a.eo === r.b.eo && r.a.ao === r.b.ao) ? 'same' : 'diff';
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
      if (key === 'source') return sourceName(val);
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
        const filterBtn = kind ? '<button class="hf-toggle" data-cf="' + key + '" data-kind="' + kind + '" title="过滤">⚲</button>' : '';
        return '<th' + sortAttr + ' scope="col">' + label + (key ? ' <span class="sort-arrow">' + compareSortArrow(key) + '</span>' : '') + filterBtn + '</th>';
      }
      const trs = pageRows.map(function (r) {
        const diff = compareDiffOf(r) === 'diff';
        return '<tr class="' + (diff ? 'row-fail' : '') + '">' +
          '<td class="mono"><a class="val-link" data-detail="' + esc(r.a.id) + '">' + esc(r.f) + '</a></td>' +
          '<td>' + esc(sourceName(r.source)) + '</td>' +
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
        closePopover();
      });
    }

    /* ---------- 健康总览（跨全部 item，支持按报告日期；纯计算在 core.js / Worker） ---------- */
    function computeHealthSync(date, channel) {
      return computeHealthPure(DATA.items, date, channel, IGNORE_CONFIG);
    }
    function computeHealth(date, channel) { return computeHealthSync(date, channel); }

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
      entries.sort(function (a, b) {
        const key = sort.key;
        const va = a[key], vb = b[key];
        if (va < vb) return -1 * sort.dir;
        if (va > vb) return 1 * sort.dir;
        return 0;
      });
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
        it.channels.forEach(function (ch) {
          if (channel && channel !== 'ALL' && ch.name !== channel) return;
          const st = chStats[ch.name] || (chStats[ch.name] = { total: 0, passed: 0, failed: 0 });
          ch.sources.forEach(function (s) { s.fields.forEach(function (fd) { st.total++; fd.result === 'PASSED' ? st.passed++ : st.failed++; }); });
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
          if (s.key === key) s.dir = s.dir === 1 ? -1 : 1;
          else { s.key = key; s.dir = key === 'count' ? -1 : 1; }
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
        '<div class="help-list">' + shortcuts.map(row).join('') + '</div></div>' +
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
    async function globalSearchResults(q) {
      if (isMultiMode()) await ensureAllLoaded();
      try {
        return await workerCall('globalSearch', { items: DATA.items, q: q, limit: APP_LIMITS.globalSearchLimit });
      } catch (e) {
        return globalSearchPure(DATA.items, q, APP_LIMITS.globalSearchLimit);
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
        backdrop.remove();
        selectItem(itemId);
        if (fieldId) setTimeout(function () { openModal(fieldId, true); }, 60);
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
              return '<div class="gs-row" data-goto="' + esc(r.itemId) + '" data-field-id="' + esc(r.fieldId) + '">' +
                '<span class="gs-item mono">' + esc(r.itemId) + '</span>' +
                '<span class="chip channel-chip">' + esc(r.channel) + '</span>' +
                '<span class="mono">' + esc(r.f) + '</span>' +
                '<span class="gs-snippet">' + highlight(r.snippet, q) + '</span>' +
                '</div>';
            }).join('')
          : '<div class="empty">' + t('globalSearchNoResults') + '</div>';
      };
      input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(doSearch, 150); });
      setTimeout(function () { input.focus(); }, 60);
    }

    /* ---------- 忽略配置导入 ---------- */
    function importIgnoreConfigFile(file) {
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const cfg = JSON.parse(reader.result);
          if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('bad');
          const keys = Object.keys(cfg);
          const isFlat = keys.every(function (k) { try { return Array.isArray(JSON.parse(k)); } catch (e) { return false; } });
          const flat = isFlat ? cfg : groupedToFlat(cfg);
          let n = 0;
          Object.keys(flat).forEach(function (k) { if (flat[k]) { IGNORE_CONFIG[k] = true; n++; } });
          saveIgnoreConfig();
          renderSummary(); renderTabs(); renderChannelTabs(); renderSidebar(); renderSidebarChips(); renderContent();
          alert(t('importSuccess').replace('N', n));
        } catch (e) {
          alert(t('importFail'));
        }
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
        btn.textContent = collapsed ? '⌄' : '⌃';
        btn.title = collapsed ? '展开顶部区域' : '折叠顶部区域';
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
        const undoBtn = e.target.closest('[data-batch-undo]');
        if (undoBtn) { unmarkBatchPending(undoBtn.getAttribute('data-batch-undo')); return; }
        const confirmBtn = e.target.closest('[data-batch-confirm]');
        if (confirmBtn) { confirmBatchDelete(confirmBtn.getAttribute('data-batch-confirm')); return; }
        const favBtn = e.target.closest('[data-batch-fav]');
        if (favBtn) { openAddFavoriteDialog(favBtn.getAttribute('data-batch-fav')); return; }
        const itemFirst = e.target.closest('[data-batch]');
        if (!itemFirst) hideBatchQuickDetail();
        const sideFlip = e.target.closest('#batchSideFlip');
        if (sideFlip) { toggleBatchSide(); return; }
        const close = e.target.closest('#batchClose');
        if (close) { toggleBatchPanel(false); return; }
        const refresh = e.target.closest('#batchRefresh');
        if (refresh) { reloadBatchesIndex(); return; }
        const compatBtn = e.target.closest('#batchCompatFilter');
        if (compatBtn) { BATCH_STATE.compatOnly = !BATCH_STATE.compatOnly; BATCH_STATE.page = 1; renderBatchPanel(); renderBatchDock(); return; }
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
            if (BATCH_STATE.detailMode === 'quick') showBatchQuickDetail(item, b);
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
          const b = BATCHES_INDEX.batches.find(function (x) { return x.batchId === load.getAttribute('data-fav-load'); });
          if (b) { hideBatchQuickDetail(); selectBatch(b); }
        }
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
        if (b) { hideBatchQuickDetail(); selectBatch(b); }
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
          clearTimeout(BATCH_LIST_TIMER);
          BATCH_LIST_TIMER = setTimeout(renderBatchList, 150);
        }
      });
      document.getElementById('batchPanel').addEventListener('change', function (e) {
        if (e.target && e.target.id === 'batchEnv') {
          BATCH_STATE.env = e.target.value;
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
            if (b) { hideBatchQuickDetail(); selectBatch(b); }
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
        if (BATCH_QD && !e.relatedTarget) hideBatchQuickDetail();
      });
      document.getElementById('batchBackDefault').addEventListener('click', function () { loadDefaultReport(); });

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
      window.addEventListener('hashchange', function () { applyHash(); render(); });
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
        } else if (digits.length === 0) {
          state.reportDateFilter = '';
          e.target.parentElement.classList.toggle('has-value', false);
          renderSidebar();
        }
      });
      document.getElementById('reportDateClear').addEventListener('click', function () {
        state.reportDateFilter = '';
        state.sidebarPage = 1;
        dateInput.value = '';
        datePicker.value = '';
        dateInput.parentElement.classList.remove('has-value');
        renderSidebar();
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
        if (action === 'fields') { state.tab = 'fields'; state.colFilter.result = 'ALL'; }
        else if (action === 'passed') { state.tab = 'fields'; state.colFilter.result = 'PASSED'; }
        else if (action === 'failed') { state.tab = 'fields'; state.colFilter.result = 'FAILED'; }
        else if (action === 'warnings') { state.tab = 'warnings'; }
        else if (action === 'errors') { state.tab = 'errors'; }
        render();
      });

      document.getElementById('filterChips').addEventListener('click', function (e) {
        const btn = e.target.closest('[data-clear]');
        if (!btn) return;
        const idx = parseInt(btn.getAttribute('data-clear'), 10);
        if (ACTIVE_FILTERS[idx]) ACTIVE_FILTERS[idx].clear();
        state.page = 1;
        render();
      });

      document.getElementById('sidebar').addEventListener('click', function (e) {
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

      document.getElementById('itemMeta').addEventListener('click', function (e) {
        const a = e.target.closest('[data-item-info]');
        if (!a) return;
        openItemInfoPopover(a, currentItem());
      });

      document.getElementById('tabs').addEventListener('click', function (e) {
        const el = e.target.closest('[data-tab]');
        if (!el) return;
        state.tab = el.getAttribute('data-tab'); state.page = 1;
        state.msgSort = { key: '', dir: 1 };
        state.msgFilter = {};
        closePopover();
        renderTabs(); renderChannelTabs(); renderFilterChips(); renderContent();
      });

      document.getElementById('channelTabs').addEventListener('click', function (e) {
        const colToggle = e.target.closest('.col-toggle');
        if (colToggle) { openColumnMenu(colToggle); return; }
        const el = e.target.closest('[data-channel]');
        if (!el) return;
        state.channel = el.getAttribute('data-channel'); state.page = 1;
        state.colFilter = { channel: 'ALL', source: 'ALL', f: '', x: '', aoCsv: '', t: 'ALL', ctx: '', eo: '', ao: '', result: 'ALL', note: '' };
        render();
      });

      document.getElementById('content').addEventListener('click', function (e) {
        const ctxTag = e.target.closest('.ctx-tag');
        if (ctxTag) { showCtxDefPopup(ctxTag, ctxTag.getAttribute('data-ctx')); return; }
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
        const detail = e.target.closest('[data-detail]');
        if (detail) { openModal(detail.getAttribute('data-detail')); return; }
        const ign = e.target.closest('.ignore-btn');
        if (ign) { toggleIgnoreByKey(ign.getAttribute('data-ignore')); return; }
        const exp = e.target.closest('#exportIgnoreBtn');
        if (exp) { exportIgnoreConfig(); return; }
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
          if (sort.key === key) sort.dir = sort.dir === 1 ? -1 : 1;
          else { sort.key = key; sort.dir = 1; }
          state.page = 1;
          state.msgPage = 1;
          renderContent();
        }
      });

      document.getElementById('content').addEventListener('mousedown', function (e) {
        const handle = e.target.closest('.col-resize');
        if (!handle) return;
        const colKey = handle.getAttribute('data-resize');
        const rc = RESIZABLE_COLS[colKey];
        if (!rc) return;
        e.preventDefault();
        const startX = e.clientX;
        const startW = state[rc.stateKey];
        const guide = document.createElement('div');
        guide.className = 'col-resize-guide';
        document.body.appendChild(guide);
        const header = handle.closest('th');
        if (header) header.classList.add('resizing');
        document.body.classList.add('col-resizing');
        function onMove(ev) {
          const w = Math.max(rc.min, Math.min(rc.max, startW + (ev.clientX - startX)));
          state[rc.stateKey] = w;
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
          if (fid) { openModal(fid, true); return; }
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
        if (BATCH_QD && !e.target.closest('#batchPanel') && !e.target.closest('.batch-qd') && !e.target.closest('#batchBadge')) hideBatchQuickDetail();
        const cp = e.target.closest('[data-copy]');
        if (cp) {
          copyText(cp.getAttribute('data-copy'));
          const old = cp.textContent;
          cp.textContent = '✓';
          cp.classList.add('copied');
          setTimeout(function () { cp.textContent = old; cp.classList.remove('copied'); }, 1200);
        }
      });

      // 列表/页面滚动时关闭 Ctx 详情弹框（捕获阶段，覆盖嵌套滚动容器）。
      document.addEventListener('scroll', function () { if (CTX_DEF_POPUP) closeCtxDefPopup(); }, true);
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
      await loadFavorites();
      applyTheme(THEME);
      applySidebarWidth();
      applyBatchSide();
      applyBatchDockY();
      applyBatchListH();
      await loadBatchesIndex();
      applyFeatureVisibility();
      const restored = restoreActiveBatch();
      if (restored) {
        const ok = await loadBatchData(restored.batch, restored.forced, resolveUrl(indexBaseUrl(), restored.batch.dataUrl || ''));
        if (!ok) { DATA = await loadData(); await loadIgnoreConfig(); }
      } else {
        await loadIgnoreConfig();
        DATA = await loadData();
      }
      initState();
      if (isMultiMode()) await ensureItemLoaded(DATA.items[0].tradeId);
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

    if (typeof document !== 'undefined' && document.getElementById) initApp();

    // 供 Node 测试与工具使用的导出（纯函数 + 测试挂点）。
    export {
      groupedToFlat, msgIgnoreKey, msgIsIgnored,
      filteredFields, getMsgRows, diffSegments,
      parseSearchQuery, makeMatcher, matchRow,
      ctxTypes, ctxKeysOfType,
    };
    export const __test = {
      setState(s) { state = s; },
      setData(d) { DATA = d; },
      setIgnoreConfig(c) { IGNORE_CONFIG = c; },
      getData() { return DATA; },
    };
  