/**
 * Environment Variable Validation
 *
 * Centralizes all environment variable parsing and validation using Zod.
 * This module should be imported once at application startup.
 * All defaults are defined here - no other module should read process.env directly.
 */

import { z } from "zod";

/**
 * Zod schema for all environment variables
 */
const envSchema = z.object({
  // ── Infrastructure ──────────────────────────────────
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  DATABASE_URL: z
    .string()
    .url()
    .default("postgresql://trading:trading_dev@localhost:5432/trading"),
  DB_PASSWORD: z.string().default("trading_dev"),

  // ── IBKR ────────────────────────────────────────────
  IBKR_HOST: z.string().ip().default("127.0.0.1"),
  IBKR_PORT: z.coerce.number().int().min(1).max(65535).default(7497),
  IBKR_CLIENT_ID: z.coerce.number().int().min(1).default(10),
  IBKR_EXECUTION_CLIENT_ID: z.coerce.number().int().min(1).default(20),

  // ── Kraken ──────────────────────────────────────────
  KRAKEN_API_KEY: z.string().default(""),
  KRAKEN_API_SECRET: z.string().default(""),
  KRAKEN_SYMBOLS: z
    .string()
    .default("BTC/USD,ETH/USD")
    .transform((s) => s.split(",").map((sym) => sym.trim())),
  KRAKEN_L3_ENABLED: z
    .string()
    .default("false")
    .transform((s) => s.toLowerCase() === "true"),

  // ── Catalyst APIs ───────────────────────────────────
  POLYGON_API_KEY: z.string().default(""),
  CRYPTOQUANT_API_KEY: z.string().default(""),

  // ── ML / Agents ─────────────────────────────────────
  ORDER_FLOW_MODEL_PATH: z.string().default("./models/order-flow-lstm.onnx"),
  CATALYST_LLM_MODEL_PATH: z.string().default("./models/catalyst-7b-q4"),

  // ── General ─────────────────────────────────────────
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"])
    .default("info"),

  // ── Storage Writer ──────────────────────────────────
  STORAGE_BATCH_SIZE: z.coerce.number().int().min(1).default(1000),
  STORAGE_FLUSH_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),

  // ── Health Check ────────────────────────────────────
  HEALTH_CHECK_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

/**
 * Type for validated environment variables
 */
export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate environment variables
 * Throws ZodError if validation fails
 */
function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("Environment validation failed:");
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    throw new Error("Invalid environment configuration");
  }

  return result.data;
}

/**
 * Validated environment variables
 * Parsed once at module load time
 */
export const env: Env = parseEnv();

/**
 * Check if running in production
 */
export const isProduction = env.NODE_ENV === "production";

/**
 * Check if running in development
 */
export const isDevelopment = env.NODE_ENV === "development";

/**
 * Check if running in test mode
 */
export const isTest = env.NODE_ENV === "test";
