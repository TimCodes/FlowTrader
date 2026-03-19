/**
 * Kraken WebSocket v2 API Types
 *
 * Based on: https://docs.kraken.com/api/docs/websocket-v2/book
 */

// ── Common Types ─────────────────────────────────────

export interface KrakenMessage {
  channel: string;
  type: string;
  data?: unknown[];
}

export interface KrakenError {
  error: string;
  method?: string;
  req_id?: number;
  success: boolean;
  time_in: string;
  time_out: string;
}

export interface KrakenSubscriptionStatus {
  channel: string;
  type: "subscribe" | "unsubscribe";
  success: boolean;
  symbol?: string;
  error?: string;
}

// ── Book Channel (L2) ────────────────────────────────

export interface KrakenBookSubscribe {
  method: "subscribe";
  params: {
    channel: "book";
    symbol: string[];
    depth?: number; // 10, 25, 100, 500, 1000
    snapshot?: boolean;
  };
  req_id?: number;
}

export interface KrakenBookLevel {
  price: number;
  qty: number;
}

export interface KrakenBookSnapshot {
  channel: "book";
  type: "snapshot";
  data: [{
    symbol: string;
    bids: KrakenBookLevel[];
    asks: KrakenBookLevel[];
    checksum: number;
  }];
}

export interface KrakenBookUpdate {
  channel: "book";
  type: "update";
  data: [{
    symbol: string;
    bids: KrakenBookLevel[];
    asks: KrakenBookLevel[];
    checksum: number;
    timestamp: string;
  }];
}

export type KrakenBookMessage = KrakenBookSnapshot | KrakenBookUpdate;

// ── Trade Channel ────────────────────────────────────

export interface KrakenTradeSubscribe {
  method: "subscribe";
  params: {
    channel: "trade";
    symbol: string[];
    snapshot?: boolean;
  };
  req_id?: number;
}

export interface KrakenTrade {
  symbol: string;
  side: "buy" | "sell";
  price: number;
  qty: number;
  ord_type: "market" | "limit";
  trade_id: number;
  timestamp: string;
}

export interface KrakenTradeMessage {
  channel: "trade";
  type: "snapshot" | "update";
  data: KrakenTrade[];
}

// ── Level3 Channel (Authenticated) ───────────────────

export interface KrakenL3Subscribe {
  method: "subscribe";
  params: {
    channel: "level3";
    symbol: string[];
    snapshot?: boolean;
    token: string;
  };
  req_id?: number;
}

export interface KrakenL3Order {
  order_id: string;
  symbol: string;
  side: "buy" | "sell";
  price: number;
  qty: number;
  timestamp: string;
}

export interface KrakenL3Event {
  symbol: string;
  order_id: string;
  event: "add" | "modify" | "delete";
  side?: "buy" | "sell";
  price?: number;
  qty?: number;
  timestamp: string;
}

export interface KrakenL3Snapshot {
  channel: "level3";
  type: "snapshot";
  data: [{
    symbol: string;
    bids: KrakenL3Order[];
    asks: KrakenL3Order[];
    checksum: number;
  }];
}

export interface KrakenL3Update {
  channel: "level3";
  type: "update";
  data: KrakenL3Event[];
}

export type KrakenL3Message = KrakenL3Snapshot | KrakenL3Update;

// ── Heartbeat ────────────────────────────────────────

export interface KrakenHeartbeat {
  channel: "heartbeat";
}

// ── Status ───────────────────────────────────────────

export interface KrakenStatus {
  channel: "status";
  type: "update";
  data: [{
    api_version: string;
    connection_id: number;
    system: string;
    version: string;
  }];
}

// ── Pong ─────────────────────────────────────────────

export interface KrakenPong {
  method: "pong";
  req_id?: number;
  time_in: string;
  time_out: string;
}
