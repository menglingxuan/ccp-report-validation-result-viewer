package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * {@code ignore-config-by-platform.json}: one entry per platform.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PlatformIgnore {
    private List<IgnoreWarning> warnings;
    private List<Object> uncomparedXpaths;
}