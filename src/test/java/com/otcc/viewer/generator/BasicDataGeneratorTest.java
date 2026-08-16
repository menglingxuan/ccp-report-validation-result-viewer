package com.otcc.viewer.generator;

import com.fasterxml.jackson.databind.JsonNode;
import com.otcc.viewer.model.Channel;
import com.otcc.viewer.model.CtxRule;
import com.otcc.viewer.model.Field;
import com.otcc.viewer.model.ValidationDataset;
import com.otcc.viewer.model.ValidationItem;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Tests for {@link BasicDataGenerator}: one report date, one item, every necessary field filled.
 */
class BasicDataGeneratorTest {

    @TempDir
    Path tmpDir;

    @Test
    void generatesExactlyOneItemAndOneReportDate() {
        ValidationDataset ds = BasicDataGenerator.generate();

        assertNotNull(ds.getItems());
        assertEquals(1, ds.getItems().size());

        ValidationItem item = ds.getItems().get(0);
        assertEquals("BASIC-0001", item.getTradeId());
        assertEquals(BasicDataGenerator.REPORT_DATE, item.getReportDate());

        long distinctDates = ds.getItems().stream()
                .map(ValidationItem::getReportDate)
                .distinct()
                .count();
        assertEquals(1, distinctDates, "only one report date expected");
    }

    @Test
    void everyNecessaryFieldIsFilled() {
        ValidationItem item = BasicDataGenerator.generate().getItems().get(0);

        assertFalse(item.getChannels().isEmpty(), "channels filled");
        assertEquals(3, item.getChannels().size(), "HKTR / JSFA / CFTC");
        assertFalse(item.getSkippedItems().isEmpty(), "skippedItems filled");
        assertFalse(item.getOverviewLogs().isEmpty(), "overviewLogs filled");

        for (Channel ch : item.getChannels()) {
            String label = "channel " + ch.getName();
            boolean csv = "csv".equals(ch.getFormat());

            assertFalse(ch.getFiles().getEo().isEmpty(), label + " files.eo filled");
            assertFalse(ch.getFiles().getAo().isEmpty(), label + " files.ao filled");
            assertNotNull(ch.getFiles().getExcel(), label + " files.excel present");
            assertTrue(ch.getFiles().getExcel().getFile() != null && !ch.getFiles().getExcel().getFile().isBlank(),
                    label + " files.excel.file filled");
            assertTrue(ch.getFiles().getExcel().getSheet() != null && !ch.getFiles().getExcel().getSheet().isBlank(),
                    label + " files.excel.sheet filled");
            assertTrue(ch.getFiles().getExcel().getPath() != null && !ch.getFiles().getExcel().getPath().isBlank(),
                    label + " files.excel.path filled");

            assertEquals(2, ch.getSources().size(), label + " sources A/B");
            assertFalse(ch.getWarnings().isEmpty(), label + " warnings filled");
            assertFalse(ch.getErrors().isEmpty(), label + " errors filled");
            assertFalse(ch.getLogs().isEmpty(), label + " logs filled");

            if (csv) {
                assertFalse(ch.getUncomparedCsv().isEmpty(), label + " uncomparedCsv filled");
                assertTrue(ch.getUncompared().isEmpty(), label + " uncompared empty for csv");
            } else {
                assertFalse(ch.getUncompared().isEmpty(), label + " uncompared filled");
                assertTrue(ch.getUncomparedCsv().isEmpty(), label + " uncomparedCsv empty for xml");
            }

            for (var src : ch.getSources()) {
                assertFalse(src.getFields().isEmpty(), label + " fields filled");
                for (Field f : src.getFields()) {
                    String fl = label + " field " + f.getF();
                    assertTrue(Boolean.TRUE.equals(f.getEoConverted()), fl + " eoConverted true");
                    assertTrue(f.getEoUnconverted() != null && !f.getEoUnconverted().isBlank(),
                            fl + " eoUnconverted filled");
                    assertFalse(f.getExtraResults().isEmpty(), fl + " extraResults filled");
                    assertFalse(f.getCtx().isEmpty(), fl + " ctx filled");
                    assertFalse(f.getPrints().isEmpty(), fl + " prints filled");
                    assertRule(fl, f.getConversionRule());
                    assertRule(fl, f.getValidationRule());
                    assertTrue(f.getExcelMapping() != null && !f.getExcelMapping().isBlank(),
                            fl + " excelMapping filled");
                    assertTrue(f.getExcelConversionRule() != null && !f.getExcelConversionRule().isBlank(),
                            fl + " excelConversionRule filled");
                    assertTrue(f.getExcelValidationRule() != null && !f.getExcelValidationRule().isBlank(),
                            fl + " excelValidationRule filled");
                }
            }
        }

        assertFalse(BasicDataGenerator.generate().getCtxDefs().isEmpty(), "ctxDefs filled");
    }

    @Test
    void serializationRoundTripsWithoutLoss() throws Exception {
        JsonNode root = BasicDataGenerator.MAPPER.valueToTree(BasicDataGenerator.generate());
        ValidationDataset back = BasicDataGenerator.MAPPER.treeToValue(root, ValidationDataset.class);
        assertEquals(root, BasicDataGenerator.MAPPER.valueToTree(back));
    }

    @Test
    void writesOnlyTheRequestedFile() throws Exception {
        BasicDataGenerator.writeTo(tmpDir);

        Path file = tmpDir.resolve(BasicDataGenerator.FILE_NAME);
        assertTrue(Files.isRegularFile(file), "expected file: " + file);

        JsonNode root = BasicDataGenerator.MAPPER.readTree(file.toFile());
        assertEquals(1, root.path("items").size());
        assertEquals(BasicDataGenerator.REPORT_DATE,
                root.path("items").get(0).path("reportDate").asText());
        assertEquals(3, root.path("items").get(0).path("channels").size());
    }

    private static void assertRule(String label, CtxRule rule) {
        assertNotNull(rule, label + " rule present");
        assertTrue(rule.getValue() != null && !rule.getValue().isBlank(), label + " rule.value filled");
        assertFalse(rule.getCtx().isEmpty(), label + " rule.ctx filled");
    }
}
