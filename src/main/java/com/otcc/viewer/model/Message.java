package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A warning / error message (item level).
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
    private String channel;
    private String type;
    private String level;
    private String text;
    private String field;
}