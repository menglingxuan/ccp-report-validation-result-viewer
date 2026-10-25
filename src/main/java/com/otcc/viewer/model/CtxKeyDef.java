package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Dataset-level ctxKey declaration ({@code $root.usedCtxKeyDefs[<ctxKey>]}):
 * {@code { id, type, rules, def }}.
 *
 * <p>{@code rules} holds rule names, not numbers: {@code fdm} (field mapping),
 * {@code cvt} (value conversion), {@code vdt} (final value validation). A single ctxKey can take
 * part in several rules. The per-item hit summary lives in {@link CtxDef} instead.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CtxKeyDef {
    /** Stable id, referenced by {@code rule.metaCtxs} (id array) and resolved from the item's {@code ctxDtls} key. */
    private Integer id;
    /** Ctx origin: {@code builtin} or {@code user}. */
    private String type;
    /** Rule names: subset of {@code fdm} / {@code cvt} / {@code vdt}. */
    private List<String> rules;
    private String def;
}
