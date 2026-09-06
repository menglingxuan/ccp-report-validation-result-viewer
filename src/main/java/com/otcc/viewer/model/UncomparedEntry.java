package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * An uncompared record: merged xpath / csv entries with a {@code type}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UncomparedEntry {
    /** 1 = xpath (xml channel), 2 = csv field (csv channel). */
    private Integer type;
    private String channel;
    /** The XPath or CSV field name. */
    private String value;
    private String note;
}