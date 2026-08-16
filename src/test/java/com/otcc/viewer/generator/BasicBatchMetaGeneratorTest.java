package com.otcc.viewer.generator;

import com.fasterxml.jackson.databind.JsonNode;
import com.otcc.viewer.model.BatchMeta;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Tests for {@link BasicBatchMetaGenerator}: every field filled, lossless round-trip, file written.
 */
class BasicBatchMetaGeneratorTest {

    @TempDir
    Path tmpDir;

    @Test
    void everyFieldIsFilled() {
        BatchMeta meta = BasicBatchMetaGenerator.generate();

        assertTrue(meta.getBatchId() != null && !meta.getBatchId().isBlank(), "batchId filled");
        assertTrue(meta.getBatchName() != null && !meta.getBatchName().isBlank(), "batchName filled");
        assertTrue(meta.getDate() != null && !meta.getDate().isBlank(), "date filled");
        assertTrue(meta.getExecutedAt() != null && !meta.getExecutedAt().isBlank(), "executedAt filled");
        assertNotNull(meta.getFormatVersion(), "formatVersion filled");
        assertTrue(meta.getCwd() != null && !meta.getCwd().isBlank(), "cwd filled");

        assertFalse(meta.getCommandLine().isEmpty(), "commandLine filled");
        assertFalse(meta.getArgv().isEmpty(), "argv filled");

        assertNotNull(meta.getSummary(), "summary present");
        assertFalse(meta.getSummary().isEmpty(), "summary filled");
        assertTrue(meta.getSummary().containsKey("items"), "summary.items present");
        assertTrue(meta.getSummary().containsKey("channels"), "summary.channels present");

        assertTrue(meta.getDescription() != null && !meta.getDescription().isBlank(), "description filled");
    }

    @Test
    void serializationRoundTripsWithoutLoss() throws Exception {
        JsonNode root = BasicBatchMetaGenerator.MAPPER.valueToTree(BasicBatchMetaGenerator.generate());
        BatchMeta back = BasicBatchMetaGenerator.MAPPER.treeToValue(root, BatchMeta.class);
        assertEquals(root, BasicBatchMetaGenerator.MAPPER.valueToTree(back));
    }

    @Test
    void writesOnlyTheRequestedFile() throws Exception {
        BasicBatchMetaGenerator.writeTo(tmpDir);

        Path file = tmpDir.resolve(BasicBatchMetaGenerator.FILE_NAME);
        assertTrue(Files.isRegularFile(file), "expected file: " + file);

        JsonNode root = BasicBatchMetaGenerator.MAPPER.readTree(file.toFile());
        assertEquals("batch-basic-0001", root.path("batchId").asText());
        assertEquals(2, root.path("formatVersion").asInt());
        assertEquals(1, root.path("summary").path("items").asInt());
        assertEquals(3, root.path("summary").path("channels").asInt());
    }
}
