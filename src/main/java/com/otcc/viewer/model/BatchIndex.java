package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * {@code batches-index.json} model.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class BatchIndex {

    private Integer schemaVersion;
    private String generatedAt;
    private String basedir;
    private Integer count;
    private List<BatchEntry> batches;
}
