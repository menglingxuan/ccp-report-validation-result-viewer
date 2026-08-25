package com.otcc.viewer.model;

import java.util.List;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One compared item (identified by {@code tradeId}).
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ValidationItem {
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
    private List<Channel> channels;
    private List<SkippedItem> skippedItems;
    private List<String> overviewLogs;
}