/**
 * IBKR Tick-by-Tick Trade Handler
 *
 * Processes tick-by-tick trade data from IBKR TWS API.
 * Implements aggressor classification by comparing trade price to bid/ask.
 *
 * IBKR provides:
 * - Trade price and size
 * - Exchange where trade occurred
 * - Timestamp (Unix epoch seconds)
 *
 * IBKR does NOT provide:
 * - Trade side (must be inferred from bid/ask comparison)
 */

import type { TradeEvent, TradeSide } from "@trading/types";
import type { TickByTickLast, BidAskTick } from "./types.js";

/**
 * Quote state for aggressor classification
 */
interface QuoteState {
  bidPrice: number;
  askPrice: number;
  bidSize: number;
  askSize: number;
  timestamp: number;
}

/**
 * Trade Handler - processes IBKR tick-by-tick trade data
 *
 * Aggressor classification logic:
 * - Trade at ask price or higher = buy (taker buying from maker)
 * - Trade at bid price or lower = sell (taker selling to maker)
 * - Trade between bid and ask = unknown (likely midpoint trade)
 */
export class IBKRTradeHandler {
  private quotes: Map<string, QuoteState> = new Map(); // symbol -> quote
  private tradeCount: Map<string, number> = new Map(); // symbol -> count
  // Rolling cache to deduplicate tick-by-tick trades per tickerId using a composite key
  // (time, price, size) rather than seconds-only timestamps.
  private lastTradeKey: Map<number, string> = new Map(); // tickerId -> dedup key
  private tickerToSymbol: Map<number, string> = new Map();
  private lastTradeTime: Map<number, number> = new Map();

  /**
   * Register a symbol for a ticker ID
   */
  registerSymbol(tickerId: number, symbol: string): void {
    this.tickerToSymbol.set(tickerId, symbol);
  }

  /**
   * Update quote state for aggressor classification
   * Called from bid/ask tick subscription
   */
  updateQuote(data: BidAskTick): void {
    const symbol = this.tickerToSymbol.get(data.tickerId);
    if (!symbol) {
      // No registered symbol for this tickerId; cannot store quote reliably
      return;
    }

    this.quotes.set(symbol, {
      bidPrice: data.bidPrice,
      askPrice: data.askPrice,
      bidSize: data.bidSize,
      askSize: data.askSize,
      timestamp: data.time * 1000, // Convert to ms
    });
  }

  /**
   * Classify aggressor side based on trade price vs bid/ask
   */
  classifyAggressor(tickerId: number, tradePrice: number): TradeSide {
    const symbol = this.tickerToSymbol.get(tickerId);
    if (!symbol) {
      // No symbol mapping for this tickerId; cannot find corresponding quote
      return "unknown";
    }

    const quote = this.quotes.get(symbol);

    if (!quote) {
      // No quote data available
      return "unknown";
    }

    // Check if quote is stale (>5 seconds old)
    const quoteAge = Date.now() - quote.timestamp;
    if (quoteAge > 5000) {
      return "unknown";
    }

    // Classification logic
    if (tradePrice >= quote.askPrice) {
      // Trade at or above ask = buyer aggressor (buy)
      return "buy";
    } else if (tradePrice <= quote.bidPrice) {
      // Trade at or below bid = seller aggressor (sell)
      return "sell";
    } else {
      // Trade between bid and ask
      // Use midpoint to guess direction
      const midPrice = (quote.bidPrice + quote.askPrice) / 2;
      if (tradePrice > midPrice) {
        return "buy";
      } else if (tradePrice < midPrice) {
        return "sell";
      }
      return "unknown";
    }
  }

  /**
   * Process a tick-by-tick last trade
   * Returns TradeEvent or null if symbol not registered
   */
  processTrade(data: TickByTickLast): TradeEvent | null {
    const symbol = this.tickerToSymbol.get(data.tickerId);
    if (!symbol) {
      console.warn(
        `[TradeHandler] No symbol registered for tickerId=${data.tickerId}`
      );
      return null;
    }

    // Skip unreported trades (e.g., late reports)
    if (data.tickAttribLast.unreported) {
      return null;
    }

    // Deduplicate using a composite key so multiple trades in the same second are not dropped.
    // IBKR timestamps are in seconds, so use (time, price, size) to distinguish distinct trades.
    const dedupKey = `${data.time}-${data.price}-${data.size}`;
    const lastKey = this.lastTradeKey.get(data.tickerId);
    if (lastKey === dedupKey) {
      return null;
    }
    this.lastTradeKey.set(data.tickerId, dedupKey);

    // Classify aggressor
    const side = this.classifyAggressor(data.tickerId, data.price);

    // Increment trade count
    const count = this.tradeCount.get(symbol) || 0;
    this.tradeCount.set(symbol, count + 1);

    return {
      source: "ibkr",
      asset_class: "futures",
      symbol,
      timestamp: data.time * 1000, // IBKR provides seconds, convert to ms
      price: data.price,
      size: data.size,
      side,
    };
  }

  /**
   * Get current quote for a ticker
   */
  getQuote(tickerId: number): QuoteState | undefined {
    return this.quotes.get(tickerId);
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
   * Get classification stats
   */
  getStats(): {
    registeredSymbols: number;
    quotesTracked: number;
    totalTrades: number;
  } {
    let totalTrades = 0;
    for (const count of this.tradeCount.values()) {
      totalTrades += count;
    }

    return {
      registeredSymbols: this.tickerToSymbol.size,
      quotesTracked: this.quotes.size,
      totalTrades,
    };
  }

  /**
   * Reset trade counts (useful for stats reporting)
   */
  resetCounts(): void {
    this.tradeCount.clear();
  }

  /**
   * Clear all state
   */
  clear(): void {
    this.quotes.clear();
    this.tradeCount.clear();
    this.tickerToSymbol.clear();
    this.lastTradeTime.clear();
    this.lastTradeKey.clear();
  }
}

/**
 * Create a trade handler instance
 */
export function createIBKRTradeHandler(): IBKRTradeHandler {
  return new IBKRTradeHandler();
}
