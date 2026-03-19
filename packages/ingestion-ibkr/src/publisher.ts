/**
 * IBKR Redis Stream Publisher
 *
 * Publishes OrderBookEvent and TradeEvent to Redis Streams.
 * Uses the same stream keys as Kraken pipeline for broker-agnostic consumption.
 * Supports configurable throttling for order book updates.
 *
 * Note: IBKR does not provide L3 data, so no L3 publishing.
 */

import type Redis from "ioredis";
import type { OrderBookEvent, TradeEvent } from "@trading/types";
import { publishOrderBook, publishTrade } from "@trading/shared";

export interface IBKRPublisherOptions {
  /** Minimum interval between order book publishes per symbol (ms). 0 = no throttle */
  orderBookThrottleMs?: number;
  /** Enable logging of publish events */
  verbose?: boolean;
}

export interface IBKRPublisherStats {
  orderBookPublished: number;
  orderBookThrottled: number;
  tradesPublished: number;
  errors: number;
  lastPublishTime: number;
}

/**
 * Redis Stream Publisher for IBKR events
 */
export class IBKRPublisher {
  private redis: Redis;
  private options: Required<IBKRPublisherOptions>;
  private lastOrderBookPublish: Map<string, number> = new Map();
  private stats: IBKRPublisherStats = {
    orderBookPublished: 0,
    orderBookThrottled: 0,
    tradesPublished: 0,
    errors: 0,
    lastPublishTime: 0,
  };

  constructor(redis: Redis, options: IBKRPublisherOptions = {}) {
    this.redis = redis;
    this.options = {
      orderBookThrottleMs: options.orderBookThrottleMs ?? 100,
      verbose: options.verbose ?? false,
    };
  }

  /**
   * Publish an OrderBookEvent to Redis Stream
   * Applies throttling per symbol if configured
   */
  async publishOrderBook(event: OrderBookEvent): Promise<boolean> {
    const now = Date.now();
    const lastPublish = this.lastOrderBookPublish.get(event.symbol) || 0;

    // Check throttle
    if (this.options.orderBookThrottleMs > 0) {
      const elapsed = now - lastPublish;
      if (elapsed < this.options.orderBookThrottleMs) {
        this.stats.orderBookThrottled++;
        return false;
      }
    }

    try {
      await publishOrderBook(this.redis, event);
      this.lastOrderBookPublish.set(event.symbol, now);
      this.stats.orderBookPublished++;
      this.stats.lastPublishTime = now;

      if (this.options.verbose) {
        const bestBid = event.bids[0]?.price ?? "N/A";
        const bestAsk = event.asks[0]?.price ?? "N/A";
        console.log(
          `[IBKR Publisher] OrderBook ${event.symbol}: bid=${bestBid} ask=${bestAsk} imbalance=${event.imbalance.toFixed(3)}`
        );
      }

      return true;
    } catch (err) {
      this.stats.errors++;
      console.error(`[IBKR Publisher] Failed to publish order book:`, err);
      return false;
    }
  }

  /**
   * Publish a TradeEvent to Redis Stream
   */
  async publishTrade(event: TradeEvent): Promise<boolean> {
    try {
      await publishTrade(this.redis, event);
      this.stats.tradesPublished++;
      this.stats.lastPublishTime = Date.now();

      if (this.options.verbose) {
        console.log(
          `[IBKR Publisher] Trade ${event.symbol}: ${event.side} ${event.size} @ ${event.price}`
        );
      }

      return true;
    } catch (err) {
      this.stats.errors++;
      console.error(`[IBKR Publisher] Failed to publish trade:`, err);
      return false;
    }
  }

  /**
   * Publish multiple TradeEvents to Redis Stream
   */
  async publishTrades(events: TradeEvent[]): Promise<number> {
    let published = 0;
    for (const event of events) {
      if (await this.publishTrade(event)) {
        published++;
      }
    }
    return published;
  }

  /**
   * Get current statistics
   */
  getStats(): IBKRPublisherStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      orderBookPublished: 0,
      orderBookThrottled: 0,
      tradesPublished: 0,
      errors: 0,
      lastPublishTime: 0,
    };
  }

  /**
   * Log current statistics
   */
  logStats(): void {
    const elapsed = this.stats.lastPublishTime
      ? `${((Date.now() - this.stats.lastPublishTime) / 1000).toFixed(1)}s ago`
      : "never";
    console.log(
      `[IBKR Publisher] Stats: orderbook=${this.stats.orderBookPublished} (throttled=${this.stats.orderBookThrottled}), trades=${this.stats.tradesPublished}, errors=${this.stats.errors}, last=${elapsed}`
    );
  }

  /**
   * Get throughput stats (events per second)
   */
  getThroughput(
    intervalMs: number
  ): { orderbookPerSec: number; tradesPerSec: number } {
    const seconds = intervalMs / 1000;
    return {
      orderbookPerSec: this.stats.orderBookPublished / seconds,
      tradesPerSec: this.stats.tradesPublished / seconds,
    };
  }

  /**
   * Check if Redis connection is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create an IBKR publisher instance
 */
export function createIBKRPublisher(
  redis: Redis,
  options?: IBKRPublisherOptions
): IBKRPublisher {
  return new IBKRPublisher(redis, options);
}
