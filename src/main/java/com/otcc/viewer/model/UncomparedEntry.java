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
    /** 报告渠道；可为 null（全局未比较）。 */
    private String channel;
    /** 来源渠道；可为 null；非 null 时 channel 必非 null。 */
    private String source;
    /** The XPath or CSV field name. */
    private String value;
    private String note;
}