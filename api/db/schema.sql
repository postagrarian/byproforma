-- Run this in the Supabase SQL editor to initialize the schema.

-- ETF slot configuration (1–5)
create table if not exists etf_config (
  slot           int primary key,
  ticker         text not null,
  last_run_date  date,
  updated_at     timestamptz default now()
);

-- Monthly price history (ETF + individual stocks)
create table if not exists price_history (
  ticker         text not null,
  date           date not null,
  monthly_return float8,
  primary key (ticker, date)
);

-- Fama-French 5 + Momentum monthly factors
create table if not exists ff_factors (
  date    date primary key,
  mkt_rf  float8,
  smb     float8,
  hml     float8,
  rmw     float8,
  cma     float8,
  mom     float8,
  rf      float8
);

-- Rolling 36-month OLS loadings per ticker
create table if not exists factor_loadings (
  ticker           text not null,
  window_end_date  date not null,
  beta_mkt         float8,
  beta_smb         float8,
  beta_hml         float8,
  beta_rmw         float8,
  beta_cma         float8,
  beta_mom         float8,
  r2               float8,
  resid_var        float8,
  primary key (ticker, window_end_date)
);

-- Completed portfolio runs (one row per slot per month)
create table if not exists portfolio_runs (
  id               bigserial primary key,
  slot             int not null,
  etf_ticker       text not null,
  run_date         date not null,
  sector_weights   jsonb,
  factor_loadings  jsonb,
  portfolio        jsonb,
  factor_rmse      float8,
  max_sector_diff  float8,
  created_at       timestamptz default now()
);

create index if not exists idx_portfolio_runs_slot_date
  on portfolio_runs (slot, run_date desc);

create index if not exists idx_price_history_ticker_date
  on price_history (ticker, date);

create index if not exists idx_factor_loadings_ticker
  on factor_loadings (ticker, window_end_date desc);
