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

    // ---- 以下为查看器/服务端写入的可选用户态字段（无值时不序列化） ----
    /** 软删除标记：{@code true} 表示批次已删除但仍可见。 */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private Boolean deleted;
    /** 收藏标记。 */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private Boolean favorite;
    /** 批次标签（最多 12 个）。 */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private List<String> tags;
    /** 批次级忽略配置地址（相对批次目录 / web 根）。 */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private String ignoreUrl;
    /**
     * 任务说明扩展内容（只读）：在「任务说明」末尾按 {@code contentType} 渲染；
     * 写入 {@code batch-meta.json}，不进入 {@code batches-index.json}（查看器按索引的
     * {@code metaUrl} 懒加载）。详见 {@link DescriptionEx}。
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private DescriptionEx descriptionEx;
}