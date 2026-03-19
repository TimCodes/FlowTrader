/**
 * Kraken L3 Order Handler
 *
 * Processes Level 3 (individual order) data from Kraken authenticated WebSocket.
 * Maps Kraken L3 events to unified L3OrderEvent schema.
 */

import type { L3OrderEvent, L3Event, TradeSide } from "@trading/types";
import type {
  KrakenL3Message,
  KrakenL3Snapshot,
  KrakenL3Update,
  KrakenL3Order,
  KrakenL3Event,
} from "./types.js";

/**
 * Parse Kraken timestamp to Unix epoch ms
 */
function parseTimestamp(timestamp: string): number {
  return new Date(timestamp).getTime();
}

/**
 * Map Kraken side to unified TradeSide
 */
function mapSide(side: "buy" | "sell" | undefined): TradeSide {
  if (side === "buy") return "buy";
  if (side === "sell") return "sell";
  return "unknown";
}

/**
 * Map Kraken event type to unified L3Event
 */
function mapEventType(event: "add" | "modify" | "delete"): L3Event {
  return event;
}

/**
 * Convert a Kraken L3 snapshot order to L3OrderEvent
 */
function krakenL3OrderToEvent(
  order: KrakenL3Order,
  event: L3Event
): L3OrderEvent {
  return {
    source: "kraken",
    symbol: order.symbol,
    timestamp: parseTimestamp(order.timestamp),
    order_id: order.order_id,
    event,
    side: mapSide(order.side),
    price: order.price,
    qty: order.qty,
  };
}

/**
 * Convert a Kraken L3 update event to L3OrderEvent
 */
function krakenL3EventToOrderEvent(event: KrakenL3Event): L3OrderEvent {
  return {
    source: "kraken",
    symbol: event.symbol,
    timestamp: parseTimestamp(event.timestamp),
    order_id: event.order_id,
    event: mapEventType(event.event),
    side: mapSide(event.side),
    price: event.price ?? 0,
    qty: event.qty ?? 0,
  };
}

/**
 * Individual order in the L3 book
 */
interface L3Order {
  orderId: string;
  side: TradeSide;
  price: number;
  qty: number;
  timestamp: number;
}

/**
 * L3 Order Book - tracks individual orders
 */
export class L3OrderBook {
  readonly symbol: string;
  private orders: Map<string, L3Order> = new Map();
  private lastUpdate: number = Date.now();

  constructor(symbol: string) {
    this.symbol = symbol;
  }

  /**
   * Apply a snapshot (replaces entire book)
   */
  applySnapshot(bids: KrakenL3Order[], asks: KrakenL3Order[]): L3OrderEvent[] {
    this.orders.clear();
    const events: L3OrderEvent[] = [];

    for (const bid of bids) {
      this.orders.set(bid.order_id, {
        orderId: bid.order_id,
        side: "buy",
        price: bid.price,
        qty: bid.qty,
        timestamp: parseTimestamp(bid.timestamp),
      });
      events.push(krakenL3OrderToEvent(bid, "add"));
    }

    for (const ask of asks) {
      this.orders.set(ask.order_id, {
        orderId: ask.order_id,
        side: "sell",
        price: ask.price,
        qty: ask.qty,
        timestamp: parseTimestamp(ask.timestamp),
      });
      events.push(krakenL3OrderToEvent(ask, "add"));
    }

    this.lastUpdate = Date.now();
    console.log(
      `[L3Book:${this.symbol}] Snapshot applied: ${bids.length} bids, ${asks.length} asks`
    );

    return events;
  }

  /**
   * Apply an incremental update event
   */
  applyEvent(event: KrakenL3Event): L3OrderEvent {
    const l3Event = krakenL3EventToOrderEvent(event);

    switch (event.event) {
      case "add":
        this.orders.set(event.order_id, {
          orderId: event.order_id,
          side: mapSide(event.side),
          price: event.price ?? 0,
          qty: event.qty ?? 0,
          timestamp: parseTimestamp(event.timestamp),
        });
        break;

      case "modify":
        const existing = this.orders.get(event.order_id);
        if (existing) {
          if (event.price !== undefined) existing.price = event.price;
          if (event.qty !== undefined) existing.qty = event.qty;
          existing.timestamp = parseTimestamp(event.timestamp);
        }
        break;

      case "delete":
        this.orders.delete(event.order_id);
        break;
    }

    this.lastUpdate = Date.now();
    return l3Event;
  }

  /**
   * Get order count
   */
  getOrderCount(): number {
    return this.orders.size;
  }

  /**
   * Get order counts by side
   */
  getOrderCountsBySide(): { bids: number; asks: number } {
    let bids = 0;
    let asks = 0;
    for (const order of this.orders.values()) {
      if (order.side === "buy") bids++;
      else if (order.side === "sell") asks++;
    }
    return { bids, asks };
  }

  /**
   * Get time since last update in ms
   */
  getAge(): number {
    return Date.now() - this.lastUpdate;
  }
}

/**
 * L3 Handler - manages L3 order books for multiple symbols
 */
export class L3Handler {
  private books: Map<string, L3OrderBook> = new Map();
  private eventCount: number = 0;

  /**
   * Get or create L3 order book for a symbol
   */
  getBook(symbol: string): L3OrderBook {
    let book = this.books.get(symbol);
    if (!book) {
      book = new L3OrderBook(symbol);
      this.books.set(symbol, book);
    }
    return book;
  }

  /**
   * Process a Kraken L3 message
   * Returns array of L3OrderEvent
   */
  processMessage(message: KrakenL3Message): L3OrderEvent[] {
    if (message.type === "snapshot") {
      return this.processSnapshot(message as KrakenL3Snapshot);
    } else {
      return this.processUpdate(message as KrakenL3Update);
    }
  }

  /**
   * Process a snapshot message
   */
  private processSnapshot(message: KrakenL3Snapshot): L3OrderEvent[] {
    if (!message.data || message.data.length === 0) {
      return [];
    }

    const data = message.data[0];
    const book = this.getBook(data.symbol);
    return book.applySnapshot(data.bids, data.asks);
  }

  /**
   * Process an update message
   */
  private processUpdate(message: KrakenL3Update): L3OrderEvent[] {
    if (!message.data || message.data.length === 0) {
      return [];
    }

    const events: L3OrderEvent[] = [];

    for (const event of message.data) {
      const book = this.getBook(event.symbol);
      events.push(book.applyEvent(event));
      this.eventCount++;
    }

    return events;
  }

  /**
   * Get total event count
   */
  getEventCount(): number {
    return this.eventCount;
  }

  /**
   * Get all symbols being tracked
   */
  getSymbols(): string[] {
    return Array.from(this.books.keys());
  }

  /**
   * Get stats for all books
   */
  getStats(): Record<string, { orders: number; bids: number; asks: number }> {
    const stats: Record<string, { orders: number; bids: number; asks: number }> = {};
    for (const [symbol, book] of this.books) {
      const counts = book.getOrderCountsBySide();
      stats[symbol] = {
        orders: book.getOrderCount(),
        bids: counts.bids,
        asks: counts.asks,
      };
    }
    return stats;
  }
}

/**
 * Create an L3 handler instance
 */
export function createL3Handler(): L3Handler {
  return new L3Handler();
}
