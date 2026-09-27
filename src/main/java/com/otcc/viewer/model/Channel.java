package com.otcc.viewer.model;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One report channel (HKTR / JSFA / CFTC).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Channel {
    /**
     * Stable channel id (preset: HKTR=1 / JSFA=2 / CFTC=3).
     * Used only as a stable identifier for log anchors, internal locators and cross-item
     * association - never for display or URL / ignore-config keys (those stay name based).
     */
    private Integer id;
    /**
     * Definition-side members (the registry entry in {@code dataset.channels}).
     * NON_NULL: inside an item the definition is not repeated - only the id reference remains.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private String name;
    /**
     * Whether this channel takes part in the comparison. Absent means enabled.
     * This is the single enable flag - {@code item.enabledChannels} has been removed.
     * NON_NULL so that enabled channels simply omit the key (the mapper keeps nulls elsewhere).
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private Boolean enabled;
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private String desc;
    /**
     * {@code xml} or {@code csv}
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private String format;
    /**
     * Item-level members ({@code files} / {@code fields} / {@code sources}) are NON_NULL: the same
     * class also represents the dataset-level channel definition in {@code dataset.channels}, where
     * none of them exist.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private ChannelFiles files;
    /** Field definition registry for this report channel ({@code channel.fields}). */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private List<FieldDef> fields;
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private List<Source> sources;
}