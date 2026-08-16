package com.otcc.viewer.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Conversion / validation rule: {@code { ctx: [...], value: "..." }}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CtxRule {

    private List<String> ctx;
    private String value;
}
