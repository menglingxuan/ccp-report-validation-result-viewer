package com.otcc.viewer.generator;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.ValidationMessage;
import com.otcc.viewer.model.BatchIndex;
import com.otcc.viewer.model.BatchMeta;
import com.otcc.viewer.model.Channel;
import com.otcc.viewer.model.Field;
import com.otcc.viewer.model.Message;
import com.otcc.viewer.model.PlatformIgnore;
import com.otcc.viewer.model.SkippedItem;
import com.otcc.viewer.model.UncomparedEntry;
import com.otcc.viewer.model.ValidationConfig;
import com.otcc.viewer.model.ValidationDataset;
import com.otcc.viewer.model.ValidationItem;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Test engine: generates every JSON file the viewer needs, writes them under
 * {@code generated/}, then fully validates them (JSON Schema, structure, round-trip).
 */
class ValidationJsonEngineTest {

    static final Path OUT_DIR = Path.of("generated");
    static final Path SCHEMA_PATH = Path.of("exapp", "viewer_frontend", "main", "config.schema.json");

    static ValidationDataset dataset;
    static ValidationConfig config;
    static Map<String, PlatformIgnore> ignore;
    static BatchIndex batchIndex;
    static BatchMeta batchMeta;

    static JsonNode dataJson;
    static JsonNode configJson;
    static JsonNode ignoreJson;
    static JsonNode indexJson;
    static JsonNode metaJson;

    static final List<String> GENERATED_FILES = new ArrayList<>();

    @BeforeAll
    static void setUp() throws Exception {
        ValidationJsonGenerator.writeAll(OUT_DIR);
        GENERATED_FILES.addAll(List.of(
                "deepseek-validation-data.json",
                "deepseek-validation-config.json",
                "ignore-config-by-platform.json",
                "batches-index.json",
                "batches/2026-08-16/batch-20260816-0400/batch-meta.json",
                "batches/2026-08-16/batch-20260816-0400/deepseek-validation-data.json"));

        dataJson = readTree("deepseek-validation-data.json");
        configJson = readTree("deepseek-validation-config.json");
        ignoreJson = readTree("ignore-config-by-platform.json");
        indexJson = readTree("batches-index.json");
        metaJson = readTree("batches/2026-08-16/batch-20260816-0400/batch-meta.json");

        dataset = ValidationJsonGenerator.MAPPER.treeToValue(dataJson, ValidationDataset.class);
        config = ValidationJsonGenerator.MAPPER.treeToValue(configJson, ValidationConfig.class);
        ignore = ValidationJsonGenerator.MAPPER.convertValue(ignoreJson, new TypeReference<>() {});
        batchIndex = ValidationJsonGenerator.MAPPER.treeToValue(indexJson, BatchIndex.class);
        batchMeta = ValidationJsonGenerator.MAPPER.treeToValue(metaJson, BatchMeta.class);
    }

    @AfterAll
    static void report() {
        System.out.println("=== ValidationJsonEngineTest ===");
        System.out.println("Generated files under: " + OUT_DIR.toAbsolutePath());
        for (String f : GENERATED_FILES) {
            System.out.println("  - " + f);
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Tests                                                             */
    /* ------------------------------------------------------------------ */

    @Test
    void allExpectedFilesAreGenerated() {
        Check c = new Check();
        for (String f : GENERATED_FILES) {
            c.check(Files.isRegularFile(OUT_DIR.resolve(f)), "missing generated file: " + f);
        }
        c.done();
    }

    @Test
    void dataJsonStructureIsValid() {
        Check c = new Check();
        c.check(dataset.getItems() != null && !dataset.getItems().isEmpty(), "items must be non-empty");
        c.check(dataset.getCtxDefs() != null && !dataset.getCtxDefs().isEmpty(), "ctxDefs must be non-empty");

        Set<String> ctxDefKeys = dataset.getCtxDefs().keySet();
        for (Map.Entry<String, com.otcc.viewer.model.CtxDef> e : dataset.getCtxDefs().entrySet()) {
            c.check(nonBlank(e.getKey()), "ctxDef key must be non-blank");
            c.check(nonBlank(e.getValue().getDef()), "ctxDef[" + e.getKey() + "].def must be non-blank");
            c.check(nonBlank(e.getValue().getHits()), "ctxDef[" + e.getKey() + "].hits must be non-blank");
        }

        for (int i = 0; i < dataset.getItems().size(); i++) {
            ValidationItem item = dataset.getItems().get(i);
            String it = "items[" + i + "]";
            c.check(nonBlank(item.getTradeId()), it + ".tradeId non-blank");
            c.check(nonBlank(item.getReportDate()), it + ".reportDate non-blank");
            c.check(nonBlank(item.getGeneratedAt()), it + ".generatedAt non-blank");
            c.check(nonBlank(item.getPlatform()), it + ".platform non-blank");
            c.check(nonBlank(item.getProduct()), it + ".product non-blank");
            c.check(nonBlank(item.getProductCategory()), it + ".productCategory non-blank");
            c.check(item.getPlatformTradeId() != null, it + ".platformTradeId present");
            c.check(item.getPlatformDealId() != null, it + ".platformDealId present");

            c.check(item.getChannels() != null && !item.getChannels().isEmpty(), it + ".channels non-empty");
            Set<String> channelNames = new HashSet<>();
            if (item.getChannels() != null) {
                for (Channel ch : item.getChannels()) {
                    channelNames.add(ch.getName());
                }
                c.check(channelNames.size() == item.getChannels().size(), it + ".channels names must be unique");
            }
            c.check(item.getEnabledChannels() != null && !item.getEnabledChannels().isEmpty(), it + ".enabledChannels non-empty");
            if (item.getEnabledChannels() != null) {
                for (String en : item.getEnabledChannels()) {
                    c.check(channelNames.contains(en), it + ".enabledChannels references existing channel: " + en);
                }
            }
            c.check(item.getOverviewLogs() != null && !item.getOverviewLogs().isEmpty(), it + ".overviewLogs non-empty");
            if (item.getSkippedItems() != null) {
                for (SkippedItem s : item.getSkippedItems()) {
                    c.check(nonBlank(s.getItemId()), it + ".skippedItems.itemId non-blank");
                    c.check(nonBlank(s.getReason()), it + ".skippedItems.reason non-blank");
                    c.check("ALL".equals(s.getChannel()) || Set.of("HKTR", "JSFA", "CFTC").contains(s.getChannel()),
                            it + ".skippedItems.channel valid: " + s.getChannel());
                }
            }

            if (item.getChannels() != null) {
                for (int j = 0; j < item.getChannels().size(); j++) {
                    validateChannel(c, item.getChannels().get(j), it + ".channels[" + j + "]", ctxDefKeys);
                }
            }
        }
        c.done();
    }

    @Test
    void configConformsToJsonSchema() {
        Check c = new Check();
        c.check(Files.isRegularFile(SCHEMA_PATH), "schema file not found: " + SCHEMA_PATH);
        try {
            JsonNode schemaNode = ValidationJsonGenerator.MAPPER.readTree(Files.readString(SCHEMA_PATH));
            JsonSchemaFactory factory = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V7);
            JsonSchema schema = factory.getSchema(schemaNode);
            Set<ValidationMessage> errors = schema.validate(configJson);
            for (ValidationMessage m : errors) {
                c.fail("config schema violation: " + m.getInstanceLocation() + " -> " + m.getMessage());
            }
        } catch (Exception e) {
            c.fail("schema validation threw: " + e.getMessage());
        }
        c.done();
    }

    @Test
    void serializationRoundTripsWithoutLoss() {
        Check c = new Check();
        try {
            assertTreeRoundTrip(c, "dataset", dataJson, dataset);
            assertTreeRoundTrip(c, "config", configJson, config);
            assertTreeRoundTrip(c, "ignore", ignoreJson, ignore);
            assertTreeRoundTrip(c, "batchIndex", indexJson, batchIndex);
            assertTreeRoundTrip(c, "batchMeta", metaJson, batchMeta);
        } catch (Exception e) {
            c.fail("round-trip threw: " + e.getMessage());
        }
        c.done();
    }

    @Test
    void batchFilesAreConsistent() {
        Check c = new Check();
        c.check(batchIndex.getCount() != null && batchIndex.getCount() == 1, "batchIndex.count == 1");
        c.check(batchIndex.getBatches() != null && batchIndex.getBatches().size() == 1, "batchIndex.batches.size == 1");

        if (batchIndex.getBatches() != null && !batchIndex.getBatches().isEmpty()) {
            var entry = batchIndex.getBatches().get(0);
            c.check(nonBlank(entry.getBatchId()), "batch entry batchId non-blank");
            c.check(nonBlank(entry.getDataUrl()), "batch entry dataUrl non-blank");
            c.check(nonBlank(entry.getIgnoreUrl()), "batch entry ignoreUrl non-blank");
            c.check(entry.getSummary() != null && entry.getSummary().containsKey("items"), "batch entry summary.items present");

            Path dataFile = OUT_DIR.resolve(entry.getDataUrl());
            c.check(Files.isRegularFile(dataFile), "batch dataUrl resolves to a file: " + entry.getDataUrl());

            Object summaryItems = entry.getSummary() != null ? entry.getSummary().get("items") : null;
            c.check(summaryItems != null && Integer.valueOf(String.valueOf(summaryItems)) == dataset.getItems().size(),
                    "summary.items == dataset.items.size()");
        }

        Object metaItems = batchMeta.getSummary() != null ? batchMeta.getSummary().get("items") : null;
        c.check(metaItems != null && Integer.valueOf(String.valueOf(metaItems)) == dataset.getItems().size(),
                "batchMeta.summary.items == dataset.items.size()");
        c.check(batchMeta.getSummary() != null && batchMeta.getSummary().containsKey("channels"), "batchMeta.summary.channels present");
        c.done();
    }

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                           */
    /* ------------------------------------------------------------------ */

    private static JsonNode readTree(String rel) throws Exception {
        return ValidationJsonGenerator.MAPPER.readTree(OUT_DIR.resolve(rel).toFile());
    }

    private static void validateChannel(Check c, Channel ch, String label, Set<String> ctxDefKeys) {
        c.check(nonBlank(ch.getName()), label + ".name non-blank");
        c.check(nonBlank(ch.getDesc()), label + ".desc non-blank");
        c.check("xml".equals(ch.getFormat()) || "csv".equals(ch.getFormat()), label + ".format in {xml,csv}");
        boolean csv = "csv".equals(ch.getFormat());

        c.check(ch.getFiles() != null, label + ".files present");
        if (ch.getFiles() != null) {
            c.check(ch.getFiles().getEo() != null && !ch.getFiles().getEo().isEmpty(), label + ".files.eo non-empty");
            c.check(ch.getFiles().getAo() != null && !ch.getFiles().getAo().isEmpty(), label + ".files.ao non-empty");
            if (ch.getFiles().getEo() != null) {
                for (var fe : ch.getFiles().getEo()) {
                    c.check(nonBlank(fe.getName()), label + ".files.eo entry name non-blank");
                }
            }
            c.check(ch.getFiles().getExcel() != null, label + ".files.excel present");
            if (ch.getFiles().getExcel() != null) {
                c.check(nonBlank(ch.getFiles().getExcel().getFile()), label + ".files.excel.file non-blank");
                c.check(nonBlank(ch.getFiles().getExcel().getSheet()), label + ".files.excel.sheet non-blank");
            }
        }

        c.check(ch.getSources() != null && ch.getSources().size() == 2, label + ".sources size == 2");
        if (ch.getSources() != null) {
            for (var src : ch.getSources()) {
                c.check(nonBlank(src.getName()), label + ".source.name non-blank");
                c.check(src.getFields() != null && !src.getFields().isEmpty(), label + ".source.fields non-empty");
                if (src.getFields() != null) {
                    for (Field f : src.getFields()) {
                        validateField(c, f, label, csv, ctxDefKeys);
                    }
                }
            }
        }

        validateMessages(c, ch.getWarnings(), label + ".warnings", ch.getName());
        validateMessages(c, ch.getErrors(), label + ".errors", ch.getName());

        if (ch.getUncompared() != null) {
            for (UncomparedEntry u : ch.getUncompared()) {
                c.check(nonBlank(u.getXpath()), label + ".uncompared.xpath non-blank");
                c.check(u.getCsvField() == null, label + ".uncompared.csvField must be null for xml");
            }
        }
        if (ch.getUncomparedCsv() != null) {
            for (UncomparedEntry u : ch.getUncomparedCsv()) {
                c.check(nonBlank(u.getCsvField()), label + ".uncomparedCsv.csvField non-blank");
                c.check(u.getXpath() == null, label + ".uncomparedCsv.xpath must be null for csv");
            }
        }
        c.check(ch.getLogs() != null && !ch.getLogs().isEmpty(), label + ".logs non-empty");
    }

    private static void validateField(Check c, Field f, String label, boolean csv, Set<String> ctxDefKeys) {
        c.check(nonBlank(f.getId()), label + ".field.id non-blank");
        c.check(nonBlank(f.getF()), label + ".field.f non-blank");
        c.check(nonBlank(f.getT()), label + ".field.t non-blank");
        c.check(nonBlank(f.getK()), label + ".field.k non-blank");
        c.check(nonBlank(f.getEo()), label + ".field.eo non-blank");
        c.check(nonBlank(f.getAo()), label + ".field.ao non-blank");
        c.check("PASSED".equals(f.getResult()) || "FAILED".equals(f.getResult()), label + ".field.result in {PASSED,FAILED}");

        if (csv) {
            c.check(nonBlank(f.getAoCsv()), label + ".field.aoCsv non-blank for csv");
            c.check(f.getX() == null || f.getX().isEmpty(), label + ".field.x must be empty for csv");
        } else {
            c.check(nonBlank(f.getX()), label + ".field.x non-blank for xml");
            c.check(f.getAoCsv() == null || f.getAoCsv().isEmpty(), label + ".field.aoCsv must be empty for xml");
        }

        c.check(f.getCtx() != null && !f.getCtx().isEmpty(), label + ".field.ctx non-empty");
        if (f.getCtx() != null) {
            for (String ctx : f.getCtx()) {
                c.check(ctxDefKeys.contains(ctx), label + ".field.ctx defined in ctxDefs: " + ctx);
            }
        }

        c.check(f.getEoConverted() != null, label + ".field.eoConverted present");
        if (Boolean.TRUE.equals(f.getEoConverted())) {
            c.check(nonBlank(f.getEoUnconverted()), label + ".field.eoUnconverted non-blank when converted");
            c.check(f.getExtraResults() != null && !f.getExtraResults().isEmpty(), label + ".field.extraResults non-empty when converted");
            c.check(f.getConversionRule() != null, label + ".field.conversionRule present when converted");
        } else {
            c.check(f.getEoUnconverted() == null, label + ".field.eoUnconverted must be null when not converted");
            c.check(f.getConversionRule() == null, label + ".field.conversionRule must be null when not converted");
        }
        c.check(f.getPrints() != null && !f.getPrints().isEmpty(), label + ".field.prints non-empty");
        c.check(nonBlank(f.getExcelMapping()), label + ".field.excelMapping non-blank");
        c.check(nonBlank(f.getExcelConversionRule()), label + ".field.excelConversionRule non-blank");
        c.check(nonBlank(f.getExcelValidationRule()), label + ".field.excelValidationRule non-blank");
    }

    private static void validateMessages(Check c, List<Message> msgs, String label, String channelName) {
        c.check(msgs != null, label + " present");
        if (msgs == null) {
            return;
        }
        for (Message m : msgs) {
            c.check(channelName.equals(m.getChannel()), label + ".channel matches: " + m.getChannel());
            c.check(nonBlank(m.getType()), label + ".type non-blank");
            c.check(nonBlank(m.getLevel()), label + ".level non-blank");
            c.check(nonBlank(m.getText()), label + ".text non-blank");
            c.check(m.getField() != null, label + ".field present (may be empty)");
        }
    }

    private static void assertTreeRoundTrip(Check c, String name, JsonNode original, Object model) {
        try {
            JsonNode reSerialized = ValidationJsonGenerator.MAPPER.valueToTree(model);
            if (!original.equals(reSerialized)) {
                c.fail(name + " round-trip mismatch: original != re-serialized");
            }
        } catch (Exception e) {
            c.fail(name + " round-trip threw: " + e.getMessage());
        }
    }

    private static boolean nonBlank(String s) {
        return s != null && !s.isBlank();
    }

    /** Accumulating assertion helper so one test reports all failures. */
    static final class Check {
        private final List<String> failures = new ArrayList<>();

        void check(boolean cond, String message) {
            if (!cond) {
                failures.add(message);
            }
        }

        void fail(String message) {
            failures.add(message);
        }

        void done() {
            if (!failures.isEmpty()) {
                throw new AssertionError("validation failures (" + failures.size() + "):\n  - "
                        + String.join("\n  - ", failures));
            }
        }
    }
}
