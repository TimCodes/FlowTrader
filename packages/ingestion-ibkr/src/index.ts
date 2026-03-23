/**
 * @trading/ingestion-ibkr
 *
 * IBKR Futures Ingestion Service
 *
 * Connects to TWS API via @stoqey/ib and streams:
 * - L2 order book depth (reqMktDepth) for CME futures
 * - Tick-by-tick trade data (reqTickByTickData)
 *
 * Publishes unified OrderBookEvent and TradeEvent to Redis Streams.
 *
 * Supported contracts: ES, NQ, MES, MNQ, CL
 */

import { pathToFileURL } from "url";

// Re-export all public APIs
export * from "./types.js";
export { IBKRClient, createIBKRClient } from "./client.js";
export {
  getFrontMonthContract,
  getFrontMonthContracts,
  getContractForExpiry,
  getExpiryInfo,
  getSupportedSymbols,
  isSymbolSupported,
  getContractSpec,
  buildContract,
} from "./contracts.js";
export {
  IBKROrderBook,
  IBKROrderBookManager,
  createIBKROrderBookManager,
} from "./orderbook.js";
export { IBKRTradeHandler, createIBKRTradeHandler } from "./trades.js";
export {
  IBKRPublisher,
  createIBKRPublisher,
  type IBKRPublisherOptions,
  type IBKRPublisherStats,
} from "./publisher.js";
export {
  MarketHoursHandler,
  createMarketHoursHandler,
  isMarketOpenNow,
  getMarketStateNow,
  type MarketState,
  type MarketHoursConfig,
} from "./market-hours.js";

// Re-export types from @trading/types for convenience
export type {
  OrderBookEvent,
  TradeEvent,
  PriceLevel,
  DataSource,
  AssetClass,
  TradeSide,
} from "@trading/types";

import type { Contract } from "@stoqey/ib";
import type Redis from "ioredis";
import { createRedisClient, ibkrConfig } from "@trading/shared";
import { IBKRClient } from "./client.js";
import { IBKROrderBookManager } from "./orderbook.js";
import { IBKRTradeHandler } from "./trades.js";
import { IBKRPublisher } from "./publisher.js";
import { MarketHoursHandler } from "./market-hours.js";
import { getFrontMonthContracts, buildContract } from "./contracts.js";
import type { MarketDepthEntry } from "./types.js";

/**
 * IBKR Ingestion Service configuration
 */
export interface IBKRIngestionConfig {
  /** Symbols to subscribe to (default: ["MES", "MNQ"]) */
  symbols?: string[];
  /** Order book depth (default: 10) */
  depth?: number;
  /** Order book throttle in ms (default: 100) */
  orderBookThrottleMs?: number;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
  /** Auto-manage connection based on market hours (default: true) */
  respectMarketHours?: boolean;
  /** Redis client (optional, will create if not provided) */
  redis?: Redis;
}

/**
 * IBKR Ingestion Service
 *
 * Orchestrates the complete IBKR data ingestion pipeline:
 * 1. Connects to TWS/Gateway
 * 2. Subscribes to L2 depth and tick-by-tick trades
 * 3. Maintains local order book state
 * 4. Classifies trade aggressor (buy/sell)
 * 5. Publishes to Redis Streams
 */
export class IBKRIngestionService {
  private client: IBKRClient;
  private orderBookManager: IBKROrderBookManager;
  private tradeHandler: IBKRTradeHandler;
  private publisher: IBKRPublisher;
  private marketHours: MarketHoursHandler;
  private redis: Redis;
  private ownRedis: boolean;
  private config: Required<IBKRIngestionConfig>;
  private contracts: Map<string, Contract> = new Map();
  private running: boolean = false;
  private marketCheckInterval: NodeJS.Timeout | null = null;

  constructor(config: IBKRIngestionConfig = {}) {
    this.config = {
      symbols: config.symbols ?? ["MES", "MNQ"],
      depth: config.depth ?? 10,
      orderBookThrottleMs: config.orderBookThrottleMs ?? 100,
      verbose: config.verbose ?? false,
      respectMarketHours: config.respectMarketHours ?? true,
      redis: config.redis!,
    };

    // Initialize components
    this.client = new IBKRClient();
    this.orderBookManager = new IBKROrderBookManager(this.config.depth);
    this.tradeHandler = new IBKRTradeHandler();
    this.marketHours = new MarketHoursHandler();

    // Redis setup
    if (config.redis) {
      this.redis = config.redis;
      this.ownRedis = false;
    } else {
      this.redis = createRedisClient();
      this.ownRedis = true;
    }

    this.publisher = new IBKRPublisher(this.redis, {
      orderBookThrottleMs: this.config.orderBookThrottleMs,
      verbose: this.config.verbose,
    });

    // Set up event handlers
    this.setupEventHandlers();
  }

  /**
   * Set up event handlers for IBKR client
   */
  private setupEventHandlers(): void {
    // Handle depth updates
    this.client.on("depth", (tickerId: number, entry: MarketDepthEntry) => {
      const event = this.orderBookManager.processUpdate(tickerId, entry);
      if (event) {
        this.publisher.publishOrderBook(event);
      }
    });

    // Handle bid/ask updates for aggressor classification
    this.client.on("bidAsk", (data) => {
      this.tradeHandler.updateQuote(data);
    });

    // Handle tick-by-tick trades
    this.client.on("tickLast", (data) => {
      const event = this.tradeHandler.processTrade(data);
      if (event) {
        this.publisher.publishTrade(event);
      }
    });

    // Handle connection events
    this.client.on("connected", () => {
      console.log("[IBKR Ingestion] Connected, subscribing to market data...");
      this.subscribeAll();
    });

    this.client.on("disconnected", () => {
      console.log("[IBKR Ingestion] Disconnected from TWS");
    });

    this.client.on("error", (error) => {
      console.error(`[IBKR Ingestion] Error: ${error.message}`);
    });

    this.client.on("reconnecting", (attempt, delay) => {
      console.log(
        `[IBKR Ingestion] Reconnecting in ${delay}ms (attempt ${attempt})`
      );
    });
  }

  /**
   * Subscribe to all configured symbols
   */
  private subscribeAll(): void {
    // Get front-month contracts
    this.contracts = getFrontMonthContracts(this.config.symbols);

    for (const [symbol, contract] of this.contracts) {
      console.log(
        `[IBKR Ingestion] Subscribing to ${symbol} (${contract.localSymbol})`
      );

      // Register order book
      const depthTickerId = this.client.subscribeDepth(
        contract,
        this.config.depth
      );
      this.orderBookManager.registerBook(symbol, depthTickerId);

      // Subscribe to tick-by-tick trades
      const tradeTickerId = this.client.subscribeTickByTick(contract);
      this.tradeHandler.registerSymbol(tradeTickerId, symbol);

      // Subscribe to bid/ask for aggressor classification
      const bidAskTickerId = this.client.subscribeBidAsk(contract);
      this.tradeHandler.registerSymbol(bidAskTickerId, symbol);
    }
  }

  /**
   * Start the ingestion service
   */
  async start(): Promise<void> {
    if (this.running) {
      console.warn("[IBKR Ingestion] Service already running");
      return;
    }

    console.log("[IBKR Ingestion] Starting...");
    console.log(`  Symbols: ${this.config.symbols.join(", ")}`);
    console.log(`  IBKR: ${ibkrConfig.host}:${ibkrConfig.port}`);
    console.log(`  Paper Trading: ${ibkrConfig.paperTrading}`);
    console.log(`  Market Hours: ${this.marketHours.getStatusMessage()}`);

    // Check market hours if enabled
    if (this.config.respectMarketHours && !this.marketHours.isMarketOpen()) {
      const nextEvent = this.marketHours.getNextEvent();
      console.log(
        `[IBKR Ingestion] Market closed. Next: ${nextEvent.description} at ${nextEvent.time.toLocaleString()}`
      );
      console.log("[IBKR Ingestion] Waiting for market to open...");

      // Start market hours check interval
      this.startMarketHoursCheck();
      this.running = true;
      return;
    }

    await this.connect();
    this.running = true;

    // Start market hours check if enabled
    if (this.config.respectMarketHours) {
      this.startMarketHoursCheck();
    }
  }

  /**
   * Connect to IBKR
   */
  private async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (err) {
      console.error("[IBKR Ingestion] Failed to connect:", err);
      throw err;
    }
  }

  /**
   * Start periodic market hours check
   */
  private startMarketHoursCheck(): void {
    // Check every minute
    this.marketCheckInterval = setInterval(() => {
      const isOpen = this.marketHours.isMarketOpen();
      const isConnected = this.client.connected;

      if (isOpen && !isConnected) {
        console.log("[IBKR Ingestion] Market opened, connecting...");
        this.connect().catch((err) => {
          console.error("[IBKR Ingestion] Failed to connect on market open:", err);
        });
      } else if (!isOpen && isConnected) {
        console.log("[IBKR Ingestion] Market closed, disconnecting...");
        this.client.disconnect();
      }
    }, 60000); // Check every minute
  }

  /**
   * Stop the ingestion service
   */
  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    console.log("[IBKR Ingestion] Stopping...");

    // Stop market hours check
    if (this.marketCheckInterval) {
      clearInterval(this.marketCheckInterval);
      this.marketCheckInterval = null;
    }

    // Disconnect from IBKR
    this.client.disconnect();

    // Close Redis if we own it
    if (this.ownRedis) {
      await this.redis.quit();
    }

    this.running = false;
    console.log("[IBKR Ingestion] Stopped");
  }

  /**
   * Get service status
   */
  getStatus(): {
    running: boolean;
    connected: boolean;
    marketState: string;
    symbols: string[];
    stats: {
      orderBooks: ReturnType<IBKROrderBookManager["getStats"]>;
      trades: ReturnType<IBKRTradeHandler["getStats"]>;
      publisher: ReturnType<IBKRPublisher["getStats"]>;
    };
  } {
    return {
      running: this.running,
      connected: this.client.connected,
      marketState: this.marketHours.getStatusMessage(),
      symbols: this.config.symbols,
      stats: {
        orderBooks: this.orderBookManager.getStats(),
        trades: this.tradeHandler.getStats(),
        publisher: this.publisher.getStats(),
      },
    };
  }

  /**
   * Log current statistics
   */
  logStats(): void {
    console.log("[IBKR Ingestion] Status:", this.getStatus());
    this.publisher.logStats();
  }
}

/**
 * Create and start an IBKR ingestion service
 */
export async function startIBKRIngestion(
  config?: IBKRIngestionConfig
): Promise<IBKRIngestionService> {
  const service = new IBKRIngestionService(config);
  await service.start();
  return service;
}

// Default export for direct execution
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const service = new IBKRIngestionService({
    symbols: ["MES", "MNQ"],
    verbose: true,
  });

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nReceived SIGINT, shutting down...");
    await service.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, shutting down...");
    await service.stop();
    process.exit(0);
  });

  service.start().catch((err) => {
    console.error("Failed to start IBKR ingestion:", err);
    process.exit(1);
  });
}
