/**
 * Database Connection Utilities
 *
 * Provides TimescaleDB connection management and health checks.
 * Uses Drizzle ORM for type-safe queries.
 */

import postgres from "postgres";
import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { databaseConfig } from "@trading/shared";
import * as schema from "./schema.js";

let _sql: postgres.Sql | null = null;
let _db: PostgresJsDatabase<typeof schema> | null = null;

/**
 * Get or create the raw postgres connection
 */
export function getSql(): postgres.Sql {
  if (!_sql) {
    _sql = postgres(databaseConfig.url, {
      max: databaseConfig.maxConnections,
      idle_timeout: 20,
      connect_timeout: 10,
      onnotice: () => {}, // Suppress notices
    });
  }
  return _sql;
}

/**
 * Get or create the Drizzle ORM database instance
 */
export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!_db) {
    _db = drizzle(getSql(), { schema });
  }
  return _db;
}

// Re-export schema for convenience
export { schema };

/**
 * Close the database connection
 */
export async function closeDb(): Promise<void> {
  if (_sql) {
    await _sql.end();
    _sql = null;
    _db = null;
    console.log("[DB] Connection closed");
  }
}

/**
 * Check if the database is connected and responding
 */
export async function checkDbHealth(): Promise<boolean> {
  try {
    const sql = getSql();
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Get database info for health checks
 */
export async function getDbInfo(): Promise<{
  connected: boolean;
  version: string | null;
  timescaleVersion: string | null;
  activeConnections: number;
  maxConnections: number;
}> {
  try {
    const sql = getSql();

    // Get PostgreSQL version
    const versionResult = await sql`SELECT version()`;
    const version = versionResult[0]?.version as string | null;

    // Get TimescaleDB version
    const tsResult = await sql`
      SELECT extversion
      FROM pg_extension
      WHERE extname = 'timescaledb'
    `;
    const timescaleVersion = tsResult[0]?.extversion as string | null;

    // Get connection stats
    const statsResult = await sql`
      SELECT
        (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) as active,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max
    `;
    const activeConnections = Number(statsResult[0]?.active ?? 0);
    const maxConnections = Number(statsResult[0]?.max ?? 0);

    return {
      connected: true,
      version,
      timescaleVersion,
      activeConnections,
      maxConnections,
    };
  } catch {
    return {
      connected: false,
      version: null,
      timescaleVersion: null,
      activeConnections: 0,
      maxConnections: 0,
    };
  }
}

/**
 * Get table statistics for monitoring
 */
export async function getTableStats(): Promise<
  {
    table: string;
    rowCount: number;
    sizeBytes: number;
    sizePretty: string;
  }[]
> {
  try {
    const sql = getSql();
    const result = await sql`
      SELECT
        relname as table,
        reltuples::bigint as row_count,
        pg_total_relation_size(relid) as size_bytes,
        pg_size_pretty(pg_total_relation_size(relid)) as size_pretty
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(relid) DESC
    `;

    return result.map((r) => ({
      table: r.table as string,
      rowCount: Number(r.row_count),
      sizeBytes: Number(r.size_bytes),
      sizePretty: r.size_pretty as string,
    }));
  } catch {
    return [];
  }
}
