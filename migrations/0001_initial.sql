PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS ticks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  quote TEXT NOT NULL,
  digit INTEGER NOT NULL CHECK(digit BETWEEN 0 AND 9),
  received_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'deriv-live',
  UNIQUE(market, epoch, quote)
);
CREATE INDEX IF NOT EXISTS idx_ticks_market_epoch ON ticks(market, epoch DESC);
CREATE TABLE IF NOT EXISTS contract_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  barrier TEXT,
  duration INTEGER,
  duration_unit TEXT,
  payout_currency TEXT,
  payout REAL,
  ask_price REAL,
  raw_json TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  UNIQUE(market, contract_type, barrier, duration, duration_unit, observed_at)
);
CREATE INDEX IF NOT EXISTS idx_contract_market_time ON contract_catalog(market, observed_at DESC);
CREATE TABLE IF NOT EXISTS signal_observations (
  id TEXT PRIMARY KEY,
  market TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  barrier TEXT,
  direction TEXT,
  horizon_ticks INTEGER NOT NULL,
  signal_at INTEGER NOT NULL,
  feature_json TEXT NOT NULL,
  model_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  resolved_at INTEGER,
  outcome INTEGER,
  settlement_quote TEXT
);
CREATE INDEX IF NOT EXISTS idx_observations_market_time ON signal_observations(market, signal_at DESC);
CREATE TABLE IF NOT EXISTS validation_runs (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  model_version TEXT NOT NULL,
  market TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  barrier TEXT,
  horizon_ticks INTEGER NOT NULL,
  train_start INTEGER,
  train_end INTEGER,
  test_start INTEGER,
  test_end INTEGER,
  sample_size INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  hit_rate REAL,
  baseline_rate REAL,
  lower_95 REAL,
  upper_95 REAL,
  expected_value REAL,
  metadata_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_validation_lookup ON validation_runs(market, contract_type, created_at DESC);
CREATE TABLE IF NOT EXISTS collection_sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  client_id TEXT,
  markets_json TEXT NOT NULL,
  ticks_received INTEGER NOT NULL DEFAULT 0,
  ticks_inserted INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);
