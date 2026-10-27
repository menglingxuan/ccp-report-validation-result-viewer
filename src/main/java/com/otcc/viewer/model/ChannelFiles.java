package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * {@code channel.files}: source EO files, submitted AO files, optional extra input files ({@code other})
 * and the Excel mapping config.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ChannelFiles {
    private List<FileEntry> eo;
    private List<FileEntry> ao;
    /**
     * Extra input files (rendered as {@code EX} in the viewer).
     * Always serialized: callers set an empty list when there is none (no {@code null}).
     */
    private List<FileEntry> other;
    private ExcelFile excel;
}