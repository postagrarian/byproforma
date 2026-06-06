"""
Full pipeline for one ETF slot:
  1. Load ETF config from Supabase
  2. Fetch holdings via Polygon → top 10 per sector
  3. Download / refresh price history (ETF + universe) via yfinance → cache
  4. Download / refresh FF5+Mom factors → cache
  5. Run latest-window OLS for ETF + all universe tickers → cache
  6. Optimize portfolio weights (factor match + sector constraints)
  7. Write portfolio_runs row to Supabase
"""
import asyncio
from datetime import date, timedelta

import numpy as np
import pandas as pd

from db import supabase as db
from services import holdings as svc_holdings
from services import prices   as svc_prices
from services import factors  as svc_factors
from services import regression as svc_reg
from services import optimizer  as svc_opt

START_DATE = "2010-01-01"
_STATUS: dict[int, dict] = {}


def get_pipeline_status(slot: int) -> dict:
    return _STATUS.get(slot, {"slot": slot, "stage": "idle", "message": "", "progress": 0})


def _set_status(slot: int, stage: str, message: str, progress: int):
    _STATUS[slot] = {"slot": slot, "stage": stage, "message": message, "progress": progress}


async def run_pipeline(slot: int) -> dict:
    _set_status(slot, "holdings", "Fetching ETF config…", 5)

    cfg = await db.get_etf_config(slot)
    if not cfg or not cfg.get("ticker"):
        raise ValueError(f"Slot {slot} is not configured")
    etf_ticker = cfg["ticker"]

    # ── 1. Holdings ──────────────────────────────────────────────────────────
    _set_status(slot, "holdings", f"Fetching {etf_ticker} holdings from Massive…", 10)
    raw_holdings = svc_holdings.get_etf_holdings(etf_ticker)
    etf_sectors  = svc_holdings.get_etf_sector_weights(etf_ticker)
    top10        = svc_holdings.get_top10_per_sector(raw_holdings, etf_sectors)
    universe_tix = list({tk for tks in top10.values() for tk in tks})

    # Build universe metadata list (ticker → sector)
    ticker_sector = {}
    for sector, tks in top10.items():
        for tk in tks:
            ticker_sector[tk] = sector

    # ── 2. Factor data ───────────────────────────────────────────────────────
    _set_status(slot, "factors", "Loading FF5+Momentum factors…", 20)
    cached_factors = await db.get_cached_factors(START_DATE)

    today = date.today()
    needs_refresh = (
        not cached_factors
        or pd.to_datetime(cached_factors[-1]["date"]).date() < today - timedelta(days=45)
    )
    if needs_refresh:
        factor_df = svc_factors.fetch_factors(START_DATE)
        await db.upsert_factors(svc_factors.factors_to_rows(factor_df))
    else:
        factor_df = svc_factors.rows_to_dataframe(cached_factors)

    # ── 3. Price history ─────────────────────────────────────────────────────
    _set_status(slot, "prices", "Downloading price histories…", 35)
    all_tickers = [etf_ticker] + universe_tix
    returns_dict: dict[str, pd.Series] = {}

    fresh_needed = []
    for tk in all_tickers:
        cached = await db.get_cached_prices(tk, START_DATE)
        if not cached or pd.to_datetime(cached[-1]["date"]).date() < today - timedelta(days=45):
            fresh_needed.append(tk)
        else:
            returns_dict[tk] = svc_prices.rows_to_series(cached)

    if fresh_needed:
        new_returns = svc_prices.fetch_monthly_returns(fresh_needed, START_DATE)
        for tk in fresh_needed:
            if tk in new_returns.columns:
                series = new_returns[tk].dropna()
                await db.upsert_prices(tk, svc_prices.returns_to_rows(tk, series))
                returns_dict[tk] = series

    # ── 4. Regressions ───────────────────────────────────────────────────────
    _set_status(slot, "regressions", "Running factor regressions…", 55)

    # Align factor index to month-start timestamps
    def to_ms(idx):
        return pd.DatetimeIndex([pd.Timestamp(d.year, d.month, 1) for d in idx])

    factor_df.index = to_ms(factor_df.index)

    betas_by_ticker: dict[str, dict] = {}
    for tk, series in returns_dict.items():
        series.index = to_ms(series.index)
        b = svc_reg.estimate_latest_betas(series, factor_df)
        if b:
            betas_by_ticker[tk] = b
            await db.upsert_loadings([{
                "ticker":          tk,
                "window_end_date": today.strftime("%Y-%m-%d"),
                **b,
            }])

    if etf_ticker not in betas_by_ticker:
        raise ValueError(f"Could not estimate betas for {etf_ticker}")

    etf_betas = svc_reg.betas_to_array(betas_by_ticker[etf_ticker])

    # ── 5. Build universe for optimizer ──────────────────────────────────────
    _set_status(slot, "optimizing", "Optimising portfolio…", 75)
    universe = []
    for tk in universe_tix:
        if tk not in betas_by_ticker:
            continue
        b = betas_by_ticker[tk]
        universe.append({
            "ticker":   tk,
            "sector":   ticker_sector.get(tk, "Unknown"),
            "r2":       b["r2"],
            **b,
        })

    if not universe:
        raise ValueError("No universe tickers with valid betas")

    weights, factor_rmse = svc_opt.optimize(universe, etf_betas, etf_sectors)

    # ── 6. Build result payload ───────────────────────────────────────────────
    _set_status(slot, "optimizing", "Building result payload…", 90)

    portfolio = []
    for i, u in enumerate(universe):
        w = float(weights[i])
        if w > 0.005:
            portfolio.append({
                "ticker":  u["ticker"],
                "weight":  round(w, 4),
                "sector":  u["sector"],
                "r2":      round(u["r2"], 4),
                "betaMkt": round(u["beta_mkt"], 4),
                "betaSmb": round(u["beta_smb"], 4),
                "betaHml": round(u["beta_hml"], 4),
                "betaRmw": round(u["beta_rmw"], 4),
                "betaCma": round(u["beta_cma"], 4),
                "betaMom": round(u["beta_mom"], 4),
            })

    port_betas = np.column_stack([
        [u["beta_mkt"], u["beta_smb"], u["beta_hml"],
         u["beta_rmw"], u["beta_cma"], u["beta_mom"]]
        for u in universe
    ]) @ weights

    factor_names = ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "Mom"]
    factor_loadings = [
        {
            "factor":        fn,
            "etfBeta":       round(float(etf_betas[j]), 4),
            "portfolioBeta": round(float(port_betas[j]), 4),
            "diff":          round(float(port_betas[j] - etf_betas[j]), 4),
        }
        for j, fn in enumerate(factor_names)
    ]

    portfolio_sector_weights: dict[str, float] = {}
    for item in portfolio:
        s = item["sector"]
        portfolio_sector_weights[s] = portfolio_sector_weights.get(s, 0.0) + item["weight"]

    sector_weights = [
        {
            "sector":          s,
            "etfWeight":       round(etf_sectors.get(s, 0.0), 4),
            "portfolioWeight": round(portfolio_sector_weights.get(s, 0.0), 4),
            "diff":            round(portfolio_sector_weights.get(s, 0.0) - etf_sectors.get(s, 0.0), 4),
        }
        for s in etf_sectors
    ]

    max_sector_diff = max(abs(r["diff"]) for r in sector_weights) if sector_weights else 0.0

    payload = {
        "run_date":        today.strftime("%Y-%m-%d"),
        "sector_weights":  sector_weights,
        "factor_loadings": factor_loadings,
        "portfolio":       portfolio,
        "factor_rmse":     round(factor_rmse, 6),
        "max_sector_diff": round(max_sector_diff, 4),
    }

    await db.upsert_portfolio_run(slot, etf_ticker, payload)
    _set_status(slot, "done", "Pipeline complete", 100)
    return {"slot": slot, "ticker": etf_ticker, **payload}
