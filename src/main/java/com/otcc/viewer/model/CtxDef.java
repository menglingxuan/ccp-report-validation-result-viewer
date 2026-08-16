package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * {@code ctxDefs} value: {@code { def, hits }}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CtxDef {

    private String def;
    private String hits;
}
