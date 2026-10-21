package com.otcc.viewer.generator;

import com.fasterxml.jackson.databind.JsonNode;
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
 * Tests for {@link MinimalDataGenerator}: one report date, one item, minimal JSON, no data loss.
 */
class MinimalDataGeneratorTest {

    @TempDir
    Path tmpDir;

    @Test
    void generatesExactlyOneItemAndOneReportDate() {
        ValidationDataset ds = MinimalDataGenerator.generate();

        assertEquals("single", ds.getMode());
        assertNotNull(ds.getItems());
        assertEquals(1, ds.getItems().size());

        ValidationItem item = ds.getItems().get(0);
        assertEquals("ME-0001", item.getTradeId());
        assertEquals(MinimalDataGenerator.REPORT_DATE, item.getReportDate());

        long distinctDates = ds.getItems().stream()
                .map(ValidationItem::getReportDate)
                .distinct()
                .count();
        assertEquals(1, distinctDates, "only one report date expected");
    }

    @Test
    void singleItemHasOneChannelOneSourceOneField() {
        ValidationDataset ds = MinimalDataGenerator.generate();
        ValidationItem item = ds.getItems().get(0);

        // 定义在顶层声明表里（item 里只有 id 引用）——与查看器 hydrateDataset 的契约一致。
        assertEquals(1, ds.getReportChannelDefs().size(), "顶层 reportChannelDefs 声明表");
        assertEquals(1, ds.getSourceChannelDefs().size(), "顶层 sourceChannelDefs 声明表");
        assertEquals("HKTR", ds.getReportChannelDefs().get(0).getName());
        assertEquals("xml", ds.getReportChannelDefs().get(0).getFormat());
        assertEquals(1, ds.getReportChannelDefs().get(0).getFieldDefs().size(), "字段定义在声明表里");
        assertEquals("来源渠道 A", ds.getSourceChannelDefs().get(0).getName());
        assertEquals("csv", ds.getSourceChannelDefs().get(0).getFormat(), "来源渠道声明带 format");

        assertEquals(1, item.getChannels().size());
        var channel = item.getChannels().get(0);
        assertEquals(ds.getReportChannelDefs().get(0).getId(), channel.getId(), "item 渠道只留 id 引用");
        assertEquals(null, channel.getName(), "item 里不重复写渠道名");
        assertEquals(null, channel.getFieldDefs(), "item 里不写字段定义");

        assertEquals(1, channel.getSources().size());
        assertEquals(ds.getSourceChannelDefs().get(0).getId(), channel.getSources().get(0).getId(), "item 来源渠道只留 id 引用");
        assertEquals(1, channel.getSources().get(0).getFields().size());

        var field = channel.getSources().get(0).getFields().get(0);
        assertEquals("PASSED", field.getResult());
        assertTrue(field.getPrints() instanceof List, "prints must be a list");
    }

    @Test
    void serializationOmitsOptionalNullsAndRoundTrips() throws Exception {
        JsonNode root = MinimalDataGenerator.MAPPER.valueToTree(MinimalDataGenerator.generate());
        JsonNode field = root.path("items").get(0).path("channels").get(0)
                .path("sources").get(0).path("fields").get(0);

        // Minimality: optional rules that are null must not appear in the JSON.
        assertFalse(field.has("cvtLeft"));
        assertFalse(field.has("cvtRight"));
        assertFalse(field.has("vdt"));

        // Round-trip: deserialize and re-serialize must be lossless.
        ValidationDataset back = MinimalDataGenerator.MAPPER.treeToValue(root, ValidationDataset.class);
        assertEquals(root, MinimalDataGenerator.MAPPER.valueToTree(back));
    }

    @Test
    void writesOnlyTheRequestedFile() throws Exception {
        MinimalDataGenerator.writeTo(tmpDir);

        Path file = tmpDir.resolve(MinimalDataGenerator.FILE_NAME);
        assertTrue(Files.isRegularFile(file), "expected file: " + file);

        JsonNode root = MinimalDataGenerator.MAPPER.readTree(file.toFile());
        assertEquals(1, root.path("items").size());
        assertEquals(MinimalDataGenerator.REPORT_DATE,
                root.path("items").get(0).path("reportDate").asText());
    }
}
