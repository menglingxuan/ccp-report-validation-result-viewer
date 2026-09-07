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
    /** First matching mapping-context id, or {@code null}. */
    private Integer ctx;
    /** All matching mapping-context ids. */
    private List<Integer> ctxs;
    /** Raw Excel mapping configuration text. */
    private String elRaw;
    /** Source element: CCP XPath (srcType=1) or CSV field name (srcType=2). */
    private String el;
    /** 1 = xpath (xml channel), 2 = csv field. */
    private Integer srcType;
}
