/**
 * IBKR TWS API Type Definitions
 *
 * Types for interfacing with @stoqey/ib library and
 * mapping IBKR-specific data to unified event schema.
 */

import type { Contract, SecType } from "@stoqey/ib";

/**
 * Supported IBKR contract types for this ingestion service
 */
export type IBKRSecType = "FUT";

/**
 * Supported exchanges for futures contracts
 */
export type FuturesExchange = "CME" | "CBOT" | "NYMEX" | "COMEX";

/**
 * Connection state for IBKR client
 */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

/**
 * IBKR client configuration options
 */
export interface IBKRClientOptions {
  /** TWS/Gateway host (default: 127.0.0.1) */
  host?: string;
  /** TWS/Gateway port (7497 for paper, 7496 for live) */
  port?: number;
  /** Client ID for this connection */
  clientId?: number;
  /** Enable automatic reconnection (default: true) */
  reconnect?: boolean;
  /** Max reconnection attempts (default: 10) */
  maxReconnectAttempts?: number;
  /** Initial reconnect delay in ms (default: 1000) */
  initialReconnectDelayMs?: number;
  /** Max reconnect delay in ms (default: 30000) */
  maxReconnectDelayMs?: number;
}

/**
 * Futures contract definition for subscription
 */
export interface FuturesContractDef {
  /** Symbol (e.g., "MES", "ES", "NQ") */
  symbol: string;
  /** Security type */
  secType: IBKRSecType;
  /** Exchange (e.g., "CME") */
  exchange: FuturesExchange;
  /** Currency */
  currency: string;
  /** Contract expiry (YYYYMM format, e.g., "202506") */
  lastTradeDateOrContractMonth: string;
  /** Multiplier (contract size as string) */
  multiplier?: string;
  /** Local symbol as shown in TWS */
  localSymbol?: string;
}

/**
 * Market depth (L2) entry from IBKR
 */
export interface MarketDepthEntry {
  /** Position in the book (0-based) */
  position: number;
  /** Market maker or exchange ID */
  marketMaker: string;
  /** Operation: 0=insert, 1=update, 2=delete */
  operation: 0 | 1 | 2;
  /** Side: 0=ask, 1=bid */
  side: 0 | 1;
  /** Price level */
  price: number;
  /** Size at this level */
  size: number;
}

/**
 * Market depth L2 operation type
 */
export type DepthOperation = "insert" | "update" | "delete";

/**
 * Market depth side
 */
export type DepthSide = "bid" | "ask";

/**
 * Tick-by-tick last trade data from IBKR
 */
export interface TickByTickLast {
  /** Ticker ID */
  tickerId: number;
  /** Timestamp (Unix epoch seconds) */
  time: number;
  /** Trade price */
  price: number;
  /** Trade size */
  size: number;
  /** Tick attributes */
  tickAttribLast: {
    pastLimit: boolean;
    unreported: boolean;
  };
  /** Exchange where trade occurred */
  exchange: string;
  /** Special conditions */
  specialConditions: string;
}

/**
 * Bid/Ask tick data for aggressor classification
 */
export interface BidAskTick {
  /** Ticker ID */
  tickerId: number;
  /** Timestamp */
  time: number;
  /** Bid price */
  bidPrice: number;
  /** Ask price */
  askPrice: number;
  /** Bid size */
  bidSize: number;
  /** Ask size */
  askSize: number;
}

/**
 * IBKR error message structure
 */
export interface IBKRError {
  /** Error ID (-1 for connection errors) */
  id: number;
  /** Error code */
  code: number;
  /** Error message */
  message: string;
}

/**
 * Subscription info for tracking active subscriptions
 */
export interface SubscriptionInfo {
  /** Ticker ID assigned to this subscription */
  tickerId: number;
  /** Symbol */
  symbol: string;
  /** Contract details */
  contract: Contract;
  /** Subscription type */
  type: "depth" | "trades" | "bidask";
  /** Subscription status */
  active: boolean;
}

/**
 * Connection event types emitted by IBKRClient
 */
export interface IBKRClientEvents {
  /** Connected to TWS/Gateway */
  connected: () => void;
  /** Disconnected from TWS/Gateway */
  disconnected: () => void;
  /** Error occurred */
  error: (error: IBKRError) => void;
  /** Reconnecting */
  reconnecting: (attempt: number, delayMs: number) => void;
  /** Connection state changed */
  stateChange: (state: ConnectionState) => void;
  /** Market depth update */
  depth: (tickerId: number, entry: MarketDepthEntry) => void;
  /** Tick-by-tick last trade */
  tickLast: (data: TickByTickLast) => void;
  /** Bid/Ask update */
  bidAsk: (data: BidAskTick) => void;
  /** Server time received */
  serverTime: (time: Date) => void;
}

/**
 * Map IBKR depth operation code to human-readable string
 */
export function mapDepthOperation(code: 0 | 1 | 2): DepthOperation {
  switch (code) {
    case 0:
      return "insert";
    case 1:
      return "update";
    case 2:
      return "delete";
    default:
      return "update";
  }
}

/**
 * Map IBKR depth side code to human-readable string
 */
export function mapDepthSide(code: 0 | 1): DepthSide {
  return code === 1 ? "bid" : "ask";
}
