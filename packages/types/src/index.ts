// ── Data Sources ─────────────────────────────────────

export type DataSource = "ibkr" | "kraken";
export type AssetClass = "futures" | "crypto";
export type TradeSide = "buy" | "sell" | "unknown";
export type L3Event = "add" | "modify" | "delete";
export type CatalystCategory =
  | "earnings"
  | "fda"
  | "contract"
  | "ipo"
  | "ma"
  | "macro"        // NFP, CPI, FOMC, GDP
  | "fed"          // Fed speeches, rate decisions
  | "geopolitical"
  | "onchain"      // Exchange flows, whale movements
  | "social"       // Social sentiment spikes
  | "protocol"     // Halvings, upgrades, governance
  | "regulatory"   // SEC, ETF approvals, bans
  | "other";

// ── Market Data Events ───────────────────────────────

export interface PriceLevel {
  price: number;
  size: number;
}

export interface OrderBookEvent {
  source: DataSource;
  asset_class: AssetClass;
  symbol: string;
  timestamp: number;
  bids: PriceLevel[];
  asks: PriceLevel[];
  bid_total: number;
  ask_total: number;
  imbalance: number; // 0-1, where 0.5 = balanced
}

export interface L3OrderEvent {
  source: "kraken"; // Only Kraken provides L3
  symbol: string;
  timestamp: number;
  order_id: string;
  event: L3Event;
  side: TradeSide;
  price: number;
  qty: number;
}

export interface TradeEvent {
  source: DataSource;
  asset_class: AssetClass;
  symbol: string;
  timestamp: number;
  price: number;
  size: number;
  side: TradeSide;
}

export interface CatalystEvent {
  source: string;
  asset_class: AssetClass;
  symbol: string;
  timestamp: number;
  headline: string;
  category: CatalystCategory;
  raw_text: string;
  magnitude?: number; // 1-5 estimated impact
}

// ── Feature Events (computed from raw data) ──────────

export interface FeatureVector {
  source: DataSource;
  asset_class: AssetClass;
  symbol: string;
  timestamp: number;

  // Order book features
  imbalance_ratio: number;    // bid_vol / (bid_vol + ask_vol)
  spread_bps: number;         // spread in basis points
  depth_ratio_5: number;      // bid depth / ask depth at 5 levels
  depth_ratio_10: number;     // bid depth / ask depth at 10 levels

  // Tape features
  tape_velocity: number;      // trades per second
  buy_sell_ratio: number;     // buy volume / total volume
  large_trade_count: number;  // trades > threshold size
  vwap_deviation: number;     // current price vs VWAP

  // L3-derived (Kraken only — null for IBKR)
  spoof_score: number | null;    // cancel rate at top levels
  iceberg_score: number | null;  // replenishment detection
  cancel_rate: number | null;    // orders cancelled / orders placed
}

// ── Agent Signals ────────────────────────────────────

export type SignalType =
  | "momentum"
  | "exhaustion"
  | "absorption"
  | "reversal"
  | "breakout"
  | "fade"
  | "neutral";

export type StrategyType =
  | "ross_momentum"
  | "loris_price_action"
  | "goodman_wave";

export interface OrderFlowSignal {
  symbol: string;
  timestamp: number;
  signal: SignalType;
  confidence: number;     // 0-1
  features: FeatureVector;
}

export interface CatalystSignal {
  symbol: string;
  timestamp: number;
  category: CatalystCategory;
  magnitude: number;      // 1-5
  sentiment: "bullish" | "bearish" | "neutral";
  summary: string;        // LLM-generated summary
  confidence: number;     // 0-1
}

// ── Orchestrator Decision ────────────────────────────

export interface TradeDecision {
  id: string;
  symbol: string;
  timestamp: number;
  strategy: StrategyType;
  action: "enter_long" | "enter_short" | "exit" | "scale_in" | "scale_out" | "hold" | "skip";
  confidence: number;
  order_flow_signal: OrderFlowSignal;
  catalyst_signal: CatalystSignal | null;
  risk_params: RiskParams;
  reasoning: string; // Audit trail
}

export interface RiskParams {
  position_size: number;       // Contract/coin quantity
  entry_price: number | null;  // Limit price or null for market
  stop_loss: number;
  take_profit_1: number;       // First target (partial exit)
  take_profit_2: number;       // Second target (remainder)
  max_risk_dollars: number;    // Dollar risk per trade
  risk_reward_ratio: number;
}

// ── Execution Events ─────────────────────────────────

export interface ExecutionReport {
  decision_id: string;
  symbol: string;
  timestamp: number;
  broker: DataSource;
  order_id: string;
  status: "pending" | "filled" | "partial" | "cancelled" | "rejected";
  fill_price: number | null;
  fill_size: number | null;
  slippage_bps: number | null; // Actual vs expected price
  latency_ms: number;          // Decision → fill time
}

// ── Redis Stream Keys ────────────────────────────────

export const STREAMS = {
  orderbook: (sym: string) => `orderbook:${sym}`,
  l3: (sym: string) => `l3:${sym}`,
  trades: (sym: string) => `trades:${sym}`,
  news: (sym: string) => `news:${sym}`,
  features: (sym: string) => `features:${sym}`,
  signals: {
    orderflow: (sym: string) => `signal:orderflow:${sym}`,
    catalyst: (sym: string) => `signal:catalyst:${sym}`,
  },
  decisions: (sym: string) => `decision:${sym}`,
  executions: (sym: string) => `execution:${sym}`,
} as const;

// ── Configuration ────────────────────────────────────

export interface InstrumentConfig {
  symbol: string;
  source: DataSource;
  asset_class: AssetClass;
  tick_size: number;
  contract_size: number;       // Multiplier (e.g., 50 for ES, 1 for BTC)
  min_size: number;            // Minimum order size
  large_trade_threshold: number; // Size considered "large" for tape reading
}

export const INSTRUMENTS: Record<string, InstrumentConfig> = {
  // CME Futures
  ES: { symbol: "ES", source: "ibkr", asset_class: "futures", tick_size: 0.25, contract_size: 50, min_size: 1, large_trade_threshold: 50 },
  NQ: { symbol: "NQ", source: "ibkr", asset_class: "futures", tick_size: 0.25, contract_size: 20, min_size: 1, large_trade_threshold: 20 },
  MES: { symbol: "MES", source: "ibkr", asset_class: "futures", tick_size: 0.25, contract_size: 5, min_size: 1, large_trade_threshold: 100 },
  MNQ: { symbol: "MNQ", source: "ibkr", asset_class: "futures", tick_size: 0.25, contract_size: 2, min_size: 1, large_trade_threshold: 50 },
  CL: { symbol: "CL", source: "ibkr", asset_class: "futures", tick_size: 0.01, contract_size: 1000, min_size: 1, large_trade_threshold: 20 },
  // Kraken Crypto
  "BTC/USD": { symbol: "BTC/USD", source: "kraken", asset_class: "crypto", tick_size: 0.1, contract_size: 1, min_size: 0.0001, large_trade_threshold: 1 },
  "ETH/USD": { symbol: "ETH/USD", source: "kraken", asset_class: "crypto", tick_size: 0.01, contract_size: 1, min_size: 0.001, large_trade_threshold: 10 },
};
