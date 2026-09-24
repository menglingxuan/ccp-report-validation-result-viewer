package com.otcc.viewer.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;
import java.util.Map;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

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
        private String defaultData;
        private String initData;
        private String defaultDataMode;
        private String help;
        private String ignore;
        private String batches;
        private String scan;
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
        private Boolean sourceFilter;
        private Boolean modalRules;
        private Boolean columnHover;
        private Boolean sidebarSearch;
        private Boolean sidebarTradeId;
        private Boolean compare;
        private Boolean healthOverview;
        private Boolean globalSearch;
        private Boolean keyboardShortcuts;
        private Boolean modalPrints;
        private Boolean recentBatches;
        private Boolean batchHelp;
        private Boolean revealPath;
        /** Whether to render the {@code batch-meta.json} {@code descriptionEx} content at the end of the Task Note panel (read-only). */
        private Boolean descriptionEx;
        /**
         * Whether the top bar (next to the help button) shows the "clear preferences" button.
         * It clears only the current tenant scope (localStorage + IndexedDB); server-side data
         * is never touched. Enabled by default except in the prod config.
         */
        private Boolean clearLocalCache;
        /**
         * Whether the top bar (next to the clear button) shows the "home" button, which returns
         * to the site root (origin + pathname, no query/deep link) and reloads. Enabled by
         * default except in the prod config.
         */
        private Boolean homeButton;
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
        /** Page size of the {@code descriptionEx} table in the Task Note panel. */
        private Integer descExPageSize;
        /** Page size of the item list in the ignore-config manager window. */
        private Integer ignoreMgrPageSize;
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