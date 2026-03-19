/**
 * IBKR TWS API Client
 *
 * Manages connection to Interactive Brokers TWS/Gateway via @stoqey/ib.
 * Handles connection lifecycle, reconnection, and event routing.
 *
 * Usage:
 *   const client = createIBKRClient({ port: 7497, clientId: 10 });
 *   await client.connect();
 *   client.on('depth', (tickerId, entry) => { ... });
 *   client.on('tickLast', (data) => { ... });
 */

import { EventEmitter } from "events";
import { IBApi, EventName, Contract } from "@stoqey/ib";
import { ibkrConfig } from "@trading/shared";
import type {
  IBKRClientOptions,
  ConnectionState,
  MarketDepthEntry,
  TickByTickLast,
  BidAskTick,
  IBKRError,
  SubscriptionInfo,
  FuturesContractDef,
} from "./types.js";

/**
 * IBKR TWS API Client
 *
 * EventEmitter-based client that wraps @stoqey/ib and provides:
 * - Connection management with auto-reconnection
 * - Market depth (L2) subscriptions
 * - Tick-by-tick trade data subscriptions
 * - Typed event emission for downstream consumers
 */
export class IBKRClient extends EventEmitter {
  private ib: IBApi;
  private host: string;
  private port: number;
  private clientId: number;
  private reconnect: boolean;
  private maxReconnectAttempts: number;
  private initialReconnectDelayMs: number;
  private maxReconnectDelayMs: number;
  private reconnectAttempts: number = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private isClosing: boolean = false;
  private _state: ConnectionState = "disconnected";
  private nextTickerId: number = 1;
  private subscriptions: Map<number, SubscriptionInfo> = new Map();
  private symbolToTickerId: Map<string, Map<string, number>> = new Map();
  private pendingSubscriptions: Array<() => void> = [];
  private serverVersion: number = 0;

  constructor(options: IBKRClientOptions = {}) {
    super();
    this.host = options.host ?? ibkrConfig.host;
    this.port = options.port ?? ibkrConfig.port;
    this.clientId = options.clientId ?? ibkrConfig.clientId;
    this.reconnect = options.reconnect ?? true;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10;
    this.initialReconnectDelayMs = options.initialReconnectDelayMs ?? 1000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30000;

    // Initialize IBApi
    this.ib = new IBApi({
      host: this.host,
      port: this.port,
      clientId: this.clientId,
    });

    this.setupEventHandlers();
  }

  /**
   * Current connection state
   */
  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Whether client is connected
   */
  get connected(): boolean {
    return this._state === "connected";
  }

  /**
   * Whether this is a paper trading connection
   */
  get isPaperTrading(): boolean {
    return this.port === 7497;
  }

  /**
   * Get the TWS server version
   */
  get version(): number {
    return this.serverVersion;
  }

  /**
   * Set up event handlers for @stoqey/ib
   */
  private setupEventHandlers(): void {
    // Connection events
    this.ib.on(EventName.connected, () => {
      console.log(
        `[IBKR] Connected to TWS (${this.isPaperTrading ? "PAPER" : "LIVE"}) at ${this.host}:${this.port}`
      );
      this.reconnectAttempts = 0;
      this.setState("connected");
      this.emit("connected");
      this.executePendingSubscriptions();
    });

    this.ib.on(EventName.disconnected, () => {
      console.log("[IBKR] Disconnected from TWS");
      this.setState("disconnected");
      this.emit("disconnected");

      if (this.reconnect && !this.isClosing) {
        this.scheduleReconnect();
      }
    });

    this.ib.on(EventName.server, (version: number, connectionTime: string) => {
      this.serverVersion = version;
      console.log(
        `[IBKR] Server version: ${version}, connection time: ${connectionTime}`
      );
    });

    this.ib.on(EventName.error, (err: Error, code: number, reqId: number) => {
      const ibkrError: IBKRError = {
        id: reqId,
        code: code,
        message: err.message,
      };

      // Handle specific error codes
      if (code === 502) {
        // Couldn't connect to TWS
        console.error("[IBKR] Could not connect to TWS. Is it running?");
      } else if (code === 504) {
        // Not connected
        console.error("[IBKR] Not connected to TWS");
      } else if (code === 1100) {
        // Connectivity lost
        console.warn("[IBKR] Connectivity between IB and TWS lost");
      } else if (code === 1102) {
        // Connectivity restored with data loss
        console.log("[IBKR] Connectivity restored - data lost");
        this.resubscribeAll();
      } else if (code === 2104 || code === 2106 || code === 2158) {
        // Market data farm connection (informational)
        console.log(`[IBKR] ${err.message}`);
        return; // Don't emit as error
      } else if (code === 2103 || code === 2105) {
        // Market data farm disconnected
        console.warn(`[IBKR] ${err.message}`);
      } else {
        console.error(`[IBKR] Error ${code} (req ${reqId}): ${err.message}`);
      }

      this.emit("error", ibkrError);
    });

    // Market depth (L2) events
    this.ib.on(
      EventName.updateMktDepth,
      (
        tickerId: number,
        position: number,
        operation: number,
        side: number,
        price: number,
        size: number
      ) => {
        const entry: MarketDepthEntry = {
          position,
          marketMaker: "",
          operation: operation as 0 | 1 | 2,
          side: side as 0 | 1,
          price,
          size,
        };
        this.emit("depth", tickerId, entry);
      }
    );

    this.ib.on(
      EventName.updateMktDepthL2,
      (
        tickerId: number,
        position: number,
        marketMaker: string,
        operation: number,
        side: number,
        price: number,
        size: number,
        _isSmartDepth: boolean
      ) => {
        const entry: MarketDepthEntry = {
          position,
          marketMaker,
          operation: operation as 0 | 1 | 2,
          side: side as 0 | 1,
          price,
          size,
        };
        this.emit("depth", tickerId, entry);
      }
    );

    // Tick-by-tick trade data
    this.ib.on(
      EventName.tickByTickAllLast,
      (
        tickerId: number,
        tickType: number,
        time: number,
        price: number,
        size: number,
        tickAttribLast: { pastLimit: boolean; unreported: boolean },
        exchange: string,
        specialConditions: string
      ) => {
        // tickType 1 = Last, tickType 2 = AllLast
        if (tickType === 1 || tickType === 2) {
          const data: TickByTickLast = {
            tickerId,
            time,
            price,
            size,
            tickAttribLast,
            exchange,
            specialConditions,
          };
          this.emit("tickLast", data);
        }
      }
    );

    // Tick-by-tick bid/ask data
    this.ib.on(
      EventName.tickByTickBidAsk,
      (
        tickerId: number,
        time: number,
        bidPrice: number,
        askPrice: number,
        bidSize: number,
        askSize: number,
        _tickAttribBidAsk: object
      ) => {
        const data: BidAskTick = {
          tickerId,
          time,
          bidPrice,
          askPrice,
          bidSize,
          askSize,
        };
        this.emit("bidAsk", data);
      }
    );

    // Current time from server
    this.ib.on(EventName.currentTime, (time: number) => {
      this.emit("serverTime", new Date(time * 1000));
    });
  }

  /**
   * Set connection state and emit event
   */
  private setState(state: ConnectionState): void {
    if (this._state !== state) {
      this._state = state;
      this.emit("stateChange", state);
    }
  }

  /**
   * Connect to TWS/Gateway
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connected) {
        resolve();
        return;
      }

      this.isClosing = false;
      this.setState("connecting");
      console.log(
        `[IBKR] Connecting to ${this.host}:${this.port} (client ${this.clientId})...`
      );

      // Set up one-time listeners for connection result
      const onConnect = () => {
        this.ib.off(EventName.error, onError);
        resolve();
      };

      const onError = (err: Error, code: number) => {
        if (code === 502 || code === 504) {
          this.ib.off(EventName.connected, onConnect);
          this.setState("error");
          reject(new Error(`Failed to connect: ${err.message} (code ${code})`));
        }
      };

      this.ib.once(EventName.connected, onConnect);
      this.ib.on(EventName.error, onError);

      // Initiate connection
      this.ib.connect();

      // Timeout for connection attempt
      setTimeout(() => {
        if (!this.connected) {
          this.ib.off(EventName.connected, onConnect);
          this.ib.off(EventName.error, onError);
          this.setState("error");
          reject(new Error("Connection timeout"));
        }
      }, 10000);
    });
  }

  /**
   * Disconnect from TWS/Gateway
   */
  disconnect(): void {
    this.isClosing = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Cancel all subscriptions
    for (const [tickerId, sub] of this.subscriptions) {
      if (sub.active) {
        this.cancelSubscription(tickerId);
      }
    }

    this.subscriptions.clear();
    this.symbolToTickerId.clear();

    this.ib.disconnect();
    this.setState("disconnected");
    console.log("[IBKR] Disconnected");
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[IBKR] Max reconnect attempts reached");
      this.emit("error", {
        id: -1,
        code: -1,
        message: "Max reconnect attempts reached",
      } as IBKRError);
      return;
    }

    // Calculate delay with exponential backoff + jitter
    const baseDelay = Math.min(
      this.initialReconnectDelayMs * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelayMs
    );
    const jitter = Math.random() * 0.25 * baseDelay;
    const delay = baseDelay + jitter;

    this.reconnectAttempts++;
    this.setState("reconnecting");

    console.log(
      `[IBKR] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );
    this.emit("reconnecting", this.reconnectAttempts, delay);

    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connect();
        // Resubscribe after successful reconnect
        this.resubscribeAll();
      } catch (err) {
        console.error("[IBKR] Reconnect failed:", (err as Error).message);
      }
    }, delay);
  }

  /**
   * Resubscribe all active subscriptions after reconnect
   */
  private resubscribeAll(): void {
    console.log(`[IBKR] Resubscribing ${this.subscriptions.size} subscriptions`);

    for (const [tickerId, sub] of this.subscriptions) {
      if (sub.active) {
        if (sub.type === "depth") {
          this.ib.reqMktDepth(tickerId, sub.contract, 10, false, []);
        } else if (sub.type === "trades") {
          this.ib.reqTickByTickData(tickerId, sub.contract, "Last", 0, false);
        } else if (sub.type === "bidask") {
          this.ib.reqTickByTickData(tickerId, sub.contract, "BidAsk", 0, false);
        }
      }
    }
  }

  /**
   * Queue subscription to be executed after connection
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
   * Get next available ticker ID
   */
  getNextTickerId(): number {
    return this.nextTickerId++;
  }

  /**
   * Build a Contract object from futures definition
   */
  buildContract(def: FuturesContractDef): Contract {
    return {
      symbol: def.symbol,
      secType: def.secType,
      exchange: def.exchange,
      currency: def.currency,
      lastTradeDateOrContractMonth: def.lastTradeDateOrContractMonth,
      multiplier: def.multiplier,
      localSymbol: def.localSymbol,
    } as Contract;
  }

  /**
   * Subscribe to market depth (L2) for a contract
   */
  subscribeDepth(contract: Contract, numRows: number = 10): number {
    const tickerId = this.getNextTickerId();
    const symbol = contract.localSymbol || contract.symbol;

    this.subscriptions.set(tickerId, {
      tickerId,
      symbol: symbol || "UNKNOWN",
      contract,
      type: "depth",
      active: true,
    });

    // Track symbol -> tickerId mapping
    if (!this.symbolToTickerId.has(symbol || "UNKNOWN")) {
      this.symbolToTickerId.set(symbol || "UNKNOWN", new Map());
    }
    this.symbolToTickerId.get(symbol || "UNKNOWN")!.set("depth", tickerId);

    console.log(`[IBKR] Subscribing to depth: ${symbol} (tickerId=${tickerId})`);
    this.ib.reqMktDepth(tickerId, contract, numRows, false, []);

    return tickerId;
  }

  /**
   * Subscribe to tick-by-tick last trades for a contract
   */
  subscribeTickByTick(contract: Contract): number {
    const tickerId = this.getNextTickerId();
    const symbol = contract.localSymbol || contract.symbol;

    this.subscriptions.set(tickerId, {
      tickerId,
      symbol: symbol || "UNKNOWN",
      contract,
      type: "trades",
      active: true,
    });

    if (!this.symbolToTickerId.has(symbol || "UNKNOWN")) {
      this.symbolToTickerId.set(symbol || "UNKNOWN", new Map());
    }
    this.symbolToTickerId.get(symbol || "UNKNOWN")!.set("trades", tickerId);

    console.log(
      `[IBKR] Subscribing to tick-by-tick trades: ${symbol} (tickerId=${tickerId})`
    );
    // "Last" gives individual trades, 0 = unlimited ticks, false = not ignoring size
    this.ib.reqTickByTickData(tickerId, contract, "Last", 0, false);

    return tickerId;
  }

  /**
   * Subscribe to tick-by-tick bid/ask for aggressor classification
   */
  subscribeBidAsk(contract: Contract): number {
    const tickerId = this.getNextTickerId();
    const symbol = contract.localSymbol || contract.symbol;

    this.subscriptions.set(tickerId, {
      tickerId,
      symbol: symbol || "UNKNOWN",
      contract,
      type: "bidask",
      active: true,
    });

    if (!this.symbolToTickerId.has(symbol || "UNKNOWN")) {
      this.symbolToTickerId.set(symbol || "UNKNOWN", new Map());
    }
    this.symbolToTickerId.get(symbol || "UNKNOWN")!.set("bidask", tickerId);

    console.log(
      `[IBKR] Subscribing to bid/ask: ${symbol} (tickerId=${tickerId})`
    );
    this.ib.reqTickByTickData(tickerId, contract, "BidAsk", 0, false);

    return tickerId;
  }

  /**
   * Cancel a subscription by ticker ID
   */
  cancelSubscription(tickerId: number): void {
    const sub = this.subscriptions.get(tickerId);
    if (!sub) return;

    if (sub.type === "depth") {
      this.ib.cancelMktDepth(tickerId, false);
    } else {
      this.ib.cancelTickByTickData(tickerId);
    }

    sub.active = false;
    console.log(`[IBKR] Cancelled subscription: ${sub.symbol} (${sub.type})`);
  }

  /**
   * Get subscription info by ticker ID
   */
  getSubscription(tickerId: number): SubscriptionInfo | undefined {
    return this.subscriptions.get(tickerId);
  }

  /**
   * Get ticker ID for a symbol and subscription type
   */
  getTickerIdForSymbol(
    symbol: string,
    type: "depth" | "trades" | "bidask"
  ): number | undefined {
    return this.symbolToTickerId.get(symbol)?.get(type);
  }

  /**
   * Request current server time
   */
  requestServerTime(): void {
    this.ib.reqCurrentTime();
  }

  /**
   * Reset reconnection counter
   */
  resetReconnectAttempts(): void {
    this.reconnectAttempts = 0;
  }
}

/**
 * Create a new IBKR client instance
 */
export function createIBKRClient(options?: IBKRClientOptions): IBKRClient {
  return new IBKRClient(options);
}
