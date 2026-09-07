package com.otcc.viewer.generator;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.otcc.viewer.model.Channel;
import com.otcc.viewer.model.ChannelFiles;
import com.otcc.viewer.model.CmpSide;
import com.otcc.viewer.model.ExcelFile;
import com.otcc.viewer.model.Field;
import com.otcc.viewer.model.FieldDef;
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
 * written to {@code report-validation-data-minimal.json}.
 *
 * <p>Independent of {@link ValidationJsonGenerator}; only relies on the shared
 * {@code com.otcc.viewer.model} classes and Jackson.</p>
 */
public final class MinimalDataGenerator {

    private MinimalDataGenerator() {
    }

    public static final String FILE_NAME = "report-validation-data-minimal.json";

    /** The single fixed report date carried by the generated item. */
    public static final String REPORT_DATE = "2026-08-17";

    /** Minimal mapper: pretty output, omit nulls (keeps the JSON truly minimal), tolerant reads. */
    public static final ObjectMapper MAPPER = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT)
            .setSerializationInclusion(JsonInclude.Include.NON_NULL)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);

    public static ValidationDataset generate() {
        return generate(REPORT_DATE);
    }

    /** Generates the minimal dataset for the given report date (or the default when {@code null}). */
    public static ValidationDataset generate(String reportDate) {
        String date = reportDate == null ? REPORT_DATE : reportDate;
        String target = "/HKTR/Report/Header/TradeDetails/TradeIdentifier/TradeId";

        Field field = Field.builder()
                .id("1")
                .cmpLeft(CmpSide.builder()
                        .value("TX-ME-0001").ctx(null).ctxs(List.of())
                        .elRaw("").el("src_tradeId").srcType(2).build())
                .cmpRight(CmpSide.builder()
                        .value("TX-ME-0001").ctx(null).ctxs(List.of())
                        .elRaw("").el(target).srcType(1).build())
                .result("PASSED")
                .remarks("")
                .resultText("比对通过")
                .resultDetails(List.of())
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
                .fields(List.of(FieldDef.builder().id("1").name("tradeId").userTag("contextAssertion").type("id").build()))
                .sources(List.of(source))
                .build();

        ValidationItem item = ValidationItem.builder()
                .tradeId("ME-0001")
                .reportDate(date)
                .generatedAt(date + "T00:00:00+08:00")
                .platform("OTC-PLATFORM-A")
                .product("IRS")
                .productCategory("IR")
                .counterpartyItemId("")
                .platformTradeId("PT-ME-0001")
                .platformDealId("PD-ME-0001")
                .enabledChannels(List.of("HKTR"))
                .ctxDefs(new LinkedHashMap<>())
                .channels(List.of(channel))
                .skippedItems(List.of())
                .warnings(List.of())
                .errors(List.of())
                .uncompared(List.of())
                .logs(List.of())
                .build();

        return ValidationDataset.builder()
                .mode("single")
                .items(List.of(item))
                .reportEnv("OTCXXX")
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
