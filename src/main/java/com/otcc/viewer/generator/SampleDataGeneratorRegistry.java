package com.otcc.viewer.generator;

import org.springframework.stereotype.Component;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * Resolves a {@link SampleDataGenerator} by {@link SampleStyle}. All Spring beans
 * implementing {@link SampleDataGenerator} are discovered automatically, so adding
 * a new style only requires registering a new implementation.
 */
@Component
public class SampleDataGeneratorRegistry {

    private final Map<SampleStyle, SampleDataGenerator> generators = new EnumMap<>(SampleStyle.class);

    public SampleDataGeneratorRegistry(List<SampleDataGenerator> discovered) {
        for (SampleDataGenerator generator : discovered) {
            generators.put(generator.style(), generator);
        }
    }

    public SampleDataGenerator get(SampleStyle style) {
        SampleDataGenerator generator = generators.get(style);
        if (generator == null) {
            throw new IllegalArgumentException("No generator registered for style: " + style);
        }
        return generator;
    }
}
