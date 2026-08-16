package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A warning entry inside the ignore config.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class IgnoreWarning {

    private String kind;
    private String channel;
    private String field;
    private String type;
    private String level;
    private String product;
}
