package com.otcc.viewer.generator;

import com.fasterxml.jackson.databind.JsonNode;
import com.otcc.viewer.model.Channel;
import com.otcc.viewer.model.Field;
import com.otcc.viewer.model.Source;
import com.otcc.viewer.model.ValidationDataset;
import com.otcc.viewer.model.ValidationItem;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

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

        assertEquals("single", ds.getMode());
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
        assertFalse(item.getLogs().isEmpty(), "logs filled");
        assertFalse(item.getWarnings().isEmpty(), "warnings filled");
        assertFalse(item.getErrors().isEmpty(), "errors filled");
        assertFalse(item.getUncompared().isEmpty(), "uncompared filled");
        assertFalse(item.getCtxDefs().isEmpty(), "ctxDefs filled");

        for (Channel ch : item.getChannels()) {
            String label = "channel " + ch.getName();

            assertFalse(ch.getFields().isEmpty(), label + " fields registry filled");
            assertFalse(ch.getFiles().getEo().isEmpty(), label + " files.eo filled");
            assertFalse(ch.getFiles().getAo().isEmpty(), label + " files.ao filled");
            assertNotNull(ch.getFiles().getExcel(), label + " files.excel present");
            assertTrue(ch.getFiles().getExcel().getFile() != null && !ch.getFiles().getExcel().getFile().isBlank(),
                    label + " files.excel.file filled");
            assertTrue(ch.getFiles().getExcel().getSheet() != null && !ch.getFiles().getExcel().getSheet().isBlank(),
                    label + " files.excel.sheet filled");

            assertEquals(2, ch.getSources().size(), label + " sources A/B");
            for (Source src : ch.getSources()) {
                assertFalse(src.getFields().isEmpty(), label + " fields filled");
                for (Field f : src.getFields()) {
                    String fl = label + " field " + f.getId();
                    assertFalse(f.getCmpLeft().getCtxs().isEmpty(), fl + " cmpLeft.ctxs filled");
                    assertFalse(f.getPrints().isEmpty(), fl + " prints filled");
                    assertNotNull(f.getCmpLeft(), fl + " cmpLeft present");
                    assertNotNull(f.getCmpRight(), fl + " cmpRight present");
                    assertNotNull(f.getCvtLeft(), fl + " cvtLeft present");
                    assertNotNull(f.getCvtRight(), fl + " cvtRight present");
                    assertNotNull(f.getVdt(), fl + " vdt present");
                    assertFalse(f.getResultDetails().isEmpty(), fl + " resultDetails filled");
                }
            }
        }
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
}
