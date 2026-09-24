package com.otcc.viewer.model;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonInclude;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * {@code batch-meta.json} model.
 *
 * <p>Besides the fields written by the sample generator, the viewer/server also persists user state
 * into the same file: {@code deleted} (soft delete), {@code favorite}, {@code tags} and
 * {@code ignoreUrl}. They are optional and omitted when absent.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BatchMeta {
    private String batchId;
    private String batchName;
    private String date;
    private String executedAt;
    private Integer formatVersion;
    private String cwd;
    private List<String> commandLine;
    private List<String> argv;
    private Map<String, Object> summary;
    private String description;
    private String reportEnv;
    /** Data origin: {@code "sample"} or {@code "user"}. */
    private String creationType;
    /** Relative data-file path (single file or multi-file manifest). */
    private String dataUrl;
    /** {@code "single"} or {@code "multi"}. */
    private String dataMode;

    // ---- Optional user-state fields written by the viewer/server (not serialized when absent) ----
    /** Soft-delete flag: {@code true} means the batch is deleted but still listed. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private Boolean deleted;
    /** Favorite flag. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private Boolean favorite;
    /** Batch tags (up to 12). */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private List<String> tags;
    /** Batch-level ignore-config location (relative to the batch dir / web root). */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private String ignoreUrl;
    /**
     * Task Note extension content (read-only): rendered at the end of the Task Note panel
     * according to {@code contentType}. Written to {@code batch-meta.json} only — it never
     * enters {@code batches-index.json} (the viewer lazy-loads it via the index
     * {@code metaUrl}). See {@link DescriptionEx}.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private DescriptionEx descriptionEx;
}