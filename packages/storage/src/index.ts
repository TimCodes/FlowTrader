/**
 * @trading/storage
 *
 * TimescaleDB storage layer:
 * - Database connection management
 * - Drizzle ORM schema and typed queries
 * - Migration runner and verification
 * - Batch writer service
 */

// Database connection utilities
export {
  getDb,
  getSql,
  closeDb,
  checkDbHealth,
  getDbInfo,
  getTableStats,
  schema,
} from "./db.js";

// Drizzle schema and types
export {
  orderBookSnapshots,
  l3Orders,
  trades,
  features,
  catalysts,
  tradeDecisions,
  executionReports,
  type OrderBookSnapshot,
  type NewOrderBookSnapshot,
  type L3Order,
  type NewL3Order,
  type Trade,
  type NewTrade,
  type Feature,
  type NewFeature,
  type Catalyst,
  type NewCatalyst,
  type TradeDecision,
  type NewTradeDecision,
  type ExecutionReport,
  type NewExecutionReport,
} from "./schema.js";

// Migration utilities
export { verifySchema } from "./migrate.js";

// Writer service
export { main as startWriter } from "./writer.js";
