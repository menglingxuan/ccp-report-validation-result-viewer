package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A warning entry inside the ignore config.
 *
 * <p>No {@code kind} field: the enclosing bucket array ({@code warnings} /
 * {@code uncomparedXpaths} / {@code uncomparedCsvs}) already carries the type.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class IgnoreWarning {
    private String channel;
    private String source;
    private String field;
    private String type;
    private String level;
}