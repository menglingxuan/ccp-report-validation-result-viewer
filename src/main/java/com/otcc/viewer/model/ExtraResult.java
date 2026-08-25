package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * {@code extraResults[]} entry: {@code { label, value }}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ExtraResult {
    private String label;
    private String value;
}