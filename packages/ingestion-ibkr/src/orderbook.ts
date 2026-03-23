/**
 * IBKR Order Book State Manager
 *
 * Maintains local order book state from IBKR L2 (Market Depth) updates.
 * - Handles insert/update/delete operations from reqMktDepth callbacks
 * - Sorts bids descending, asks ascending
 * - Computes imbalance ratio
 * - Emits OrderBookEvent for Redis publishing
 *
 * IBKR provides position-based updates (0-9 for 10 levels).
 * Operations: 0=insert, 1=update, 2=delete
 * Side: 0=ask, 1=bid
 */

import type { OrderBookEvent, PriceLevel } from "@trading/types";
import type { MarketDepthEntry, DepthOperation, DepthSide } from "./types.js";
import { mapDepthOperation, mapDepthSide } from "./types.js";

/**
 * Price level with position tracking
 */
interface PositionedLevel {
  position: number;
  price: number;
  size: number;
}

/**
 * Order book for a single IBKR futures contract
 */
export class IBKROrderBook {
  readonly symbol: string;
  readonly tickerId: number;
  private bids: Map<number, PositionedLevel> = new Map(); // position -> level
  private asks: Map<number, PositionedLevel> = new Map(); // position -> level
  private lastUpdate: number = 0;
  private updateCount: number = 0;
  private maxDepth: number;

  constructor(symbol: string, tickerId: number, maxDepth: number = 10) {
    this.symbol = symbol;
    this.tickerId = tickerId;
    this.maxDepth = maxDepth;
  }

  /**
   * Apply a market depth update from IBKR
   */
  applyUpdate(entry: MarketDepthEntry): void {
    const side = mapDepthSide(entry.side);
    const operation = mapDepthOperation(entry.operation);
    const book = side === "bid" ? this.bids : this.asks;

    switch (operation) {
      case "insert":
        // Insert at position, shift others down
        this.insertLevel(book, entry.position, entry.price, entry.size);
        break;

      case "update":
        // Update existing position, or insert if missing (upsert)
        if (book.has(entry.position)) {
          book.set(entry.position, {
            position: entry.position,
            price: entry.price,
            size: entry.size,
          });
        } else {
          this.insertLevel(book, entry.position, entry.price, entry.size);
        }
        break;

      case "delete":
        // Delete position, shift others up
        this.deleteLevel(book, entry.position);
        break;
    }

    this.lastUpdate = Date.now();
    this.updateCount++;
  }

  /**
   * Insert a level at position, shifting existing levels down
   */
  private insertLevel(
    book: Map<number, PositionedLevel>,
    position: number,
    price: number,
    size: number
  ): void {
    // Shift existing levels down (from bottom up)
    for (let i = this.maxDepth - 1; i > position; i--) {
      const prevLevel = book.get(i - 1);
      if (prevLevel) {
        book.set(i, { ...prevLevel, position: i });
      } else {
        book.delete(i);
      }
    }

    // Insert new level
    book.set(position, { position, price, size });
  }

  /**
   * Delete a level at position, shifting others up
   */
  private deleteLevel(
    book: Map<number, PositionedLevel>,
    position: number
  ): void {
    // Shift levels up (from position to end)
    for (let i = position; i < this.maxDepth - 1; i++) {
      const nextLevel = book.get(i + 1);
      if (nextLevel) {
        book.set(i, { ...nextLevel, position: i });
      } else {
        book.delete(i);
      }
    }
    // Remove last position
    book.delete(this.maxDepth - 1);
  }

  /**
   * Clear the order book
   */
  clear(): void {
    this.bids.clear();
    this.asks.clear();
    this.updateCount = 0;
  }

  /**
   * Get bids as PriceLevel array (sorted descending by price)
   */
  getBids(): PriceLevel[] {
    const levels = Array.from(this.bids.values())
      .sort((a, b) => a.position - b.position) // Position 0 = best bid
      .map(({ price, size }) => ({ price, size }));
    return levels;
  }

  /**
   * Get asks as PriceLevel array (sorted ascending by price)
   */
  getAsks(): PriceLevel[] {
    const levels = Array.from(this.asks.values())
      .sort((a, b) => a.position - b.position) // Position 0 = best ask
      .map(({ price, size }) => ({ price, size }));
    return levels;
  }

  /**
   * Get best bid price
   */
  getBestBid(): number | null {
    const level = this.bids.get(0);
    return level ? level.price : null;
  }

  /**
   * Get best ask price
   */
  getBestAsk(): number | null {
    const level = this.asks.get(0);
    return level ? level.price : null;
  }

  /**
   * Get best bid size
   */
  getBestBidSize(): number | null {
    const level = this.bids.get(0);
    return level ? level.size : null;
  }

  /**
   * Get best ask size
   */
  getBestAskSize(): number | null {
    const level = this.asks.get(0);
    return level ? level.size : null;
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
    for (const level of this.bids.values()) {
      total += level.size;
    }
    return total;
  }

  /**
   * Compute total ask volume
   */
  getTotalAskVolume(): number {
    let total = 0;
    for (const level of this.asks.values()) {
      total += level.size;
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
   * Check if book has data
   */
  hasData(): boolean {
    return this.bids.size > 0 || this.asks.size > 0;
  }

  /**
   * Get number of bid levels
   */
  getBidDepth(): number {
    return this.bids.size;
  }

  /**
   * Get number of ask levels
   */
  getAskDepth(): number {
    return this.asks.size;
  }

  /**
   * Get time since last update in ms
   */
  getAge(): number {
    if (this.lastUpdate === 0) return Infinity;
    return Date.now() - this.lastUpdate;
  }

  /**
   * Get total number of updates received
   */
  getUpdateCount(): number {
    return this.updateCount;
  }

  /**
   * Convert to OrderBookEvent
   */
  toEvent(): OrderBookEvent {
    const bids = this.getBids();
    const asks = this.getAsks();
    const bidTotal = this.getTotalBidVolume();
    const askTotal = this.getTotalAskVolume();

    return {
      source: "ibkr",
      asset_class: "futures",
      symbol: this.symbol,
      timestamp: this.lastUpdate || Date.now(),
      bids,
      asks,
      bid_total: bidTotal,
      ask_total: askTotal,
      imbalance: this.getImbalance(),
    };
  }
}

/**
 * Order Book Manager - manages books for multiple IBKR futures contracts
 */
export class IBKROrderBookManager {
  private books: Map<number, IBKROrderBook> = new Map(); // tickerId -> book
  private symbolToTickerId: Map<string, number> = new Map();
  private maxDepth: number;

  constructor(maxDepth: number = 10) {
    this.maxDepth = maxDepth;
  }

  /**
   * Register a new order book for a symbol/tickerId
   */
  registerBook(symbol: string, tickerId: number): IBKROrderBook {
    const book = new IBKROrderBook(symbol, tickerId, this.maxDepth);
    this.books.set(tickerId, book);
    this.symbolToTickerId.set(symbol, tickerId);
    console.log(
      `[OrderBookManager] Registered book: ${symbol} (tickerId=${tickerId})`
    );
    return book;
  }

  /**
   * Get order book by ticker ID
   */
  getBookByTickerId(tickerId: number): IBKROrderBook | undefined {
    return this.books.get(tickerId);
  }

  /**
   * Get order book by symbol
   */
  getBookBySymbol(symbol: string): IBKROrderBook | undefined {
    const tickerId = this.symbolToTickerId.get(symbol);
    if (tickerId === undefined) return undefined;
    return this.books.get(tickerId);
  }

  /**
   * Process a market depth update
   * Returns the updated OrderBookEvent or null if book not found
   */
  processUpdate(
    tickerId: number,
    entry: MarketDepthEntry
  ): OrderBookEvent | null {
    const book = this.books.get(tickerId);
    if (!book) {
      console.warn(
        `[OrderBookManager] No book registered for tickerId=${tickerId}`
      );
      return null;
    }

    book.applyUpdate(entry);
    return book.toEvent();
  }

  /**
   * Get all registered symbols
   */
  getSymbols(): string[] {
    return Array.from(this.symbolToTickerId.keys());
  }

  /**
   * Get all current order book events
   */
  getAllEvents(): OrderBookEvent[] {
    return Array.from(this.books.values())
      .filter((book) => book.hasData())
      .map((book) => book.toEvent());
  }

  /**
   * Get book statistics
   */
  getStats(): {
    symbol: string;
    tickerId: number;
    bidLevels: number;
    askLevels: number;
    updateCount: number;
    ageMs: number;
  }[] {
    return Array.from(this.books.values()).map((book) => ({
      symbol: book.symbol,
      tickerId: book.tickerId,
      bidLevels: book.getBidDepth(),
      askLevels: book.getAskDepth(),
      updateCount: book.getUpdateCount(),
      ageMs: book.getAge(),
    }));
  }

  /**
   * Clear all books
   */
  clearAll(): void {
    for (const book of this.books.values()) {
      book.clear();
    }
  }

  /**
   * Remove a book
   */
  removeBook(tickerId: number): void {
    const book = this.books.get(tickerId);
    if (book) {
      this.symbolToTickerId.delete(book.symbol);
      this.books.delete(tickerId);
    }
  }
}

/**
 * Create an IBKR order book manager
 */
export function createIBKROrderBookManager(
  maxDepth: number = 10
): IBKROrderBookManager {
  return new IBKROrderBookManager(maxDepth);
}
