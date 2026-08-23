package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Top level of {@code deepseek-validation-data.json}: {@code { "items": [...], "ctxDefs": {...}, "reportEnv": "..." }}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ValidationDataset {

    private List<ValidationItem> items;

    /** running environment label (e.g. {@code OTCXXX}); optional, the viewer falls back to its own default */
    private String reportEnv;

    /** key = ctx name, value = {@code { def, hits }} */
    private Map<String, CtxDef> ctxDefs;
}
