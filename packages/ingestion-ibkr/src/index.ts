import type { OrderBookEvent, TradeEvent } from "@trading/types";
import { STREAMS, INSTRUMENTS } from "@trading/types";

/**
 * IBKR Futures Ingestion Service
 *
 * Connects to TWS API via @stoqey/ib and streams:
 * - L2 order book depth (reqMktDepth) for CME futures
 * - Tick-by-tick trade data (reqTickByTickData)
 *
 * Publishes unified OrderBookEvent and TradeEvent to Redis Streams.
 *
 * Config:
 *   IBKR_HOST, IBKR_PORT, IBKR_CLIENT_ID
 *   REDIS_URL
 */

const FUTURES_SYMBOLS = ["MES", "MNQ"]; // Start with micros for paper trading

async function main() {
  console.log("🚀 IBKR Futures Ingestion starting...");
  console.log(`   Instruments: ${FUTURES_SYMBOLS.join(", ")}`);
  console.log(`   IBKR: ${process.env.IBKR_HOST}:${process.env.IBKR_PORT}`);
  console.log(`   Redis: ${process.env.REDIS_URL}`);

  // TODO: Implement
  // 1. Connect to Redis
  // 2. Connect to IBKR TWS API
  // 3. Subscribe to L2 depth for each symbol
  // 4. Subscribe to tick-by-tick trades for each symbol
  // 5. Publish OrderBookEvent and TradeEvent to Redis Streams
  // 6. Handle reconnection on disconnect

  console.log("⏳ Waiting for implementation...");
}

main().catch(console.error);
