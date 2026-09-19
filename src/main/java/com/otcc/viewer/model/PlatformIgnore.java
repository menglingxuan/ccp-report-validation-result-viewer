package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * {@code ignore-config-by-platform.json}: one entry per platform.
 *
 * <p>The three bucket arrays are the only type carrier — entries have no {@code kind} field.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PlatformIgnore {
    private List<IgnoreWarning> warnings;
    private List<Object> uncomparedXpaths;
    private List<Object> uncomparedCsvs;
}