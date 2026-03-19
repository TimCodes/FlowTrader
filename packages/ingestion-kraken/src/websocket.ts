/**
 * Kraken WebSocket Client
 *
 * Manages WebSocket connection to Kraken's v2 API.
 * Handles connection, subscription, and message parsing.
 */

import WebSocket from "ws";
import { EventEmitter } from "events";
import { krakenConfig } from "@trading/shared";
import type {
  KrakenBookSubscribe,
  KrakenTradeSubscribe,
  KrakenBookMessage,
  KrakenTradeMessage,
  KrakenHeartbeat,
  KrakenStatus,
  KrakenPong,
} from "./types.js";

export interface KrakenWebSocketOptions {
  url?: string;
  pingIntervalMs?: number;
  reconnect?: boolean;
  maxReconnectAttempts?: number;
}

export interface KrakenWebSocketEvents {
  open: () => void;
  close: (code: number, reason: string) => void;
  error: (error: Error) => void;
  book: (message: KrakenBookMessage) => void;
  trade: (message: KrakenTradeMessage) => void;
  heartbeat: () => void;
  status: (message: KrakenStatus) => void;
  subscribed: (channel: string, symbol: string) => void;
  unsubscribed: (channel: string, symbol: string) => void;
}

export class KrakenWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private pingInterval: NodeJS.Timeout | null = null;
  private pingIntervalMs: number;
  private reconnect: boolean;
  private maxReconnectAttempts: number;
  private reconnectAttempts: number = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isClosing: boolean = false;
  private reqId: number = 1;

  constructor(options: KrakenWebSocketOptions = {}) {
    super();
    this.url = options.url || krakenConfig.wsPublicUrl;
    this.pingIntervalMs = options.pingIntervalMs || 30000;
    this.reconnect = options.reconnect ?? true;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
  }

  /**
   * Connect to Kraken WebSocket
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.isClosing = false;
      console.log(`[Kraken WS] Connecting to ${this.url}...`);

      this.ws = new WebSocket(this.url);

      this.ws.on("open", () => {
        console.log("[Kraken WS] Connected");
        this.reconnectAttempts = 0;
        this.startPingInterval();
        this.emit("open");
        resolve();
      });

      this.ws.on("close", (code, reason) => {
        const reasonStr = reason.toString() || "unknown";
        console.log(`[Kraken WS] Disconnected: ${code} ${reasonStr}`);
        this.stopPingInterval();
        this.emit("close", code, reasonStr);

        if (this.reconnect && !this.isClosing) {
          this.scheduleReconnect();
        }
      });

      this.ws.on("error", (error) => {
        console.error("[Kraken WS] Error:", error.message);
        this.emit("error", error);
        reject(error);
      });

      this.ws.on("message", (data) => {
        this.handleMessage(data.toString());
      });
    });
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.isClosing = true;
    this.stopPingInterval();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Subscribe to order book channel
   */
  subscribeBook(symbols: string[], depth: number = 25): void {
    const message: KrakenBookSubscribe = {
      method: "subscribe",
      params: {
        channel: "book",
        symbol: symbols,
        depth,
        snapshot: true,
      },
      req_id: this.reqId++,
    };
    this.send(message);
    console.log(`[Kraken WS] Subscribing to book: ${symbols.join(", ")} (depth=${depth})`);
  }

  /**
   * Subscribe to trade channel
   */
  subscribeTrades(symbols: string[]): void {
    const message: KrakenTradeSubscribe = {
      method: "subscribe",
      params: {
        channel: "trade",
        symbol: symbols,
        snapshot: true,
      },
      req_id: this.reqId++,
    };
    this.send(message);
    console.log(`[Kraken WS] Subscribing to trades: ${symbols.join(", ")}`);
  }

  /**
   * Send a message
   */
  send(message: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("[Kraken WS] Cannot send: not connected");
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Send ping to keep connection alive
   */
  private sendPing(): void {
    this.send({ method: "ping", req_id: this.reqId++ });
  }

  /**
   * Start ping interval
   */
  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      if (this.connected) {
        this.sendPing();
      }
    }, this.pingIntervalMs);
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[Kraken WS] Max reconnect attempts reached");
      this.emit("error", new Error("Max reconnect attempts reached"));
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(
      `[Kraken WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    this.reconnectTimeout = setTimeout(() => {
      this.connect().catch((err) => {
        console.error("[Kraken WS] Reconnect failed:", err.message);
      });
    }, delay);
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Handle different message types
      if (message.channel === "heartbeat") {
        this.emit("heartbeat");
        return;
      }

      if (message.channel === "status") {
        this.emit("status", message as KrakenStatus);
        return;
      }

      if (message.method === "pong") {
        // Pong response to our ping
        return;
      }

      if (message.method === "subscribe" && message.success !== undefined) {
        // Subscription confirmation
        if (message.success) {
          const params = message.result || {};
          this.emit("subscribed", params.channel, params.symbol);
        } else {
          console.error("[Kraken WS] Subscription failed:", message.error);
        }
        return;
      }

      if (message.channel === "book") {
        this.emit("book", message as KrakenBookMessage);
        return;
      }

      if (message.channel === "trade") {
        this.emit("trade", message as KrakenTradeMessage);
        return;
      }

      // Unknown message
      console.log("[Kraken WS] Unknown message:", message);
    } catch (err) {
      console.error("[Kraken WS] Failed to parse message:", err);
    }
  }
}

/**
 * Create a new Kraken public WebSocket client
 */
export function createKrakenWebSocket(
  options?: KrakenWebSocketOptions
): KrakenWebSocket {
  return new KrakenWebSocket(options);
}
