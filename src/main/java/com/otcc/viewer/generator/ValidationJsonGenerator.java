package com.otcc.viewer.generator;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.otcc.viewer.model.BatchEntry;
import com.otcc.viewer.model.BatchIndex;
import com.otcc.viewer.model.BatchMeta;
import com.otcc.viewer.model.Channel;
import com.otcc.viewer.model.ChannelFiles;
import com.otcc.viewer.model.CtxDef;
import com.otcc.viewer.model.CtxRule;
import com.otcc.viewer.model.ExcelFile;
import com.otcc.viewer.model.ExtraResult;
import com.otcc.viewer.model.Field;
import com.otcc.viewer.model.FileEntry;
import com.otcc.viewer.model.IgnoreWarning;
import com.otcc.viewer.model.Message;
import com.otcc.viewer.model.PlatformIgnore;
import com.otcc.viewer.model.SkippedItem;
import com.otcc.viewer.model.Source;
import com.otcc.viewer.model.UncomparedEntry;
import com.otcc.viewer.model.ValidationConfig;
import com.otcc.viewer.model.ValidationDataset;
import com.otcc.viewer.model.ValidationItem;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * Reverse-engineered generator that produces the JSON files consumed by the
 * {@code deepseek-validation-result.html} viewer (data / config / ignore / batch index / batch meta).
 *
 * <p>The structure mirrors the HTML's internal {@code buildDataset()} generator and the
 * {@code scan-batches.js} / {@code config.schema.json} contracts, serialized with Jackson.</p>
 */
public final class ValidationJsonGenerator {

    private ValidationJsonGenerator() {
    }

    /** Shared mapper: pretty output, keep nulls (like JSON.stringify), tolerant reads. */
    public static final ObjectMapper MAPPER = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT)
            .setSerializationInclusion(JsonInclude.Include.ALWAYS)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);

    public static final String[] CHANNEL_NAMES = {"HKTR", "JSFA", "CFTC"};
    public static final String[] PLATFORMS = {"OTC-PLATFORM-A", "OTC-PLATFORM-B", "OTC-PLATFORM-C"};
    public static final String[] PRODUCT_CATEGORIES = {"IR", "CD", "FX"};

    private static final Map<String, String> CHANNEL_DESC = Map.of(
            "HKTR", "香港交易资料储存库",
            "JSFA", "日本金融厅",
            "CFTC", "美国商品期货交易委员会");
    private static final Map<String, String> CHANNEL_FORMAT = Map.of(
            "HKTR", "xml", "JSFA", "xml", "CFTC", "csv");

    private static final String[] TYPE_KEYS = {"platformAssertion", "productAssertion", "contextAssertion"};
    private static final String[] ERROR_TYPE_KEYS = {"xpathError", "conversionError", "mappingError", "runtimeError", "bufferError"};
    private static final String[] WARN_LEVELS = {"WARN", "INFO", "NOTICE", "DEBUG"};
    private static final String[] ERR_LEVELS = {"ERROR", "FATAL", "SEVERE"};

    private static final String MULTI_TEXT =
            "第一行备注：交易双方已确认条款，包含特殊字符 <PartyRole id=\"P1\"> & \"quote\" & 'single'。</PartyRole>\n"
                    + "第二行备注：本字段可能包含较长内容，用于验证多行与特殊字符的展示效果。\n"
                    + "第三行备注：配置驱动比较，命中上下文后取得字段对应关系。";

    /** Channel field definitions: {field, target(XPath or CSV field), assertion type, value kind}. */
    private static final Map<String, List<String[]>> FIELD_DEFS = Map.of(
            "HKTR", List.of(
                    new String[]{"tradeId", "/HKTR/Report/Header/TradeDetails/TradeIdentifier/TradeId", "contextAssertion", "id"},
                    new String[]{"reportId", "/HKTR/Report/Header/ReportDetails/ReportIdentifier/ReportId", "contextAssertion", "id"},
                    new String[]{"product", "/HKTR/Report/Product/ProductDetails/ProductIdentifier", "productAssertion", "product"},
                    new String[]{"notional", "/HKTR/Report/Notional/AmountDetails/NotionalValue", "productAssertion", "num"},
                    new String[]{"currency", "/HKTR/Report/Notional/AmountDetails/CurrencyCode", "productAssertion", "code"},
                    new String[]{"tradeDate", "/HKTR/Report/Header/TradeDetails/TradeDate", "contextAssertion", "date"},
                    new String[]{"maturityDate", "/HKTR/Report/Header/TradeDetails/MaturityDate", "contextAssertion", "date"},
                    new String[]{"counterparty", "/HKTR/Report/Counterparty/PartyDetails/PartyName", "contextAssertion", "text"},
                    new String[]{"platform", "/HKTR/Report/Execution/PlatformDetails/PlatformIdentifier", "platformAssertion", "text"},
                    new String[]{"venue", "/HKTR/Report/Execution/VenueDetails/VenueIdentifier", "platformAssertion", "text"},
                    new String[]{"price", "/HKTR/Report/Pricing/PriceDetails/PriceValue", "productAssertion", "num"},
                    new String[]{"quantity", "/HKTR/Report/Pricing/QuantityDetails/QuantityValue", "productAssertion", "num"},
                    new String[]{"remarks", "/HKTR/Report/Header/AdditionalInformation/Remarks", "contextAssertion", "multi"}),
            "JSFA", List.of(
                    new String[]{"tradeId", "/JSFA/Report/Header/TransactionDetails/TradeIdentifier/TradeId", "contextAssertion", "id"},
                    new String[]{"reportId", "/JSFA/Report/Header/ReportDetails/ReportIdentifier/ReportId", "contextAssertion", "id"},
                    new String[]{"product", "/JSFA/Report/Product/ProductDetails/ProductIdentifier", "productAssertion", "product"},
                    new String[]{"notional", "/JSFA/Report/Notional/AmountDetails/NotionalValue", "productAssertion", "num"},
                    new String[]{"currency", "/JSFA/Report/Notional/AmountDetails/CurrencyCode", "productAssertion", "code"},
                    new String[]{"tradeDate", "/JSFA/Report/Header/TransactionDetails/TradeDate", "contextAssertion", "date"},
                    new String[]{"settlementDate", "/JSFA/Report/Header/SettlementDetails/SettlementDate", "contextAssertion", "date"},
                    new String[]{"counterparty", "/JSFA/Report/Counterparty/PartyDetails/PartyName", "contextAssertion", "text"},
                    new String[]{"platform", "/JSFA/Report/Execution/PlatformDetails/PlatformIdentifier", "platformAssertion", "text"},
                    new String[]{"venue", "/JSFA/Report/Execution/VenueDetails/VenueIdentifier", "platformAssertion", "text"},
                    new String[]{"price", "/JSFA/Report/Pricing/PriceDetails/PriceValue", "productAssertion", "num"},
                    new String[]{"quantity", "/JSFA/Report/Pricing/QuantityDetails/QuantityValue", "productAssertion", "num"},
                    new String[]{"remarks", "/JSFA/Report/Header/AdditionalInformation/Remarks", "contextAssertion", "multi"}),
            "CFTC", List.of(
                    new String[]{"tradeId", "trade_id", "contextAssertion", "id"},
                    new String[]{"reportId", "report_id", "contextAssertion", "id"},
                    new String[]{"product", "product_code", "productAssertion", "product"},
                    new String[]{"notional", "notional_amount", "productAssertion", "num"},
                    new String[]{"currency", "ccy", "productAssertion", "code"},
                    new String[]{"tradeDate", "exec_timestamp", "contextAssertion", "date"},
                    new String[]{"maturityDate", "expiration_date", "contextAssertion", "date"},
                    new String[]{"counterparty", "cp_name", "contextAssertion", "text"},
                    new String[]{"platform", "platform_id", "platformAssertion", "text"},
                    new String[]{"venue", "venue_id", "platformAssertion", "text"},
                    new String[]{"price", "price_amt", "productAssertion", "num"},
                    new String[]{"quantity", "qty", "productAssertion", "num"},
                    new String[]{"remarks", "remarks", "contextAssertion", "multi"}));

    private static final String[] WARN_TEXTS = {
            "配置映射缺失：CSV 字段未找到对应 XPath，已跳过",
            "字段格式与映射配置不一致，使用默认校验规则",
            "日期格式异常，已自动规范化处理",
            "空值处理：期望值为空，按容错策略判定通过",
            "关键字段重复，仅保留首条记录"};

    private static final String[] ERR_TEXTS = {
            "XPath 解析失败：节点不存在",
            "类型转换异常：无法转换为数值",
            "映射配置错误：XPath 语法非法",
            "运行时异常：字段比较过程被中断",
            "日志缓冲达到上限，部分日志被丢弃"};

    /* ------------------------------------------------------------------ */
    /*  Dataset                                                           */
    /* ------------------------------------------------------------------ */

    public static ValidationDataset generateDataset(long seed) {
        Random rng = new Random(seed);
        List<ValidationItem> items = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            items.add(generateItem(rng, i));
        }
        return ValidationDataset.builder()
                .items(items)
                .ctxDefs(generateCtxDefs())
                .build();
    }

    private static ValidationItem generateItem(Random rng, int index) {
        String tradeId = "T-20240814-100" + (1 + index);
        String reportDate = "2024-08-" + (10 + index);
        double failRate = index == 0 ? 0.0 : (index == 2 ? 0.85 : 0.18);
        String platform = PLATFORMS[index % PLATFORMS.length];
        String productCategory = PRODUCT_CATEGORIES[index % PRODUCT_CATEGORIES.length];
        String product = pickProduct(productCategory, rng);
        String counterpartyItemId = (index == 2) ? "" : ("T-20240814-" + (1000 + index));

        List<Channel> channels = new ArrayList<>();
        for (String name : CHANNEL_NAMES) {
            channels.add(generateChannel(name, tradeId, reportDate, rng, failRate, platform, product));
        }

        List<String> enabledChannels = switch (index) {
            case 0 -> List.of("HKTR", "JSFA", "CFTC");
            case 1 -> List.of("HKTR", "JSFA");
            default -> List.of("HKTR", "CFTC");
        };

        return ValidationItem.builder()
                .tradeId(tradeId)
                .reportDate(reportDate)
                .generatedAt("2024-08-14 10:23:0" + index + ".000")
                .platform(platform)
                .product(product)
                .productCategory(productCategory)
                .counterpartyItemId(counterpartyItemId)
                .platformTradeId("PT-" + tradeId.substring(2))
                .platformDealId("PD-" + tradeId.substring(2))
                .enabledChannels(enabledChannels)
                .channels(channels)
                .skippedItems(generateSkippedItems(reportDate, rng))
                .overviewLogs(generateOverviewLogs(tradeId, reportDate, channels))
                .build();
    }

    private static Channel generateChannel(String name, String tradeId, String reportDate,
                                           Random rng, double failRate, String platform, String product) {
        boolean csv = "csv".equals(CHANNEL_FORMAT.get(name));
        List<String[]> defs = FIELD_DEFS.get(name);
        String ext = csv ? ".csv" : ".xml";

        List<Source> sources = new ArrayList<>();
        for (int sn = 1; sn <= 2; sn++) {
            List<Field> fields = new ArrayList<>();
            for (int idx = 0; idx < defs.size(); idx++) {
                fields.add(generateField(name, sn, idx, defs.get(idx), csv, tradeId, rng, failRate));
            }
            sources.add(Source.builder().name("来源渠道 " + (sn == 1 ? "A" : "B")).fields(fields).build());
        }

        String eoNameA = name.toLowerCase() + "_srcA_" + tradeId + ".csv";
        String eoNameB = name.toLowerCase() + "_srcB_" + tradeId + ".csv";
        String aoNameA = name.toUpperCase() + "_" + tradeId + "_001" + ext;
        String aoNameB = name.toUpperCase() + "_" + tradeId + "_002" + ext;

        ChannelFiles files = ChannelFiles.builder()
                .eo(List.of(
                        FileEntry.builder().name(eoNameA).path("data/eo/" + eoNameA).build(),
                        FileEntry.builder().name(eoNameB).path("data/eo/" + eoNameB).build()))
                .ao(List.of(
                        FileEntry.builder().name(aoNameA).path("data/ao/" + aoNameA).build(),
                        FileEntry.builder().name(aoNameB).path("data/ao/" + aoNameB).build()))
                .excel(ExcelFile.builder().file("mapping.xlsx").sheet(name).path("data/excel/mapping.xlsx").build())
                .build();

        return Channel.builder()
                .name(name)
                .desc(CHANNEL_DESC.get(name))
                .format(CHANNEL_FORMAT.get(name))
                .files(files)
                .sources(sources)
                .warnings(generateMessages(false, rng, name, defs, platform, product))
                .errors(generateMessages(true, rng, name, defs, platform, product))
                .uncompared(csv ? List.of() : generateUncompared(false, name, rng, defs, platform, product))
                .uncomparedCsv(csv ? generateUncompared(true, name, rng, defs, platform, product) : List.of())
                .logs(List.of(
                        "2024-08-14 10:23:00.200 INFO  [" + name + "] 读取报送文件 " + aoNameA + ", " + aoNameB,
                        "2024-08-14 10:23:00.300 INFO  [" + name + "] 应用映射配置 mapping.xlsx [sheet: " + name + "]",
                        "2024-08-14 10:23:00.400 INFO  [" + name + "] 完成字段比较，渠道结果已生成"))
                .build();
    }

    private static Field generateField(String chName, int sn, int idx, String[] def,
                                       boolean csv, String tradeId, Random rng, double failRate) {
        String f = def[0];
        String target = def[1];
        String t = def[2];
        String k = def[3];
        String x = csv ? "" : target;
        String aoCsv = csv ? target : "";

        String eo = genValue(k, rng);
        boolean failed = rng.nextDouble() < failRate;
        String ao = failed ? mutateValue(eo, k, rng) : eo;

        List<String> ctx = pickCtx(chName, rng);
        String result = failed ? "FAILED" : "PASSED";
        String note = failed ? noteFor(k) : "";

        boolean eoConverted = rng.nextDouble() < convProb(k);
        String eoUnconverted = eoConverted ? genUnconverted(eo, k) : null;
        CtxRule conversionRule = eoConverted
                ? CtxRule.builder().ctx(pickCtx(chName, rng)).value(convRuleFor(k, rng)).build()
                : null;
        CtxRule validationRule = rng.nextDouble() < 0.75
                ? CtxRule.builder().ctx(pickCtx(chName, rng)).value(valRuleFor(k, rng)).build()
                : null;

        boolean sample = "T-20240814-1001".equals(tradeId) && "HKTR".equals(chName) && idx == 0;
        String excelMapping = genExcelMapping(csv ? aoCsv : x, ctx, sample);
        String excelConversionRule = genExcelRuleText(conversionRule == null ? null : conversionRule.getValue(), ctx, sample);
        String excelValidationRule = genExcelRuleText(validationRule == null ? null : validationRule.getValue(), ctx, sample);

        List<ExtraResult> extraResults = new ArrayList<>();
        if (eoConverted && eoUnconverted != null) {
            extraResults.add(ExtraResult.builder().label("期望值 (EO, Unconverted)").value(eoUnconverted).build());
        }

        List<String> prints = List.of(
                "[INFO] 比较字段 " + f + "（报告渠道 " + chName + " / 来源渠道 " + (sn == 1 ? "A" : "B") + "）",
                "[INFO] " + (csv ? "CSV字段" : "XPath") + "=" + target + "，命中Ctx=" + String.join(",", ctx),
                "[INFO] EO=" + eo + "，AO=" + ao + " → " + result + (note.isEmpty() ? "" : "（" + note + "）"));

        return Field.builder()
                .id(chName + "-" + sn + "-" + idx)
                .f(f).x(x).aoCsv(aoCsv).t(t).k(k).ctx(ctx)
                .eo(eo).ao(ao).result(result).note(note)
                .eoConverted(eoConverted).eoUnconverted(eoUnconverted)
                .extraResults(extraResults)
                .conversionRule(conversionRule).validationRule(validationRule)
                .excelMapping(excelMapping)
                .excelConversionRule(excelConversionRule)
                .excelValidationRule(excelValidationRule)
                .prints(prints)
                .build();
    }

    private static List<Message> generateMessages(boolean error, Random rng, String chName,
                                                  List<String[]> defs, String platform, String product) {
        int count = 2 + rng.nextInt(3);
        String[] pool = error ? ERR_TEXTS : WARN_TEXTS;
        String[] typeKeys = error ? ERROR_TYPE_KEYS : TYPE_KEYS;
        String[] levels = error ? ERR_LEVELS : WARN_LEVELS;
        List<Message> msgs = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            msgs.add(Message.builder()
                    .channel(chName)
                    .platform(platform)
                    .product(product)
                    .type(typeKeys[rng.nextInt(typeKeys.length)])
                    .level(levels[rng.nextInt(levels.length)])
                    .text(pool[rng.nextInt(pool.length)])
                    .field(rng.nextDouble() < 0.8 ? defs.get(rng.nextInt(defs.size()))[0] : "")
                    .build());
        }
        return msgs;
    }

    private static List<UncomparedEntry> generateUncompared(boolean csv, String chName, Random rng,
                                                            List<String[]> defs, String platform, String product) {
        List<UncomparedEntry> list = new ArrayList<>();
        int n = rng.nextInt(2);
        List<String> ctxPool = ctxPool(chName);
        for (int i = 0; i < n; i++) {
            String target = defs.get(rng.nextInt(defs.size()))[1];
            list.add(UncomparedEntry.builder()
                    .channel(chName)
                    .xpath(csv ? null : target)
                    .csvField(csv ? target : null)
                    .note(csv ? "未在映射配置中匹配到对应来源字段" : "未在映射配置中匹配到对应 CSV 字段")
                    .platform(platform)
                    .product(product)
                    .ctx(ctxPool.get(rng.nextInt(ctxPool.size())))
                    .build());
        }
        return list;
    }

    private static List<SkippedItem> generateSkippedItems(String reportDate, Random rng) {
        List<SkippedItem> list = new ArrayList<>();
        int n = 1 + rng.nextInt(2);
        for (int i = 0; i < n; i++) {
            String ch = rng.nextDouble() < 0.55 ? CHANNEL_NAMES[rng.nextInt(CHANNEL_NAMES.length)] : "ALL";
            String reason = "ALL".equals(ch)
                    ? "未在任一报告渠道中找到对应记录，该 item 未能参与比较。"
                    : "在 " + ch + " 渠道中未找到该 item 的对应记录，已跳过该渠道的比较。";
            list.add(SkippedItem.builder()
                    .itemId("T-" + reportDate.replace("-", "") + "-0" + (91 + i))
                    .channel(ch)
                    .reason(reason)
                    .build());
        }
        return list;
    }

    private static List<String> generateOverviewLogs(String tradeId, String reportDate, List<Channel> channels) {
        List<String> lines = new ArrayList<>();
        lines.add("2024-08-14 10:23:00.100 INFO  开始比较 item=" + tradeId + "，报告日期=" + reportDate);
        lines.add("2024-08-14 10:23:00.120 INFO  加载映射配置 mapping.xlsx（" + channels.size() + " 个报告渠道）");
        lines.add("2024-08-14 10:23:00.140 INFO  初始化逐渠道执行器（HKTR / JSFA / CFTC）");
        for (int i = 0; i < 6; i++) {
            Channel ch = channels.get(i % channels.size());
            FileEntry eo = ch.getFiles().getEo().get(0);
            FileEntry ao = ch.getFiles().getAo().get(0);
            lines.add("2024-08-14 10:23:0" + i + ".100 INFO  [" + ch.getName() + "] 执行字段比较步骤 "
                    + (i + 1) + "：读取 " + eo.getName() + " 与 " + ao.getName() + "，逐字段校验映射关系。");
        }
        lines.add("2024-08-14 10:24:00.000 INFO  比较完成，结果已生成");
        return lines;
    }

    private static Map<String, CtxDef> generateCtxDefs() {
        Map<String, CtxDef> defs = new LinkedHashMap<>();
        for (String name : CHANNEL_NAMES) {
            String p = name.toLowerCase();
            defs.put(p + ".ctx.default", CtxDef.builder().def(name + " 默认上下文（标准报送场景）").hits("命中 3 个映射条目（EO 2 / AO 1）").build());
            defs.put(p + ".ctx.v2", CtxDef.builder().def(name + " v2 上下文（2024 新版映射）").hits("命中 2 个映射条目（EO 1 / AO 1）").build());
            defs.put(p + ".ctx.v3", CtxDef.builder().def(name + " v3 上下文（最新版映射）").hits("命中 1 个映射条目（EO 1 / AO 0）").build());
            defs.put(p + ".ctx.extended.production.region.east.v2024.latest",
                    CtxDef.builder().def(name + " 扩展上下文（生产·东部区域·2024 最新）").hits("命中 4 个映射条目（EO 2 / AO 2）").build());
        }
        return defs;
    }

    /* ------------------------------------------------------------------ */
    /*  Value helpers                                                     */
    /* ------------------------------------------------------------------ */

    private static List<String> ctxPool(String chName) {
        String p = chName.toLowerCase();
        return List.of(p + ".ctx.default", p + ".ctx.v2", p + ".ctx.v3",
                p + ".ctx.extended.production.region.east.v2024.latest");
    }

    private static List<String> pickCtx(String chName, Random rng) {
        List<String> pool = ctxPool(chName);
        List<String> out = new ArrayList<>();
        int n = rng.nextDouble() < 0.3 ? 2 : 1;
        for (int i = 0; i < n; i++) {
            String c = pool.get(rng.nextInt(pool.size()));
            if (!out.contains(c)) {
                out.add(c);
            }
        }
        return out;
    }

    private static String genValue(String kind, Random rng) {
        return switch (kind) {
            case "id" -> "TX-2024-" + (100000 + rng.nextInt(900000));
            case "num" -> String.format("%.2f", 100000 + rng.nextDouble() * 9900000);
            case "date" -> LocalDate.of(2024, 1, 1).plusDays(rng.nextInt(364)).toString();
            case "code" -> List.of("USD", "CNY", "HKD", "JPY", "EUR").get(rng.nextInt(5));
            case "product" -> List.of("IRS", "OIS", "BSW", "CDS", "FXS", "FXF").get(rng.nextInt(6));
            case "text" -> List.of("ABC Bank", "Citi Group", "HSBC", "Nomura", "Goldman Sachs").get(rng.nextInt(5));
            case "multi" -> MULTI_TEXT;
            default -> "VAL-" + rng.nextInt(9999);
        };
    }

    private static String mutateValue(String v, String kind, Random rng) {
        return switch (kind) {
            case "num" -> {
                double n = Double.parseDouble(v);
                double delta = (rng.nextBoolean() ? -1 : 1) * (0.01 + rng.nextInt(99));
                yield String.format("%.2f", n + delta);
            }
            case "date" -> LocalDate.parse(v).plusDays(1 + rng.nextInt(9)).toString();
            case "code" -> {
                List<String> codes = Arrays.asList("USD", "CNY", "HKD", "JPY", "EUR");
                yield codes.stream().filter(c -> !c.equals(v)).findFirst().orElse("GBP");
            }
            case "product" -> {
                List<String> ps = Arrays.asList("IRS", "OIS", "BSW", "CDS", "FXS", "FXF");
                yield ps.stream().filter(p -> !p.equals(v)).findFirst().orElse("OPTION");
            }
            case "id" -> v.substring(0, v.length() - 1) + rng.nextInt(10);
            case "multi" -> v.replace("已确认条款", "存在差异条款") + "\n[差异] 新增差异行：内容不一致。";
            case "text" -> "XYZ Bank";
            default -> "VAL-" + rng.nextInt(9999);
        };
    }

    private static String noteFor(String kind) {
        return switch (kind) {
            case "num" -> "数值差异";
            case "date" -> "日期差异";
            case "code", "product" -> "码值差异";
            case "multi" -> "内容差异";
            default -> "值不一致";
        };
    }

    private static String genUnconverted(String eo, String k) {
        return switch (k) {
            case "num" -> String.valueOf(Math.round(Double.parseDouble(eo) * 100));
            case "date" -> eo.replace("-", "");
            case "code", "product" -> eo.toLowerCase();
            case "text" -> "  " + eo + "  ";
            case "id" -> eo.replace("TX-", "");
            default -> eo;
        };
    }

    private static double convProb(String k) {
        return switch (k) {
            case "num" -> 0.6;
            case "date", "code" -> 0.5;
            case "text" -> 0.45;
            case "product" -> 0.3;
            case "id" -> 0.2;
            case "multi" -> 0.15;
            default -> 0.3;
        };
    }

    private static String convRuleFor(String k, Random rng) {
        return switch (k) {
            case "num" -> rng.nextBoolean() ? "@round2" : "@scale100";
            case "date" -> "@dateFormat(YYYY-MM-DD)";
            case "code", "product" -> "@toUpper";
            case "text" -> rng.nextBoolean() ? "@trim" : "@normalizeSpace";
            case "id" -> "@normalizeId";
            case "multi" -> "@trimLines";
            default -> "@normalize";
        };
    }

    private static String valRuleFor(String k, Random rng) {
        return switch (k) {
            case "code" -> "enum: ['USD', 'CNY', 'HKD', 'JPY', 'EUR']";
            case "num" -> "regex:^\\d+(\\.\\d{2})?$";
            case "date" -> "regex:^\\d{4}-\\d{2}-\\d{2}$";
            case "id" -> "regex:^TX-\\d{6}$";
            case "product" -> "enum: ['IRS', 'OIS', 'BSW', 'CDS', 'FXS', 'FXF']";
            case "text" -> rng.nextBoolean() ? "@length<=64" : "@notNull";
            case "multi" -> "@maxLines<=3";
            default -> "@notNull";
        };
    }

    private static String genExcelMapping(String target, List<String> ctx, boolean sample) {
        if (!sample) {
            return "-; " + target;
        }
        return ctx.stream().map(ck -> ck + ":\n-; " + target + "\n- boolean(" + target + ") = False")
                .reduce((a, b) -> a + "\n" + b).orElse("-; " + target);
    }

    private static String genExcelRuleText(String rule, List<String> ctx, boolean sample) {
        if (rule == null) {
            return "（未配置）";
        }
        if (!sample) {
            return "-; " + rule;
        }
        return ctx.stream().map(ck -> ck + ":\n-; " + rule + "\n- @fallback")
                .reduce((a, b) -> a + "\n" + b).orElse("-; " + rule);
    }

    private static String pickProduct(String category, Random rng) {
        return switch (category) {
            case "IR" -> List.of("IRS", "OIS", "BSW").get(rng.nextInt(3));
            case "CD" -> List.of("CDS", "CDX").get(rng.nextInt(2));
            default -> List.of("FXS", "FXF", "FXO").get(rng.nextInt(3));
        };
    }

    private static Map<String, Boolean> orderedColumns() {
        Map<String, Boolean> m = new LinkedHashMap<>();
        m.put("channel", true);
        m.put("source", true);
        m.put("f", true);
        m.put("x", true);
        m.put("aoCsv", true);
        m.put("t", false);
        m.put("ctx", false);
        m.put("eo", true);
        m.put("ao", true);
        m.put("result", true);
        m.put("note", false);
        return m;
    }

    /* ------------------------------------------------------------------ */
    /*  Config / ignore / batch                                           */
    /* ------------------------------------------------------------------ */

    public static ValidationConfig generateConfig() {
        return ValidationConfig.builder()
                .configVersion(2)
                .runType("dev")
                .urls(ValidationConfig.Urls.builder()
                        .data("deepseek-validation-data.json")
                        .ignore("ignore-config-by-platform.json")
                        .batches("batches-index.json")
                        .build())
                .ui(ValidationConfig.Ui.builder()
                        .lang("zh-CN").theme("light").sidebarMode("combined")
                        .sidebarWidth(280).reportCatDefault(null)
                        .batchDockSide("left").progressBarStyle("status")
                        .build())
                .features(ValidationConfig.Features.builder()
                        .uncomparedXpath(true).uncomparedItems(true).uncomparedCsv(true)
                        .logs(true).conversionRule(true).validationRule(true)
                        .excelMapping(true).excelConversionRule(true).excelValidationRule(true)
                        .columnHover(true).sidebarSearch(true).sidebarTradeId(true)
                        .compare(true).healthOverview(true).globalSearch(true)
                        .keyboardShortcuts(true).modalPrints(true).recentBatches(true)
                        .build())
                .limits(ValidationConfig.Limits.builder()
                        .pageSize(20).pageSizeOptions(List.of(10, 20, 50))
                        .sidebarPageSize(8).msgPageSize(20).globalSearchLimit(200)
                        .build())
                .batches(ValidationConfig.BatchesConfig.builder()
                        .recentCount(5).pageSize(8).listMode("lazy")
                        .detailMode("quick").panelWidth(320)
                        .build())
                .columns(ValidationConfig.ColumnsConfig.builder()
                        .defaults(orderedColumns())
                        .build())
                .build();
    }

    public static Map<String, PlatformIgnore> generateIgnoreConfig() {
        Map<String, PlatformIgnore> map = new LinkedHashMap<>();
        for (String platform : PLATFORMS) {
            List<IgnoreWarning> warnings = new ArrayList<>();
            warnings.add(IgnoreWarning.builder()
                    .kind("warning").channel("HKTR").field("")
                    .type("contextAssertion").level("NOTICE").product("IRS")
                    .build());
            map.put(platform, PlatformIgnore.builder()
                    .warnings(warnings)
                    .uncomparedXpaths(new ArrayList<>())
                    .build());
        }
        return map;
    }

    public static BatchMeta generateBatchMeta(ValidationDataset dataset) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("items", dataset.getItems().size());
        summary.put("channels", CHANNEL_NAMES.length);
        return BatchMeta.builder()
                .batchId("batch-20260816-0400")
                .batchName("nightly-20260816")
                .date("2026-08-16")
                .executedAt("2026-08-16T04:00:00+08:00")
                .formatVersion(2)
                .cwd(System.getProperty("user.dir"))
                .commandLine(List.of("java", "-jar", "ccp-report.jar", "--job=nightly",
                        "--date=2026-08-16", "--channels=HKTR,JSFA,CFTC"))
                .argv(List.of("--job=nightly", "--date=2026-08-16", "--channels=HKTR,JSFA,CFTC"))
                .summary(summary)
                .description("夜间全量批处理：\n- 渠道：HKTR / JSFA / CFTC\n- 范围：当日全部交易\n- 模式：全量比对 + 汇总报表")
                .build();
    }

    public static BatchIndex generateBatchIndex(BatchMeta meta, String dataUrl, String ignoreUrl, String basedir, String path) {
        BatchEntry entry = BatchEntry.builder()
                .batchId(meta.getBatchId())
                .batchName(meta.getBatchName())
                .date(meta.getDate())
                .executedAt(meta.getExecutedAt())
                .formatVersion(meta.getFormatVersion())
                .dataUrl(dataUrl)
                .ignoreUrl(ignoreUrl)
                .path(path)
                .commandLine(meta.getCommandLine())
                .argv(meta.getArgv())
                .cwd(meta.getCwd())
                .description(meta.getDescription())
                .summary(meta.getSummary())
                .build();
        return BatchIndex.builder()
                .schemaVersion(1)
                .generatedAt(java.time.Instant.now().toString())
                .basedir(basedir)
                .count(1)
                .batches(List.of(entry))
                .build();
    }

    /* ------------------------------------------------------------------ */
    /*  Output                                                            */
    /* ------------------------------------------------------------------ */

    public static void writeAll(Path outDir) throws IOException {
        ValidationDataset dataset = generateDataset(20240814L);
        ValidationConfig config = generateConfig();
        Map<String, PlatformIgnore> ignore = generateIgnoreConfig();
        BatchMeta meta = generateBatchMeta(dataset);

        Path batchDir = outDir.resolve("batches").resolve("2026-08-16").resolve("batch-20260816-0400");
        String dataUrl = "batches/2026-08-16/batch-20260816-0400/deepseek-validation-data.json";
        String ignoreUrl = "ignore-config-by-platform.json";
        BatchIndex index = generateBatchIndex(meta, dataUrl, ignoreUrl,
                toWeb(outDir.resolve("batches").toAbsolutePath()),
                toWeb(batchDir.toAbsolutePath()));

        Files.createDirectories(batchDir);
        writeJson(outDir.resolve("deepseek-validation-data.json"), dataset);
        writeJson(outDir.resolve("deepseek-validation-config.json"), config);
        writeJson(outDir.resolve("ignore-config-by-platform.json"), ignore);
        writeJson(outDir.resolve("batches-index.json"), index);
        writeJson(batchDir.resolve("batch-meta.json"), meta);
        writeJson(batchDir.resolve("deepseek-validation-data.json"), dataset);
    }

    private static void writeJson(Path file, Object value) throws IOException {
        Files.createDirectories(file.getParent());
        Files.writeString(file, MAPPER.writeValueAsString(value), StandardCharsets.UTF_8);
    }

    private static String toWeb(Path p) {
        return p.toString().replace('\\', '/');
    }

    public static void main(String[] args) throws IOException {
        Path out = args.length > 0 ? Path.of(args[0]) : Path.of("generated");
        writeAll(out);
        System.out.println("Generated validation JSON files -> " + out.toAbsolutePath());
    }
}
