package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * {@code item.fields[]} registry entry: one report field definition shared by all
 * channels / sources of an item. Comparison fields reference it through the
 * numeric-string {@code id} (per-item unique, ordered by first appearance).
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
