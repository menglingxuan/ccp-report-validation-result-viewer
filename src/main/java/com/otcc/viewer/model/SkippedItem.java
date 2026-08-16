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
    private String channel;
    private String reason;
}
