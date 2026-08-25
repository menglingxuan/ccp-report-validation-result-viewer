package com.otcc.viewer.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A warning / error message. {@code xpath}, {@code csvField} and {@code ctx}
 * are optional (omitted when null), matching the original generator output.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Message {
    private String channel;
    private String platform;
    private String product;
    private String type;
    private String level;
    private String text;
    private String field;
    private String xpath;
    private String csvField;
    private String ctx;
}