package com.otcc.viewer.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One item-level log entry ({@code item.logs[]}), object form:
 * {@code { scope, channelId, sourceId, field, text }}.
 *
 * <p>{@code scope} is {@code item}, {@code channel} or {@code field}:
 * item-scoped lines have no channel / source / field; channel-scoped lines
 * carry a channel id but no field; field-scoped lines carry all of them
 * ({@code field} is the field id from {@code reportChannelDefs[].fieldDefs}).</p>
 *
 * <p>Log lines carry the <b>stable ids only</b> ({@code channelId} / {@code sourceId}); the
 * names are resolved from the dataset's top-level declaration tables by the viewer at load time
 * (see {@code public/core.js} {@code hydrateItem}). {@code text} is display-only content and
 * must <b>never</b> be parsed for channel / source information.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ItemLog {
    /** {@code item}, {@code channel} or {@code field}. */
    private String scope;
    /** Stable source id (resolved to a name by the viewer). */
    private Integer sourceId;
    /** Stable channel id (resolved to a name by the viewer). */
    private Integer channelId;
    /** Field id (references {@code channel.fields}); only set when {@code scope == "field"}. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private String field;
    private String text;
}
