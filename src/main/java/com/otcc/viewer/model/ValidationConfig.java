package com.otcc.viewer.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * {@code deepseek-validation-config.json} model, mirroring {@code config.schema.json}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ValidationConfig {

    private Integer configVersion;
    private String runType;
    private Urls urls;
    private Ui ui;
    private Features features;
    private Limits limits;
    private BatchesConfig batches;
    private ColumnsConfig columns;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Urls {
        private String data;
        private String ignore;
        private String batches;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Ui {
        private String lang;
        private String theme;
        private String sidebarMode;
        private Integer sidebarWidth;
        private String reportCatDefault;
        private String batchDockSide;
        private String progressBarStyle;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Features {
        private Boolean uncomparedXpath;
        private Boolean uncomparedItems;
        private Boolean uncomparedCsv;
        private Boolean logs;
        private Boolean conversionRule;
        private Boolean validationRule;
        private Boolean excelMapping;
        private Boolean excelConversionRule;
        private Boolean excelValidationRule;
        private Boolean columnHover;
        private Boolean sidebarSearch;
        private Boolean sidebarTradeId;
        private Boolean compare;
        private Boolean healthOverview;
        private Boolean globalSearch;
        private Boolean keyboardShortcuts;
        private Boolean modalPrints;
        private Boolean recentBatches;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Limits {
        private Integer pageSize;
        private List<Integer> pageSizeOptions;
        private Integer sidebarPageSize;
        private Integer msgPageSize;
        private Integer globalSearchLimit;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class BatchesConfig {
        private Integer recentCount;
        private Integer pageSize;
        private String listMode;
        private String detailMode;
        private Integer panelWidth;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ColumnsConfig {
        @JsonProperty("default")
        private Map<String, Boolean> defaults;
    }
}
