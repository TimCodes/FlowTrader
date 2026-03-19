# FlowTrader

LangGraph-orchestrated multi-agent trading system running locally on Alienware Aurora R16 (RTX 4090, 24GB VRAM).

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    DATA INGESTION                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ IBKR Futures  │  │ Kraken Crypto│  │  Catalysts   │      │
│  │ L2 + Trades   │  │ L2/L3+Trades │  │ News + Chain │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         └─────────┬───────┴─────────┬───────┘               │
│              Redis Streams (unified schema)                   │
├─────────────────────────────────────────────────────────────┤
│                  FEATURE ENGINEERING                          │
│  Order book features │ Tape features │ L3-derived features   │
├─────────────────────────────────────────────────────────────┤
│                      ML AGENTS                               │
│  ┌──────────────────┐  ┌──────────────────┐                 │
│  │ Order Flow LSTM   │  │ Catalyst LLM 7B  │                │
│  │ ~2GB VRAM, <50ms  │  │ ~5GB VRAM, <500ms│                │
│  └────────┬─────────┘  └────────┬─────────┘                │
├───────────┴────────────┬────────┴────────────────────────────┤
│              LANGGRAPH ORCHESTRATOR                           │
│  Signal fusion → Strategy selection → Risk management        │
├─────────────────────────────────────────────────────────────┤
│                  EXECUTION ENGINE                            │
│  Rules-based │ IBKR (futures) │ Kraken (crypto) │ No LLM    │
└─────────────────────────────────────────────────────────────┘
         ↕                                    ↕
   TimescaleDB                          LEAN CLI
   (time-series)                      (backtesting)
```

## Strategies

- **Ross Cameron Momentum** — Low-float gap-ups, L2 tape reading, quick scalps
- **Chris Loris Price Action** — Pattern-based entries, defined risk/reward
- **Duane Archer Goodman Wave** — Structural wave analysis, swing trades

## Packages

| Package | Description | Phase |
|---------|-------------|-------|
| `@trading/types` | Shared TypeScript types — unified event schema | ✅ Ready |
| `@trading/ingestion-ibkr` | IBKR TWS API — futures L2 + trades | Phase 1 |
| `@trading/ingestion-kraken` | Kraken WebSocket — crypto L2/L3 + trades | Phase 1 |
| `@trading/features` | Feature engineering — raw data to model inputs | Phase 2 |
| `@trading/storage` | TimescaleDB writer + Drizzle ORM schema | Phase 1 |
| `@trading/catalysts` | News and catalyst feeds | Phase 2 |
| `@trading/agents` | Order flow LSTM + Catalyst LLM (RTX 4090) | Phase 3 |
| `@trading/orchestrator` | LangGraph state machine — signal fusion | Phase 4 |
| `@trading/execution` | Rules-based execution engine | Phase 4 |

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url>
cd FlowTrader
npm install

# 2. Set up environment
cp .env.example .env
# Edit .env with your API keys

# 3. Start infrastructure
docker compose up -d

# 4. Run database migrations
docker exec trading-tsdb psql -U trading -d trading \
  -f /docker-entrypoint-initdb.d/001_initial_schema.sql

# 5. Build all packages
npm run build

# 6. Start services (when implemented)
npm run pm2:start
```

## Infrastructure

- **Redis 7** — Real-time event bus (Streams), 6GB RAM allocation
- **TimescaleDB (PG16)** — Time-series storage, hypertables with compression
- **PM2** — Process manager for Node.js services
- **Docker** — Infrastructure containers

## Hardware

- Alienware Aurora R16, RTX 4090 24GB VRAM
- VRAM budget: LSTM ~2GB + LLM 7B ~5GB + OS ~3GB = ~10GB used, ~14GB headroom

## Brokers

- **Interactive Brokers** — CME futures (ES, NQ, MES, MNQ, CL), paper port 7497
- **Kraken** — Crypto spot + futures (BTC/USD, ETH/USD), demo at demo-futures.kraken.com

## Integration

This system is designed to eventually merge into
[StrategyVisualizer](https://github.com/TimCodes/StrategyVisualizer)
as the live trading layer on top of LEAN CLI backtesting.
