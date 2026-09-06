package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Top level of the validation data file (single-file mode):
 * {@code { "mode": "single", "reportEnv": "...", "items": [...] }}.
 *
 * <p>In multi-file mode the manifest uses the same {@code mode} / {@code reportEnv}
 * fields but a lightweight item list (see {@link ManifestItem}); the full items live
 * in separate files.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ValidationDataset {
    /**
     * {@code "single"} or {@code "multi"}; defaults to {@code "single"} when absent.
     */
    private String mode;
    /**
     * Running environment label (e.g. {@code OTCXXX}); optional.
     */
    private String reportEnv;
    private List<ValidationItem> items;
}