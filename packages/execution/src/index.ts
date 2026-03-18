import type { TradeDecision, ExecutionReport } from "@trading/types";
import { STREAMS } from "@trading/types";

/**
 * Execution Engine
 *
 * Rules-based execution — NO LLM. Speed is everything.
 *
 * Consumes TradeDecision from the orchestrator and:
 * 1. Validates order parameters
 * 2. Routes to correct broker (IBKR for futures, Kraken for crypto)
 * 3. Places orders with defined entry, stop, and targets
 * 4. Monitors fills and publishes ExecutionReport
 * 5. Manages active positions (trailing stops, scale-outs)
 *
 * Order types:
 *   - Market orders for momentum entries (speed > price)
 *   - Limit orders for price action entries (Loris style)
 *   - Stop-limit for protective stops
 *   - OCO (one-cancels-other) for target + stop pairs
 *
 * Position management:
 *   - Scale out: 50% at TP1, trail remainder to TP2
 *   - ATR-based trailing stop after TP1 hit
 *   - Hard stop always in place (never move against position)
 *
 * IMPORTANT: Uses separate IBKR client ID from ingestion service
 * to avoid message conflicts.
 *
 * Config:
 *   IBKR_HOST, IBKR_PORT, IBKR_CLIENT_ID (20, separate from ingestion)
 *   KRAKEN_API_KEY, KRAKEN_API_SECRET
 *   REDIS_URL
 */

async function main() {
  console.log("🚀 Execution Engine starting...");
  console.log(`   IBKR: ${process.env.IBKR_HOST}:${process.env.IBKR_PORT} (client ${process.env.IBKR_CLIENT_ID})`);
  console.log(`   Redis: ${process.env.REDIS_URL}`);

  // TODO: Implement (Phase 4 — after orchestrator is producing decisions)
  //
  // 1. Connect to Redis
  // 2. Connect to IBKR TWS API (separate client ID = 20)
  // 3. Connect to Kraken REST API for order submission
  // 4. Subscribe to decision:{symbol} Redis Stream
  // 5. On TradeDecision:
  //    a. Validate: confidence > threshold, risk within limits
  //    b. Route to correct broker based on asset_class
  //    c. Submit entry order
  //    d. Submit protective stop
  //    e. Submit take-profit targets
  //    f. Publish ExecutionReport to execution:{symbol}
  // 6. Monitor active orders for fills
  // 7. Manage position lifecycle (scale-out, trailing stop)

  console.log("⏳ Waiting for trade decisions (Phase 4)...");
}

main().catch(console.error);
