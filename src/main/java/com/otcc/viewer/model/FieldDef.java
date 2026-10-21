package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One report field definition: {@code reportChannelDefs[].fieldDefs[]} entry.
 *
 * <p>Field ids are unique within their report channel (the sample data also keeps them unique
 * dataset-wide: HKTR 1..13 / JSFA 21..33 / CFTC 41..53). Comparison results reference the definition
 * through the numeric-string {@code id}: {@code channels[].sources[].fields[].id}, resolved against
 * the fieldDefs of the parent report channel.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FieldDef {
    /** Numeric string id (e.g. {@code "1"}, {@code "2"}). */
    private String id;
    /** Report field name (e.g. {@code tradeId}, {@code notional}). */
    private String name;
    /** Assertion type: platformAssertion / productAssertion / contextAssertion. */
    private String userTag;
    /** Value kind: id / num / date / code / product / text / multi. */
    private String type;
}
