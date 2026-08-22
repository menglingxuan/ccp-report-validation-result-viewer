package com.otcc.viewer.generator;

import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Generates the {@code minimal} style: one report date, one item, minimal JSON.
 * Output file: {@code deepseek-validator-data-minimal.json}.
 */
@Component
public class MinimalStyleGenerator implements SampleDataGenerator {

    @Override
    public SampleStyle style() {
        return SampleStyle.minimal;
    }

    @Override
    public void generate(Path outDir, String reportDate) throws IOException {
        Files.createDirectories(outDir);
        Path file = outDir.resolve(style().dataFileName(reportDate));
        Files.writeString(file,
                MinimalDataGenerator.MAPPER.writeValueAsString(MinimalDataGenerator.generate(reportDate)),
                StandardCharsets.UTF_8);
    }
}
