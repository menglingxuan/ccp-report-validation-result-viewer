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
    /** 报告渠道；可为 null（null 表示未关联到具体渠道）。 */
    private String channel;
    /** 来源渠道；可为 null。 */
    private String source;
    private String reason;
}