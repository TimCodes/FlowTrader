import type { CatalystEvent } from "@trading/types";
import { STREAMS } from "@trading/types";

/**
 * Catalyst Feed Service
 *
 * Aggregates news and catalyst data from multiple sources
 * for both futures and crypto markets.
 *
 * Futures sources:
 *   - Economic calendar API (NFP, CPI, FOMC, GDP)
 *   - IBKR news feed (Reuters, Dow Jones)
 *   - Fed speech / FOMC minutes tracker
 *
 * Crypto sources:
 *   - On-chain analytics (exchange flows, whale alerts)
 *   - Social sentiment (LunarCrush or similar)
 *   - Protocol event tracker (halvings, upgrades)
 *   - Regulatory news aggregator
 *
 * Output stream:
 *   news:{symbol} → CatalystEvent
 *
 * The catalyst LLM agent downstream will process these raw
 * events and produce structured CatalystSignals.
 *
 * Config:
 *   REDIS_URL
 *   POLYGON_API_KEY (optional)
 *   CRYPTOQUANT_API_KEY (optional)
 */

async function main() {
  console.log("🚀 Catalyst Feed starting...");
  console.log(`   Redis: ${process.env.REDIS_URL}`);

  // TODO: Implement
  // 1. Connect to Redis
  // 2. Start economic calendar poller (check daily schedule)
  // 3. Start crypto on-chain monitor
  // 4. Start social sentiment aggregator
  // 5. Publish CatalystEvent to news:{symbol} streams
  // 6. Pre-classify catalyst type with keyword matching
  //    (LLM agent does deeper analysis downstream)

  console.log("⏳ Waiting for implementation...");
}

main().catch(console.error);
