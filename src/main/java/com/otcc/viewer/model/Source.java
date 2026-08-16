package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

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
