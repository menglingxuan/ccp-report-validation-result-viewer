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
    /** First validation-context id, or {@code null}. */
    private Integer ctx;
    /** All validation-context ids. */
    private List<Integer> ctxs;
    /** Rule value (e.g. {@code enum: [...]}, {@code regex:...}). */
    private String el;
    /** Raw Excel validation-rule configuration text. */
    private String elRaw;
}
