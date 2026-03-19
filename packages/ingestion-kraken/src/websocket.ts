/**
 * Kraken WebSocket Client
 *
 * Manages WebSocket connection to Kraken's v2 API.
 * Handles connection, subscription, message parsing, and reconnection.
 *
 * Supports both public (L2 book, trades) and authenticated (L3) channels.
 *
 * Reconnection handling:
 * - Kraken disconnects after 60s of inactivity (ping keeps alive)
 * - Cloudflare rate limits: 150 connections/10min per IP
 * - Exponential backoff with jitter on reconnect
 */

import WebSocket from "ws";
import { EventEmitter } from "events";
import { krakenConfig } from "@trading/shared";
import type {
  KrakenBookSubscribe,
  KrakenTradeSubscribe,
  KrakenL3Subscribe,
  KrakenBookMessage,
  KrakenTradeMessage,
  KrakenL3Message,
  KrakenHeartbeat,
  KrakenStatus,
  KrakenPong,
} from "./types.js";

/** Kraken connection rate limit: 150 per 10 minutes */
const CLOUDFLARE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const CLOUDFLARE_MAX_CONNECTIONS = 150;

export interface KrakenWebSocketOptions {
  /** WebSocket URL (defaults to public URL) */
  url?: string;
  /** Ping interval in ms (default: 30000, Kraken disconnects after 60s inactivity) */
  pingIntervalMs?: number;
  /** Enable automatic reconnection (default: true) */
  reconnect?: boolean;
  /** Max reconnection attempts before giving up (default: 10) */
  maxReconnectAttempts?: number;
  /** Initial reconnect delay in ms (default: 1000) */
  initialReconnectDelayMs?: number;
  /** Max reconnect delay in ms (default: 30000) */
  maxReconnectDelayMs?: number;
  /** Auth token for authenticated WebSocket (L3) */
  authToken?: string;
  /** Callback to refresh auth token on reconnect */
  onTokenRefresh?: () => Promise<string>;
}

export interface KrakenWebSocketEvents {
  open: () => void;
  close: (code: number, reason: string) => void;
  error: (error: Error) => void;
  book: (message: KrakenBookMessage) => void;
  trade: (message: KrakenTradeMessage) => void;
  l3: (message: KrakenL3Message) => void;
  heartbeat: () => void;
  status: (message: KrakenStatus) => void;
  subscribed: (channel: string, symbol: string) => void;
  unsubscribed: (channel: string, symbol: string) => void;
  reconnecting: (attempt: number, delayMs: number) => void;
  rateLimited: (retryAfterMs: number) => void;
}

export class KrakenWebSocket extends EventEmitter {
  private ws: WebSocket | null = null;
  private url: string;
  private pingInterval: NodeJS.Timeout | null = null;
  private pingIntervalMs: number;
  private reconnect: boolean;
  private maxReconnectAttempts: number;
  private initialReconnectDelayMs: number;
  private maxReconnectDelayMs: number;
  private reconnectAttempts: number = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isClosing: boolean = false;
  private reqId: number = 1;
  private authToken: string | null = null;
  private onTokenRefresh: (() => Promise<string>) | null = null;
  private lastMessageTime: number = Date.now();
  private connectionCount: number = 0;
  private connectionWindowStart: number = Date.now();
  private pendingSubscriptions: Array<() => void> = [];

  constructor(options: KrakenWebSocketOptions = {}) {
    super();
    this.url = options.url || krakenConfig.wsPublicUrl;
    this.pingIntervalMs = options.pingIntervalMs || 30000;
    this.reconnect = options.reconnect ?? true;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.initialReconnectDelayMs = options.initialReconnectDelayMs || 1000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs || 30000;
    this.authToken = options.authToken || null;
    this.onTokenRefresh = options.onTokenRefresh || null;
  }

  /**
   * Set auth token (for L3 authenticated connections)
   */
  setAuthToken(token: string): void {
    this.authToken = token;
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
      this.connectionCount++;
      console.log(`[Kraken WS] Connecting to ${this.url}...`);

      this.ws = new WebSocket(this.url);

      this.ws.on("open", () => {
        console.log("[Kraken WS] Connected");
        this.reconnectAttempts = 0;
        this.lastMessageTime = Date.now();
        this.startPingInterval();
        this.emit("open");

        // Execute any pending subscriptions
        this.executePendingSubscriptions();

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
   * Subscribe to L3 (level3) channel - requires auth token
   */
  subscribeL3(symbols: string[]): void {
    if (!this.authToken) {
      console.error("[Kraken WS] Cannot subscribe to L3: no auth token");
      return;
    }

    const message: KrakenL3Subscribe = {
      method: "subscribe",
      params: {
        channel: "level3",
        symbol: symbols,
        snapshot: true,
        token: this.authToken,
      },
      req_id: this.reqId++,
    };
    this.send(message);
    console.log(`[Kraken WS] Subscribing to L3: ${symbols.join(", ")}`);
  }

  /**
   * Queue a subscription to be executed after connection
   */
  queueSubscription(subscribe: () => void): void {
    if (this.connected) {
      subscribe();
    } else {
      this.pendingSubscriptions.push(subscribe);
    }
  }

  /**
   * Execute all pending subscriptions
   */
  private executePendingSubscriptions(): void {
    for (const subscribe of this.pendingSubscriptions) {
      subscribe();
    }
    this.pendingSubscriptions = [];
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
   * Schedule reconnection with exponential backoff and jitter
   * Also respects Cloudflare rate limits (150 connections/10min)
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[Kraken WS] Max reconnect attempts reached");
      this.emit("error", new Error("Max reconnect attempts reached"));
      return;
    }

    // Check rate limit
    const rateLimitDelay = this.checkRateLimit();
    if (rateLimitDelay > 0) {
      console.warn(`[Kraken WS] Rate limited, waiting ${rateLimitDelay}ms`);
      this.emit("rateLimited", rateLimitDelay);
    }

    // Calculate delay with exponential backoff + jitter
    const baseDelay = Math.min(
      this.initialReconnectDelayMs * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelayMs
    );
    // Add 0-25% jitter to prevent thundering herd
    const jitter = Math.random() * 0.25 * baseDelay;
    const delay = Math.max(baseDelay + jitter, rateLimitDelay);

    this.reconnectAttempts++;

    console.log(
      `[Kraken WS] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );
    this.emit("reconnecting", this.reconnectAttempts, delay);

    this.reconnectTimeout = setTimeout(async () => {
      try {
        // Refresh auth token if needed
        if (this.onTokenRefresh && this.authToken) {
          try {
            this.authToken = await this.onTokenRefresh();
            console.log("[Kraken WS] Auth token refreshed");
          } catch (err) {
            console.error("[Kraken WS] Failed to refresh token:", err);
          }
        }

        await this.connect();
      } catch (err) {
        const error = err as Error;
        console.error("[Kraken WS] Reconnect failed:", error.message);
      }
    }, delay);
  }

  /**
   * Check rate limit and return delay if needed
   */
  private checkRateLimit(): number {
    const now = Date.now();

    // Reset window if expired
    if (now - this.connectionWindowStart > CLOUDFLARE_RATE_LIMIT_WINDOW_MS) {
      this.connectionCount = 0;
      this.connectionWindowStart = now;
      return 0;
    }

    // Check if we're at the limit
    if (this.connectionCount >= CLOUDFLARE_MAX_CONNECTIONS) {
      // Wait until window resets
      return this.connectionWindowStart + CLOUDFLARE_RATE_LIMIT_WINDOW_MS - now;
    }

    return 0;
  }

  /**
   * Get time since last message (for staleness detection)
   */
  getTimeSinceLastMessage(): number {
    return Date.now() - this.lastMessageTime;
  }

  /**
   * Reset reconnection counter (call after successful subscription)
   */
  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
  }

  /**
   * Handle incoming message
   */
  private handleMessage(data: string): void {
    this.lastMessageTime = Date.now();

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

      if (message.channel === "level3") {
        this.emit("l3", message as KrakenL3Message);
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

/**
 * Create a new Kraken authenticated WebSocket client (for L3 data)
 */
export function createKrakenAuthWebSocket(
  authToken: string,
  options?: Omit<KrakenWebSocketOptions, "url" | "authToken">
): KrakenWebSocket {
  return new KrakenWebSocket({
    ...options,
    url: krakenConfig.wsAuthUrl,
    authToken,
  });
}
