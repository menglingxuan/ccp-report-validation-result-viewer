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
import com.otcc.viewer.model.CmpSide;
import com.otcc.viewer.model.ConversionRule;
import com.otcc.viewer.model.CtxDef;
import com.otcc.viewer.model.ExcelFile;
import com.otcc.viewer.model.ExtraResult;
import com.otcc.viewer.model.Field;
import com.otcc.viewer.model.FieldDef;
import com.otcc.viewer.model.FileEntry;
import com.otcc.viewer.model.IgnoreWarning;
import com.otcc.viewer.model.ItemLog;
import com.otcc.viewer.model.ItemSummary;
import com.otcc.viewer.model.ManifestItem;
import com.otcc.viewer.model.Message;
import com.otcc.viewer.model.PlatformIgnore;
import com.otcc.viewer.model.SkippedItem;
import com.otcc.viewer.model.Source;
import com.otcc.viewer.model.UncomparedEntry;
import com.otcc.viewer.model.ValidationConfig;
import com.otcc.viewer.model.ValidationDataset;
import com.otcc.viewer.model.ValidationItem;
import com.otcc.viewer.model.ValidationRule;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * Generator for the {@code report-validation-data} JSON files consumed by the viewer.
 *
 * <p>Implements the latest data interface standard (see the viewer's {@code DATA_SCHEMA.md}):
 * <ul>
 *   <li>single-file mode ({@code mode: "single"}) — one file with all items;</li>
 *   <li>multi-file mode ({@code mode: "multi"}) — a manifest plus one file per item
 *       ({@code data/items/&lt;tradeId&gt;.json}).</li>
 * </ul>
 * Also emits the viewer config, ignore config, batch index and batch metadata.</p>
 */
public final class ValidationJsonGenerator {

    private ValidationJsonGenerator() {
    }

    /** Shared mapper: pretty output, keep nulls (like {@code JSON.stringify}), tolerant reads. */
    public static final ObjectMapper MAPPER = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT)
            .setSerializationInclusion(JsonInclude.Include.ALWAYS)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);

    public static final String[] CHANNEL_NAMES = {"HKTR", "JSFA", "CFTC"};
    public static final String[] PLATFORMS = {"OTC-PLATFORM-A", "OTC-PLATFORM-B", "OTC-PLATFORM-C"};

    private static final Map<String, String> CHANNEL_DESC = Map.of(
            "HKTR", "香港交易资料储存库",
            "JSFA", "日本金融厅",
            "CFTC", "美国商品期货交易委员会");
    private static final Map<String, String> CHANNEL_FORMAT = Map.of(
            "HKTR", "xml", "JSFA", "xml", "CFTC", "csv");

    /** platform -> available product categories (platform/product linkage). */
    private static final Map<String, List<String>> PLATFORM_CATEGORIES = Map.of(
            "OTC-PLATFORM-A", List.of("IR", "CD"),
            "OTC-PLATFORM-B", List.of("IR", "FX"),
            "OTC-PLATFORM-C", List.of("CD", "FX"));

    /** product category -> sub products. */
    private static final Map<String, List<String>> PRODUCT_SUB = Map.of(
            "IR", List.of("IRS", "OIS", "BSW"),
            "CD", List.of("CDS", "CDX"),
            "FX", List.of("FXS", "FXF", "FXO"));

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

    public static ValidationDataset generateDataset() {
        return generateDataset(20240814L);
    }

    /** Generates the single-file dataset ({@code mode: "single"}) with 18 items. */
    public static ValidationDataset generateDataset(long seed) {
        Random rng = new Random(seed);
        List<ValidationItem> items = new ArrayList<>();
        for (int i = 0; i < 18; i++) {
            items.add(generateItem(rng, i));
        }
        return ValidationDataset.builder()
                .mode("single")
                .items(items)
                .reportEnv("OTCXXX")
                .build();
    }

    private static ValidationItem generateItem(Random rng, int i) {
        String tradeId = "T-20240814-" + (1001 + i);
        String reportDate = "2024-08-" + pad2(10 + i / 3);
        String generatedAt = "2024-08-14 10:23:0" + (i % 10) + ".000";
        double failRate = i == 0 ? 0.0 : (i == 2 ? 0.85 : 0.18);
        String platform = PLATFORMS[i % PLATFORMS.length];

        List<String> cats = PLATFORM_CATEGORIES.get(platform);
        String productCategory = cats.get(i % cats.size());
        List<String> subs = PRODUCT_SUB.get(productCategory);
        String product = subs.get(rng.nextInt(subs.size()));

        String counterpartyItemId = (i / 2 == 5)
                ? ""
                : (i % 2 == 0 ? "T-20240814-" + (1002 + i) : "T-20240814-" + (1000 + i));

        FieldRegistry fr = buildFieldRegistry(i);
        int sourceCount = i == 17 ? 1 : 2;

        List<Channel> channels = new ArrayList<>();
        List<Message> warnings = new ArrayList<>();
        List<Message> errors = new ArrayList<>();
        List<UncomparedEntry> uncompared = new ArrayList<>();
        List<ItemLog> channelLogs = new ArrayList<>();
        for (String chName : CHANNEL_NAMES) {
            List<String[]> fieldsDef = fieldDefsForItem(i, chName);
            ChannelBuild built = buildChannel(chName, tradeId, reportDate, rng, failRate, fr.nameToId, fieldsDef, sourceCount);
            channels.add(built.channel);
            warnings.addAll(built.warnings);
            errors.addAll(built.errors);
            uncompared.addAll(built.uncompared);
            channelLogs.addAll(built.logs);
        }

        List<String> enabledChannels = switch (i % 3) {
            case 0 -> List.of("HKTR", "JSFA", "CFTC");
            case 1 -> List.of("HKTR", "JSFA");
            default -> List.of("HKTR", "CFTC");
        };

        return ValidationItem.builder()
                .tradeId(tradeId)
                .reportDate(reportDate)
                .generatedAt(generatedAt)
                .platform(platform)
                .product(product)
                .productCategory(productCategory)
                .counterpartyItemId(counterpartyItemId)
                .platformTradeId("PT-" + tradeId.substring(2))
                .platformDealId("PD-" + tradeId.substring(2))
                .ctxDefs(buildCtxDefs(i))
                .fields(fr.registry)
                .channels(channels)
                .enabledChannels(enabledChannels)
                .skippedItems(buildSkippedItems(reportDate, rng))
                .warnings(warnings)
                .errors(errors)
                .uncompared(uncompared)
                .logs(buildOverviewLogs(tradeId, reportDate, channels, channelLogs))
                .build();
    }

    /* ------------------------------------------------------------------ */
    /*  Field registry                                                    */
    /* ------------------------------------------------------------------ */

    private static final class FieldRegistry {
        final List<FieldDef> registry;
        final Map<String, String> nameToId;

        FieldRegistry(List<FieldDef> registry, Map<String, String> nameToId) {
            this.registry = registry;
            this.nameToId = nameToId;
        }
    }

    /** Builds the per-item field registry (deduplicated by name, id = first-appearance order). */
    private static FieldRegistry buildFieldRegistry(int itemIndex) {
        List<FieldDef> registry = new ArrayList<>();
        Map<String, String> nameToId = new LinkedHashMap<>();
        for (String chName : CHANNEL_NAMES) {
            for (String[] def : fieldDefsForItem(itemIndex, chName)) {
                String name = def[0];
                if (!nameToId.containsKey(name)) {
                    String id = String.valueOf(registry.size() + 1);
                    nameToId.put(name, id);
                    registry.add(FieldDef.builder().id(id).name(name).userTag(def[2]).type(def[3]).build());
                }
            }
        }
        return new FieldRegistry(registry, nameToId);
    }

    /** Per-item field set: drop fields by {@code i % 4} to vary each item's registry. */
    private static List<String[]> fieldDefsForItem(int itemIndex, String chName) {
        List<String[]> base = FIELD_DEFS.get(chName);
        int m = itemIndex % 4;
        List<String> drop = m == 1 ? List.of("venue")
                : m == 2 ? List.of("venue", "quantity")
                : m == 3 ? List.of("price", "remarks")
                : List.of();
        List<String[]> out = new ArrayList<>();
        for (String[] def : base) {
            if (!drop.contains(def[0])) {
                out.add(def);
            }
        }
        return out;
    }

    /* ------------------------------------------------------------------ */
    /*  Channel                                                           */
    /* ------------------------------------------------------------------ */

    private static final class ChannelBuild {
        final Channel channel;
        final List<Message> warnings;
        final List<Message> errors;
        final List<UncomparedEntry> uncompared;
        final List<ItemLog> logs;

        ChannelBuild(Channel channel, List<Message> warnings, List<Message> errors,
                     List<UncomparedEntry> uncompared, List<ItemLog> logs) {
            this.channel = channel;
            this.warnings = warnings;
            this.errors = errors;
            this.uncompared = uncompared;
            this.logs = logs;
        }
    }

    private static ChannelBuild buildChannel(String chName, String tradeId, String reportDate,
                                             Random rng, double failRate, Map<String, String> nameToId,
                                             List<String[]> fieldsDef, int sourceCount) {
        boolean csv = "csv".equals(CHANNEL_FORMAT.get(chName));
        String p = chName.toLowerCase();
        List<String> mapPool = List.of(
                p + ".ctx.default",
                p + ".ctx.v2",
                p + ".ctx.v3",
                p + ".ctx.extended.production.region.east.v2024.latest");
        List<String> convPool = List.of(p + ".ctx.conv.default", p + ".ctx.conv.v2");
        List<String> valPool = List.of(p + ".ctx.val.default", p + ".ctx.val.v2");

        String ext = csv ? ".csv" : ".xml";
        String eoNameA = p + "_srcA_" + tradeId + ".csv";
        String eoNameB = p + "_srcB_" + tradeId + ".csv";
        String aoNameA = chName.toUpperCase() + "_" + tradeId + "_001" + ext;
        String aoNameB = chName.toUpperCase() + "_" + tradeId + "_002" + ext;

        List<FileEntry> eo = sourceCount == 1
                ? List.of(fileEntry(eoNameA, "eo"))
                : List.of(fileEntry(eoNameA, "eo"), fileEntry(eoNameB, "eo"));
        List<FileEntry> ao = sourceCount == 1
                ? List.of(fileEntry(aoNameA, "ao"))
                : List.of(fileEntry(aoNameA, "ao"), fileEntry(aoNameB, "ao"));
        ChannelFiles files = ChannelFiles.builder()
                .eo(eo)
                .ao(ao)
                .excel(ExcelFile.builder().file("mapping.xlsx").sheet(chName).path("data/excel/mapping.xlsx").build())
                .build();

        List<Integer> sourceIndexes = sourceCount == 1 ? List.of(1) : List.of(1, 2);
        List<Source> sources = new ArrayList<>();
        for (int sn : sourceIndexes) {
            List<Field> fields = new ArrayList<>();
            int idx = 0;
            for (String[] def : fieldsDef) {
                fields.add(buildField(chName, def, idx, sn, csv, tradeId, rng, failRate,
                        nameToId, mapPool, convPool, valPool));
                idx++;
            }
            sources.add(Source.builder().name("来源渠道 " + (sn == 1 ? "A" : "B")).fields(fields).build());
        }

        Channel channel = Channel.builder()
                .name(chName)
                .desc(CHANNEL_DESC.get(chName))
                .format(CHANNEL_FORMAT.get(chName))
                .files(files)
                .sources(sources)
                .build();

        return new ChannelBuild(
                channel,
                buildMessages(false, rng, chName, fieldsDef),
                buildMessages(true, rng, chName, fieldsDef),
                buildUncompared(chName, rng, fieldsDef, csv ? 2 : 1),
                buildChannelLogs(chName, files));
    }

    private static Field buildField(String chName, String[] def, int idx, int sn, boolean csv,
                                    String tradeId, Random rng, double failRate,
                                    Map<String, String> nameToId, List<String> mapPool,
                                    List<String> convPool, List<String> valPool) {
        String f = def[0];
        String rawTarget = def[1];
        String k = def[3];
        int srcType = csv ? 2 : 1;

        String eo = genValue(k, rng);
        boolean failed = rng.nextDouble() < failRate;
        String ao = failed ? mutateValue(eo, k, rng) : eo;

        // Hit contexts: one mapping ctx always, conversion/validation/extras appended by probability.
        List<String> ctx = new ArrayList<>();
        ctx.add(pick(mapPool, rng));
        if (rng.nextDouble() < 0.7) {
            addUnique(ctx, pick(convPool, rng));
        }
        if (rng.nextDouble() < 0.7) {
            addUnique(ctx, pick(valPool, rng));
        }
        if (rng.nextDouble() < 0.3) {
            addUnique(ctx, pick(mapPool, rng));
        }

        String result = failed ? "FAILED" : "PASSED";
        String note = failed ? noteFor(k) : "";
        if (!note.isEmpty() && rng.nextDouble() < 0.3) {
            note += "\n详情：期望值与实际值存在差异，可能由来源数据更新或报送数据延迟导致。\n建议核对上游系统该字段的最新取值，确认差异是否为业务允许范围。";
        }
        String resultNote = failed ? ("比对未通过：" + note) : "比对通过";

        boolean eoConverted = rng.nextDouble() < convProb(k);
        String eoUnconverted = eoConverted ? genUnconverted(eo, k) : null;
        List<String> convCtxs = eoConverted ? pickCtx(convPool, rng) : null;
        String convValue = eoConverted ? convRuleFor(k, rng) : null;

        boolean aoConverted = rng.nextDouble() < 0.4;
        List<String> aoConvCtxs = aoConverted ? pickCtx(convPool, rng) : null;
        String aoConvValue = aoConverted ? convRuleFor(k, rng) : null;

        boolean hasValidation = rng.nextDouble() < 0.75;
        List<String> valCtxs = hasValidation ? pickCtx(valPool, rng) : null;
        String valValue = hasValidation ? valRuleFor(k, rng) : null;

        boolean isSample = "T-20240814-1001".equals(tradeId) && "HKTR".equals(chName) && idx == 0;
        String excelMapping = genExcelMapping(rawTarget, ctx, isSample);
        String excelConversionRule = genExcelRuleText(convValue, ctx, isSample);
        String excelValidationRule = genExcelRuleText(valValue, ctx, isSample);

        // EO side is a source CSV field; its "el" is derived from the field name.
        String eoCol = "src_" + f;
        String eoMapping = genExcelMapping(eoCol, ctx, isSample);

        List<ExtraResult> resultDetails = new ArrayList<>();
        if (eoConverted && eoUnconverted != null) {
            resultDetails.add(ExtraResult.builder().label("期望值 (EO, Unconverted)").value(eoUnconverted).build());
        }

        List<String> mapCtxs = filterMapCtxs(ctx);

        CmpSide cmpLeft = CmpSide.builder()
                .value(eo).ctx(firstOrNull(mapCtxs)).ctxs(mapCtxs)
                .elRaw(eoMapping).el(eoCol).srcType(2).build();
        CmpSide cmpRight = CmpSide.builder()
                .value(ao).ctx(firstOrNull(mapCtxs)).ctxs(mapCtxs)
                .elRaw(excelMapping).el(rawTarget).srcType(srcType).build();

        ConversionRule cvtLeft = convCtxs == null ? null : ConversionRule.builder()
                .ctx(firstOrNull(convCtxs)).ctxs(convCtxs)
                .el(convValue).elRaw(excelConversionRule).raw(eoUnconverted).build();
        ConversionRule cvtRight = aoConvCtxs == null ? null : ConversionRule.builder()
                .ctx(firstOrNull(aoConvCtxs)).ctxs(aoConvCtxs)
                .el(aoConvValue).elRaw(genExcelRuleText(aoConvValue, ctx, isSample)).raw(null).build();
        ValidationRule vdt = valCtxs == null ? null : ValidationRule.builder()
                .ctx(firstOrNull(valCtxs)).ctxs(valCtxs)
                .el(valValue).elRaw(excelValidationRule).build();

        List<String> prints = buildPrints(f, rawTarget, ctx, chName, "来源渠道 " + (sn == 1 ? "A" : "B"),
                eo, ao, result, note, csv ? "CSV字段" : "XPath");

        return Field.builder()
                .id(nameToId.get(f))
                .ctxs(ctx)
                .cmpLeft(cmpLeft)
                .cmpRight(cmpRight)
                .cvtLeft(cvtLeft)
                .cvtRight(cvtRight)
                .vdt(vdt)
                .result(result)
                .remarks(note)
                .resultText(resultNote)
                .resultDetails(resultDetails)
                .prints(prints)
                .build();
    }

    private static List<Message> buildMessages(boolean error, Random rng, String chName, List<String[]> fieldsDef) {
        int count = 2 + rng.nextInt(4);
        String[] pool = error ? ERR_TEXTS : WARN_TEXTS;
        String[] typeKeys = error ? ERROR_TYPE_KEYS : TYPE_KEYS;
        String[] levels = error ? ERR_LEVELS : WARN_LEVELS;
        List<Message> msgs = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            String base = pool[rng.nextInt(pool.length)];
            String text = rng.nextDouble() < 0.2
                    ? base + "\n详情：该字段的映射配置可能缺失或与当前 context 不匹配。\n建议检查映射表对应 sheet 的配置，确认 XPath 与命中的 context 是否正确，并核对字段类型。"
                    : base;
            String field = rng.nextDouble() < 0.8 ? fieldsDef.get(rng.nextInt(fieldsDef.size()))[0] : "";
            String source = rng.nextDouble() < 0.25 ? "" : (rng.nextDouble() < 0.5 ? "来源渠道 A" : "来源渠道 B");
            msgs.add(Message.builder()
                    .scope(field.isEmpty() ? "channel" : "field")
                    .source(source)
                    .channel(chName)
                    .type(typeKeys[rng.nextInt(typeKeys.length)])
                    .level(levels[rng.nextInt(levels.length)])
                    .text(text)
                    .field(field)
                    .build());
        }
        return msgs;
    }

    private static List<UncomparedEntry> buildUncompared(String chName, Random rng, List<String[]> fieldsDef, int type) {
        List<UncomparedEntry> list = new ArrayList<>();
        int n = rng.nextInt(2);
        for (int i = 0; i < n; i++) {
            String[] d = fieldsDef.get(rng.nextInt(fieldsDef.size()));
            String note;
            if (rng.nextDouble() < 0.35) {
                note = type == 1
                        ? "未在映射配置中匹配到对应 CSV 字段\n详情：Excel 映射配置中未找到与该 XPath 对应的条目，可能因 context 定义变化导致。\n请检查映射表并确认该 XPath 是否仍需要参与比较。"
                        : "未在映射配置中匹配到对应来源字段\n详情：Excel 映射配置中未找到与该 AO CSV 字段对应的条目，可能因 context 定义变化导致。\n请检查映射表并确认该 CSV 字段是否仍需要参与比较。";
            } else {
                note = type == 1 ? "未在映射配置中匹配到对应 CSV 字段" : "未在映射配置中匹配到对应来源字段";
            }
            list.add(UncomparedEntry.builder().type(type).channel(chName).value(d[1]).note(note).build());
        }
        return list;
    }

    private static List<SkippedItem> buildSkippedItems(String reportDate, Random rng) {
        List<SkippedItem> list = new ArrayList<>();
        int n = 1 + rng.nextInt(3);
        for (int i = 0; i < n; i++) {
            boolean withChannel = rng.nextDouble() < 0.55;
            String ch = withChannel ? CHANNEL_NAMES[rng.nextInt(CHANNEL_NAMES.length)] : "ALL";
            String reason = "ALL".equals(ch)
                    ? "未在任一报告渠道中找到对应记录，该 item 未能参与比较。"
                    : "在 " + ch + " 渠道中未找到该 item 的对应记录，已跳过该渠道的比较。";
            if (rng.nextDouble() < 0.35) {
                reason += "\n详情：该 item 在来源 CSV 与报送 XML 中均未出现对应记录，可能因数据采集或报送延迟导致。\n建议核对上游系统是否已产生该 item 的数据。";
            }
            list.add(SkippedItem.builder()
                    .itemId("T-" + reportDate.replace("-", "") + "-0" + (91 + i))
                    .channel(ch)
                    .reason(reason)
                    .build());
        }
        return list;
    }

    private static List<ItemLog> buildChannelLogs(String chName, ChannelFiles files) {
        String t = "2024-08-14 10:23:0";
        return List.of(
                ItemLog.builder().scope("channel").channel(chName).source(null)
                        .text(t + "0.200 INFO  [" + chName + "] 读取报送文件 " + joinNames(files.getAo())).build(),
                ItemLog.builder().scope("channel").channel(chName).source(null)
                        .text(t + "0.300 INFO  [" + chName + "] 应用映射配置 " + files.getExcel().getFile()
                                + " [sheet: " + files.getExcel().getSheet() + "]").build(),
                ItemLog.builder().scope("channel").channel(chName).source(null)
                        .text(t + "0.400 INFO  [" + chName + "] 完成字段比较，渠道结果已生成").build());
    }

    private static List<ItemLog> buildOverviewLogs(String tradeId, String reportDate,
                                                   List<Channel> channels, List<ItemLog> channelLogs) {
        List<ItemLog> lines = new ArrayList<>();
        lines.add(ItemLog.builder().scope("item").channel(null).source(null)
                .text("2024-08-14 10:23:00.100 INFO  开始比较 item=" + tradeId + "，报告日期=" + reportDate).build());
        lines.add(ItemLog.builder().scope("item").channel(null).source(null)
                .text("2024-08-14 10:23:00.120 INFO  加载映射配置 mapping.xlsx（" + channels.size() + " 个报告渠道）").build());
        lines.add(ItemLog.builder().scope("item").channel(null).source(null)
                .text("2024-08-14 10:23:00.140 INFO  初始化逐渠道执行器（HKTR / JSFA / CFTC）").build());
        for (int i = 0; i < 60; i++) {
            Channel ch = channels.get(i % channels.size());
            String ms = String.valueOf(100 + i * 7);
            lines.add(ItemLog.builder().scope("channel").channel(ch.getName()).source(null)
                    .text("2024-08-14 10:23:" + pad2(i) + "." + ms + " INFO  [" + ch.getName() + "] 执行字段比较步骤 "
                            + (i + 1) + "：读取 " + fileEntryName(ch.getFiles().getEo().get(0))
                            + " 与 " + fileEntryName(ch.getFiles().getAo().get(0)) + "，逐字段校验映射关系。").build());
        }
        lines.add(ItemLog.builder().scope("item").channel(null).source(null)
                .text("2024-08-14 10:24:00.000 INFO  比较完成，结果已生成").build());
        lines.addAll(channelLogs);
        return lines;
    }

    private static Map<String, CtxDef> buildCtxDefs(int itemIndex) {
        int seed = itemIndex;
        Map<String, CtxDef> defs = new LinkedHashMap<>();
        for (String chName : CHANNEL_NAMES) {
            String p = chName.toLowerCase();
            defs.put(p + ".ctx.default", CtxDef.builder().type(List.of(1))
                    .def(chName + " 默认上下文（标准报送场景）")
                    .hits("命中 " + (3 + seed % 3) + " 个映射条目（EO 2 / AO 1）").build());
            defs.put(p + ".ctx.v2", CtxDef.builder().type(List.of(1))
                    .def(chName + " v2 上下文（2024 新版映射）")
                    .hits("命中 " + (2 + seed % 2) + " 个映射条目（EO 1 / AO 1）").build());
            defs.put(p + ".ctx.v3", CtxDef.builder().type(List.of(1))
                    .def(chName + " v3 上下文（最新版映射）")
                    .hits("命中 " + (1 + seed % 2) + " 个映射条目（EO 1 / AO 0）").build());
            defs.put(p + ".ctx.extended.production.region.east.v2024.latest", CtxDef.builder().type(List.of(1))
                    .def(chName + " 扩展上下文（生产·东部区域·2024 最新）")
                    .hits("命中 " + (4 + seed % 2) + " 个映射条目（EO 2 / AO 2）").build());
            defs.put(p + ".ctx.conv.default", CtxDef.builder().type(List.of(2))
                    .def(chName + " 值转换默认上下文（EO 归一化）")
                    .hits("命中 " + (2 + seed % 2) + " 个转换规则（@trim / @toUpper 等）").build());
            defs.put(p + ".ctx.conv.v2", CtxDef.builder().type(List.of(2))
                    .def(chName + " 值转换 v2 上下文")
                    .hits("命中 " + (1 + seed % 2) + " 个转换规则").build());
            defs.put(p + ".ctx.val.default", CtxDef.builder().type(List.of(3))
                    .def(chName + " 终值校验默认上下文")
                    .hits("命中 " + (3 + seed % 3) + " 个校验规则（枚举/正则/非空）").build());
            defs.put(p + ".ctx.val.v2", CtxDef.builder().type(List.of(3))
                    .def(chName + " 终值校验 v2 上下文")
                    .hits("命中 " + (2 + seed % 2) + " 个校验规则").build());
        }
        return defs;
    }

    /* ------------------------------------------------------------------ */
    /*  Value helpers                                                     */
    /* ------------------------------------------------------------------ */

    private static String pick(List<String> pool, Random rng) {
        return pool.get(rng.nextInt(pool.size()));
    }

    private static List<String> pickCtx(List<String> pool, Random rng) {
        List<String> out = new ArrayList<>();
        int n = rng.nextDouble() < 0.4 ? 2 : 1;
        for (int i = 0; i < n; i++) {
            String c = pool.get(rng.nextInt(pool.size()));
            if (!out.contains(c)) {
                out.add(c);
            }
        }
        return out;
    }

    private static void addUnique(List<String> list, String value) {
        if (!list.contains(value)) {
            list.add(value);
        }
    }

    private static String firstOrNull(List<String> list) {
        return list == null || list.isEmpty() ? null : list.get(0);
    }

    private static List<String> filterMapCtxs(List<String> ctx) {
        List<String> out = new ArrayList<>();
        for (String c : ctx) {
            if (!c.contains(".conv.") && !c.contains(".val.")) {
                out.add(c);
            }
        }
        return out;
    }

    private static List<String> buildPrints(String f, String target, List<String> ctx, String chName,
                                            String srcName, String eo, String ao, String result,
                                            String note, String targetName) {
        return List.of(
                "[INFO] 比较字段 " + f + "（报告渠道 " + chName + " / " + srcName + "）",
                "[INFO] " + targetName + "=" + target + "，命中Ctx=" + String.join(",", ctx),
                "[INFO] EO=" + eo + "，AO=" + ao + " → " + result
                        + (note == null || note.isEmpty() ? "" : "（" + note + "）"));
    }

    private static String genValue(String kind, Random rng) {
        return switch (kind) {
            case "id" -> "TX-2024-" + (100000 + rng.nextInt(900000));
            case "num" -> String.format("%.2f", 100000 + rng.nextDouble() * 9900000);
            case "date" -> LocalDate.of(2024, 1, 1).plusDays(rng.nextInt(364)).toString();
            case "code" -> List.of("USD", "CNY", "HKD", "JPY", "EUR").get(rng.nextInt(5));
            case "product" -> List.of("IRS", "OIS", "BSW", "CDS", "FXS", "FXF").get(rng.nextInt(6));
            case "text" -> {
                double roll = rng.nextDouble();
                if (roll < 0.08) {
                    yield "";
                }
                if (roll < 0.16) {
                    yield "   ";
                }
                if (roll < 0.24) {
                    yield "ABC\u200BBank";
                }
                yield List.of("ABC Bank", "Citi Group", "HSBC", "Nomura", "Goldman Sachs").get(rng.nextInt(5));
            }
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
                yield ps.stream().filter(x -> !x.equals(v)).findFirst().orElse("OPTION");
            }
            case "id" -> v.substring(0, v.length() - 1) + rng.nextInt(10);
            case "multi" -> v.replace("已确认条款", "存在差异条款") + "\n[差异] 新增差异行：内容不一致。";
            case "text" -> {
                List<String> texts = List.of("XYZ Bank", "Deutsche Bank", "Mizuho", "BNP Paribas", "Barclays");
                yield texts.stream().filter(x -> !x.equals(v)).findFirst().orElse("Other Bank");
            }
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
        List<String> keys = ctx != null && !ctx.isEmpty() ? ctx : List.of("ctx.default");
        if (!sample) {
            return "-; " + target;
        }
        StringBuilder sb = new StringBuilder();
        for (String ck : keys) {
            if (sb.length() > 0) {
                sb.append('\n');
            }
            sb.append(ck).append(":\n-; ").append(target).append("\n- boolean(").append(target).append(") = False");
        }
        return sb.toString();
    }

    private static String genExcelRuleText(String rule, List<String> ctx, boolean sample) {
        if (rule == null) {
            return "（未配置）";
        }
        List<String> keys = ctx != null && !ctx.isEmpty() ? ctx : List.of("ctx.default");
        if (!sample) {
            return "-; " + rule;
        }
        StringBuilder sb = new StringBuilder();
        for (String ck : keys) {
            if (sb.length() > 0) {
                sb.append('\n');
            }
            sb.append(ck).append(":\n-; ").append(rule).append("\n- @fallback");
        }
        return sb.toString();
    }

    private static String pad2(int n) {
        return String.format("%02d", n);
    }

    private static FileEntry fileEntry(String name, String dir) {
        return FileEntry.builder().name(name).path("data/" + dir + "/" + name).build();
    }

    private static String fileEntryName(FileEntry fe) {
        return fe != null && fe.getName() != null ? fe.getName() : "";
    }

    private static String joinNames(List<FileEntry> entries) {
        List<String> names = new ArrayList<>();
        for (FileEntry fe : entries) {
            names.add(fileEntryName(fe));
        }
        return String.join(", ", names);
    }

    /* ------------------------------------------------------------------ */
    /*  Multi-file mode                                                   */
    /* ------------------------------------------------------------------ */

    /** Computes the precomputed summary for one item (manifest metadata). */
    public static ItemSummary itemStats(ValidationItem item) {
        int total = 0, passed = 0, failed = 0;
        for (Channel ch : item.getChannels()) {
            for (Source s : ch.getSources()) {
                for (Field f : s.getFields()) {
                    total++;
                    if ("PASSED".equals(f.getResult())) {
                        passed++;
                    } else {
                        failed++;
                    }
                }
            }
        }
        int warnings = item.getWarnings() == null ? 0 : item.getWarnings().size();
        int errors = item.getErrors() == null ? 0 : item.getErrors().size();
        int uncompared = item.getUncompared() == null ? 0 : item.getUncompared().size();
        int logs = item.getLogs() == null ? 0 : item.getLogs().size();
        return ItemSummary.builder()
                .total(total)
                .passed(passed)
                .failed(failed)
                .rate(total == 0 ? 0 : Math.round(passed * 100f / total))
                .warnings(warnings)
                .warningsIgnored(0)
                .errors(errors)
                .uncompared(uncompared)
                .logs(logs)
                .build();
    }

    /**
     * Splits the dataset into multi-file mode: writes the manifest
     * ({@code report-validation-data.json}, {@code mode: "multi"}) and one file per item
     * under {@code data/items/&lt;tradeId&gt;.json}. Returns the manifest items.
     */
    public static List<ManifestItem> splitToFiles(ValidationDataset dataset, Path outDir) throws IOException {
        List<ManifestItem> manifestItems = new ArrayList<>();
        for (ValidationItem it : dataset.getItems()) {
            String file = "data/items/" + it.getTradeId() + ".json";
            writeJson(outDir.resolve(file), it);
            manifestItems.add(ManifestItem.builder()
                    .tradeId(it.getTradeId())
                    .reportDate(it.getReportDate())
                    .generatedAt(it.getGeneratedAt())
                    .platform(it.getPlatform())
                    .product(it.getProduct())
                    .productCategory(it.getProductCategory())
                    .counterpartyItemId(it.getCounterpartyItemId())
                    .platformTradeId(it.getPlatformTradeId())
                    .platformDealId(it.getPlatformDealId())
                    .enabledChannels(it.getEnabledChannels())
                    .file(file)
                    .summary(itemStats(it))
                    .build());
        }
        Map<String, Object> manifest = new LinkedHashMap<>();
        manifest.put("mode", "multi");
        manifest.put("reportEnv", dataset.getReportEnv());
        manifest.put("items", manifestItems);
        writeJson(outDir.resolve("report-validation-data.json"), manifest);
        return manifestItems;
    }

    /* ------------------------------------------------------------------ */
    /*  Config / ignore / batch                                           */
    /* ------------------------------------------------------------------ */

    public static ValidationConfig generateConfig() {
        return ValidationConfig.builder()
                .configVersion(2)
                .runType("dev")
                .urls(ValidationConfig.Urls.builder()
                        .data("report-validation-data.json")
                        .defaultData("report-validation-data-default.json")
                        .initData("report-validation-data-init.json")
                        .defaultDataMode("default")
                        .help("batch-help.json")
                        .ignore("ignore-config-by-platform.json")
                        .batches("batches-index.json")
                        .scan("/scan")
                        .build())
                .ui(ValidationConfig.Ui.builder()
                        .lang("zh-CN").theme("light").sidebarMode("combined")
                        .sidebarWidth(280).reportCatDefault(null)
                        .batchDockSide("left").progressBarStyle("status")
                        .build())
                .features(ValidationConfig.Features.builder()
                        .uncomparedXpath(true).uncomparedItems(true).uncomparedCsv(true)
                        .logs(true).conversionRule(true).validationRule(true)
                        .excelMapping(true).sourceFilter(true).modalRules(true)
                        .columnHover(true).sidebarSearch(true).sidebarTradeId(true)
                        .compare(true).healthOverview(true).globalSearch(true)
                        .keyboardShortcuts(true).modalPrints(true).recentBatches(true).batchHelp(true)
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

    public static BatchMeta generateBatchMeta(ValidationDataset dataset, String dataUrl, String dataMode) {
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
                .reportEnv("OTCXXX")
                .dataUrl(dataUrl)
                .dataMode(dataMode)
                .build();
    }

    public static BatchIndex generateBatchIndex(BatchMeta meta, String dataUrl, String ignoreUrl,
                                                String dataMode, String basedir, String path) {
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
                .reportEnv(meta.getReportEnv())
                .dataMode(dataMode)
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
        writeAll(outDir, DataMode.single);
    }

    /** Writes the full viewer data set into {@code outDir} using the given data mode. */
    public static void writeAll(Path outDir, DataMode mode) throws IOException {
        ValidationDataset dataset = generateDataset();
        ValidationConfig config = generateConfig();
        Map<String, PlatformIgnore> ignore = generateIgnoreConfig();

        String dataMode = mode.name();
        Path batchDir = outDir.resolve("batches").resolve("2026-08-16").resolve("batch-20260816-0400");
        String batchDataUrl = "batches/2026-08-16/batch-20260816-0400/report-validation-data.json";
        String ignoreUrl = "ignore-config-by-platform.json";

        BatchMeta meta = generateBatchMeta(dataset, "report-validation-data.json", dataMode);
        BatchIndex index = generateBatchIndex(meta, batchDataUrl, ignoreUrl, dataMode,
                toWeb(outDir.resolve("batches").toAbsolutePath()),
                toWeb(batchDir.toAbsolutePath()));

        Files.createDirectories(batchDir);

        if (mode == DataMode.multi) {
            splitToFiles(dataset, outDir);
            splitToFiles(dataset, batchDir);
        } else {
            writeJson(outDir.resolve("report-validation-data.json"), dataset);
            writeJson(outDir.resolve("report-validation-data-default.json"), dataset);
            writeJson(batchDir.resolve("report-validation-data.json"), dataset);
        }

        writeJson(outDir.resolve("config.json"), config);
        writeJson(outDir.resolve("ignore-config-by-platform.json"), ignore);
        writeJson(outDir.resolve("batches-index.json"), index);
        writeJson(batchDir.resolve("batch-meta.json"), meta);
    }

    private static void writeJson(Path file, Object value) throws IOException {
        Files.createDirectories(file.getParent());
        Files.writeString(file, MAPPER.writeValueAsString(value), StandardCharsets.UTF_8);
    }

    private static String toWeb(Path p) {
        return p.toString().replace('\\', '/');
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

    public static void main(String[] args) throws IOException {
        Path out = Path.of("generated");
        DataMode mode = DataMode.single;
        for (String arg : args) {
            if ("--split".equals(arg) || "--multi".equals(arg)) {
                mode = DataMode.multi;
            } else if ("--single".equals(arg)) {
                mode = DataMode.single;
            } else if (arg.startsWith("--mode=")) {
                mode = DataMode.parse(arg.substring("--mode=".length()));
            } else if (!arg.startsWith("-")) {
                out = Path.of(arg);
            }
        }
        writeAll(out, mode);
        System.out.println("Generated validation JSON files (" + mode + ") -> " + out.toAbsolutePath());
    }
}
