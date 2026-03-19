/**
 * Kraken Crypto Ingestion Service
 *
 * Connects to Kraken WebSocket v2 and streams:
 * - L2 aggregated order book (public, configurable depth)
 * - L3 individual orders (authenticated, unthrottled real-time)
 * - Tick-by-tick trades with aggressor side
 *
 * Publishes unified OrderBookEvent, L3OrderEvent, and TradeEvent
 * to Redis Streams.
 *
 * Config:
 *   KRAKEN_API_KEY, KRAKEN_API_SECRET (for L3)
 *   KRAKEN_SYMBOLS (comma-separated, e.g. "BTC/USD,ETH/USD")
 *   KRAKEN_L3_ENABLED (true/false)
 *   REDIS_URL
 */

// Export types
export * from "./types.js";

// Export WebSocket client
export {
  KrakenWebSocket,
  createKrakenWebSocket,
  createKrakenAuthWebSocket,
} from "./websocket.js";
export type { KrakenWebSocketOptions, KrakenWebSocketEvents } from "./websocket.js";

// Export order book (L2)
export { OrderBook, OrderBookManager, createOrderBookManager } from "./orderbook.js";

// Export trades
export { TradeHandler, createTradeHandler } from "./trades.js";

// Export L3 handler
export { L3OrderBook, L3Handler, createL3Handler } from "./l3.js";

// Export Redis publisher
export {
  KrakenPublisher,
  createKrakenPublisher,
} from "./publisher.js";
export type { PublisherOptions, PublisherStats } from "./publisher.js";

// Export authentication
export {
  getWebSocketToken,
  TokenManager,
  createTokenManager,
} from "./auth.js";
export type { WebSocketTokenResponse } from "./auth.js";
