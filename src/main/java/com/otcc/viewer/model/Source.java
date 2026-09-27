package com.otcc.viewer.model;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One source channel (A / B): either the dataset-level definition in {@code dataset.sources}
 * ({@code id} + {@code name}) or, inside an item, the id reference plus its field comparison
 * results ({@code fields}).
 *
 * <p>Unique within its channel in the item form; the dataset-level registry makes the ids
 * dataset-wide unique.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Source {
    /**
     * Stable source id (preset: 来源渠道 A=1 / 来源渠道 B=2).
     * Unique within the channel only - different channels may reuse the same id.
     */
    private Integer id;
    /** NON_NULL: inside an item only the id reference + comparison results remain. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private String name;
    /** NON_NULL: the dataset-level registry entry has no comparison results. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private List<Field> fields;
}