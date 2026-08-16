package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

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
    /** {@code xml} or {@code csv} */
    private String format;

    private ChannelFiles files;
    private List<Source> sources;

    private List<Message> warnings;
    private List<Message> errors;
    private List<UncomparedEntry> uncompared;
    private List<UncomparedEntry> uncomparedCsv;
    private List<String> logs;
}
