package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * {@code item.ctxDefs} value: {@code { id, hits }}.
 *
 * <p>The definition itself (origin type, rule names, raw definition text) lives once in the
 * dataset-level {@code usedCtxKeyDefs} declaration table ({@link CtxKeyDef}); the item only keeps the
 * id reference plus the hit summary, which is item specific.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CtxDef {
    /** Reference into {@code dataset.usedCtxKeyDefs} ({@code usedCtxKeyDefs[<ctxKey>].id}). */
    private Integer id;
    /** Item specific hit summary. */
    private String hits;
}