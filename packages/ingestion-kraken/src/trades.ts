/**
 * Kraken Trades Handler
 *
 * Processes tick-by-tick trade data from Kraken WebSocket.
 * Maps Kraken trade messages to unified TradeEvent schema.
 */

import type { TradeEvent, TradeSide } from "@trading/types";
import type { KrakenTrade, KrakenTradeMessage } from "./types.js";

/**
 * Map Kraken trade side to unified TradeSide
 */
function mapTradeSide(side: "buy" | "sell"): TradeSide {
  return side;
}

/**
 * Parse Kraken timestamp to Unix epoch ms
 */
function parseTimestamp(timestamp: string): number {
  return new Date(timestamp).getTime();
}

/**
 * Convert a single Kraken trade to TradeEvent
 */
function krakenTradeToEvent(trade: KrakenTrade): TradeEvent {
  return {
    source: "kraken",
    asset_class: "crypto",
    symbol: trade.symbol,
    timestamp: parseTimestamp(trade.timestamp),
    price: trade.price,
    size: trade.qty,
    side: mapTradeSide(trade.side),
  };
}

/**
 * Trade Handler - processes Kraken trade messages
 */
export class TradeHandler {
  private lastTradeId: Map<string, number> = new Map();
  private tradeCount: Map<string, number> = new Map();

  /**
   * Process a Kraken trade message
   * Returns array of TradeEvent (may contain multiple trades)
   */
  processMessage(message: KrakenTradeMessage): TradeEvent[] {
    if (!message.data || message.data.length === 0) {
      return [];
    }

    const events: TradeEvent[] = [];

    for (const trade of message.data) {
      // Track trade IDs to detect duplicates
      const lastId = this.lastTradeId.get(trade.symbol) || 0;
      if (trade.trade_id <= lastId && message.type !== "snapshot") {
        // Skip duplicate trade
        continue;
      }
      this.lastTradeId.set(trade.symbol, trade.trade_id);

      // Increment trade count
      const count = this.tradeCount.get(trade.symbol) || 0;
      this.tradeCount.set(trade.symbol, count + 1);

      events.push(krakenTradeToEvent(trade));
    }

    if (message.type === "snapshot" && events.length > 0) {
      console.log(
        `[Trades:${message.data[0]?.symbol}] Snapshot received: ${events.length} trades`
      );
    }

    return events;
  }

  /**
   * Get trade count for a symbol
   */
  getTradeCount(symbol: string): number {
    return this.tradeCount.get(symbol) || 0;
  }

  /**
   * Get all trade counts
   */
  getAllTradeCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [symbol, count] of this.tradeCount) {
      counts[symbol] = count;
    }
    return counts;
  }

  /**
   * Reset trade counts (useful for stats reporting)
   */
  resetCounts(): void {
    this.tradeCount.clear();
  }
}

/**
 * Create a trade handler instance
 */
export function createTradeHandler(): TradeHandler {
  return new TradeHandler();
}
