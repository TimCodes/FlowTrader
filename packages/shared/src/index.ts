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

// Redis Stream helpers
export {
  // Publish functions
  publishOrderBook,
  publishTrade,
  publishL3Order,
  publishCatalyst,
  publishFeatures,
  publishOrderFlowSignal,
  publishCatalystSignal,
  publishDecision,
  publishExecution,
  publishEvent,
  // Consumer group management
  createConsumerGroup,
  ensureConsumerGroups,
  // Reading/consuming
  readGroup,
  acknowledgeMessages,
  getPendingMessages,
  claimPendingMessages,
  // Stream utilities
  getStreamInfo,
  trimStream,
  // Types
  type StreamEvent,
  type StreamMessage,
  type ConsumerGroupConfig,
  type ReadGroupOptions,
} from "./streams.js";
