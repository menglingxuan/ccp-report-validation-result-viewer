package com.otcc.viewer.model;

import java.util.List;
import java.util.Map;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * {@code batch-meta.json} model.
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
}