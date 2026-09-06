package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One entry of the multi-file manifest ({@code mode: "multi"}): light metadata plus
 * the relative path to the full item file and its precomputed summary.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ManifestItem {
    private String tradeId;
    private String reportDate;
    private String generatedAt;
    private String platform;
    private String product;
    private String productCategory;
    private String counterpartyItemId;
    private String platformTradeId;
    private String platformDealId;
    private List<String> enabledChannels;
    /** Relative path to the full item file (from the web root). */
    private String file;
    private ItemSummary summary;
}
