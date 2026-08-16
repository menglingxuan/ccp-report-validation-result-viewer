package com.otcc.viewer.generator;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.otcc.viewer.model.Channel;
import com.otcc.viewer.model.ChannelFiles;
import com.otcc.viewer.model.ExcelFile;
import com.otcc.viewer.model.Field;
import com.otcc.viewer.model.Source;
import com.otcc.viewer.model.ValidationDataset;
import com.otcc.viewer.model.ValidationItem;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;

/**
 * Standalone minimal-data generator: produces exactly one report date and one item,
 * written to {@code deepseek-validator-data-me.json}.
 *
 * <p>Independent of {@link ValidationJsonGenerator}; only relies on the shared
 * {@code com.otcc.viewer.model} classes and Jackson.</p>
 */
public final class MinimalDataGenerator {

    private MinimalDataGenerator() {
    }

    public static final String FILE_NAME = "deepseek-validator-data-me.json";

    /** The single fixed report date carried by the generated item. */
    public static final String REPORT_DATE = "2026-08-17";

    /** Minimal mapper: pretty output, omit nulls (keeps the JSON truly minimal), tolerant reads. */
    public static final ObjectMapper MAPPER = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT)
            .setSerializationInclusion(JsonInclude.Include.NON_NULL)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);

    public static ValidationDataset generate() {
        Field field = Field.builder()
                .id("HKTR-1-0")
                .f("tradeId")
                .x("/HKTR/Report/Header/TradeDetails/TradeIdentifier/TradeId")
                .aoCsv("")
                .t("contextAssertion")
                .k("id")
                .ctx(List.of())
                .eo("TX-ME-0001")
                .ao("TX-ME-0001")
                .result("PASSED")
                .note("")
                .prints(List.of())
                .build();

        Source source = Source.builder()
                .name("来源渠道 A")
                .fields(List.of(field))
                .build();

        ChannelFiles files = ChannelFiles.builder()
                .eo(List.of())
                .ao(List.of())
                .excel(ExcelFile.builder().file("mapping.xlsx").sheet("HKTR").build())
                .build();

        Channel channel = Channel.builder()
                .name("HKTR")
                .desc("香港交易资料储存库")
                .format("xml")
                .files(files)
                .sources(List.of(source))
                .warnings(List.of())
                .errors(List.of())
                .uncompared(List.of())
                .uncomparedCsv(List.of())
                .logs(List.of())
                .build();

        ValidationItem item = ValidationItem.builder()
                .tradeId("ME-0001")
                .reportDate(REPORT_DATE)
                .generatedAt(REPORT_DATE + "T00:00:00+08:00")
                .platform("OTC-PLATFORM-A")
                .product("IRS")
                .productCategory("IR")
                .counterpartyItemId("")
                .platformTradeId("PT-ME-0001")
                .platformDealId("PD-ME-0001")
                .enabledChannels(List.of("HKTR"))
                .channels(List.of(channel))
                .skippedItems(List.of())
                .overviewLogs(List.of())
                .build();

        return ValidationDataset.builder()
                .items(List.of(item))
                .ctxDefs(new LinkedHashMap<>())
                .build();
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
