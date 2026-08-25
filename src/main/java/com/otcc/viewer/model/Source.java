package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One source channel (A / B) with its field comparison results.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Source {
    private String name;
    private List<Field> fields;
}