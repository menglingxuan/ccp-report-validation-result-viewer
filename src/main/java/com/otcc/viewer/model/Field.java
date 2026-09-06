package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A single field comparison result.
 *
 * <p>Nullable rules ({@code cvtLeft}, {@code cvtRight}, {@code vdt}) are intentionally
 * serialized as JSON {@code null} to match the generator reference.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Field {
    /** Numeric-string id referencing {@code item.fields}. */
    private String id;
    /** Hit contexts (mapping / conversion / validation mixed). */
    private List<String> ctxs;
    /** Left side (EO source). */
    private CmpSide cmpLeft;
    /** Right side (AO submitted). */
    private CmpSide cmpRight;
    /** EO value-conversion rule, or {@code null}. */
    private ConversionRule cvtLeft;
    /** AO value-conversion rule, or {@code null}. */
    private ConversionRule cvtRight;
    /** AO final-value validation rule, or {@code null}. */
    private ValidationRule vdt;
    /** {@code PASSED} or {@code FAILED}. */
    private String result;
    /** Remark (e.g. {@code 数值差异}). */
    private String remarks;
    /** Result explanation. */
    private String resultText;
    /** Extra results {@code [{label, value}]}. */
    private List<ExtraResult> resultDetails;
    /** Related print lines. */
    private List<String> prints;
}