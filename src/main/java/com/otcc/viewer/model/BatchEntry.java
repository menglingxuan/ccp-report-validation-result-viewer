package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * One batch entry inside {@code batches-index.json}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BatchEntry {

    private String batchId;
    private String batchName;
    private String date;
    private String executedAt;
    private Integer formatVersion;
    private String dataUrl;
    private String ignoreUrl;
    private String path;
    private List<String> commandLine;
    private List<String> argv;
    private String cwd;
    private String description;
    private Map<String, Object> summary;
    private String reportEnv;
}
