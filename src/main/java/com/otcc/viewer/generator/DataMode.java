package com.otcc.viewer.generator;

/**
 * Output mode of the sample-data generator.
 *
 * <ul>
 *   <li>{@link #single} — one file contains every item ({@code mode: "single"}).</li>
 *   <li>{@link #multi} — a manifest file plus one file per item ({@code mode: "multi"}).</li>
 * </ul>
 */
public enum DataMode {
    single,
    multi;

    /** Parses a mode string ({@code single|multi}, also accepting {@code split} for {@code multi}). */
    public static DataMode parse(String value) {
        if (value == null || value.isBlank()) {
            return single;
        }
        return switch (value.trim().toLowerCase()) {
            case "multi", "split", "multiple" -> multi;
            default -> single;
        };
    }
}
