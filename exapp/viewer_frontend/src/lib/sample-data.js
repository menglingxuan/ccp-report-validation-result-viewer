// 样例数据生成器（从原 HTML 内联脚本抽离，供工具与测试使用，不进入浏览器运行时）
// 生成单文件数据集 buildDataset()，以及多文件模式 splitToFiles()。
import fs from 'node:fs';
import path from 'node:path';

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
    // 平台 -> 可用的产品类别（用于平台/产品联动）
    const PLATFORM_CATEGORIES = {
      'OTC-PLATFORM-A': ['IR', 'CD'],
      'OTC-PLATFORM-B': ['IR', 'FX'],
      'OTC-PLATFORM-C': ['CD', 'FX'],
    };

    // 运行环境默认值（当批次索引与数据 JSON 均未提供 reportEnv 时使用）
    const DEFAULT_ENV = 'UNKNOWN';
    // 本次比较任务的说明文本（多行）
    const TASK_NOTE = '本次比较任务说明：\n1. 校验多渠道来源数据与监管报送数据的一致性。\n2. 验证配置驱动映射（Excel）与命中上下文逻辑。\n3. 回归测试多行字段与特殊字符的展示效果。';

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

    function buildMessages(level, rng, channelName, fieldsDef, platform, product) {
      const count = 2 + Math.floor(rng() * 4);
      const pool = level === 'warning' ? WARN_TEXTS : ERR_TEXTS;
      const typeKeys = level === 'error' ? Object.keys(ERROR_TYPE_META) : Object.keys(TYPE_META);
      const levelPool = level === 'warning' ? ['WARN', 'INFO', 'NOTICE', 'DEBUG'] : ['ERROR', 'FATAL', 'SEVERE'];
      const msgs = [];
      for (let i = 0; i < count; i++) {
        const base = pool[Math.floor(rng() * pool.length)];
        const text = rng() < 0.2
          ? base + '\n详情：该字段的映射配置可能缺失或与当前 context 不匹配。\n建议检查映射表对应 sheet 的配置，确认 XPath 与命中的 context 是否正确，并核对字段类型。'
          : base;
        msgs.push({
          channel: channelName,
          platform: platform,
          product: product,
          type: typeKeys[Math.floor(rng() * typeKeys.length)],
          level: levelPool[Math.floor(rng() * levelPool.length)],
          text: text,
          field: rng() < 0.8 ? fieldsDef[Math.floor(rng() * fieldsDef.length)][0] : '',
        });
      }
      return msgs;
    }

    function buildChannelUncompared(channelName, rng, fieldsDef, platform, product) {
      const list = [];
      const n = Math.floor(rng() * 2);
      const ctxPool = [channelName.toLowerCase() + '.ctx.default', channelName.toLowerCase() + '.ctx.v2', channelName.toLowerCase() + '.ctx.v3'];
      for (let i = 0; i < n; i++) {
        const d = fieldsDef[Math.floor(rng() * fieldsDef.length)];
        const note = rng() < 0.35
          ? '未在映射配置中匹配到对应 CSV 字段\n详情：Excel 映射配置中未找到与该 XPath 对应的条目，可能因 context 定义变化导致。\n请检查映射表并确认该 XPath 是否仍需要参与比较。'
          : '未在映射配置中匹配到对应 CSV 字段';
        list.push({ channel: channelName, xpath: d[1], note: note, platform: platform, product: product, ctx: ctxPool[Math.floor(rng() * ctxPool.length)] });
      }
      return list;
    }

    function buildChannelUncomparedCsv(channelName, rng, fieldsDef, platform, product) {
      const list = [];
      const n = Math.floor(rng() * 2);
      const ctxPool = [channelName.toLowerCase() + '.ctx.default', channelName.toLowerCase() + '.ctx.v2', channelName.toLowerCase() + '.ctx.v3'];
      for (let i = 0; i < n; i++) {
        const d = fieldsDef[Math.floor(rng() * fieldsDef.length)];
        const note = rng() < 0.35
          ? '未在映射配置中匹配到对应来源字段\n详情：Excel 映射配置中未找到与该 AO CSV 字段对应的条目，可能因 context 定义变化导致。\n请检查映射表并确认该 CSV 字段是否仍需要参与比较。'
          : '未在映射配置中匹配到对应来源字段';
        list.push({ channel: channelName, csvField: d[1], note: note, platform: platform, product: product, ctx: ctxPool[Math.floor(rng() * ctxPool.length)] });
      }
      return list;
    }

    function buildChannelLogs(ch, tradeId) {
      const t = '2024-08-14 10:23:0';
      return [
        t + '0.200 INFO  [' + ch.name + '] 读取报送文件 ' + ch.files.ao.map(fileEntryName).join(', '),
        t + '0.300 INFO  [' + ch.name + '] 应用映射配置 ' + ch.files.excel.file + ' [sheet: ' + ch.files.excel.sheet + ']',
        t + '0.400 INFO  [' + ch.name + '] 完成字段比较，渠道结果已生成',
      ];
    }

    function buildPrints(f, target, ctx, chName, srcName, eo, ao, result, note, targetName) {
      return [
        '[INFO] 比较字段 ' + f + '（报告渠道 ' + chName + ' / ' + srcName + '）',
        '[INFO] ' + targetName + '=' + target + '，命中Ctx=' + (Array.isArray(ctx) ? ctx.join(',') : ctx),
        '[INFO] EO=' + eo + '，AO=' + ao + ' → ' + result + (note ? '（' + note + '）' : ''),
      ];
    }

    function buildChannelData(ch, tradeId, reportDate, rng, failRate, platform, product) {
      const fieldsDef = FIELD_DEFS[ch.name];
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
      const sources = [1, 2].map(sn => {
        const fields = fieldsDef.map(([f, rawTarget, t, k], idx) => {
          const x = isCsv ? '' : rawTarget;
          const aoCsv = isCsv ? rawTarget : '';
          const eo = genValue(k, rng);
          const failed = rng() < failRate;
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
          const validationRule = rng() < 0.75 ? { ctx: pickCtx(valPool, rng), value: valRuleFor(k, rng) } : null;
          const isExcelSample = tradeId === 'T-20240814-1001' && ch.name === 'HKTR' && idx === 0;
          const excelMapping = genExcelMapping(isCsv ? aoCsv : x, ctx, isExcelSample);
          const excelConversionRule = genExcelRuleText(conversionRule ? conversionRule.value : null, ctx, isExcelSample);
          const excelValidationRule = genExcelRuleText(validationRule ? validationRule.value : null, ctx, isExcelSample);
          const extraResults = [];
          if (eoConverted && eoUnconverted != null) extraResults.push({ label: '期望值 (EO, Unconverted)', value: eoUnconverted });
          return {
            id: ch.name + '-' + sn + '-' + idx,
            f: f, x: x, aoCsv: aoCsv, t: t, k: k, ctx: ctx,
            eo: eo, ao: ao,
            result: result, note: note, resultNote: resultNote,
            eoConverted: eoConverted, eoUnconverted: eoUnconverted,
            extraResults: extraResults,
            conversionRule: conversionRule, validationRule: validationRule,
            excelMapping: excelMapping, excelConversionRule: excelConversionRule, excelValidationRule: excelValidationRule,
            prints: buildPrints(f, isCsv ? aoCsv : x, ctx, ch.name, '来源渠道 ' + (sn === 1 ? 'A' : 'B'), eo, ao, result, note, isCsv ? 'CSV字段' : 'XPath'),
          };
        });
        return { name: '来源渠道 ' + (sn === 1 ? 'A' : 'B'), fields: fields };
      });

      const aoExt = isCsv ? '.csv' : '.xml';
      const eoNameA = ch.name.toLowerCase() + '_srcA_' + tradeId + '.csv';
      const eoNameB = ch.name.toLowerCase() + '_srcB_' + tradeId + '.csv';
      const aoNameA = ch.name.toUpperCase() + '_' + tradeId + '_001' + aoExt;
      const aoNameB = ch.name.toUpperCase() + '_' + tradeId + '_002' + aoExt;
      const files = {
        eo: [
          { name: eoNameA, path: 'data/eo/' + eoNameA },
          { name: eoNameB, path: 'data/eo/' + eoNameB },
        ],
        ao: [
          { name: aoNameA, path: 'data/ao/' + aoNameA },
          { name: aoNameB, path: 'data/ao/' + aoNameB },
        ],
        excel: { file: 'mapping.xlsx', sheet: ch.name, path: 'data/excel/mapping.xlsx' },
      };

      return {
        name: ch.name, desc: ch.desc, format: ch.format, files: files, sources: sources,
        warnings: buildMessages('warning', rng, ch.name, fieldsDef, platform, product),
        errors: buildMessages('error', rng, ch.name, fieldsDef, platform, product),
        uncompared: isCsv ? [] : buildChannelUncompared(ch.name, rng, fieldsDef, platform, product),
        uncomparedCsv: isCsv ? buildChannelUncomparedCsv(ch.name, rng, fieldsDef, platform, product) : [],
        logs: buildChannelLogs({ name: ch.name, files: files }, tradeId),
      };
    }

    function buildSkippedItems(reportDate, rng) {
      const list = [];
      const n = 1 + Math.floor(rng() * 3);
      const chNames = ['HKTR', 'JSFA', 'CFTC'];
      for (let i = 0; i < n; i++) {
        const withChannel = rng() < 0.55;
        const ch = withChannel ? chNames[Math.floor(rng() * chNames.length)] : 'ALL';
        const itemId = 'T-' + reportDate.replace(/-/g, '') + '-0' + (91 + i);
        let reason;
        if (ch === 'ALL') reason = '未在任一报告渠道中找到对应记录，该 item 未能参与比较。';
        else reason = '在 ' + ch + ' 渠道中未找到该 item 的对应记录，已跳过该渠道的比较。';
        if (rng() < 0.35) reason += '\n详情：该 item 在来源 CSV 与报送 XML 中均未出现对应记录，可能因数据采集或报送延迟导致。\n建议核对上游系统是否已产生该 item 的数据。';
        list.push({ itemId: itemId, channel: ch, reason: reason });
      }
      return list;
    }

    function buildOverviewLogs(tradeId, reportDate, channels) {
      const lines = [];
      lines.push('2024-08-14 10:23:00.100 INFO  开始比较 item=' + tradeId + '，报告日期=' + reportDate);
      lines.push('2024-08-14 10:23:00.120 INFO  加载映射配置 mapping.xlsx（' + channels.length + ' 个报告渠道）');
      lines.push('2024-08-14 10:23:00.140 INFO  初始化逐渠道执行器（HKTR / JSFA / CFTC）');
      for (let i = 0; i < 60; i++) {
        const ms = String(100 + i * 7).padStart(3, '0').slice(-3);
        const ch = channels[i % channels.length];
        lines.push('2024-08-14 10:23:' + String(i).padStart(2, '0') + '.' + ms + ' INFO  [' + ch.name + '] 执行字段比较步骤 ' + (i + 1) + '：读取 ' + fileEntryName(ch.files.eo[0]) + ' 与 ' + fileEntryName(ch.files.ao[0]) + '，逐字段校验映射关系。');
      }
      lines.push('2024-08-14 10:24:00.000 INFO  比较完成，结果已生成');
      return lines;
    }

    // 每个 item 的 ctx 定义（def/hits/type）与 item 绑定，而非全局共享。
    // type 为数组：1 字段映射规则 / 2 值转换规则 / 3 终值校验规则（一个 ctx key 可配置在多种规则中）。
    function buildCtxDefs(itemIndex) {
      const seed = itemIndex || 0;
      const defs = {};
      CHANNELS.forEach(function (ch) {
        const p = ch.name.toLowerCase();
        // type 1：字段映射规则
        defs[p + '.ctx.default'] = { type: [1], def: ch.name + ' 默认上下文（标准报送场景）', hits: '命中 ' + (3 + seed % 3) + ' 个映射条目（EO 2 / AO 1）' };
        defs[p + '.ctx.v2'] = { type: [1], def: ch.name + ' v2 上下文（2024 新版映射）', hits: '命中 ' + (2 + seed % 2) + ' 个映射条目（EO 1 / AO 1）' };
        defs[p + '.ctx.v3'] = { type: [1], def: ch.name + ' v3 上下文（最新版映射）', hits: '命中 ' + (1 + seed % 2) + ' 个映射条目（EO 1 / AO 0）' };
        defs[p + '.ctx.extended.production.region.east.v2024.latest'] = { type: [1], def: ch.name + ' 扩展上下文（生产·东部区域·2024 最新）', hits: '命中 ' + (4 + seed % 2) + ' 个映射条目（EO 2 / AO 2）' };
        // type 2：值转换规则
        defs[p + '.ctx.conv.default'] = { type: [2], def: ch.name + ' 值转换默认上下文（EO 归一化）', hits: '命中 ' + (2 + seed % 2) + ' 个转换规则（@trim / @toUpper 等）' };
        defs[p + '.ctx.conv.v2'] = { type: [2], def: ch.name + ' 值转换 v2 上下文', hits: '命中 ' + (1 + seed % 2) + ' 个转换规则' };
        // type 3：终值校验规则
        defs[p + '.ctx.val.default'] = { type: [3], def: ch.name + ' 终值校验默认上下文', hits: '命中 ' + (3 + seed % 3) + ' 个校验规则（枚举/正则/非空）' };
        defs[p + '.ctx.val.v2'] = { type: [3], def: ch.name + ' 终值校验 v2 上下文', hits: '命中 ' + (2 + seed % 2) + ' 个校验规则' };
      });
      return defs;
    }

    function buildDataset() {
      const rng = mulberry32(20240814);
      const items = [];
      const platforms = ['OTC-PLATFORM-A', 'OTC-PLATFORM-B', 'OTC-PLATFORM-C'];
      for (let i = 0; i < 18; i++) {
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
        const channels = CHANNELS.map(ch => buildChannelData(ch, tradeId, reportDate, rng, failRate, platform, product));
        items.push({
          tradeId: tradeId,
          reportDate: reportDate,
          generatedAt: generatedAt,
          platform: platform,
          product: product,
          productCategory: productCategory,
          counterpartyItemId: counterpartyItemId,
          platformTradeId: 'PT-' + tradeId.slice(2),
          platformDealId: 'PD-' + tradeId.slice(2),
          ctxDefs: buildCtxDefs(i),
          channels: channels,
          enabledChannels: (i % 3 === 0) ? ['HKTR', 'JSFA', 'CFTC'] : (i % 3 === 1 ? ['HKTR', 'JSFA'] : ['HKTR', 'CFTC']),
          skippedItems: buildSkippedItems(reportDate, rng),
          overviewLogs: buildOverviewLogs(tradeId, reportDate, channels),
        });
      }
      return { mode: 'single', items: items, reportEnv: 'OTCXXX' };
    }


    function fileEntryName(v) {
      if (v && typeof v === 'object') return v.name != null ? String(v.name) : '';
      return String(v == null ? '' : v);
    }

    // 计算单个 item 的统计摘要（多文件模式清单元数据使用）。
    function itemStats(item) {
      let total = 0, passed = 0, failed = 0;
      (item.channels || []).forEach(function (ch) {
        (ch.sources || []).forEach(function (s) {
          (s.fields || []).forEach(function (f) {
            total++;
            f.result === 'PASSED' ? passed++ : failed++;
          });
        });
      });
      const warnings = (item.channels || []).reduce(function (n, c) { return n + (c.warnings || []).length; }, 0);
      const errors = (item.channels || []).reduce(function (n, c) { return n + (c.errors || []).length; }, 0);
      const uncompared = (item.channels || []).reduce(function (n, c) { return n + (c.uncompared || []).length; }, 0);
      const logs = (item.overviewLogs || []).length + (item.channels || []).reduce(function (n, c) { return n + (c.logs || []).length; }, 0);
      return {
        total: total, passed: passed, failed: failed,
        rate: total ? Math.round(passed / total * 100) : 0,
        warnings: warnings, warningsIgnored: 0, errors: errors, uncompared: uncompared, logs: logs,
      };
    }

    // 将单文件数据集拆分为多文件模式：
    // 在 outDir 写入 report-validation-data.json（清单）与 data/items/<tradeId>.json（每个 item 一个文件）。
    function splitToFiles(dataset, outDir) {
      const itemsDir = path.join(outDir, 'data', 'items');
      fs.mkdirSync(itemsDir, { recursive: true });
      const manifestItems = (dataset.items || []).map(function (it) {
        const file = 'data/items/' + it.tradeId + '.json';
        fs.writeFileSync(path.join(outDir, file), JSON.stringify(it, null, 2));
        return {
          tradeId: it.tradeId,
          reportDate: it.reportDate,
          generatedAt: it.generatedAt,
          platform: it.platform,
          product: it.product,
          productCategory: it.productCategory,
          counterpartyItemId: it.counterpartyItemId,
          platformTradeId: it.platformTradeId,
          platformDealId: it.platformDealId,
          enabledChannels: it.enabledChannels,
          file: file,
          summary: itemStats(it),
        };
      });
      const manifest = { mode: 'multi', reportEnv: dataset.reportEnv, items: manifestItems };
      fs.writeFileSync(path.join(outDir, 'report-validation-data.json'), JSON.stringify(manifest, null, 2));
      return manifest;
    }

    export { buildDataset, buildCtxDefs, splitToFiles, itemStats };
