package com.otcc.viewer.generator;

import java.io.IOException;
import java.nio.file.Path;

/**
 * Strategy interface for generating one style of JSON sample data.
 *
 * <p>Implementations write their files directly into the given output directory
 * using the {@link #style()} identifier as part of the file name. Adding a new
 * style only requires a new implementation and a new {@link SampleStyle} value.</p>
 */
public interface SampleDataGenerator {

    /** The style handled by this generator. */
    SampleStyle style();

    /**
     * Generates the sample data for this style into {@code outDir}.
     *
     * @param outDir     output directory (created if missing)
     * @param reportDate report date carried by the generated items, or {@code null}
     *                   to use the generator's default date
     */
    void generate(Path outDir, String reportDate) throws IOException;
}
