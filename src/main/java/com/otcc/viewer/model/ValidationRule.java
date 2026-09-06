package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * An AO final-value validation rule ({@code vdt}). {@code null} when no validation
 * is configured for the field.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ValidationRule {
    /** First validation-context key, or {@code null}. */
    private String ctx;
    /** All validation-context keys. */
    private List<String> ctxs;
    /** Rule value (e.g. {@code enum: [...]}, {@code regex:...}). */
    private String el;
    /** Raw Excel validation-rule configuration text. */
    private String elRaw;
}
