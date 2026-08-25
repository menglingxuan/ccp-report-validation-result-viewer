package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A file reference: either {@code "name"} (string) or {@code {name, path}}.
 * The viewer accepts both; this model always emits the object form.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FileEntry {
    private String name;
    private String path;
}