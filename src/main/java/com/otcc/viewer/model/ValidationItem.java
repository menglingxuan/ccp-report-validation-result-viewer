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
    /** Original platform trade id ({@code platformOriTradeId}). */
    private String platformOriTradeId;
    /** Original platform trade deal id ({@code platformOriTradeDealId}). */
    private String platformOriTradeDealId;
    /** Per-item hit summaries ({@code item.ctxDtls}): {@code <ctxKey> -> { hits }}. */
    private Map<String, CtxDetail> ctxDtls;
    /**
     * Channels taking part in the comparison: a channel is enabled unless it carries
     * {@code enabled = false} ({@code Channel#getEnabled()}). The former
     * {@code enabledChannels} name list has been removed - it was a second source of truth.
     */
    private List<Channel> channels;
    /** Item-level warnings (aggregated from channels). */
    private List<Message> warnings;
    /** Item-level errors (aggregated from channels). */
    private List<Message> errors;
    /** Item-level uncompared entries (xpath + csv merged). */
    private List<UncomparedEntry> uncompared;
    /** Item-level logs, object form ({@code item.logs}). */
    private List<ItemLog> logs;
}