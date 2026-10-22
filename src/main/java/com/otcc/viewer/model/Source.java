package com.otcc.viewer.model;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One source channel (A / B): either the dataset-level declaration in
 * {@code dataset.sourceChannelDefs} ({@code id} + {@code name} + {@code format}) or, inside an item,
 * the id reference plus its field comparison results ({@code fields}).
 *
 * <p>Unique within its channel in the item form; the dataset-level declaration table makes the ids
 * dataset-wide unique.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Source {
    /**
     * Stable source id (preset: Source Channel A=1 / Source Channel B=2).
     * Unique within the channel only - different channels may reuse the same id.
     */
    private Integer id;
    /** NON_NULL: inside an item only the id reference + comparison results remain. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private String name;
    /** Source data format ({@code csv} / {@code xml}); declaration side only (NON_NULL). */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private String format;
    /** NON_NULL: the dataset-level declaration entry has no comparison results. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private List<Field> fields;
}