package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One side of a field comparison ({@code cmpLeft} / {@code cmpRight}).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CmpSide {
    /** Expected (EO) or actual (AO) value. */
    private String value;
    /** Raw expression of the matched mapping-context keys (e.g. {@code "hktr.ctx.default and hktr.ctx.v2"}), or {@code null}. */
    private String ctxRaw;
    /** All matching mapping-context ids ({@code metaCtxs}). */
    private List<Integer> metaCtxs;
    /** Raw Excel mapping configuration text. */
    private String elRaw;
    /** Source element: CCP XPath (valueSrcFmt=xml) or CSV field name (valueSrcFmt=csv). */
    private String el;
    /** Where the value comes from: {@code csv} or {@code xml}. */
    private String valueSrcFmt;
}
