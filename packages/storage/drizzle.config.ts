/**
 * Drizzle Kit Configuration
 *
 * Used for schema introspection, migrations generation, and studio.
 * Run: npx drizzle-kit studio
 */

import type { Config } from "drizzle-kit";

export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://trading:trading_dev@localhost:5432/trading",
  },
} satisfies Config;
