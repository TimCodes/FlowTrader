/**
 * Redis Stream Publisher
 *
 * Publishes OrderBookEvent, TradeEvent, and L3OrderEvent to Redis Streams.
 * Supports configurable throttling for order book updates.
 */

import type Redis from "ioredis";
import type { OrderBookEvent, TradeEvent, L3OrderEvent } from "@trading/types";
import {
  publishOrderBook,
  publishTrade,
  publishL3Order,
} from "@trading/shared";

export interface PublisherOptions {
  /** Minimum interval between order book publishes per symbol (ms). 0 = no throttle */
  orderBookThrottleMs?: number;
  /** Enable logging of publish events */
  verbose?: boolean;
}

export interface PublisherStats {
  orderBookPublished: number;
  orderBookThrottled: number;
  tradesPublished: number;
  l3Published: number;
  errors: number;
}

/**
 * Redis Stream Publisher for Kraken events
 */
export class KrakenPublisher {
  private redis: Redis;
  private options: Required<PublisherOptions>;
  private lastOrderBookPublish: Map<string, number> = new Map();
  private stats: PublisherStats = {
    orderBookPublished: 0,
    orderBookThrottled: 0,
    tradesPublished: 0,
    l3Published: 0,
    errors: 0,
  };

  constructor(redis: Redis, options: PublisherOptions = {}) {
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

      if (this.options.verbose) {
        console.log(
          `[Publisher] OrderBook ${event.symbol}: bid=${event.bids[0]?.price} ask=${event.asks[0]?.price} imbalance=${event.imbalance.toFixed(3)}`
        );
      }

      return true;
    } catch (err) {
      this.stats.errors++;
      console.error(`[Publisher] Failed to publish order book:`, err);
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

      if (this.options.verbose) {
        console.log(
          `[Publisher] Trade ${event.symbol}: ${event.side} ${event.size} @ ${event.price}`
        );
      }

      return true;
    } catch (err) {
      this.stats.errors++;
      console.error(`[Publisher] Failed to publish trade:`, err);
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
   * Publish an L3OrderEvent to Redis Stream
   */
  async publishL3Order(event: L3OrderEvent): Promise<boolean> {
    try {
      await publishL3Order(this.redis, event);
      this.stats.l3Published++;

      if (this.options.verbose) {
        console.log(
          `[Publisher] L3 ${event.symbol}: ${event.event} ${event.order_id} ${event.side} ${event.qty} @ ${event.price}`
        );
      }

      return true;
    } catch (err) {
      this.stats.errors++;
      console.error(`[Publisher] Failed to publish L3 order:`, err);
      return false;
    }
  }

  /**
   * Publish multiple L3OrderEvents to Redis Stream
   */
  async publishL3Orders(events: L3OrderEvent[]): Promise<number> {
    let published = 0;
    for (const event of events) {
      if (await this.publishL3Order(event)) {
        published++;
      }
    }
    return published;
  }

  /**
   * Get current statistics
   */
  getStats(): PublisherStats {
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
      l3Published: 0,
      errors: 0,
    };
  }

  /**
   * Log current statistics
   */
  logStats(): void {
    console.log(
      `[Publisher] Stats: orderbook=${this.stats.orderBookPublished} (throttled=${this.stats.orderBookThrottled}), trades=${this.stats.tradesPublished}, l3=${this.stats.l3Published}, errors=${this.stats.errors}`
    );
  }
}

/**
 * Create a Kraken publisher instance
 */
export function createKrakenPublisher(
  redis: Redis,
  options?: PublisherOptions
): KrakenPublisher {
  return new KrakenPublisher(redis, options);
}
