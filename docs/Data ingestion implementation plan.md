# Data Ingestion Layer — Implementation Plan

**IBKR Futures + Kraken Crypto | Dual-Broker Architecture**

Multi-Agent LangGraph Trading System | March 2026

Tools: **Claude Code** (complex tasks) | **GitHub Copilot** (simpler tasks)

---

## Overview

This plan covers the complete implementation of the data ingestion layer for the multi-agent trading system. It encompasses two parallel broker pipelines (IBKR futures and Kraken crypto), shared infrastructure (Redis + TimescaleDB), and a unified event schema that makes downstream consumers broker-agnostic.

The plan is organized into 5 epics with 28 atomic user stories. Each story is tagged with the recommended AI tool (Claude Code for complex/multi-file tasks, Copilot for focused single-file tasks) and sized in story points (1-5 scale).

### Summary

| Epic | Stories | Points | Claude Code | Copilot | Est. Days |
|------|:-------:|:------:|:-----------:|:-------:|:---------:|
| E1: Infrastructure | 6 | 11 | 3 | 3 | 2-3 |
| E2: Kraken Pipeline | 7 | 17 | 5 | 2 | 3-4 |
| E3: IBKR Pipeline | 6 | 15 | 4 | 2 | 3-4 |
| E4: Storage Writer | 5 | 12 | 3 | 2 | 2-3 |
| E5: Integration & Testing | 4 | 11 | 3 | 1 | 2-3 |
| **TOTAL** | **28** | **66** | **18** | **10** | **12-17** |

---

## Epics & User Stories

Each story follows the format: As a [trading system], I want [capability], so that [value]. Stories are ordered by implementation sequence within each epic.

---

### Epic 1: Infrastructure Setup (11 points)

| ID | Story | Description | Tool | SP |
|----|-------|-------------|------|----|
| 1.1 | Docker Compose | Set up docker-compose.yml with Redis 7 and TimescaleDB (PG16). Configure volumes, health checks, memory limits, and networking. | Copilot | 1 |
| 1.2 | Redis Connection Util | Create shared Redis client factory with connection pooling, reconnection logic, and environment-based config. Export from a shared utils package or inline. | Copilot | 1 |
| 1.3 | Redis Stream Helpers | Build typed publish/subscribe helpers for Redis Streams using the STREAMS constants from @trading/types. Include consumer group setup and XREADGROUP wrapper. | Claude Code | 3 |
| 1.4 | TimescaleDB Migration | Run the 001_initial_schema.sql migration. Verify hypertables, indexes, compression policies, and continuous aggregates are created correctly. | Copilot | 1 |
| 1.5 | Drizzle ORM Setup | Configure Drizzle ORM with the TimescaleDB schema. Create typed table definitions matching the SQL schema. Set up the database client. | Claude Code | 3 |
| 1.6 | Health Check Service | Create a lightweight health check endpoint that reports status of Redis connection, TimescaleDB connection, and each ingestion service. | Copilot | 2 |

---

### Epic 2: Kraken Crypto Pipeline (17 points)

| ID | Story | Description | Tool | SP |
|----|-------|-------------|------|----|
| 2.1 | Kraken L2 WebSocket | Connect to wss://ws.kraken.com/v2 and subscribe to the 'book' channel for BTC/USD and ETH/USD with depth=25 and snapshot=true. Parse initial snapshot and incremental updates. | Claude Code | 3 |
| 2.2 | Order Book State Mgr | Maintain local order book state from L2 updates. Apply insert/update/delete operations. Sort bids descending, asks ascending. Verify with CRC32 checksum. | Claude Code | 3 |
| 2.3 | Kraken Trades Feed | Subscribe to 'trade' channel on the same WebSocket. Parse tick-by-tick trades including price, qty, side, and timestamp. Map to unified TradeEvent. | Copilot | 2 |
| 2.4 | L2 → Redis Publisher | Emit OrderBookEvent snapshots to Redis Stream on each book update (or configurable throttle). Include computed imbalance ratio. | Copilot | 2 |
| 2.5 | Kraken Auth Token | Implement REST call to POST /0/private/GetWebSocketsToken using API key/secret with HMAC-SHA256 signing. Return WebSocket auth token. | Claude Code | 2 |
| 2.6 | Kraken L3 WebSocket | Connect to wss://ws-auth.kraken.com/v2 with auth token. Subscribe to 'level3' channel. Parse individual order add/modify/delete events into L3OrderEvent. | Claude Code | 3 |
| 2.7 | Reconnection Handler | Implement automatic reconnection for both L2 and L3 WebSockets. Handle Kraken's 60s inactivity disconnect, Cloudflare rate limits (150/10min), and exponential backoff. | Copilot | 2 |

---

### Epic 3: IBKR Futures Pipeline (15 points)

| ID | Story | Description | Tool | SP |
|----|-------|-------------|------|----|
| 3.1 | TWS API Connection | Connect to IBKR TWS/Gateway via @stoqey/ib on paper trading port 7497. Handle connection events, errors, and automatic reconnection. | Claude Code | 2 |
| 3.2 | Futures Contract Def | Create Contract objects for MES, MNQ, ES, NQ, CL with correct secType, exchange, currency, and auto-rolling front-month expiry calculation. | Copilot | 2 |
| 3.3 | L2 Depth Subscription | Call reqMktDepth for each futures contract (10 levels). Handle updateMktDepth callbacks with insert/update/delete operations to maintain local book state. | Claude Code | 3 |
| 3.4 | Tick-by-Tick Trades | Call reqTickByTickData for 'Last' trade data on each contract. Implement aggressor classification by comparing trade price to current bid/ask. | Claude Code | 3 |
| 3.5 | IBKR → Redis Publisher | Map IBKR book state and trades to unified OrderBookEvent and TradeEvent. Publish to same Redis Streams as Kraken pipeline. | Copilot | 2 |
| 3.6 | Market Hours Handler | Implement futures session awareness. Auto-connect Sunday 6PM ET, disconnect Friday 5PM ET. Handle CME maintenance windows and holiday calendar. | Claude Code | 3 |

---

### Epic 4: Storage Writer — Redis → TimescaleDB (12 points)

| ID | Story | Description | Tool | SP |
|----|-------|-------------|------|----|
| 4.1 | Stream Consumer Setup | Create Redis consumer group for each stream (orderbook, trades, l3, news). Implement XREADGROUP with block timeout and acknowledgment. | Claude Code | 3 |
| 4.2 | Batch Buffer | Implement in-memory batch buffer that flushes on size threshold (1000 events) or time interval (1 second), whichever comes first. | Copilot | 2 |
| 4.3 | Bulk Insert Logic | Write batch insert functions for each TimescaleDB table using Drizzle ORM. Map event types to table schemas. Handle array columns for order book data. | Claude Code | 3 |
| 4.4 | Backpressure Handling | Implement backpressure when DB writes fall behind. Monitor write queue depth. Log warnings when buffer exceeds 80% capacity. Drop oldest if 100%. | Copilot | 2 |
| 4.5 | Write Metrics | Track and log write throughput (events/sec), batch sizes, DB latency, and error rates. Expose via health check endpoint. | Copilot | 2 |

---

### Epic 5: Integration & End-to-End Testing (11 points)

| ID | Story | Description | Tool | SP |
|----|-------|-------------|------|----|
| 5.1 | E2E Kraken Test | Start Docker infra + Kraken ingestion. Verify L2 + trades flowing through Redis into TimescaleDB. Query stored data and validate schema correctness. | Claude Code | 3 |
| 5.2 | E2E IBKR Test | Start Docker infra + IBKR ingestion (paper trading). Verify futures L2 + trades flowing through Redis into TimescaleDB. Validate against paper account. | Claude Code | 3 |
| 5.3 | PM2 Deployment | Configure and test PM2 ecosystem for all services. Verify auto-restart, log rotation, and memory limits. Document startup/shutdown procedures. | Copilot | 2 |
| 5.4 | Data Validation Suite | Write validation queries: check for gaps in time series, verify imbalance ratios are 0-1, confirm trade sides are classified, verify L3 order consistency. | Claude Code | 3 |

---

## Claude Code Prompt

Copy and paste this prompt when starting a Claude Code session for complex implementation tasks. It provides full project context so Claude Code can work across multiple files effectively.

```
You are working on a multi-agent LangGraph trading system monorepo.

PROJECT STRUCTURE:
  trading-system/ (npm workspaces monorepo)
    packages/types/src/index.ts    — Shared types (OrderBookEvent, TradeEvent, L3OrderEvent, etc.)
    packages/ingestion-kraken/     — Kraken WebSocket L2/L3 + trades
    packages/ingestion-ibkr/       — IBKR TWS API futures L2 + trades
    packages/storage/              — TimescaleDB writer + Drizzle ORM
    packages/features/             — Feature engineering (Phase 2)
    packages/agents/               — ML agents LSTM + LLM (Phase 3)
    packages/orchestrator/         — LangGraph state machine (Phase 4)
    packages/execution/            — Rules-based execution (Phase 4)
    docker-compose.yml             — Redis 7 + TimescaleDB PG16
    ecosystem.config.js            — PM2 service manager

TECH STACK:
  TypeScript, Node.js 20+, npm workspaces
  Redis 7 (Streams for real-time event bus)
  TimescaleDB (PostgreSQL 16 with hypertables)
  Drizzle ORM for database access
  @stoqey/ib for IBKR TWS API
  ws (WebSocket) for Kraken API
  ioredis for Redis client

KEY DESIGN PRINCIPLES:
  1. Both brokers emit identical event types (OrderBookEvent, TradeEvent)
     to the same Redis Streams — downstream consumers are broker-agnostic.
  2. Redis Stream keys follow: orderbook:{symbol}, trades:{symbol},
     l3:{symbol}, news:{symbol} — defined in @trading/types STREAMS const.
  3. All events include 'source' (ibkr|kraken) and 'asset_class'
     (futures|crypto) fields for filtering.
  4. IBKR uses paper trading port 7497, client ID 10 for ingestion,
     client ID 20 for execution (separate connections).
  5. Kraken L2 is public (no auth). L3 requires auth token from REST API.
  6. Storage writer batch-inserts from Redis to TimescaleDB
     (flush on 1000 events or 1 second, whichever first).

CURRENT TASK:
[Describe the specific epic/story you want to implement, e.g.:
 'Implement story 2.1 and 2.2: Kraken L2 WebSocket connection and
  order book state manager in packages/ingestion-kraken/src/']

Please read the existing code in @trading/types first to understand the
event schemas, then implement the requested stories. Write production-quality
TypeScript with proper error handling, logging, and reconnection logic.
```

---

## GitHub Copilot Prompt

Use this as a Copilot Chat prompt (Ctrl+I or /explain) for focused, single-file implementation tasks. Copilot works best when given clear context about the specific file and function to implement.

```
I'm building a trading data ingestion system in TypeScript.

CONTEXT:
  - Monorepo with npm workspaces under packages/
  - Shared types in @trading/types (OrderBookEvent, TradeEvent, etc.)
  - Redis Streams as the event bus (using ioredis)
  - Stream keys: orderbook:{symbol}, trades:{symbol}, l3:{symbol}
  - TimescaleDB for persistent storage (via Drizzle ORM)
  - Two data sources: IBKR futures (@stoqey/ib) and Kraken crypto (ws)
  - Both sources produce identical event schemas to Redis

CURRENT FILE: [paste the file path]

TASK: [describe what you need, e.g.:
  'Write a Redis Stream publish helper that takes an OrderBookEvent,
   serializes it to JSON, and calls XADD with the correct stream key.
   Use the STREAMS constant from @trading/types for key generation.']

Use strict TypeScript. Handle errors gracefully. Add JSDoc comments.
```

---

## Tool Assignment Guide

### Claude Code — Complex Tasks

- Multi-file changes that need to stay consistent (e.g., type changes that ripple across packages)
- WebSocket connection logic with reconnection, state management, and error handling
- Redis consumer group setup with XREADGROUP, acknowledgment, and backpressure
- Drizzle ORM schema + typed queries spanning multiple tables
- End-to-end integration tests that verify data flow across services
- Any story rated 3+ story points

### GitHub Copilot — Focused Tasks

- Single utility functions (Redis client factory, timestamp helpers, config loaders)
- Data mapping functions (IBKR event → unified event, Kraken trade → TradeEvent)
- Docker/PM2 configuration files
- Health check endpoints and basic monitoring
- Batch buffer implementations with simple flush logic
- Any story rated 1-2 story points

---

## Recommended Implementation Order

### Week 1: Foundation

1. **Stories 1.1-1.4:** Docker infra, Redis client, stream helpers, DB migration
2. **Stories 1.5-1.6:** Drizzle ORM setup, health checks

### Week 2: Kraken Pipeline (free, no account fees)

3. **Stories 2.1-2.4:** L2 WebSocket, order book state, trades, Redis publishing
4. **Stories 2.5-2.7:** Auth token, L3 feed, reconnection

### Week 2-3: IBKR Pipeline (after account approved)

5. **Stories 3.1-3.2:** TWS connection, contract definitions
6. **Stories 3.3-3.6:** L2 depth, trades, Redis publishing, market hours

### Week 3: Storage & Integration

7. **Stories 4.1-4.5:** Stream consumer, batch buffer, bulk insert, backpressure, metrics
8. **Stories 5.1-5.4:** E2E tests, PM2 deployment, data validation

---

After completing this plan, the system will be collecting real-time L2/L3 order book data, tick-by-tick trades, and catalyst events from both futures and crypto markets, persisting everything to TimescaleDB for model training. The feature engineering layer (Phase 2) is the next implementation milestone.