/**
 * Application Configuration
 *
 * Builds typed configuration objects from validated environment variables.
 * Import config objects from this module rather than reading env directly.
 */

import { env, isProduction } from "./env.js";

/**
 * Redis connection configuration
 */
export interface RedisConfig {
  url: string;
  maxRetriesPerRequest: number;
  enableReadyCheck: boolean;
  lazyConnect: boolean;
}

export const redisConfig: RedisConfig = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: isProduction ? 5 : 3,
  enableReadyCheck: true,
  lazyConnect: false,
};

/**
 * Database (TimescaleDB) configuration
 */
export interface DatabaseConfig {
  url: string;
  password: string;
  ssl: boolean;
  maxConnections: number;
}

export const databaseConfig: DatabaseConfig = {
  url: env.DATABASE_URL,
  password: env.DB_PASSWORD,
  ssl: isProduction,
  maxConnections: isProduction ? 20 : 5,
};

/**
 * IBKR (Interactive Brokers) configuration
 */
export interface IbkrConfig {
  host: string;
  port: number;
  clientId: number;
  executionClientId: number;
  paperTrading: boolean;
}

export const ibkrConfig: IbkrConfig = {
  host: env.IBKR_HOST,
  port: env.IBKR_PORT,
  clientId: env.IBKR_CLIENT_ID,
  executionClientId: env.IBKR_EXECUTION_CLIENT_ID,
  paperTrading: env.IBKR_PORT === 7497, // 7497 = paper, 7496 = live
};

/**
 * Kraken exchange configuration
 */
export interface KrakenConfig {
  apiKey: string;
  apiSecret: string;
  symbols: string[];
  l3Enabled: boolean;
  wsPublicUrl: string;
  wsAuthUrl: string;
  restUrl: string;
}

export const krakenConfig: KrakenConfig = {
  apiKey: env.KRAKEN_API_KEY,
  apiSecret: env.KRAKEN_API_SECRET,
  symbols: env.KRAKEN_SYMBOLS,
  l3Enabled: env.KRAKEN_L3_ENABLED,
  wsPublicUrl: "wss://ws.kraken.com/v2",
  wsAuthUrl: "wss://ws-auth.kraken.com/v2",
  restUrl: "https://api.kraken.com",
};

/**
 * Catalyst/news API configuration
 */
export interface CatalystConfig {
  polygonApiKey: string;
  cryptoQuantApiKey: string;
  polygonEnabled: boolean;
  cryptoQuantEnabled: boolean;
}

export const catalystConfig: CatalystConfig = {
  polygonApiKey: env.POLYGON_API_KEY,
  cryptoQuantApiKey: env.CRYPTOQUANT_API_KEY,
  polygonEnabled: env.POLYGON_API_KEY.length > 0,
  cryptoQuantEnabled: env.CRYPTOQUANT_API_KEY.length > 0,
};

/**
 * ML model configuration
 */
export interface ModelConfig {
  orderFlowModelPath: string;
  catalystLlmPath: string;
}

export const modelConfig: ModelConfig = {
  orderFlowModelPath: env.ORDER_FLOW_MODEL_PATH,
  catalystLlmPath: env.CATALYST_LLM_MODEL_PATH,
};

/**
 * Storage writer configuration
 */
export interface StorageConfig {
  batchSize: number;
  flushIntervalMs: number;
  backpressureThreshold: number; // 80% of batch size
  dropThreshold: number; // 100% - when to drop oldest
}

export const storageConfig: StorageConfig = {
  batchSize: env.STORAGE_BATCH_SIZE,
  flushIntervalMs: env.STORAGE_FLUSH_INTERVAL_MS,
  backpressureThreshold: Math.floor(env.STORAGE_BATCH_SIZE * 0.8),
  dropThreshold: env.STORAGE_BATCH_SIZE,
};

/**
 * Health check server configuration
 */
export interface HealthCheckConfig {
  port: number;
  path: string;
}

export const healthCheckConfig: HealthCheckConfig = {
  port: env.HEALTH_CHECK_PORT,
  path: "/health",
};

/**
 * Logging configuration
 */
export interface LogConfig {
  level: "debug" | "info" | "warn" | "error";
  json: boolean;
}

export const logConfig: LogConfig = {
  level: env.LOG_LEVEL,
  json: isProduction,
};

/**
 * Combined application configuration
 */
export interface AppConfig {
  redis: RedisConfig;
  database: DatabaseConfig;
  ibkr: IbkrConfig;
  kraken: KrakenConfig;
  catalyst: CatalystConfig;
  model: ModelConfig;
  storage: StorageConfig;
  healthCheck: HealthCheckConfig;
  log: LogConfig;
  isProduction: boolean;
}

export const config: AppConfig = {
  redis: redisConfig,
  database: databaseConfig,
  ibkr: ibkrConfig,
  kraken: krakenConfig,
  catalyst: catalystConfig,
  model: modelConfig,
  storage: storageConfig,
  healthCheck: healthCheckConfig,
  log: logConfig,
  isProduction,
};
