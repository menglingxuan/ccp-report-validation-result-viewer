package com.otcc.viewer.generator;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.otcc.viewer.model.Channel;
import com.otcc.viewer.model.ChannelFiles;
import com.otcc.viewer.model.CtxDef;
import com.otcc.viewer.model.CtxRule;
import com.otcc.viewer.model.ExcelFile;
import com.otcc.viewer.model.ExtraResult;
import com.otcc.viewer.model.Field;
import com.otcc.viewer.model.FileEntry;
import com.otcc.viewer.model.Message;
import com.otcc.viewer.model.SkippedItem;
import com.otcc.viewer.model.Source;
import com.otcc.viewer.model.UncomparedEntry;
import com.otcc.viewer.model.ValidationDataset;
import com.otcc.viewer.model.ValidationItem;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Basic (single item, fully populated) data generator.
 * Produces {@code deepseek-validator-data-basic.json}: one report date, one item,
 * and every necessary field is filled with at least one value.
 *
 * <p>Independent of {@link ValidationJsonGenerator} and {@link MinimalDataGenerator};
 * only relies on the shared {@code com.otcc.viewer.model} classes and Jackson.</p>
 */
public final class BasicDataGenerator {

    private BasicDataGenerator() {
    }

    public static final String FILE_NAME = "deepseek-validator-data-basic.json";

    /** The single fixed report date carried by the generated item. */
    public static final String REPORT_DATE = "2026-08-17";

    /** Pretty output, keep nulls (like JSON.stringify), tolerant reads. */
    public static final ObjectMapper MAPPER = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT)
            .setSerializationInclusion(JsonInclude.Include.ALWAYS)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);

    private static final Map<String, String> CHANNEL_DESC = Map.of(
            "HKTR", "香港交易资料储存库",
            "JSFA", "日本金融厅",
            "CFTC", "美国商品期货交易委员会");
    private static final Map<String, String> CHANNEL_FORMAT = Map.of(
            "HKTR", "xml", "JSFA", "xml", "CFTC", "csv");

    /** Per-channel targets: { tradeId target, notional target }. */
    private static final Map<String, String[]> CHANNEL_TARGETS = Map.of(
            "HKTR", new String[]{
                    "/HKTR/Report/Header/TradeDetails/TradeIdentifier/TradeId",
                    "/HKTR/Report/Notional/AmountDetails/NotionalValue"},
            "JSFA", new String[]{
                    "/JSFA/Report/Header/TransactionDetails/TradeIdentifier/TradeId",
                    "/JSFA/Report/Notional/AmountDetails/NotionalValue"},
            "CFTC", new String[]{"trade_id", "notional_amount"});

    public static ValidationDataset generate() {
        return generate(REPORT_DATE);
    }

    /** Generates the basic dataset for the given report date (or the default when {@code null}). */
    public static ValidationDataset generate(String reportDate) {
        String date = reportDate == null ? REPORT_DATE : reportDate;
        String platform = "OTC-PLATFORM-A";
        String product = "IRS";
        String tradeId = "BASIC-0001";

        List<Channel> channels = List.of(
                buildChannel("HKTR", tradeId, platform, product, date),
                buildChannel("JSFA", tradeId, platform, product, date),
                buildChannel("CFTC", tradeId, platform, product, date));

        ValidationItem item = ValidationItem.builder()
                .tradeId(tradeId)
                .reportDate(date)
                .generatedAt(date + "T00:00:00+08:00")
                .platform(platform)
                .product(product)
                .productCategory("IR")
                .counterpartyItemId("T-20240814-1001")
                .platformTradeId("PT-BASIC-0001")
                .platformDealId("PD-BASIC-0001")
                .enabledChannels(List.of("HKTR", "JSFA", "CFTC"))
                .channels(channels)
                .skippedItems(List.of(SkippedItem.builder()
                        .itemId("T-" + date.replace("-", "") + "-0001")
                        .channel("JSFA")
                        .reason("在 JSFA 渠道中未找到该 item 的对应记录，已跳过该渠道的比较。")
                        .build()))
                .overviewLogs(List.of(
                        date + " 00:00:00.100 INFO  开始比较 item=" + tradeId + "，报告日期=" + date,
                        date + " 00:00:00.200 INFO  比较完成，结果已生成"))
                .build();

        return ValidationDataset.builder()
                .items(List.of(item))
                .ctxDefs(generateCtxDefs())
                .build();
    }

    private static Channel buildChannel(String name, String tradeId, String platform, String product, String date) {
        boolean csv = "csv".equals(CHANNEL_FORMAT.get(name));
        String ext = csv ? ".csv" : ".xml";
        String eoName = name.toLowerCase() + "_srcA_" + tradeId + ".csv";
        String aoName = name.toUpperCase() + "_" + tradeId + "_001" + ext;
        String ctx = name.toLowerCase() + ".ctx.default";

        ChannelFiles files = ChannelFiles.builder()
                .eo(List.of(FileEntry.builder().name(eoName).path("data/eo/" + eoName).build()))
                .ao(List.of(FileEntry.builder().name(aoName).path("data/ao/" + aoName).build()))
                .excel(ExcelFile.builder().file("mapping.xlsx").sheet(name).path("data/excel/mapping.xlsx").build())
                .build();

        List<Source> sources = List.of(
                Source.builder().name("来源渠道 A").fields(buildFields(name, 1, csv)).build(),
                Source.builder().name("来源渠道 B").fields(buildFields(name, 2, csv)).build());

        return Channel.builder()
                .name(name)
                .desc(CHANNEL_DESC.get(name))
                .format(CHANNEL_FORMAT.get(name))
                .files(files)
                .sources(sources)
                .warnings(List.of(Message.builder()
                        .channel(name).platform(platform).product(product)
                        .type("productAssertion").level("WARN")
                        .text("字段格式与映射配置不一致，使用默认校验规则").field("notional").build()))
                .errors(List.of(Message.builder()
                        .channel(name).platform(platform).product(product)
                        .type("mappingError").level("ERROR")
                        .text("映射配置错误：XPath 语法非法").field("tradeId").build()))
                .uncompared(csv ? List.of() : List.of(UncomparedEntry.builder()
                        .channel(name)
                        .xpath(CHANNEL_TARGETS.get(name)[0])
                        .note("未在映射配置中匹配到对应 CSV 字段")
                        .platform(platform).product(product).ctx(ctx)
                        .build()))
                .uncomparedCsv(csv ? List.of(UncomparedEntry.builder()
                        .channel(name)
                        .csvField("remarks")
                        .note("未在映射配置中匹配到对应来源字段")
                        .platform(platform).product(product).ctx(ctx)
                        .build()) : List.of())
                .logs(List.of(
                        date + " 00:00:00.200 INFO  [" + name + "] 读取报送文件 " + aoName,
                        date + " 00:00:00.300 INFO  [" + name + "] 完成字段比较，渠道结果已生成"))
                .build();
    }

    private static List<Field> buildFields(String name, int sn, boolean csv) {
        String[] targets = CHANNEL_TARGETS.get(name);
        List<String> ctx = List.of(name.toLowerCase() + ".ctx.default", name.toLowerCase() + ".ctx.v2");

        Field idField = buildField(name, sn, 0, "tradeId", targets[0], "contextAssertion", "id", ctx,
                "TX-BASIC-0001", "TX-BASIC-0001", "PASSED", "",
                "BASIC-0001", "@normalizeId", "regex:^TX-\\d{6}$", csv);
        Field numField = buildField(name, sn, 1, "notional", targets[1], "productAssertion", "num", ctx,
                "1000000.00", "1000050.00", "FAILED", "数值差异",
                "100000000", "@round2", "regex:^\\d+(\\.\\d{2})?$", csv);
        return List.of(idField, numField);
    }

    private static Field buildField(String chName, int sn, int idx, String f, String target,
                                    String t, String k, List<String> ctx, String eo, String ao,
                                    String result, String note, String eoUnconverted,
                                    String convRule, String valRule, boolean csv) {
        String x = csv ? "" : target;
        String aoCsv = csv ? target : "";

        List<String> prints = List.of(
                "[INFO] 比较字段 " + f + "（报告渠道 " + chName + " / 来源渠道 " + (sn == 1 ? "A" : "B") + "）",
                "[INFO] " + (csv ? "CSV字段" : "XPath") + "=" + target + "，命中Ctx=" + String.join(",", ctx),
                "[INFO] EO=" + eo + "，AO=" + ao + " → " + result + (note.isEmpty() ? "" : "（" + note + "）"));

        String resultNote = "PASSED".equals(result) ? "比对通过" : ("比对未通过：" + note);
        return Field.builder()
                .id(chName + "-" + sn + "-" + idx)
                .f(f).x(x).aoCsv(aoCsv).t(t).k(k).ctx(ctx)
                .eo(eo).ao(ao).result(result).note(note).resultNote(resultNote)
                .eoConverted(true)
                .eoUnconverted(eoUnconverted)
                .extraResults(List.of(ExtraResult.builder()
                        .label("期望值 (EO, Unconverted)").value(eoUnconverted).build()))
                .conversionRule(CtxRule.builder().ctx(ctx).value(convRule).build())
                .validationRule(CtxRule.builder().ctx(ctx).value(valRule).build())
                .excelMapping("-; " + target)
                .excelConversionRule("-; " + convRule)
                .excelValidationRule("-; " + valRule)
                .prints(prints)
                .build();
    }

    private static Map<String, CtxDef> generateCtxDefs() {
        Map<String, CtxDef> defs = new LinkedHashMap<>();
        for (String name : List.of("HKTR", "JSFA", "CFTC")) {
            String p = name.toLowerCase();
            defs.put(p + ".ctx.default", CtxDef.builder()
                    .def(name + " 默认上下文（标准报送场景）").hits("命中 3 个映射条目（EO 2 / AO 1）").build());
            defs.put(p + ".ctx.v2", CtxDef.builder()
                    .def(name + " v2 上下文（2024 新版映射）").hits("命中 2 个映射条目（EO 1 / AO 1）").build());
        }
        return defs;
    }

    public static void writeTo(Path outDir) throws IOException {
        Files.createDirectories(outDir);
        Path file = outDir.resolve(FILE_NAME);
        Files.writeString(file, MAPPER.writeValueAsString(generate()), StandardCharsets.UTF_8);
    }

    public static void main(String[] args) throws IOException {
        Path out = args.length > 0 ? Path.of(args[0]) : Path.of("generated");
        writeTo(out);
        System.out.println("Generated " + out.resolve(FILE_NAME).toAbsolutePath());
    }
}
