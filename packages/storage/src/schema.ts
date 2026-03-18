/**
 * Drizzle ORM Schema Definitions
 *
 * Typed table definitions matching the TimescaleDB schema.
 * These are used for type-safe queries and inserts.
 */

import {
  pgTable,
  text,
  timestamp,
  doublePrecision,
  integer,
  smallint,
  index,
  unique,
} from "drizzle-orm/pg-core";

/**
 * Custom type for PostgreSQL double precision arrays
 * Drizzle doesn't have built-in array support, so we use text and serialize/deserialize
 */
const doublePrecisionArray = (name: string) =>
  text(name).$type<number[]>();

// ── Order Book Snapshots ─────────────────────────────

export const orderBookSnapshots = pgTable(
  "order_book_snapshots",
  {
    time: timestamp("time", { withTimezone: true }).notNull(),
    source: text("source").notNull(),
    assetClass: text("asset_class").notNull(),
    symbol: text("symbol").notNull(),
    bidPrices: doublePrecisionArray("bid_prices"),
    bidSizes: doublePrecisionArray("bid_sizes"),
    askPrices: doublePrecisionArray("ask_prices"),
    askSizes: doublePrecisionArray("ask_sizes"),
    bidTotal: doublePrecision("bid_total"),
    askTotal: doublePrecision("ask_total"),
    imbalance: doublePrecision("imbalance"),
  },
  (table) => [
    index("idx_obs_sym").on(table.symbol, table.time),
    index("idx_obs_source").on(table.source, table.time),
  ]
);

export type OrderBookSnapshot = typeof orderBookSnapshots.$inferSelect;
export type NewOrderBookSnapshot = typeof orderBookSnapshots.$inferInsert;

// ── L3 Order Events (Kraken only) ────────────────────

export const l3Orders = pgTable(
  "l3_orders",
  {
    time: timestamp("time", { withTimezone: true }).notNull(),
    symbol: text("symbol").notNull(),
    orderId: text("order_id").notNull(),
    event: text("event").notNull(),
    side: text("side").notNull(),
    price: doublePrecision("price"),
    qty: doublePrecision("qty"),
  },
  (table) => [
    index("idx_l3_sym").on(table.symbol, table.time),
  ]
);

export type L3Order = typeof l3Orders.$inferSelect;
export type NewL3Order = typeof l3Orders.$inferInsert;

// ── Trades ───────────────────────────────────────────

export const trades = pgTable(
  "trades",
  {
    time: timestamp("time", { withTimezone: true }).notNull(),
    source: text("source").notNull(),
    assetClass: text("asset_class").notNull(),
    symbol: text("symbol").notNull(),
    price: doublePrecision("price").notNull(),
    size: doublePrecision("size").notNull(),
    side: text("side"),
  },
  (table) => [
    index("idx_trades_sym").on(table.symbol, table.time),
  ]
);

export type Trade = typeof trades.$inferSelect;
export type NewTrade = typeof trades.$inferInsert;

// ── Feature Vectors ──────────────────────────────────

export const features = pgTable(
  "features",
  {
    time: timestamp("time", { withTimezone: true }).notNull(),
    source: text("source").notNull(),
    assetClass: text("asset_class").notNull(),
    symbol: text("symbol").notNull(),
    imbalanceRatio: doublePrecision("imbalance_ratio"),
    spreadBps: doublePrecision("spread_bps"),
    depthRatio5: doublePrecision("depth_ratio_5"),
    depthRatio10: doublePrecision("depth_ratio_10"),
    tapeVelocity: doublePrecision("tape_velocity"),
    buySellRatio: doublePrecision("buy_sell_ratio"),
    largeTradeCount: integer("large_trade_count"),
    vwapDeviation: doublePrecision("vwap_deviation"),
    spoofScore: doublePrecision("spoof_score"),
    icebergScore: doublePrecision("iceberg_score"),
    cancelRate: doublePrecision("cancel_rate"),
  },
  (table) => [
    index("idx_feat_sym").on(table.symbol, table.time),
  ]
);

export type Feature = typeof features.$inferSelect;
export type NewFeature = typeof features.$inferInsert;

// ── Catalyst Events ──────────────────────────────────

export const catalysts = pgTable(
  "catalysts",
  {
    time: timestamp("time", { withTimezone: true }).notNull(),
    source: text("source").notNull(),
    assetClass: text("asset_class").notNull(),
    symbol: text("symbol").notNull(),
    headline: text("headline"),
    category: text("category"),
    rawText: text("raw_text"),
    magnitude: smallint("magnitude"),
  },
  (table) => [
    index("idx_cat_sym").on(table.symbol, table.time),
  ]
);

export type Catalyst = typeof catalysts.$inferSelect;
export type NewCatalyst = typeof catalysts.$inferInsert;

// ── Trade Decisions (audit log) ──────────────────────

export const tradeDecisions = pgTable(
  "trade_decisions",
  {
    time: timestamp("time", { withTimezone: true }).notNull(),
    decisionId: text("decision_id").notNull(),
    symbol: text("symbol").notNull(),
    strategy: text("strategy").notNull(),
    action: text("action").notNull(),
    confidence: doublePrecision("confidence"),
    entryPrice: doublePrecision("entry_price"),
    stopLoss: doublePrecision("stop_loss"),
    takeProfit1: doublePrecision("take_profit_1"),
    takeProfit2: doublePrecision("take_profit_2"),
    positionSize: doublePrecision("position_size"),
    maxRisk: doublePrecision("max_risk"),
    reasoning: text("reasoning"),
  },
  (table) => [
    unique("trade_decisions_decision_id_unique").on(table.decisionId),
  ]
);

export type TradeDecision = typeof tradeDecisions.$inferSelect;
export type NewTradeDecision = typeof tradeDecisions.$inferInsert;

// ── Execution Reports ────────────────────────────────

export const executionReports = pgTable(
  "execution_reports",
  {
    time: timestamp("time", { withTimezone: true }).notNull(),
    decisionId: text("decision_id").notNull(),
    symbol: text("symbol").notNull(),
    broker: text("broker").notNull(),
    orderId: text("order_id"),
    status: text("status").notNull(),
    fillPrice: doublePrecision("fill_price"),
    fillSize: doublePrecision("fill_size"),
    slippageBps: doublePrecision("slippage_bps"),
    latencyMs: doublePrecision("latency_ms"),
  },
  (table) => [
    index("idx_exec_decision").on(table.decisionId),
  ]
);

export type ExecutionReport = typeof executionReports.$inferSelect;
export type NewExecutionReport = typeof executionReports.$inferInsert;

// ── Schema Export ────────────────────────────────────

export const schema = {
  orderBookSnapshots,
  l3Orders,
  trades,
  features,
  catalysts,
  tradeDecisions,
  executionReports,
};
