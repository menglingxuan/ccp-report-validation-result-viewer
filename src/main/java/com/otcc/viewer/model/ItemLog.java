package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One item-level log entry ({@code item.logs[]}), object form:
 * {@code { scope, channel, source, text }}. {@code channel} / {@code source} are
 * {@code null} for item-scoped lines.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ItemLog {
    /** {@code item} or {@code channel}. */
    private String scope;
    private String channel;
    private String source;
    private String text;
}
