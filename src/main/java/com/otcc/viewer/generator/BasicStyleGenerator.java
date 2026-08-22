package com.otcc.viewer.generator;

import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Generates the {@code basic} style: one report date, one item, fully populated.
 * Output files: {@code deepseek-validator-data-basic.json} and {@code batch-meta-basic.json}.
 */
@Component
public class BasicStyleGenerator implements SampleDataGenerator {

    @Override
    public SampleStyle style() {
        return SampleStyle.basic;
    }

    @Override
    public void generate(Path outDir, String reportDate) throws IOException {
        Files.createDirectories(outDir);

        Path dataFile = outDir.resolve(style().dataFileName(reportDate));
        Files.writeString(dataFile,
                BasicDataGenerator.MAPPER.writeValueAsString(BasicDataGenerator.generate(reportDate)),
                StandardCharsets.UTF_8);

        Path metaFile = outDir.resolve(style().metaFileName(reportDate));
        Files.writeString(metaFile,
                BasicBatchMetaGenerator.MAPPER.writeValueAsString(BasicBatchMetaGenerator.generate(reportDate)),
                StandardCharsets.UTF_8);
    }
}
