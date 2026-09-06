package com.otcc.viewer.generator;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.otcc.viewer.model.BatchMeta;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Basic (fully populated) batch-meta generator.
 * Produces {@code batch-meta-basic.json} with every field filled with at least one value.
 *
 * <p>Independent of {@link ValidationJsonGenerator}; only relies on the shared
 * {@code com.otcc.viewer.model} classes and Jackson.</p>
 */
public final class BasicBatchMetaGenerator {

    private BasicBatchMetaGenerator() {
    }

    public static final String FILE_NAME = "batch-meta-basic.json";

    /** The single fixed report date carried by the generated meta data. */
    public static final String REPORT_DATE = "2026-08-17";

    /** Pretty output, keep nulls (like JSON.stringify), tolerant reads. */
    public static final ObjectMapper MAPPER = new ObjectMapper()
            .enable(SerializationFeature.INDENT_OUTPUT)
            .setSerializationInclusion(JsonInclude.Include.ALWAYS)
            .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);

    public static BatchMeta generate() {
        return generate(REPORT_DATE);
    }

    /** Generates the batch meta for the given report date (or the default when {@code null}). */
    public static BatchMeta generate(String reportDate) {
        String date = reportDate == null ? REPORT_DATE : reportDate;
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("items", 1);
        summary.put("channels", 3);

        return BatchMeta.builder()
                .batchId("batch-basic-0001")
                .batchName("basic-" + date.replace("-", ""))
                .date(date)
                .executedAt(date + "T00:00:00+08:00")
                .formatVersion(2)
                .cwd(System.getProperty("user.dir"))
                .commandLine(List.of("java", "-jar", "ccp-report.jar", "--job=basic",
                        "--date=" + date, "--channels=HKTR,JSFA,CFTC"))
                .argv(List.of("--job=basic", "--date=" + date, "--channels=HKTR,JSFA,CFTC"))
                .summary(summary)
                .description("基础批处理示例：\n- 渠道：HKTR / JSFA / CFTC\n- 范围：单个 item\n- 模式：全字段填充")
                .reportEnv("OTCXXX")
                .dataUrl("report-validation-data-basic.json")
                .dataMode("single")
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
