/**
 * @trading/shared
 *
 * Shared utilities for the trading system:
 * - Environment validation (Zod)
 * - Typed configuration objects
 * - Redis client factory with connection pooling
 * - Redis Stream helpers (publish/subscribe)
 */

// Environment validation
export { env, isProduction, isDevelopment, isTest, type Env } from "./env.js";

// Configuration objects
export {
  config,
  redisConfig,
  databaseConfig,
  ibkrConfig,
  krakenConfig,
  catalystConfig,
  modelConfig,
  storageConfig,
  healthCheckConfig,
  logConfig,
  type AppConfig,
  type RedisConfig,
  type DatabaseConfig,
  type IbkrConfig,
  type KrakenConfig,
  type CatalystConfig,
  type ModelConfig,
  type StorageConfig,
  type HealthCheckConfig,
  type LogConfig,
} from "./config.js";

// Redis client factory
export {
  createRedisClient,
  duplicateClient,
  closeAllRedisConnections,
  checkRedisHealth,
  getRedisInfo,
  type RedisClientOptions,
} from "./redis.js";
