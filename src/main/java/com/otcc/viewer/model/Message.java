package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A warning / error message (item level).
 *
 * <p>Messages carry the channel / source **names only**: they are small in number and read by
 * humans, so raw readability wins over the ids. Stable ids are only kept where they are needed for
 * locating ({@code item.logs[]}, {@code skippedItems[]}).</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Message {
    /** {@code field} or {@code channel}. */
    private String scope;
    /** Source channel name; may be empty when the source is unknown. */
    private String source;
    /** Report channel name (must be declared in {@code reportChannelDefs}). */
    private String channel;
    private String type;
    private String level;
    private String text;
    private String field;
}