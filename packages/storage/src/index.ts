/**
 * @trading/storage
 *
 * TimescaleDB storage layer:
 * - Database connection management
 * - Migration runner and verification
 * - Drizzle ORM schema (coming in Story 1.5)
 * - Batch writer service
 */

// Database connection utilities
export {
  getDb,
  closeDb,
  checkDbHealth,
  getDbInfo,
  getTableStats,
} from "./db.js";

// Migration utilities
export { verifySchema } from "./migrate.js";

// Writer service
export { main as startWriter } from "./writer.js";
