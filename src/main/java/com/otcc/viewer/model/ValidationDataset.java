package com.otcc.viewer.model;

import java.util.List;
import java.util.Map;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Top level of the validation data file (single-file mode):
 * {@code { "mode": "single", "reportEnv": "...", "creationType": "...",
 * "reportChannelDefs": [...], "sourceChannelDefs": [...], "usedCtxKeyDefs": {...},
 * "skippedItems": [...], "items": [...] }}.
 *
 * <p>{@code reportChannelDefs} / {@code sourceChannelDefs} / {@code usedCtxKeyDefs} are the dataset-level
 * declaration tables: channel definitions (incl. {@code fieldDefs}), source channel definitions
 * (incl. {@code format}) and ctxKey definitions (incl. {@code rules}) live here once, while the items
 * only keep id references (see {@code docs/DATA_SCHEMA.md} §1/§3.1). The viewer hydrates the
 * definitions back into each item on load, so rendering still works by name.</p>
 *
 * <p>In multi-file mode the manifest repeats all of these top-level fields
 * ({@code mode} / {@code reportEnv} / {@code creationType} / {@code reportChannelDefs} /
 * {@code sourceChannelDefs} / {@code usedCtxKeyDefs} / {@code skippedItems}) and only replaces
 * {@code items} with a lightweight list (see {@link ManifestItem}); the full items live in separate files.</p>
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
    /** Report channel declarations: {@code id} / {@code name} / {@code desc} / {@code format} / {@code fieldDefs}. */
    private List<Channel> reportChannelDefs;
    /** Source channel declarations: {@code id} / {@code name} / {@code format} (csv / xml). */
    private List<Source> sourceChannelDefs;
    /**
     * ctxKey declarations of the ctxKeys actually used by the items:
     * ctxKey -> {@code { id, type, rules, def }} (rules: fdm / cvt / vdt).
     * Items only keep {@code ctxDefs[<ctxKey>] = { id, hits }}.
     */
    private Map<String, CtxKeyDef> usedCtxKeyDefs;
    /**
     * Items skipped during comparison; each entry has {@code channel}/{@code source} which may be {@code null}.
     * Declared after the declaration tables (and before {@code items}) so raw files read
     * {@code …reportChannelDefs → sourceChannelDefs → usedCtxKeyDefs → skippedItems → items}.
     */
    private List<SkippedItem> skippedItems;
    private List<ValidationItem> items;
}