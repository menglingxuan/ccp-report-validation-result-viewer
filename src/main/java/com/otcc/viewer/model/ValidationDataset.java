package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Top level of the validation data file (single-file mode):
 * {@code { "mode": "single", "reportEnv": "...", "creationType": "...", "skippedItems": [...], "items": [...] }}.
 *
 * <p>In multi-file mode the manifest repeats all of these top-level fields
 * ({@code mode} / {@code reportEnv} / {@code creationType} / {@code skippedItems}) and only
 * replaces {@code items} with a lightweight list (see {@link ManifestItem}); the full items live
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
    /**
     * Data origin: {@code "sample"} (built-in sample) or {@code "user"} (real user data).
     */
    private String creationType;
    /**
     * Items skipped during comparison (top level, sibling of {@code reportEnv});
     * each entry has {@code channel}/{@code source} which may be {@code null}.
     */
    private List<SkippedItem> skippedItems;
    private List<ValidationItem> items;
}