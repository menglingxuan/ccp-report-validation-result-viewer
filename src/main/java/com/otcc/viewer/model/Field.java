package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A single field comparison result.
 * Nullable fields ({@code eoUnconverted}, {@code conversionRule}, {@code validationRule})
 * are intentionally serialized as JSON {@code null} to match the original generator.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Field {
    private String id;
    /**
     * report field name
     */
    private String f;
    /**
     * CCP XPath (xml channel; empty for csv)
     */
    private String x;
    /**
     * AO CSV field name (csv channel; empty for xml)
     */
    private String aoCsv;
    /**
     * assertion type: platformAssertion / productAssertion / contextAssertion
     */
    private String t;
    /**
     * value kind: num / date / id / code / text / product / multi
     */
    private String k;
    private List<String> ctx;
    private String eo;
    private String ao;
    /**
     * PASSED or FAILED
     */
    private String result;
    private String note;
    /**
     * result-specific note shown in the detail modal's result row (independent of {@code note})
     */
    private String resultNote;
    private Boolean eoConverted;
    private String eoUnconverted;
    private List<ExtraResult> extraResults;
    private CtxRule conversionRule;
    private CtxRule validationRule;
    private String excelMapping;
    private String excelConversionRule;
    private String excelValidationRule;
    private List<String> prints;
}