// 样例数据生成器（从原 HTML 内联脚本抽离，供工具与测试使用，不进入浏览器运行时）
// 生成单文件数据集 buildDataset()，以及多文件模式 splitToFiles()。
import fs from 'node:fs';
import path from 'node:path';
import { writeJSON } from './json-write.js';
import { CHANNEL_ID_PRESET, SOURCE_ID_PRESET, itemStatsPure, hoistRegistries } from '../public/core.js';

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

    // 渠道稳定标识：与 public/core.js 的预设一致（HKTR=1 / JSFA=2 / CFTC=3）。
    // 启用标记不再放在 item.enabledChannels，而是写在各渠道的 enabled 上（见 buildChannelData）。
    const CHANNELS = [
      { id: CHANNEL_ID_PRESET.HKTR, name: 'HKTR', desc: '香港交易资料储存库', format: 'xml' },
      { id: CHANNEL_ID_PRESET.JSFA, name: 'JSFA', desc: '日本金融厅', format: 'xml' },
      { id: CHANNEL_ID_PRESET.CFTC, name: 'CFTC', desc: '美国商品期货交易委员会', format: 'csv' },
    ];

    // 注意：渠道 / 来源渠道 / 字段 / ctxKey 的**定义**最终都写到顶层声明表
    // （reportChannelDefs / sourceChannelDefs / usedCtxKeyDefs，见 buildDataset 的 hoistRegistries）；
    // warnings / errors / uncompared **只写名称**（不带 id）；只有 logs / skippedItems 写 id。

    // 产品类别 -> 子产品（示例：利率类 IR 包含 IRS/OIS/BSW 等）
    const PRODUCT_CATEGORIES = {
      IR: { label: 'catIR', sub: ['IRS', 'OIS', 'BSW'] },
      CD: { label: 'catCD', sub: ['CDS', 'CDX'] },
      FX: { label: 'catFX', sub: ['FXS', 'FXF', 'FXO'] },
    };
    // 平台 -> 可用的产品类别（用于平台/产品联动）
    const PLATFORM_CATEGORIES = {
      'OTC-PLATFORM-A': ['IR', 'CD'],
      'OTC-PLATFORM-B': ['IR', 'FX'],
      'OTC-PLATFORM-C': ['CD', 'FX'],
    };

    // 每个报告渠道的字段定义: [字段, XPath或AO CSV字段, 断言类型, 值类型]
    const FIELD_DEFS = {
      HKTR: [
        ['tradeId',      '/HKTR/Report/Header/TradeDetails/TradeIdentifier/TradeId',          'contextAssertion', 'id'],
        ['reportId',     '/HKTR/Report/Header/ReportDetails/ReportIdentifier/ReportId',        'contextAssertion', 'id'],
        ['product',      '/HKTR/Report/Product/ProductDetails/ProductIdentifier',               'productAssertion',  'product'],
        ['notional',     '/HKTR/Report/Notional/AmountDetails/NotionalValue',                   'productAssertion',  'num'],
        ['currency',     '/HKTR/Report/Notional/AmountDetails/CurrencyCode',                    'productAssertion',  'code'],
        ['tradeDate',    '/HKTR/Report/Header/TradeDetails/TradeDate',                          'contextAssertion', 'date'],
        ['maturityDate', '/HKTR/Report/Header/TradeDetails/MaturityDate',                       'contextAssertion', 'date'],
        ['counterparty', '/HKTR/Report/Counterparty/PartyDetails/PartyName',                    'contextAssertion', 'text'],
        ['platform',     '/HKTR/Report/Execution/PlatformDetails/PlatformIdentifier',           'platformAssertion', 'text'],
        ['venue',        '/HKTR/Report/Execution/VenueDetails/VenueIdentifier',                 'platformAssertion', 'text'],
        ['price',        '/HKTR/Report/Pricing/PriceDetails/PriceValue',                        'productAssertion',  'num'],
        ['quantity',     '/HKTR/Report/Pricing/QuantityDetails/QuantityValue',                  'productAssertion',  'num'],
        ['remarks',      '/HKTR/Report/Header/AdditionalInformation/Remarks',                   'contextAssertion', 'multi'],
      ],
      JSFA: [
        ['tradeId',        '/JSFA/Report/Header/TransactionDetails/TradeIdentifier/TradeId',     'contextAssertion', 'id'],
        ['reportId',       '/JSFA/Report/Header/ReportDetails/ReportIdentifier/ReportId',        'contextAssertion', 'id'],
        ['product',        '/JSFA/Report/Product/ProductDetails/ProductIdentifier',              'productAssertion',  'product'],
        ['notional',       '/JSFA/Report/Notional/AmountDetails/NotionalValue',                  'productAssertion',  'num'],
        ['currency',       '/JSFA/Report/Notional/AmountDetails/CurrencyCode',                   'productAssertion',  'code'],
        ['tradeDate',      '/JSFA/Report/Header/TransactionDetails/TradeDate',                   'contextAssertion', 'date'],
        ['settlementDate', '/JSFA/Report/Header/SettlementDetails/SettlementDate',               'contextAssertion', 'date'],
        ['counterparty',   '/JSFA/Report/Counterparty/PartyDetails/PartyName',                   'contextAssertion', 'text'],
        ['platform',       '/JSFA/Report/Execution/PlatformDetails/PlatformIdentifier',          'platformAssertion', 'text'],
        ['venue',          '/JSFA/Report/Execution/VenueDetails/VenueIdentifier',                'platformAssertion', 'text'],
        ['price',          '/JSFA/Report/Pricing/PriceDetails/PriceValue',                       'productAssertion',  'num'],
        ['quantity',       '/JSFA/Report/Pricing/QuantityDetails/QuantityValue',                 'productAssertion',  'num'],
        ['remarks',        '/JSFA/Report/Header/AdditionalInformation/Remarks',                  'contextAssertion', 'multi'],
      ],
      CFTC: [
        ['tradeId',      'trade_id',              'contextAssertion', 'id'],
        ['reportId',     'report_id',             'contextAssertion', 'id'],
        ['product',      'product_code',          'productAssertion',  'product'],
        ['notional',     'notional_amount',       'productAssertion',  'num'],
        ['currency',     'ccy',                   'productAssertion',  'code'],
        ['tradeDate',    'exec_timestamp',        'contextAssertion', 'date'],
        ['maturityDate', 'expiration_date',       'contextAssertion', 'date'],
        ['counterparty', 'cp_name',               'contextAssertion', 'text'],
        ['platform',     'platform_id',           'platformAssertion', 'text'],
        ['venue',        'venue_id',              'platformAssertion', 'text'],
        ['price',        'price_amt',             'productAssertion',  'num'],
        ['quantity',     'qty',                   'productAssertion',  'num'],
        ['remarks',      'remarks',               'contextAssertion', 'multi'],
      ],
    };

    /* ---------- 示例数据生成器（真实数据可替换此部分） ---------- */
    function mulberry32(a) {
      return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
      };
    }

    const MULTI_TEXT =
      '第一行备注：交易双方已确认条款，包含特殊字符 <PartyRole id="P1"> & "quote" & \'single\'。</PartyRole>\n' +
      '第二行备注：本字段可能包含较长内容，用于验证多行与特殊字符的展示效果。\n' +
      '第三行备注：配置驱动比较，命中上下文后取得字段对应关系。';

    function genValue(kind, rng) {
      if (kind === 'id') return 'TX-2024-' + String(100000 + Math.floor(rng() * 900000));
      if (kind === 'num') return (100000 + rng() * 9900000).toFixed(2);
      if (kind === 'date') {
        const d = new Date(Date.UTC(2024, 0, 1) + Math.floor(rng() * 364) * 86400000);
        return d.toISOString().slice(0, 10);
      }
      if (kind === 'code') return ['USD', 'CNY', 'HKD', 'JPY', 'EUR'][Math.floor(rng() * 5)];
      if (kind === 'product') return ['IRS', 'OIS', 'BSW', 'CDS', 'FXS', 'FXF'][Math.floor(rng() * 6)];
      if (kind === 'text') {
        const roll = rng();
        if (roll < 0.08) return '';
        if (roll < 0.16) return '   ';
        if (roll < 0.24) return 'ABC\u200BBank';
        return ['ABC Bank', 'Citi Group', 'HSBC', 'Nomura', 'Goldman Sachs'][Math.floor(rng() * 5)];
      }
      if (kind === 'multi') return MULTI_TEXT;
      return 'VAL-' + Math.floor(rng() * 9999);
    }

    function mutateValue(v, kind, rng) {
      if (kind === 'num') {
        const n = parseFloat(v);
        const delta = (rng() < 0.5 ? -1 : 1) * (0.01 + Math.floor(rng() * 99));
        return (n + delta).toFixed(2);
      }
      if (kind === 'date') {
        const d = new Date(v);
        d.setUTCDate(d.getUTCDate() + 1 + Math.floor(rng() * 9));
        return d.toISOString().slice(0, 10);
      }
      if (kind === 'code') { const codes = ['USD', 'CNY', 'HKD', 'JPY', 'EUR']; return codes.find(c => c !== v) || 'GBP'; }
      if (kind === 'product') { const ps = ['IRS', 'OIS', 'BSW', 'CDS', 'FXS', 'FXF']; return ps.find(p => p !== v) || 'OPTION'; }
      if (kind === 'id') return v.slice(0, -1) + String(Math.floor(rng() * 10));
      if (kind === 'multi') return v.replace('已确认条款', '存在差异条款') + '\n[差异] 新增差异行：内容不一致。';
      const texts = ['XYZ Bank', 'Deutsche Bank', 'Mizuho', 'BNP Paribas', 'Barclays'];
      return texts.find(t => t !== v) || 'Other Bank';
    }

    function noteFor(kind) {
      if (kind === 'num') return '数值差异';
      if (kind === 'date') return '日期差异';
      if (kind === 'code' || kind === 'product') return '码值差异';
      if (kind === 'multi') return '内容差异';
      return '值不一致';
    }

    function genUnconverted(eo, k) {
      if (k === 'num') return String(Math.round(parseFloat(eo) * 100));
      if (k === 'date') return String(eo).replace(/-/g, '');
      if (k === 'code') return String(eo).toLowerCase();
      if (k === 'product') return String(eo).toLowerCase();
      if (k === 'text') return '  ' + eo + '  ';
      if (k === 'id') return String(eo).replace('TX-', '');
      return eo;
    }
    function genExcelMapping(x, ctx, isSample) {
      const keys = ctx && ctx.length ? ctx : ['ctx.default'];
      if (!isSample) return '-; ' + x;
      return keys.map(function (ck) {
        return ck + ':\n-; ' + x + '\n- boolean(' + x + ') = False';
      }).join('\n');
    }
    function genExcelRuleText(rule, ctx, isSample) {
      if (!rule) return '（未配置）';
      const keys = ctx && ctx.length ? ctx : ['ctx.default'];
      if (!isSample) return '-; ' + rule;
      return keys.map(function (ck) {
        return ck + ':\n-; ' + rule + '\n- @fallback';
      }).join('\n');
    }
    function convRuleFor(k, rng) {
      if (k === 'num') return ['@round2', '@scale100'][Math.floor(rng() * 2)];
      if (k === 'date') return '@dateFormat(YYYY-MM-DD)';
      if (k === 'code') return '@toUpper';
      if (k === 'product') return '@toUpper';
      if (k === 'text') return ['@trim', '@normalizeSpace'][Math.floor(rng() * 2)];
      if (k === 'id') return '@normalizeId';
      if (k === 'multi') return '@trimLines';
      return '@normalize';
    }
    function valRuleFor(k, rng) {
      if (k === 'code') return "enum: ['USD', 'CNY', 'HKD', 'JPY', 'EUR']";
      if (k === 'num') return 'regex:^\\d+(\\.\\d{2})?$';
      if (k === 'date') return 'regex:^\\d{4}-\\d{2}-\\d{2}$';
      if (k === 'id') return 'regex:^TX-\\d{6}$';
      if (k === 'product') return "enum: ['IRS', 'OIS', 'BSW', 'CDS', 'FXS', 'FXF']";
      if (k === 'text') return ['@length<=64', '@notNull'][Math.floor(rng() * 2)];
      if (k === 'multi') return '@maxLines<=3';
      return '@notNull';
    }
    function pickCtx(ctxPool, rng) {
      const n = rng() < 0.4 ? 2 : 1;
      const arr = [];
      for (let i = 0; i < n; i++) {
        const c = ctxPool[Math.floor(rng() * ctxPool.length)];
        if (arr.indexOf(c) === -1) arr.push(c);
      }
      return arr;
    }

    const WARN_TEXTS = [
      '配置映射缺失：CSV 字段未找到对应 XPath，已跳过',
      '字段格式与映射配置不一致，使用默认校验规则',
      '日期格式异常，已自动规范化处理',
      '空值处理：期望值为空，按容错策略判定通过',
      '关键字段重复，仅保留首条记录',
    ];
    const ERR_TEXTS = [
      'XPath 解析失败：节点不存在',
      '类型转换异常：无法转换为数值',
      '映射配置错误：XPath 语法非法',
      '运行时异常：字段比较过程被中断',
      '日志缓冲达到上限，部分日志被丢弃',
    ];

    // warnings / errors 迁移到 item 级别：
    //   - 移除 platform / product（跟随 item）
    //   - 新增 scope（field / channel）与 source（来源渠道，随机分配 A/B，部分为空模拟来源缺失）
    function buildMessages(rng, channelName, fieldsDef, failedBySource) {
      const count = 2 + Math.floor(rng() * 4);
      const typeKeys = Object.keys(TYPE_META);
      const levelPool = ['WARN', 'INFO', 'NOTICE', 'DEBUG'];
      // 所有存在失败字段的来源渠道：用于让部分警告关联到失败字段（与错误叠加）。
      const failedSrcs = (failedBySource || []).filter(function (s) { return s.failedFields.length > 0; });
      // 来源渠道只能从**该渠道实际存在的来源**里挑：否则会出现引用了不存在来源渠道的消息
      // （旧的 enabledChannels 时代这种悬空引用无法被发现，现在 id 引用校验会直接报错）。
      const srcPool = (failedBySource || []).map(function (s) { return s.name; });
      const pickSource = function () { return srcPool.length ? srcPool[Math.floor(rng() * srcPool.length)] : ''; };
      const msgs = [];
      for (let i = 0; i < count; i++) {
        const base = WARN_TEXTS[Math.floor(rng() * WARN_TEXTS.length)];
        const text = rng() < 0.2
          ? base + '\n详情：该字段的映射配置可能缺失或与当前 context 不匹配。\n建议检查映射表对应 sheet 的配置，确认 XPath 与命中的 context 是否正确，并核对字段类型。'
          : base;
        let field = '';
        let source;
        if (i === 0 && failedSrcs.length) {
          // 首条警告固定关联到第一个失败字段（与首条错误同字段），保证该失败字段同时有警告+错误。
          field = failedSrcs[0].failedFields[0];
          source = failedSrcs[0].name;
        } else if (rng() < 0.8) {
          // 约一半警告关联到失败字段（与错误叠加），其余为随机字段。
          if (failedSrcs.length && rng() < 0.5) {
            const src = failedSrcs[Math.floor(rng() * failedSrcs.length)];
            field = src.failedFields[Math.floor(rng() * src.failedFields.length)];
            source = src.name;
          } else {
            field = fieldsDef[Math.floor(rng() * fieldsDef.length)][0];
            source = rng() < 0.25 ? '' : pickSource();
          }
        } else {
          // 渠道级警告：部分来源渠道为空（模拟来源信息缺失的样例数据）。
          source = rng() < 0.25 ? '' : pickSource();
        }
        msgs.push({
          scope: field ? 'field' : 'channel',
          source: source,
          channel: channelName,
          type: typeKeys[Math.floor(rng() * typeKeys.length)],
          level: levelPool[Math.floor(rng() * levelPool.length)],
          text: text,
          field: field,
        });
      }
      return msgs;
    }

    // 错误只关联到实际失败的字段：failedBySource 收集各来源渠道中 FAILED 的字段名。
    // 当整个渠道没有任何失败字段（即该渠道/ item 结果为 PASSED）时不产生任何错误。
    function buildErrorMessages(rng, channelName, failedBySource) {
      const withFailures = failedBySource.filter(function (s) { return s.failedFields.length > 0; });
      if (withFailures.length === 0) return [];
      const count = 2 + Math.floor(rng() * 4);
      const typeKeys = Object.keys(ERROR_TYPE_META);
      const levelPool = ['ERROR', 'FATAL', 'SEVERE'];
      const msgs = [];
      for (let i = 0; i < count; i++) {
        let src, field;
        if (i === 0) {
          // 首条错误固定关联到第一个失败字段，保证与首条警告叠加（同一失败字段同时有警告+错误）。
          src = withFailures[0];
          field = src.failedFields[0];
        } else {
          src = withFailures[Math.floor(rng() * withFailures.length)];
          // 大部分错误关联到具体失败字段；少数为渠道级错误（无字段归属）。
          field = rng() < 0.8 ? src.failedFields[Math.floor(rng() * src.failedFields.length)] : '';
        }
        const base = ERR_TEXTS[Math.floor(rng() * ERR_TEXTS.length)];
        const text = rng() < 0.2
          ? base + '\n详情：该字段的映射配置可能缺失或与当前 context 不匹配。\n建议检查映射表对应 sheet 的配置，确认 XPath 与命中的 context 是否正确，并核对字段类型。'
          : base;
        // 字段级错误必须携带失败字段所在的来源渠道；渠道级错误偶尔来源为空（模拟缺失）。
        const source = field ? src.name : (rng() < 0.3 ? '' : src.name);
        msgs.push({
          scope: field ? 'field' : 'channel',
          source: source,
          channel: channelName,
          type: typeKeys[Math.floor(rng() * typeKeys.length)],
          level: levelPool[Math.floor(rng() * levelPool.length)],
          text: text,
          field: field,
        });
      }
      return msgs;
    }

    // uncompared 与 uncomparedCsv 合并为 uncompared：
    //   - 新增 type：1 = xpath（XML 渠道）/ 2 = csv（CSV 渠道）
    //   - 元素统一存 value；移除 platform / product / ctx
    //   - 新增 source（来源渠道）：可为 null（渠道级未比较）；channel 可为 null（全局未比较，见 buildGlobalUncompared），
    //     source 非空时 channel 必非空。
    function buildUncompared(channelName, sourceNames, rng, fieldsDef, type) {
      const list = [];
      const n = Math.floor(rng() * 2);
      for (let i = 0; i < n; i++) {
        const d = fieldsDef[Math.floor(rng() * fieldsDef.length)];
        const source = (sourceNames.length && rng() < 0.5) ? sourceNames[Math.floor(rng() * sourceNames.length)] : null;
        const note = rng() < 0.35
          ? (type === 1
            ? '未在映射配置中匹配到对应 CSV 字段\n详情：Excel 映射配置中未找到与该 XPath 对应的条目，可能因 context 定义变化导致。\n请检查映射表并确认该 XPath 是否仍需要参与比较。'
            : '未在映射配置中匹配到对应来源字段\n详情：Excel 映射配置中未找到与该 AO CSV 字段对应的条目，可能因 context 定义变化导致。\n请检查映射表并确认该 CSV 字段是否仍需要参与比较。')
          : (type === 1 ? '未在映射配置中匹配到对应 CSV 字段' : '未在映射配置中匹配到对应来源字段');
        list.push({ type: type, channel: channelName, source: source, value: d[1], note: note });
      }
      return list;
    }

    // 全局未比较条目：channel=null、source=null（未关联到具体报告渠道）。
    function buildGlobalUncompared(rng) {
      const list = [];
      const n = rng() < 0.5 ? 1 : 0;
      for (let i = 0; i < n; i++) {
        list.push({
          type: rng() < 0.5 ? 1 : 2,
          channel: null,
          source: null,
          value: ['/Common/Header/TradeId', '/Common/Header/DealId', '/Common/Header/ReportDate'][Math.floor(rng() * 3)],
          note: '未在任一报告渠道的映射配置中匹配到对应字段',
        });
      }
      return list;
    }

    function buildChannelLogs(ch, tradeId) {
      const t = '2024-08-14 10:23:0';
      // 日志行只写**渠道 / 来源渠道 id**（不写名称）：名称由查看器加载时按 id 从顶层声明表补回，
      // text 里的 `[渠道名]` 只是给人看的展示内容，不承载任何数据（见 docs/DATA_SCHEMA.md §3）。
      return [
        { scope: 'channel', channelId: ch.id, sourceId: null, field: null, text: t + '0.200 INFO  [' + ch.name + '] 读取报送文件 ' + ch.files.ao.map(fileEntryName).join(', ') },
        { scope: 'channel', channelId: ch.id, sourceId: null, field: null, text: t + '0.300 INFO  [' + ch.name + '] 应用映射配置 ' + ch.files.excel.file + ' [sheet: ' + ch.files.excel.sheet + ']' },
        { scope: 'channel', channelId: ch.id, sourceId: null, field: null, text: t + '0.400 INFO  [' + ch.name + '] 完成字段比较，渠道结果已生成' },
      ];
    }

    // 原「相关打印信息」（field.prints，保留待用）：字段比较过程的三行打印文本。
    function buildPrints(f, target, ctx, chName, srcName, eo, ao, result, note, targetName) {
      return [
        '[INFO] 比较字段 ' + f + '（报告渠道 ' + chName + ' / ' + srcName + '）',
        '[INFO] ' + targetName + '=' + target + '，命中Ctx=' + (Array.isArray(ctx) ? ctx.join(',') : ctx),
        '[INFO] EO=' + eo + '，AO=' + ao + ' → ' + result + (note ? '（' + note + '）' : ''),
      ];
    }

    // 字段级日志行（item.logs 中 scope="field" 的行）：
    //   - **只在 item.logs 里存一份**（fields[] 不新增任何字段，字段自身只有 prints 保留待用）；
    //   - 每行带 field（字段 id）与 channelId / sourceId：**不写渠道 / 来源渠道名称**，
    //     名称由查看器加载时按 id 从顶层声明表补回（展示 / 筛选 / 深链接仍按名称）；
    //   - 文本沿用原 prints 的语义，补上时间戳与 `[报告渠道/来源渠道]` 前缀，使其与其它日志行一致可读；
    //     前缀**只是展示文本**，代码逻辑不得解析它（真实数据可能完全不带渠道信息）。
    function buildFieldLogs(f, fieldId, chId, srcId, target, ctx, chName, srcName, eo, ao, result, note, targetName, sn, idx) {
      const stamp = '2024-08-14 10:24:' + String(sn * 10 + (idx % 10)).padStart(2, '0') + '.';
      const prefix = '[' + chName + '/' + srcName + '] ';
      return buildPrints(f, target, ctx, chName, srcName, eo, ao, result, note, targetName).map(function (text, i) {
        return {
          scope: 'field',
          channelId: chId,
          sourceId: srcId,
          field: fieldId,
          text: stamp + String(100 + i * 40) + ' INFO  ' + prefix + text.replace(/^\[INFO\]\s*/, ''),
        };
      });
    }

    // 每个 item 的字段定义（不同 item 可有不同字段集合）：
    //   i%4==0 完整字段
    //   i%4==1 缺 venue（该 item 无成交场所）
    //   i%4==2 缺 venue、quantity（无成交场所与数量）
    //   i%4==3 缺 price、remarks（无价格与备注）
    function fieldDefsForItem(itemIndex, ch) {
      const base = FIELD_DEFS[ch.name] || [];
      const m = itemIndex % 4;
      const drop = m === 1 ? ['venue']
        : m === 2 ? ['venue', 'quantity']
        : m === 3 ? ['price', 'remarks']
        : [];
      return base.filter(function (def) { return drop.indexOf(def[0]) === -1; });
    }

    // report channel 级字段定义注册表：每个报告渠道各自构建（不同渠道的字段定义不同）。
    // 字段 id 在**数据集内唯一**：不同报告渠道即便字段同名，id 也不同（按渠道分配 id 区间，
    // 如 HKTR 1..13 / JSFA 21..33 / CFTC 41..53），因此 `sources[].fields[].id` 的引用天然唯一。
    // 编号始终按渠道的**完整**字段列表编（而不是某个 item 的子集：不同 item 可以缺字段，
    // 但同一字段的 id 必须全局一致 —— 定义是数据集级的）。
    const FIELD_ID_BASE = { HKTR: 0, JSFA: 20, CFTC: 40 };
    function buildChannelFieldRegistry(chName) {
      const registry = [];
      const nameToId = {};
      const base = FIELD_ID_BASE[chName] || 0;
      (FIELD_DEFS[chName] || []).forEach(function (def) {
        const id = String(base + registry.length + 1);
        nameToId[def[0]] = id;
        registry.push({ id: id, name: def[0], userTag: def[2], type: def[3] });
      });
      return { registry: registry, nameToId: nameToId };
    }

    // enabled：该渠道是否参与本次比较（唯一口径 channels[].enabled）。
    // 仅在被禁用时输出 `enabled: false`（缺省 = 启用），避免无意义的 `enabled: true` 噪声。
    function buildChannelData(ch, tradeId, reportDate, rng, failRate, fieldsDef, sourceCount, idByKey, enabled) {
      const fr = buildChannelFieldRegistry(ch.name);
      const base = ch.name.toLowerCase();
      const mapPool = [
        base + '.ctx.default',
        base + '.ctx.v2',
        base + '.ctx.v3',
        base + '.ctx.extended.production.region.east.v2024.latest',
      ];
      const convPool = [base + '.ctx.conv.default', base + '.ctx.conv.v2'];
      const valPool = [base + '.ctx.val.default', base + '.ctx.val.v2'];
      const isCsv = ch.format === 'csv';
      // ctx key → ctxDefs.id 引用
      const toIds = function (arr) {
        return (arr || []).map(function (k) { return idByKey[k]; }).filter(function (id) { return id != null; });
      };
      // ctx（单数）为命中 ctxKey 的原始字符串表达式，如 "hktr.ctx.val.v2 and hktr.ctx.default"；
      // 其中每个元 ctxKey 的 id 引用在同级别的 ctxs 数组中。
      const ctxExpr = function (arr) {
        return (arr && arr.length) ? arr.join(' and ') : null;
      };
      // 来源渠道数量：默认为 2（A/B），部分 item 仅有 1 个来源渠道（sourceCount=1）。
      const sourceIndexes = sourceCount === 1 ? [1] : [1, 2];
      // 记录各来源渠道中 FAILED 的字段名，供错误消息只关联到实际失败字段。
      const failedBySource = [];
      // 该来源渠道的字段级日志行（scope=field）：只进 item.logs（item.logs 里按渠道分组）。
      const sourceFieldLogs = [];
      const sources = sourceIndexes.map(sn => {
        const failedFields = [];
        const fields = fieldsDef.map(([f, rawTarget, t, k], idx) => {
          const el = rawTarget;
          // 值来源格式：EO 侧恒为 CSV（来源数据），AO 侧随渠道格式（XPath/XML 或 CSV）。
          const valueSrcFmt = isCsv ? 'csv' : 'xml';
          const eo = genValue(k, rng);
          const failed = rng() < failRate;
          if (failed) failedFields.push(f);
          const ao = failed ? mutateValue(eo, k, rng) : eo;
          const ctx = [];
          // 至少包含一个字段映射（type 1）CtxKey；值转换（type 2）与终值校验（type 3）按概率追加。
          const m0 = mapPool[Math.floor(rng() * mapPool.length)];
          ctx.push(m0);
          if (rng() < 0.7) { const c = convPool[Math.floor(rng() * convPool.length)]; if (ctx.indexOf(c) === -1) ctx.push(c); }
          if (rng() < 0.7) { const c = valPool[Math.floor(rng() * valPool.length)]; if (ctx.indexOf(c) === -1) ctx.push(c); }
          if (rng() < 0.3) { const c = mapPool[Math.floor(rng() * mapPool.length)]; if (ctx.indexOf(c) === -1) ctx.push(c); }
          const result = failed ? 'FAILED' : 'PASSED';
          let note = failed ? noteFor(k) : '';
          if (note && rng() < 0.3) note += '\n详情：期望值与实际值存在差异，可能由来源数据更新或报送数据延迟导致。\n建议核对上游系统该字段的最新取值，确认差异是否为业务允许范围。';
          const resultNote = failed ? ('比对未通过：' + note) : '比对通过';
          // EO 转换信息（Excel 转换规则）与 AO 终值校验规则
          const convProb = { num: 0.6, date: 0.5, code: 0.5, text: 0.45, product: 0.3, id: 0.2, multi: 0.15 }[k] || 0.3;
          const eoConverted = rng() < convProb;
          const eoUnconverted = eoConverted ? genUnconverted(eo, k) : null;
          const conversionRule = eoConverted ? { ctx: pickCtx(convPool, rng), value: convRuleFor(k, rng) } : null;
          // AO 侧值转换规则（cvtRight 样例数据）。
          const aoConverted = rng() < 0.4;
          const aoConversionRule = aoConverted ? { ctx: pickCtx(convPool, rng), value: convRuleFor(k, rng) } : null;
          const aoUnconverted = aoConverted ? genUnconverted(ao, k) : null;
          const validationRule = rng() < 0.75 ? { ctx: pickCtx(valPool, rng), value: valRuleFor(k, rng) } : null;
          const isExcelSample = tradeId === 'T-20240814-1001' && ch.name === 'HKTR' && idx === 0;
          const excelMapping = genExcelMapping(el, ctx, isExcelSample);
          const excelConversionRule = genExcelRuleText(conversionRule ? conversionRule.value : null, ctx, isExcelSample);
          const excelValidationRule = genExcelRuleText(validationRule ? validationRule.value : null, ctx, isExcelSample);
          // EO 侧元素与映射：EO 来源为 CSV，列名由字段派生（供「EO 字段映射规则」左栏展示）。
          const eoCol = 'src_' + f;
          const eoMapping = genExcelMapping(eoCol, ctx, isExcelSample);
          const resultDetails = [];
          if (eoConverted && eoUnconverted != null) resultDetails.push({ label: '期望值 (EO, Unconverted)', value: eoUnconverted });

          // 各侧 CtxKey 分组：映射（type1）/ 转换（type2）/ 校验（type3）。
          const mapCtxs = ctx.filter(function (c) { return c.indexOf('.conv.') === -1 && c.indexOf('.val.') === -1; });
          const convCtxs = conversionRule ? conversionRule.ctx : [];
          const aoConvCtxs = aoConversionRule ? aoConversionRule.ctx : [];
          const valCtxs = validationRule ? validationRule.ctx : [];

          // ctx 引用改为 id：各规则 ctxs 均为 ctxDefs 的 id；field 级 ctxs 已删除（由规则 ctxs 取合集）。
          const mapCtxIds = toIds(mapCtxs);
          const convCtxIds = toIds(convCtxs);
          const aoConvCtxIds = toIds(aoConvCtxs);
          const valCtxIds = toIds(valCtxs);
          const srcName = '来源渠道 ' + (sn === 1 ? 'A' : 'B');
          const fieldId = fr.nameToId[f];
          // 字段级日志行（scope=field）：只进 item.logs，不写进字段对象。
          sourceFieldLogs.push.apply(sourceFieldLogs,
            buildFieldLogs(f, fieldId, ch.id, SOURCE_ID_PRESET[srcName], el, ctx, ch.name, srcName, eo, ao, result, note, isCsv ? 'CSV字段' : 'XPath', sn, idx));
          return {
            id: fieldId,
            cmpLeft: { value: eo, ctx: ctxExpr(mapCtxs), ctxs: mapCtxIds, elRaw: eoMapping, el: eoCol, valueSrcFmt: 'csv' },
            cmpRight: { value: ao, ctx: ctxExpr(mapCtxs), ctxs: mapCtxIds, elRaw: excelMapping, el: el, valueSrcFmt: valueSrcFmt },
            cvtLeft: conversionRule ? { ctx: ctxExpr(convCtxs), ctxs: convCtxIds, el: conversionRule.value, elRaw: excelConversionRule, raw: eoUnconverted } : null,
            cvtRight: aoConversionRule ? { ctx: ctxExpr(aoConvCtxs), ctxs: aoConvCtxIds, el: aoConversionRule.value, elRaw: genExcelRuleText(aoConversionRule.value, ctx, isExcelSample), raw: aoUnconverted } : null,
            vdt: validationRule ? { ctx: ctxExpr(valCtxs), ctxs: valCtxIds, el: validationRule.value, elRaw: excelValidationRule } : null,
            result: result,
            remarks: note,
            resultText: resultNote,
            resultDetails: resultDetails,
            // prints 保留待用（查看器详情页已改为从 item.logs 读取该字段的关联日志行）。
            prints: buildPrints(f, el, ctx, ch.name, srcName, eo, ao, result, note, isCsv ? 'CSV字段' : 'XPath'),
          };
        });
        const srcName = '来源渠道 ' + (sn === 1 ? 'A' : 'B');
        failedBySource.push({ name: srcName, failedFields: failedFields });
        return { id: SOURCE_ID_PRESET[srcName], name: srcName, fields: fields };
      });

      // 该渠道的字段级日志行（scope=field）：按来源渠道 / 字段出现顺序汇总，只用于 item.logs（按渠道分组）。

      const aoExt = isCsv ? '.csv' : '.xml';
      const eoNameA = ch.name.toLowerCase() + '_srcA_' + tradeId + '.csv';
      const eoNameB = ch.name.toLowerCase() + '_srcB_' + tradeId + '.csv';
      const aoNameA = ch.name.toUpperCase() + '_' + tradeId + '_001' + aoExt;
      const aoNameB = ch.name.toUpperCase() + '_' + tradeId + '_002' + aoExt;
      const files = {
        eo: sourceCount === 1
          ? [{ name: eoNameA, path: 'data/eo/' + eoNameA }]
          : [{ name: eoNameA, path: 'data/eo/' + eoNameA }, { name: eoNameB, path: 'data/eo/' + eoNameB }],
        ao: sourceCount === 1
          ? [{ name: aoNameA, path: 'data/ao/' + aoNameA }]
          : [{ name: aoNameA, path: 'data/ao/' + aoNameA }, { name: aoNameB, path: 'data/ao/' + aoNameB }],
        excel: { file: 'mapping.xlsx', sheet: ch.name, path: 'data/excel/mapping.xlsx' },
      };

      const channel = { id: ch.id, name: ch.name };
      if (enabled === false) channel.enabled = false;
      channel.desc = ch.desc;
      channel.format = ch.format;
      channel.files = files;
      channel.fields = fr.registry;
      channel.sources = sources;
      return {
        channel: channel,
        warnings: buildMessages(rng, ch.name, fieldsDef, failedBySource),
        errors: buildErrorMessages(rng, ch.name, failedBySource),
        uncompared: buildUncompared(ch.name, sources.map(function (s) { return s.name; }), rng, fieldsDef, isCsv ? 2 : 1),
        logs: buildChannelLogs({ id: ch.id, name: ch.name, files: files }, tradeId),
        fieldLogs: sourceFieldLogs,
      };
    }

    // 顶层 skippedItems：记录未能参与比较的 item（与 reportEnv 同级）。
    //   channel / source / channelId / sourceId 均可为 null：null 表示「未关联到具体渠道 / 来源」。
    function buildSkippedItems(rng) {
      const list = [];
      const n = 2 + Math.floor(rng() * 3);
      const chNames = ['HKTR', 'JSFA', 'CFTC'];
      const srcNames = ['来源渠道 A', '来源渠道 B'];
      for (let i = 0; i < n; i++) {
        const channel = rng() < 0.6 ? chNames[Math.floor(rng() * chNames.length)] : null;
        const source = channel && rng() < 0.7 ? srcNames[Math.floor(rng() * srcNames.length)] : null;
        const itemId = 'T-20240810-0' + (91 + i);
        let reason;
        if (channel === null) reason = '未在任一报告渠道中找到对应记录，该 item 未能参与比较。';
        else if (source === null) reason = '在 ' + channel + ' 渠道中未找到该 item 的对应记录，已跳过该渠道的比较。';
        else reason = '在 ' + channel + ' 渠道的 ' + source + ' 中未找到该 item 的对应记录，已跳过该来源渠道的比较。';
        if (rng() < 0.35) reason += '\n详情：该 item 在来源 CSV 与报送 XML 中均未出现对应记录，可能因数据采集或报送延迟导致。\n建议核对上游系统是否已产生该 item 的数据。';
        // skippedItems 保持「名称 + id」双写：被跳过的 item 不在 items 里，名称便于人读、id 便于定位。
        const ids = {
          channelId: (channel && CHANNEL_ID_PRESET[channel]) || null,
          sourceId: null,
        };
        if (ids.channelId != null && source) ids.sourceId = SOURCE_ID_PRESET[source] || null;
        list.push({ itemId: itemId, channel: channel, source: source, channelId: ids.channelId, sourceId: ids.sourceId, reason: reason });
      }
      return list;
    }

    // item 级 logs：对象式 { scope, channelId, sourceId, field, text }。
    //   - overview（开始/加载/初始化/完成）→ scope=item（channelId / sourceId / field 均为 null）
    //   - 逐渠道执行步骤、各渠道日志 → scope=channel（field 为 null，channelId 非空、sourceId 为 null）
    //   - 各字段关联的日志行 → scope=field（field 与两个 id 均非空）
    // 日志行**不写渠道 / 来源渠道名称**（名称由查看器按 id 补回）；text 仅为展示文本。
    function buildOverviewLogs(tradeId, reportDate, channels, channelLogGroups) {
      const lines = [];
      lines.push({ scope: 'item', channelId: null, sourceId: null, field: null, text: '2024-08-14 10:23:00.100 INFO  开始比较 item=' + tradeId + '，报告日期=' + reportDate });
      lines.push({ scope: 'item', channelId: null, sourceId: null, field: null, text: '2024-08-14 10:23:00.120 INFO  加载映射配置 mapping.xlsx（' + channels.length + ' 个报告渠道）' });
      lines.push({ scope: 'item', channelId: null, sourceId: null, field: null, text: '2024-08-14 10:23:00.140 INFO  初始化逐渠道执行器（' + channels.map(function (c) { return c.name; }).join(' / ') + '）' });
      for (let i = 0; i < 60; i++) {
        const ms = String(100 + i * 7).padStart(3, '0').slice(-3);
        const ch = channels[i % channels.length];
        lines.push({ scope: 'channel', channelId: ch.id, sourceId: null, field: null, text: '2024-08-14 10:23:' + String(i).padStart(2, '0') + '.' + ms + ' INFO  [' + ch.name + '] 执行字段比较步骤 ' + (i + 1) + '：读取 ' + fileEntryName(ch.files.eo[0]) + ' 与 ' + fileEntryName(ch.files.ao[0]) + '，逐字段校验映射关系。' });
      }
      lines.push({ scope: 'item', channelId: null, sourceId: null, field: null, text: '2024-08-14 10:24:00.000 INFO  比较完成，结果已生成' });
      // 按渠道追加：先该渠道自身的日志（scope=channel），再该渠道各字段关联的日志行（scope=field）。
      (channelLogGroups || []).forEach(function (g) {
        (g.logs || []).forEach(function (l) { lines.push(l); });
        (g.fieldLogs || []).forEach(function (l) { lines.push(l); });
      });
      return lines;
    }

    // 每个 item 的 ctxKey 定义：**定义只写一次**（hoistRegistries 会把 type / rules / def 提到
    // 顶层 `usedCtxKeyDefs`，item 内只留 `{ id, hits }`），hits（命中数）与 item 绑定。
    // rules 为规则名数组：fdm 字段映射规则 / cvt 值转换规则 / vdt 终值校验规则。
    function buildCtxDefs(itemIndex) {
      const seed = itemIndex || 0;
      const defs = {};
      const idByKey = {};
      let nextId = 1;
      const add = function (key, rules, type, defText, hitsText) {
        defs[key] = { id: nextId, rules: rules, type: type, def: defText, hits: hitsText };
        idByKey[key] = nextId;
        nextId++;
      };
      CHANNELS.forEach(function (ch) {
        const p = ch.name.toLowerCase();
        // rules: fdm（字段映射规则）
        add(p + '.ctx.default', ['fdm'], 'builtin', ch.name + ' 默认上下文（标准报送场景）', '命中 ' + (3 + seed % 3) + ' 个映射条目（EO 2 / AO 1）');
        add(p + '.ctx.v2', ['fdm'], 'builtin', ch.name + ' v2 上下文（2024 新版映射）', '命中 ' + (2 + seed % 2) + ' 个映射条目（EO 1 / AO 1）');
        add(p + '.ctx.v3', ['fdm'], 'builtin', ch.name + ' v3 上下文（最新版映射）', '命中 ' + (1 + seed % 2) + ' 个映射条目（EO 1 / AO 0）');
        add(p + '.ctx.extended.production.region.east.v2024.latest', ['fdm'], 'user', ch.name + ' 扩展上下文（生产·东部区域·2024 最新）', '命中 ' + (4 + seed % 2) + ' 个映射条目（EO 2 / AO 2）');
        // rules: cvt（值转换规则）
        add(p + '.ctx.conv.default', ['cvt'], 'builtin', ch.name + ' 值转换默认上下文（EO 归一化）', '命中 ' + (2 + seed % 2) + ' 个转换规则（@trim / @toUpper 等）');
        add(p + '.ctx.conv.v2', ['cvt'], 'builtin', ch.name + ' 值转换 v2 上下文', '命中 ' + (1 + seed % 2) + ' 个转换规则');
        // rules: vdt（终值校验规则）
        add(p + '.ctx.val.default', ['vdt'], 'builtin', ch.name + ' 终值校验默认上下文', '命中 ' + (3 + seed % 3) + ' 个校验规则（枚举/正则/非空）');
        add(p + '.ctx.val.v2', ['vdt'], 'builtin', ch.name + ' 终值校验 v2 上下文', '命中 ' + (2 + seed % 2) + ' 个校验规则');
      });
      return { defs: defs, idByKey: idByKey };
    }

    // opts：
    //   itemCount    生成的 item 数量（默认 18）
    //   singleSource true 时全部 item 仅含 1 个来源渠道（默认仅最后一个 item 为单来源）
    function buildDataset(opts) {
      const rng = mulberry32(20240814);
      const singleSource = !!(opts && opts.singleSource);
      const itemCount = (opts && opts.itemCount > 0) ? Math.floor(opts.itemCount) : 18;
      const items = [];
      const platforms = ['OTC-PLATFORM-A', 'OTC-PLATFORM-B', 'OTC-PLATFORM-C'];
      for (let i = 0; i < itemCount; i++) {
        const tradeId = 'T-20240814-' + String(1001 + i);
        const reportDate = '2024-08-' + String(10 + Math.floor(i / 3)).padStart(2, '0');
        const generatedAt = '2024-08-14 10:23:0' + (i % 10) + '.000';
        const failRate = i === 0 ? 0 : (i === 2 ? 0.85 : 0.18);
        const platform = platforms[i % platforms.length];
        const cats = PLATFORM_CATEGORIES[platform] || Object.keys(PRODUCT_CATEGORIES);
        const productCategory = cats[i % cats.length];
        const subProducts = PRODUCT_CATEGORIES[productCategory].sub;
        const product = subProducts[Math.floor(rng() * subProducts.length)];
        const counterpartyItemId = (Math.floor(i / 2) === 5) ? '' : (i % 2 === 0 ? 'T-20240814-' + String(1002 + i) : 'T-20240814-' + String(1000 + i));

        // 默认：最后一个 item 仅含 1 个来源渠道（演示单一来源渠道场景）；singleSource 模式下全部 item 均为单来源。
        const sourceCount = singleSource ? 1 : (i === itemCount - 1 ? 1 : 2);
        // 启用渠道：三分之一样本启用全部渠道，其余只启用其中两个（用于验证「启用口径」在各处一致）。
        const enabledNames = (i % 3 === 0) ? ['HKTR', 'JSFA', 'CFTC'] : (i % 3 === 1 ? ['HKTR', 'JSFA'] : ['HKTR', 'CFTC']);

        const channels = [];
        const warnings = [];
        const errors = [];
        const uncompared = [];
        const channelLogGroups = [];
        const ctxDefsRes = buildCtxDefs(i);
        const idByKey = ctxDefsRes.idByKey;
        CHANNELS.forEach(function (ch) {
          const fieldsDef = fieldDefsForItem(i, ch);
          // 启用口径：只写 channels[].enabled（历史上的 item.enabledChannels 名单已彻底移除）。
          const enabled = enabledNames.indexOf(ch.name) !== -1;
          const built = buildChannelData(ch, tradeId, reportDate, rng, failRate, fieldsDef, sourceCount, idByKey, enabled);
          channels.push(built.channel);
          warnings.push.apply(warnings, built.warnings);
          errors.push.apply(errors, built.errors);
          uncompared.push.apply(uncompared, built.uncompared);
          channelLogGroups.push({ logs: built.logs, fieldLogs: built.fieldLogs });
        });
        uncompared.push.apply(uncompared, buildGlobalUncompared(rng));

        items.push({
          tradeId: tradeId,
          reportDate: reportDate,
          generatedAt: generatedAt,
          platform: platform,
          product: product,
          productCategory: productCategory,
          counterpartyItemId: counterpartyItemId,
          platformOriTradeId: 'PT-' + tradeId.slice(2),
          platformOriTradeDealId: 'PD-' + tradeId.slice(2),
          ctxDefs: ctxDefsRes.defs,
          channels: channels,
          warnings: warnings,
          errors: errors,
          uncompared: uncompared,
          logs: buildOverviewLogs(tradeId, reportDate, channels, channelLogGroups),
        });
      }
      // 归一化输出形态：渠道 / 来源渠道的定义提到顶层登记表（channels / sources），
      // item 里只留 id 引用（见 docs/DATA_SCHEMA.md §1）；查看器加载时用 hydrateDataset() 补回名称。
      return hoistRegistries({
        mode: 'single', reportEnv: 'OTCXXX', creationType: 'sample',
        skippedItems: buildSkippedItems(rng), items: items,
      });
    }


    function fileEntryName(v) {
      if (v && typeof v === 'object') return v.name != null ? String(v.name) : '';
      return String(v == null ? '' : v);
    }

    // 计算单个 item 的统计摘要（多文件模式清单元数据使用）。
    // 口径与查看器完全共享（public/core.js itemStatsPure）：只统计启用渠道
    //（channels[].enabled），消息按作用域过滤——否则侧栏卡片会与字段表条数不一致。
    function itemStats(item) {
      return itemStatsPure(item, null);
    }

    // 将单文件数据集拆分为多文件模式：
    // 在 outDir 写入 <manifestName>（默认 report-validation-data.json）与 data/items/<tradeId>.json。
    // 多文件模式下主数据与默认模板数据都是清单，因此需要能指定清单文件名（否则 defaultDataMode=default 时缺文件）。
    // opts.pretty：输出缩进版（默认紧凑，见 lib/json-write.js；缩进会让文件大 40%+）。
    function splitToFiles(dataset, outDir, manifestName, opts) {
      const name = manifestName || 'report-validation-data.json';
      const itemsDir = path.join(outDir, 'data', 'items');
      fs.mkdirSync(itemsDir, { recursive: true });
      const manifestItems = (dataset.items || []).map(function (it) {
        const file = 'data/items/' + it.tradeId + '.json';
        writeJSON(path.join(outDir, file), it, opts);
        return {
          tradeId: it.tradeId,
          reportDate: it.reportDate,
          generatedAt: it.generatedAt,
          platform: it.platform,
          product: it.product,
          productCategory: it.productCategory,
          counterpartyItemId: it.counterpartyItemId,
          platformOriTradeId: it.platformOriTradeId,
          platformOriTradeDealId: it.platformOriTradeDealId,
          file: file,
          summary: itemStats(it),
        };
      });
      // 清单与单文件模式保留同一套顶层字段：三张声明表（reportChannelDefs / sourceChannelDefs /
      // usedCtxKeyDefs）必须一并写入，否则 item 文件里的 id 引用无从解析（见 docs/DATA_SCHEMA.md §2）。
      // 键顺序固定为 `…声明表 → usedCtxKeyDefs → skippedItems → items`。
      // 健壮性：调用方可能只传 items（例如按切片写批次）。此时若 item 里还残留定义（老形态），
      // 先补出声明表，避免写出的清单缺声明（id-only 的 item 无法反推定义，只能由调用方传入）。
      const hasItemDefs = (dataset.items || []).some(function (it) {
        return (it.channels || []).some(function (ch) { return ch.name != null || ch.desc != null || ch.format != null; });
      });
      let declaredChannels = dataset.reportChannelDefs;
      let declaredSources = dataset.sourceChannelDefs;
      let declaredCtx = dataset.usedCtxKeyDefs;
      if ((declaredChannels == null || declaredSources == null || declaredCtx == null) && hasItemDefs) {
        const probe = hoistRegistries({
          skippedItems: dataset.skippedItems,
          items: (dataset.items || []).map(function (it) {
            return { tradeId: it.tradeId, channels: it.channels, ctxDefs: it.ctxDefs };
          }),
        });
        if (declaredChannels == null) declaredChannels = probe.reportChannelDefs;
        if (declaredSources == null) declaredSources = probe.sourceChannelDefs;
        if (declaredCtx == null) declaredCtx = probe.usedCtxKeyDefs;
      }
      const manifest = {
        mode: 'multi', reportEnv: dataset.reportEnv, creationType: dataset.creationType || 'sample',
        reportChannelDefs: declaredChannels, sourceChannelDefs: declaredSources, usedCtxKeyDefs: declaredCtx,
        skippedItems: dataset.skippedItems,
        items: manifestItems,
      };
      writeJSON(path.join(outDir, name), manifest, opts);
      return manifest;
    }

    export { buildDataset, splitToFiles };
