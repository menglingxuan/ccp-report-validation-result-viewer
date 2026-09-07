package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A value-conversion rule ({@code cvtLeft} / {@code cvtRight}). {@code null} when the
 * field has no conversion configured.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ConversionRule {
    /** First conversion-context id, or {@code null}. */
    private Integer ctx;
    /** All conversion-context ids. */
    private List<Integer> ctxs;
    /** Rule value (e.g. {@code @round2}, {@code @toUpper}). */
    private String el;
    /** Raw Excel conversion-rule configuration text. */
    private String elRaw;
    /** Unconverted raw value (EO or AO side; {@code null} when not converted). */
    private String raw;
}
