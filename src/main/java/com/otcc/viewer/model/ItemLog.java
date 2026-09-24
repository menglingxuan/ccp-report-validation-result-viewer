package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One item-level log entry ({@code item.logs[]}), object form:
 * {@code { scope, channel, source, field, text }}.
 *
 * <p>{@code scope} is {@code item}, {@code channel} or {@code field}:
 * item-scoped lines have {@code null} channel / source / field; channel-scoped lines
 * have a {@code channel} but no {@code field}; field-scoped lines carry all three
 * ({@code field} is the field id from {@code channel.fields}).</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ItemLog {
    /** {@code item}, {@code channel} or {@code field}. */
    private String scope;
    private String channel;
    private String source;
    /** Field id (references {@code channel.fields}); only set when {@code scope == "field"}. */
    private String field;
    private String text;
}
