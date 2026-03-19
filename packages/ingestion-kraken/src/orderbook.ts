/**
 * Order Book State Manager
 *
 * Maintains local order book state from Kraken L2 updates.
 * - Applies insert/update/delete operations
 * - Sorts bids descending, asks ascending
 * - Verifies state with CRC32 checksum
 * - Computes imbalance ratio
 */

import type { OrderBookEvent, PriceLevel } from "@trading/types";
import type { KrakenBookLevel, KrakenBookMessage } from "./types.js";

/**
 * CRC32 lookup table (IEEE polynomial)
 */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

/**
 * Compute CRC32 checksum
 */
function crc32(str: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    crc = CRC32_TABLE[(crc ^ str.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Format price/qty for Kraken checksum calculation
 * Removes trailing zeros and decimal point if integer
 */
function formatForChecksum(value: number): string {
  // Convert to string, remove decimal point, remove leading zeros
  const str = value.toFixed(10).replace(".", "").replace(/^0+/, "");
  return str || "0";
}

/**
 * Order book for a single symbol
 */
export class OrderBook {
  readonly symbol: string;
  private bids: Map<number, number> = new Map(); // price -> size
  private asks: Map<number, number> = new Map(); // price -> size
  private lastChecksum: number = 0;
  private lastUpdate: number = Date.now();
  private depth: number;

  constructor(symbol: string, depth: number = 25) {
    this.symbol = symbol;
    this.depth = depth;
  }

  /**
   * Apply a snapshot (replaces entire book)
   */
  applySnapshot(
    bids: KrakenBookLevel[],
    asks: KrakenBookLevel[],
    checksum: number
  ): boolean {
    this.bids.clear();
    this.asks.clear();

    for (const bid of bids) {
      this.bids.set(bid.price, bid.qty);
    }
    for (const ask of asks) {
      this.asks.set(ask.price, ask.qty);
    }

    this.lastChecksum = checksum;
    this.lastUpdate = Date.now();

    return this.verifyChecksum(checksum);
  }

  /**
   * Apply incremental update
   */
  applyUpdate(
    bids: KrakenBookLevel[],
    asks: KrakenBookLevel[],
    checksum: number
  ): boolean {
    // Apply bid updates
    for (const bid of bids) {
      if (bid.qty === 0) {
        this.bids.delete(bid.price);
      } else {
        this.bids.set(bid.price, bid.qty);
      }
    }

    // Apply ask updates
    for (const ask of asks) {
      if (ask.qty === 0) {
        this.asks.delete(ask.price);
      } else {
        this.asks.set(ask.price, ask.qty);
      }
    }

    this.lastChecksum = checksum;
    this.lastUpdate = Date.now();

    return this.verifyChecksum(checksum);
  }

  /**
   * Verify the checksum matches Kraken's expected value
   * Kraken uses top 10 ask + top 10 bid levels for checksum
   */
  verifyChecksum(expected: number): boolean {
    const topAsks = this.getTopAsks(10);
    const topBids = this.getTopBids(10);

    // Build checksum string: ask prices/qtys then bid prices/qtys
    let checksumStr = "";

    for (const ask of topAsks) {
      checksumStr += formatForChecksum(ask.price);
      checksumStr += formatForChecksum(ask.size);
    }

    for (const bid of topBids) {
      checksumStr += formatForChecksum(bid.price);
      checksumStr += formatForChecksum(bid.size);
    }

    const computed = crc32(checksumStr);
    const valid = computed === expected;

    if (!valid) {
      console.warn(
        `[OrderBook:${this.symbol}] Checksum mismatch: computed=${computed}, expected=${expected}`
      );
    }

    return valid;
  }

  /**
   * Get top N bids (sorted descending by price)
   */
  getTopBids(n: number = this.depth): PriceLevel[] {
    return Array.from(this.bids.entries())
      .sort((a, b) => b[0] - a[0]) // Descending
      .slice(0, n)
      .map(([price, size]) => ({ price, size }));
  }

  /**
   * Get top N asks (sorted ascending by price)
   */
  getTopAsks(n: number = this.depth): PriceLevel[] {
    return Array.from(this.asks.entries())
      .sort((a, b) => a[0] - b[0]) // Ascending
      .slice(0, n)
      .map(([price, size]) => ({ price, size }));
  }

  /**
   * Get best bid price
   */
  getBestBid(): number | null {
    if (this.bids.size === 0) return null;
    return Math.max(...this.bids.keys());
  }

  /**
   * Get best ask price
   */
  getBestAsk(): number | null {
    if (this.asks.size === 0) return null;
    return Math.min(...this.asks.keys());
  }

  /**
   * Get spread in price units
   */
  getSpread(): number | null {
    const bid = this.getBestBid();
    const ask = this.getBestAsk();
    if (bid === null || ask === null) return null;
    return ask - bid;
  }

  /**
   * Get mid price
   */
  getMidPrice(): number | null {
    const bid = this.getBestBid();
    const ask = this.getBestAsk();
    if (bid === null || ask === null) return null;
    return (bid + ask) / 2;
  }

  /**
   * Compute total bid volume
   */
  getTotalBidVolume(): number {
    let total = 0;
    for (const size of this.bids.values()) {
      total += size;
    }
    return total;
  }

  /**
   * Compute total ask volume
   */
  getTotalAskVolume(): number {
    let total = 0;
    for (const size of this.asks.values()) {
      total += size;
    }
    return total;
  }

  /**
   * Compute imbalance ratio (0-1, where 0.5 = balanced)
   * imbalance = bid_volume / (bid_volume + ask_volume)
   */
  getImbalance(): number {
    const bidVol = this.getTotalBidVolume();
    const askVol = this.getTotalAskVolume();
    const total = bidVol + askVol;
    if (total === 0) return 0.5;
    return bidVol / total;
  }

  /**
   * Convert to OrderBookEvent
   */
  toEvent(): OrderBookEvent {
    const bids = this.getTopBids();
    const asks = this.getTopAsks();
    const bidTotal = this.getTotalBidVolume();
    const askTotal = this.getTotalAskVolume();

    return {
      source: "kraken",
      asset_class: "crypto",
      symbol: this.symbol,
      timestamp: this.lastUpdate,
      bids,
      asks,
      bid_total: bidTotal,
      ask_total: askTotal,
      imbalance: this.getImbalance(),
    };
  }

  /**
   * Get time since last update in ms
   */
  getAge(): number {
    return Date.now() - this.lastUpdate;
  }
}

/**
 * Order Book Manager - manages books for multiple symbols
 */
export class OrderBookManager {
  private books: Map<string, OrderBook> = new Map();
  private depth: number;

  constructor(depth: number = 25) {
    this.depth = depth;
  }

  /**
   * Get or create order book for a symbol
   */
  getBook(symbol: string): OrderBook {
    let book = this.books.get(symbol);
    if (!book) {
      book = new OrderBook(symbol, this.depth);
      this.books.set(symbol, book);
    }
    return book;
  }

  /**
   * Process a Kraken book message (snapshot or update)
   */
  processMessage(message: KrakenBookMessage): OrderBookEvent | null {
    if (!message.data || message.data.length === 0) {
      return null;
    }

    const data = message.data[0];
    const book = this.getBook(data.symbol);

    let valid: boolean;
    if (message.type === "snapshot") {
      valid = book.applySnapshot(data.bids, data.asks, data.checksum);
      console.log(
        `[OrderBook:${data.symbol}] Snapshot applied: ${data.bids.length} bids, ${data.asks.length} asks, valid=${valid}`
      );
    } else {
      valid = book.applyUpdate(data.bids, data.asks, data.checksum);
    }

    if (!valid) {
      console.warn(`[OrderBook:${data.symbol}] Checksum invalid, may need resync`);
    }

    return book.toEvent();
  }

  /**
   * Get all symbols being tracked
   */
  getSymbols(): string[] {
    return Array.from(this.books.keys());
  }

  /**
   * Get all current order book events
   */
  getAllEvents(): OrderBookEvent[] {
    return Array.from(this.books.values()).map((book) => book.toEvent());
  }
}

/**
 * Create an order book manager
 */
export function createOrderBookManager(depth: number = 25): OrderBookManager {
  return new OrderBookManager(depth);
}
