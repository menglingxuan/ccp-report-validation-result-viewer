package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * {@code ctxDefs} value: {@code { type: [...], def, hits }}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CtxDef {
    /** CtxKey type array: 1 = mapping, 2 = conversion, 3 = validation. */
    private List<Integer> type;
    private String def;
    private String hits;
}