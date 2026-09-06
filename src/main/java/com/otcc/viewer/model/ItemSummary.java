package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Precomputed statistics for one item, embedded in the multi-file manifest
 * ({@code summary}) so the sidebar and stat cards render without loading the item.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ItemSummary {
    private int total;
    private int passed;
    private int failed;
    private int rate;
    private int warnings;
    private int warningsIgnored;
    private int errors;
    private int uncompared;
    private int logs;
}
