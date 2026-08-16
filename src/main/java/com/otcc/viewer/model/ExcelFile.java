package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * {@code channel.files.excel}: {@code { file, sheet, path? }}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ExcelFile {

    private String file;
    private String sheet;
    private String path;
}
