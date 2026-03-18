-- 001_initial_schema.sql
-- TimescaleDB schema for trading system
-- Run via: docker exec trading-tsdb psql -U trading -d trading -f /docker-entrypoint-initdb.d/001_initial_schema.sql

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ── Order Book Snapshots ─────────────────────────────

CREATE TABLE IF NOT EXISTS order_book_snapshots (
  time         TIMESTAMPTZ NOT NULL,
  source       TEXT NOT NULL,
  asset_class  TEXT NOT NULL,
  symbol       TEXT NOT NULL,
  bid_prices   DOUBLE PRECISION[],
  bid_sizes    DOUBLE PRECISION[],
  ask_prices   DOUBLE PRECISION[],
  ask_sizes    DOUBLE PRECISION[],
  bid_total    DOUBLE PRECISION,
  ask_total    DOUBLE PRECISION,
  imbalance    DOUBLE PRECISION
);

SELECT create_hypertable('order_book_snapshots', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_obs_sym ON order_book_snapshots (symbol, time DESC);
CREATE INDEX IF NOT EXISTS idx_obs_source ON order_book_snapshots (source, time DESC);

-- ── L3 Order Events (Kraken only) ────────────────────

CREATE TABLE IF NOT EXISTS l3_orders (
  time       TIMESTAMPTZ NOT NULL,
  symbol     TEXT NOT NULL,
  order_id   TEXT NOT NULL,
  event      TEXT NOT NULL,
  side       TEXT NOT NULL,
  price      DOUBLE PRECISION,
  qty        DOUBLE PRECISION
);

SELECT create_hypertable('l3_orders', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_l3_sym ON l3_orders (symbol, time DESC);

-- ── Trades ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS trades (
  time         TIMESTAMPTZ NOT NULL,
  source       TEXT NOT NULL,
  asset_class  TEXT NOT NULL,
  symbol       TEXT NOT NULL,
  price        DOUBLE PRECISION NOT NULL,
  size         DOUBLE PRECISION NOT NULL,
  side         TEXT
);

SELECT create_hypertable('trades', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_trades_sym ON trades (symbol, time DESC);

-- ── Feature Vectors ──────────────────────────────────

CREATE TABLE IF NOT EXISTS features (
  time               TIMESTAMPTZ NOT NULL,
  source             TEXT NOT NULL,
  asset_class        TEXT NOT NULL,
  symbol             TEXT NOT NULL,
  imbalance_ratio    DOUBLE PRECISION,
  spread_bps         DOUBLE PRECISION,
  depth_ratio_5      DOUBLE PRECISION,
  depth_ratio_10     DOUBLE PRECISION,
  tape_velocity      DOUBLE PRECISION,
  buy_sell_ratio     DOUBLE PRECISION,
  large_trade_count  INTEGER,
  vwap_deviation     DOUBLE PRECISION,
  spoof_score        DOUBLE PRECISION,
  iceberg_score      DOUBLE PRECISION,
  cancel_rate        DOUBLE PRECISION
);

SELECT create_hypertable('features', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_feat_sym ON features (symbol, time DESC);

-- ── Catalyst Events ──────────────────────────────────

CREATE TABLE IF NOT EXISTS catalysts (
  time         TIMESTAMPTZ NOT NULL,
  source       TEXT NOT NULL,
  asset_class  TEXT NOT NULL,
  symbol       TEXT NOT NULL,
  headline     TEXT,
  category     TEXT,
  raw_text     TEXT,
  magnitude    SMALLINT
);

SELECT create_hypertable('catalysts', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_cat_sym ON catalysts (symbol, time DESC);

-- ── Trade Decisions (audit log) ──────────────────────

CREATE TABLE IF NOT EXISTS trade_decisions (
  time            TIMESTAMPTZ NOT NULL,
  decision_id     TEXT NOT NULL UNIQUE,
  symbol          TEXT NOT NULL,
  strategy        TEXT NOT NULL,
  action          TEXT NOT NULL,
  confidence      DOUBLE PRECISION,
  entry_price     DOUBLE PRECISION,
  stop_loss       DOUBLE PRECISION,
  take_profit_1   DOUBLE PRECISION,
  take_profit_2   DOUBLE PRECISION,
  position_size   DOUBLE PRECISION,
  max_risk        DOUBLE PRECISION,
  reasoning       TEXT
);

SELECT create_hypertable('trade_decisions', 'time', if_not_exists => TRUE);

-- ── Execution Reports ────────────────────────────────

CREATE TABLE IF NOT EXISTS execution_reports (
  time           TIMESTAMPTZ NOT NULL,
  decision_id    TEXT NOT NULL,
  symbol         TEXT NOT NULL,
  broker         TEXT NOT NULL,
  order_id       TEXT,
  status         TEXT NOT NULL,
  fill_price     DOUBLE PRECISION,
  fill_size      DOUBLE PRECISION,
  slippage_bps   DOUBLE PRECISION,
  latency_ms     DOUBLE PRECISION
);

SELECT create_hypertable('execution_reports', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_exec_decision ON execution_reports (decision_id);

-- ── Continuous Aggregates ────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS features_1min
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 minute', time) AS bucket,
  source, asset_class, symbol,
  AVG(imbalance_ratio)   AS avg_imbalance,
  AVG(tape_velocity)     AS avg_tape_velocity,
  MAX(tape_velocity)     AS peak_tape_velocity,
  AVG(buy_sell_ratio)    AS avg_bs_ratio,
  AVG(spread_bps)        AS avg_spread
FROM features
GROUP BY bucket, source, asset_class, symbol
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS features_5min
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('5 minutes', time) AS bucket,
  source, asset_class, symbol,
  AVG(imbalance_ratio)   AS avg_imbalance,
  AVG(tape_velocity)     AS avg_tape_velocity,
  MAX(tape_velocity)     AS peak_tape_velocity,
  AVG(buy_sell_ratio)    AS avg_bs_ratio,
  AVG(spread_bps)        AS avg_spread
FROM features
GROUP BY bucket, source, asset_class, symbol
WITH NO DATA;

-- ── Compression Policies ─────────────────────────────

SELECT add_compression_policy('order_book_snapshots', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_compression_policy('l3_orders', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_compression_policy('trades', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_compression_policy('features', INTERVAL '14 days', if_not_exists => TRUE);
SELECT add_compression_policy('catalysts', INTERVAL '30 days', if_not_exists => TRUE);

-- ── Retention Policies (optional — adjust as needed) ─
-- Uncomment to auto-drop data older than 6 months:
-- SELECT add_retention_policy('order_book_snapshots', INTERVAL '6 months');
-- SELECT add_retention_policy('l3_orders', INTERVAL '6 months');
-- SELECT add_retention_policy('trades', INTERVAL '6 months');
