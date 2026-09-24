package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A skipped item record ({@code skippedItems[]}).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class SkippedItem {
    private String itemId;
    /** Report channel; may be {@code null} (null = not tied to a specific channel). */
    private String channel;
    /** Source channel; may be {@code null}. */
    private String source;
    private String reason;
}