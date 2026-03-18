import type { OrderBookEvent, L3OrderEvent, TradeEvent } from "@trading/types";
import { STREAMS } from "@trading/types";

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

const SYMBOLS = (process.env.KRAKEN_SYMBOLS || "BTC/USD,ETH/USD").split(",");
const L3_ENABLED = process.env.KRAKEN_L3_ENABLED === "true";

const WS_PUBLIC = "wss://ws.kraken.com/v2";
const WS_AUTH = "wss://ws-auth.kraken.com/v2";

async function main() {
  console.log("🚀 Kraken Crypto Ingestion starting...");
  console.log(`   Symbols: ${SYMBOLS.join(", ")}`);
  console.log(`   L3 enabled: ${L3_ENABLED}`);
  console.log(`   Redis: ${process.env.REDIS_URL}`);

  // TODO: Implement
  // 1. Connect to Redis
  // 2. Connect to Kraken public WebSocket (L2 book + trades)
  // 3. Subscribe to "book" channel with depth=25 + snapshot=true
  // 4. Subscribe to "trade" channel
  // 5. If L3_ENABLED:
  //    a. Get WebSocket auth token via REST: POST /0/private/GetWebSocketsToken
  //    b. Connect to authenticated WebSocket
  //    c. Subscribe to "level3" channel
  // 6. Publish events to Redis Streams using unified schema
  // 7. Handle reconnection (Kraken disconnects after 60s inactivity)
  // 8. Maintain local order book state, verify with CRC32 checksums

  console.log("⏳ Waiting for implementation...");
}

main().catch(console.error);
