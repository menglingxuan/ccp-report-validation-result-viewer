package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * {@code channel.files}: source EO files, submitted AO files and the Excel mapping config.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ChannelFiles {
    private List<FileEntry> eo;
    private List<FileEntry> ao;
    private ExcelFile excel;
}