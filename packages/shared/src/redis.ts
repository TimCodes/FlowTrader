/**
 * Redis Client Factory
 *
 * Provides connection pooling, automatic reconnection with exponential backoff,
 * and centralized configuration via @trading/shared config.
 */

import Redis, { RedisOptions } from "ioredis";
import { redisConfig } from "./config.js";

export interface RedisClientOptions {
  db?: number;
  keyPrefix?: string;
}

const DEFAULT_OPTIONS: Partial<RedisOptions> = {
  maxRetriesPerRequest: redisConfig.maxRetriesPerRequest,
  enableReadyCheck: redisConfig.enableReadyCheck,
  lazyConnect: redisConfig.lazyConnect,
  retryStrategy: (times: number): number | null => {
    // Exponential backoff: 100ms, 200ms, 400ms, 800ms... up to 30s max
    const delay = Math.min(Math.pow(2, times) * 100, 30000);
    console.log(`[Redis] Reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  },
  reconnectOnError: (err: Error): boolean | 1 | 2 => {
    const targetErrors = ["READONLY", "ECONNRESET", "ETIMEDOUT"];
    if (targetErrors.some((e) => err.message.includes(e))) {
      // Reconnect and retry the command
      return 2;
    }
    return false;
  },
};

/**
 * Attach event handlers for logging and monitoring
 */
function attachEventHandlers(client: Redis, name: string): void {
  client.on("connect", () => {
    console.log(`[Redis:${name}] Connecting...`);
  });

  client.on("ready", () => {
    console.log(`[Redis:${name}] Connected and ready`);
  });

  client.on("error", (err: Error) => {
    console.error(`[Redis:${name}] Error:`, err.message);
  });

  client.on("close", () => {
    console.log(`[Redis:${name}] Connection closed`);
  });

  client.on("reconnecting", (delay: number) => {
    console.log(`[Redis:${name}] Reconnecting in ${delay}ms...`);
  });

  client.on("end", () => {
    console.log(`[Redis:${name}] Connection ended`);
  });
}

// Client pool for reuse
const clientPool = new Map<string, Redis>();

/**
 * Create or retrieve a Redis client instance
 *
 * @param name - Unique name for this client (for logging and pooling)
 * @param options - Optional overrides (db, keyPrefix)
 * @returns Redis client instance
 *
 * @example
 * ```ts
 * // Use default config
 * const redis = createRedisClient("main");
 *
 * // With custom db
 * const redis = createRedisClient("streams", { db: 1 });
 * ```
 */
export function createRedisClient(
  name: string = "default",
  options: RedisClientOptions = {}
): Redis {
  // Check pool for existing client
  const poolKey = `${name}-${JSON.stringify(options)}`;
  const existing = clientPool.get(poolKey);
  if (existing && existing.status === "ready") {
    return existing;
  }

  // Merge: default options < explicit options
  const mergedOptions: RedisOptions = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  // Create client from URL with merged options
  const client = new Redis(redisConfig.url, mergedOptions);

  // Attach logging handlers
  attachEventHandlers(client, name);

  // Store in pool
  clientPool.set(poolKey, client);

  return client;
}

/**
 * Create a duplicate connection for pub/sub or blocking operations
 *
 * @param source - Source client to duplicate from
 * @param name - Name for the duplicate client
 * @returns New Redis client with same config
 */
export function duplicateClient(source: Redis, name: string): Redis {
  const duplicate = source.duplicate();
  attachEventHandlers(duplicate, name);
  return duplicate;
}

/**
 * Gracefully close all pooled Redis connections
 */
export async function closeAllRedisConnections(): Promise<void> {
  const closePromises: Promise<void>[] = [];

  for (const [key, client] of clientPool.entries()) {
    console.log(`[Redis] Closing connection: ${key}`);
    closePromises.push(
      client.quit().then(() => {
        clientPool.delete(key);
      })
    );
  }

  await Promise.all(closePromises);
  console.log("[Redis] All connections closed");
}

/**
 * Check if Redis is connected and responding
 */
export async function checkRedisHealth(client: Redis): Promise<boolean> {
  try {
    const pong = await client.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}

/**
 * Get Redis connection info for health checks
 */
export async function getRedisInfo(
  client: Redis
): Promise<Record<string, string>> {
  try {
    const info = await client.info("server");
    const lines = info.split("\r\n").filter((l) => l && !l.startsWith("#"));
    const result: Record<string, string> = {};
    for (const line of lines) {
      const [key, value] = line.split(":");
      if (key && value) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}
