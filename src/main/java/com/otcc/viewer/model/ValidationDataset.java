package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Top level of {@code deepseek-validation-data.json}: {@code { "items": [...], "ctxDefs": {...} }}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ValidationDataset {

    private List<ValidationItem> items;

    /** key = ctx name, value = {@code { def, hits }} */
    private Map<String, CtxDef> ctxDefs;
}
