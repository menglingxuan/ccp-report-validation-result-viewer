package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

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