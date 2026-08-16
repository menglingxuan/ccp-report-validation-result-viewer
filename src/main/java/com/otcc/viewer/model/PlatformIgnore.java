package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

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
