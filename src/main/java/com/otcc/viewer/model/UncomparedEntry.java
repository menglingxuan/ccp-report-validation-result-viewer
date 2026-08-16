package com.otcc.viewer.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * An uncompared record: xml channels carry {@code xpath}, csv channels carry {@code csvField}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
public class UncomparedEntry {

    private String channel;
    private String xpath;
    private String csvField;
    private String note;
    private String platform;
    private String product;
    private String ctx;
}
