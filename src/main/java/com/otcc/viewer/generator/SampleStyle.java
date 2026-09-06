package com.otcc.viewer.generator;

/**
 * Supported sample-data styles. Each style is also used as the file-name
 * identifier, so that generated files follow the {@code *-<style>.json}
 * convention (for example {@code report-validation-data-basic.json}).
 */
public enum SampleStyle {

    minimal,
    basic;

    /** File-name suffix used for this style, e.g. {@code -basic}. */
    public String suffix() {
        return "-" + name();
    }

    /** Default data file name for this style. */
    public String dataFileName() {
        return "report-validation-data" + suffix() + ".json";
    }

    /** Data file name for this style, with a date identifier when a report date is given. */
    public String dataFileName(String reportDate) {
        return reportDate == null
                ? dataFileName()
                : "report-validation-data" + suffix() + "-" + reportDate + ".json";
    }

    /** Batch metadata file name for this style. */
    public String metaFileName() {
        return "batch-meta" + suffix() + ".json";
    }

    /** Batch metadata file name for this style, with a date identifier when a report date is given. */
    public String metaFileName(String reportDate) {
        return reportDate == null
                ? metaFileName()
                : "batch-meta" + suffix() + "-" + reportDate + ".json";
    }
}
