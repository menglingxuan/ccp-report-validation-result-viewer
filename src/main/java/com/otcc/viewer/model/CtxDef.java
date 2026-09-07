package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * {@code ctxDefs} value: {@code { id, scopes: [...], type, def, hits }}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CtxDef {
    /** Unique integer id within the item's {@code ctxDefs}. */
    private Integer id;
    /** CtxKey scope array: 1 = mapping, 2 = conversion, 3 = validation. */
    private List<Integer> scopes;
    /** Ctx origin: {@code builtin} or {@code user}. */
    private String type;
    private String def;
    private String hits;
}