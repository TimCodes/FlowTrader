/**
 * TimescaleDB Migration Runner
 *
 * Runs SQL migrations against TimescaleDB.
 * Migrations are auto-run by Docker on first container start,
 * but this script is useful for:
 *   - Running migrations on existing containers
 *   - Development and testing
 *   - CI/CD pipelines
 *
 * Usage: npx tsx src/migrate.ts
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import postgres from "postgres";
import { databaseConfig } from "@trading/shared";

const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

interface MigrationResult {
  file: string;
  success: boolean;
  error?: string;
}

/**
 * Get list of migration files sorted by name
 */
function getMigrationFiles(): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files;
}

/**
 * Run a single migration file
 */
async function runMigration(
  sql: postgres.Sql,
  filename: string
): Promise<MigrationResult> {
  const filepath = join(MIGRATIONS_DIR, filename);
  const content = readFileSync(filepath, "utf-8");

  try {
    // Execute the migration
    await sql.unsafe(content);
    return { file: filename, success: true };
  } catch (err) {
    const error = err as Error;
    return { file: filename, success: false, error: error.message };
  }
}

/**
 * Verify that TimescaleDB extension and hypertables are set up correctly
 */
async function verifySchema(sql: postgres.Sql): Promise<{
  timescaleEnabled: boolean;
  hypertables: string[];
  indexes: string[];
  compressionPolicies: number;
  continuousAggregates: string[];
}> {
  // Check TimescaleDB extension
  const extensions = await sql`
    SELECT extname FROM pg_extension WHERE extname = 'timescaledb'
  `;
  const timescaleEnabled = extensions.length > 0;

  // List hypertables
  const hypertables = await sql`
    SELECT hypertable_name
    FROM timescaledb_information.hypertables
    ORDER BY hypertable_name
  `;

  // List indexes on our tables
  const indexes = await sql`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('order_book_snapshots', 'l3_orders', 'trades', 'features', 'catalysts', 'trade_decisions', 'execution_reports')
    ORDER BY indexname
  `;

  // Count compression policies
  const compression = await sql`
    SELECT count(*) as count
    FROM timescaledb_information.jobs
    WHERE proc_name = 'policy_compression'
  `;

  // List continuous aggregates
  const caggs = await sql`
    SELECT view_name
    FROM timescaledb_information.continuous_aggregates
    ORDER BY view_name
  `;

  return {
    timescaleEnabled,
    hypertables: hypertables.map((r) => r.hypertable_name as string),
    indexes: indexes.map((r) => r.indexname as string),
    compressionPolicies: Number(compression[0]?.count ?? 0),
    continuousAggregates: caggs.map((r) => r.view_name as string),
  };
}

/**
 * Main migration runner
 */
async function main() {
  console.log("=== TimescaleDB Migration Runner ===\n");
  console.log(`Database: ${databaseConfig.url.replace(/:[^:@]+@/, ":***@")}\n`);

  const sql = postgres(databaseConfig.url, {
    max: 1,
    onnotice: () => {}, // Suppress notices
  });

  try {
    // Test connection
    console.log("Testing connection...");
    await sql`SELECT 1`;
    console.log("Connected successfully.\n");

    // Run migrations
    const files = getMigrationFiles();
    console.log(`Found ${files.length} migration file(s):\n`);

    const results: MigrationResult[] = [];
    for (const file of files) {
      process.stdout.write(`  Running ${file}... `);
      const result = await runMigration(sql, file);
      results.push(result);

      if (result.success) {
        console.log("OK");
      } else {
        console.log("FAILED");
        console.log(`    Error: ${result.error}\n`);
      }
    }

    // Verify schema
    console.log("\n=== Schema Verification ===\n");
    const schema = await verifySchema(sql);

    console.log(
      `TimescaleDB extension: ${schema.timescaleEnabled ? "ENABLED" : "MISSING"}`
    );

    console.log(`\nHypertables (${schema.hypertables.length}):`);
    for (const table of schema.hypertables) {
      console.log(`  - ${table}`);
    }

    console.log(`\nIndexes (${schema.indexes.length}):`);
    for (const idx of schema.indexes) {
      console.log(`  - ${idx}`);
    }

    console.log(`\nCompression policies: ${schema.compressionPolicies}`);

    console.log(`\nContinuous aggregates (${schema.continuousAggregates.length}):`);
    for (const cagg of schema.continuousAggregates) {
      console.log(`  - ${cagg}`);
    }

    // Summary
    console.log("\n=== Summary ===\n");
    const failed = results.filter((r) => !r.success);
    if (failed.length === 0) {
      console.log("All migrations completed successfully.");
    } else {
      console.log(`${failed.length} migration(s) failed:`);
      for (const f of failed) {
        console.log(`  - ${f.file}: ${f.error}`);
      }
      process.exitCode = 1;
    }

    // Expected tables check
    const expectedTables = [
      "order_book_snapshots",
      "l3_orders",
      "trades",
      "features",
      "catalysts",
      "trade_decisions",
      "execution_reports",
    ];
    const missingTables = expectedTables.filter(
      (t) => !schema.hypertables.includes(t)
    );
    if (missingTables.length > 0) {
      console.log(`\nWARNING: Missing hypertables: ${missingTables.join(", ")}`);
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

export { main, verifySchema, runMigration };

// Run if executed directly
main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
