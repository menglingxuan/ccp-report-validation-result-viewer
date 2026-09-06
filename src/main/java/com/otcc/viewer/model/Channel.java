package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One report channel (HKTR / JSFA / CFTC).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Channel {
    private String name;
    private String desc;
    /**
     * {@code xml} or {@code csv}
     */
    private String format;
    private ChannelFiles files;
    private List<Source> sources;
}