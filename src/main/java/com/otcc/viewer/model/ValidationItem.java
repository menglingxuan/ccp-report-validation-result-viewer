package com.otcc.viewer.model;

import java.util.List;
import java.util.Map;

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
    /** Per-item hit-context definitions ({@code item.ctxDefs}). */
    private Map<String, CtxDef> ctxDefs;
    private List<Channel> channels;
    private List<SkippedItem> skippedItems;
    /** Item-level warnings (aggregated from channels). */
    private List<Message> warnings;
    /** Item-level errors (aggregated from channels). */
    private List<Message> errors;
    /** Item-level uncompared entries (xpath + csv merged). */
    private List<UncomparedEntry> uncompared;
    /** Item-level logs, object form ({@code item.logs}). */
    private List<ItemLog> logs;
}