package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Top level of the validation data file (single-file mode):
 * {@code { "mode": "single", "reportEnv": "...", "creationType": "...", "skippedItems": [...],
 * "channels": [...], "sources": [...], "items": [...] }}.
 *
 * <p>{@code channels} / {@code sources} are the dataset-level registries: channel and source
 * definitions ({@code id}/{@code name}/{@code desc}/{@code format}) live here once, while the items
 * only keep id references (see {@code docs/DATA_SCHEMA.md} §1/§3.1). The viewer hydrates the
 * definitions back into each item on load, so rendering still works by name.</p>
 *
 * <p>In multi-file mode the manifest repeats all of these top-level fields
 * ({@code mode} / {@code reportEnv} / {@code creationType} / {@code skippedItems} / {@code channels} /
 * {@code sources}) and only replaces {@code items} with a lightweight list (see
 * {@link ManifestItem}); the full items live in separate files.</p>
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
    /** Report channel definitions ({@code id} / {@code name} / {@code desc} / {@code format}). */
    private List<Channel> channels;
    /** Source channel definitions ({@code id} / {@code name}); ids are dataset-wide unique. */
    private List<Source> sources;
    private List<ValidationItem> items;
}