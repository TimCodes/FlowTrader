module.exports = {
  apps: [
    // ── IBKR Futures Pipeline ─────────────────────────
    {
      name: "ibkr-ingestion",
      script: "./packages/ingestion-ibkr/dist/index.js",
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        IBKR_HOST: "127.0.0.1",
        IBKR_PORT: 7497, // Paper trading
        IBKR_CLIENT_ID: 10,
        REDIS_URL: "redis://localhost:6379",
      },
    },

    // ── Kraken Crypto Pipeline ────────────────────────
    {
      name: "kraken-ingestion",
      script: "./packages/ingestion-kraken/dist/index.js",
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        KRAKEN_SYMBOLS: "BTC/USD,ETH/USD",
        KRAKEN_L3_ENABLED: "true",
        REDIS_URL: "redis://localhost:6379",
      },
    },

    // ── Catalyst Feeds ────────────────────────────────
    {
      name: "catalysts",
      script: "./packages/catalysts/dist/index.js",
      autorestart: true,
      env: {
        NODE_ENV: "production",
        REDIS_URL: "redis://localhost:6379",
      },
    },

    // ── Feature Engine ────────────────────────────────
    {
      name: "feature-engine",
      script: "./packages/features/dist/index.js",
      autorestart: true,
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
        REDIS_URL: "redis://localhost:6379",
        DATABASE_URL: "postgresql://trading:trading_dev@localhost:5432/trading",
      },
    },

    // ── Storage Writer (Redis → TimescaleDB) ──────────
    {
      name: "db-writer",
      script: "./packages/storage/dist/writer.js",
      autorestart: true,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        REDIS_URL: "redis://localhost:6379",
        DATABASE_URL: "postgresql://trading:trading_dev@localhost:5432/trading",
      },
    },

    // ── LangGraph Orchestrator ────────────────────────
    {
      name: "orchestrator",
      script: "./packages/orchestrator/dist/index.js",
      autorestart: true,
      max_memory_restart: "2G",
      env: {
        NODE_ENV: "production",
        REDIS_URL: "redis://localhost:6379",
      },
    },

    // ── Execution Engine ──────────────────────────────
    {
      name: "execution",
      script: "./packages/execution/dist/index.js",
      autorestart: true,
      env: {
        NODE_ENV: "production",
        IBKR_HOST: "127.0.0.1",
        IBKR_PORT: 7497,
        IBKR_CLIENT_ID: 20, // Separate client ID from ingestion
        REDIS_URL: "redis://localhost:6379",
      },
    },
  ],
};
