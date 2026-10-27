package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * {@code item.ctxDtls} value: {@code { hits }}.
 *
 * <p>Everything else lives in the dataset-level {@code usedCtxKeyDefs} declaration table
 * ({@link CtxKeyDef}): {@code id}, origin type, rule names and the raw definition text. The item only
 * keeps the hit summary, which is item specific; the {@code ctxKey} itself is the map key, so the id is
 * not repeated per item (see {@code docs/DATA_SCHEMA.md} §3.1).</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CtxDetail {
    /** Item specific hit summary. */
    private String hits;
}