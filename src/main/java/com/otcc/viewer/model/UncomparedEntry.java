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
    /** Report channel; may be {@code null} (global uncompared entry). */
    private String channel;
    /** Source channel; may be {@code null}; when non-null, {@code channel} is non-null too. */
    private String source;
    /** The XPath or CSV field name. */
    private String value;
    private String note;
}