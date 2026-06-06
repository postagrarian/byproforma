"""
Full pipeline for one ETF slot — synchronous, runs in a thread pool.
All blocking I/O (yfinance, requests, Supabase) runs in a thread so the
FastAPI event loop stays free for health checks and status polls.

Status is persisted to Supabase so container restarts don't lose progress.
"""
from datetime import date, timedelta

import numpy as np
import pandas as pd

from db import supabase as db
from services import holdings  as svc_holdings
from services import prices    as svc_prices
from services import factors   as svc_factors
from services import regression as svc_reg
from services import optimizer  as svc_opt

START_DATE = "2010-01-01"


# ── Status (Supabase-backed so restarts don't lose it) ──────────────────────

def get_pipeline_status(slot: int) -> dict:
    try:
        sb = db.get_client()
        res = (
            sb.table("pipeline_status")
            .select("*")
            .eq("slot", slot)
            .single()
            .execute()
        )
        return res.data or _idle(slot)
    except Exception:
        return _idle(slot)


def _idle(slot: int) -> dict:
    return {"slot": slot, "stage": "idle", "message": "", "progress": 0}


def _set_status(slot: int, stage: str, message: str, progress: int):
    print(f"[slot {slot}] {stage} {progress}% — {message}")
    try:
        sb = db.get_client()
        sb.table("pipeline_status").upsert({
            "slot":     slot,
            "stage":    stage,
            "message":  message,
            "progress": progress,
        }).execute()
    except Exception as exc:
        print(f"[slot {slot}] Status write failed: {exc}")


# ── Main pipeline (synchronous) ──────────────────────────────────────────────

def run_pipeline_sync(slot: int) -> dict:
    """
    Synchronous pipeline — safe to run in a ThreadPoolExecutor.
    All Supabase calls use the sync client.
    """
    try:
        return _run(slot)
    except Exception as exc:
        import traceback
        msg = str(exc)
        print(f"[slot {slot}] PIPELINE ERROR: {msg}")
        traceback.print_exc()
        _set_status(slot, "error", msg, 0)
        raise


def _run(slot: int) -> dict:
    _set_status(slot, "holdings", "Fetching ETF config…", 5)

    sb  = db.get_client()
    cfg = sb.table("etf_config").select("*").eq("slot", slot).single().execute()
    if not cfg.data or not cfg.data.get("ticker"):
        raise ValueError(f"Slot {slot} is not configured")
    etf_ticker = cfg.data["ticker"]

    # ── 1. Holdings ───────────────────────────────────────────────────────────
    _set_status(slot, "holdings", f"Fetching {etf_ticker} holdings from FMP…", 10)
    raw_holdings = svc_holdings.get_etf_holdings(etf_ticker)
    etf_sectors  = svc_holdings.get_etf_sector_weights(etf_ticker)
    top10        = svc_holdings.get_top10_per_sector(raw_holdings, etf_sectors)
    universe_tix = list({tk for tks in top10.values() for tk in tks})

    ticker_sector = {
        tk: sector
        for sector, tks in top10.items()
        for tk in tks
    }
    ticker_name = {h["ticker"]: h.get("name", "") for h in raw_holdings}

    # ── 2. Factor data ────────────────────────────────────────────────────────
    _set_status(slot, "factors", "Loading FF5+Momentum factors…", 20)
    today = date.today()

    cached = sb.table("ff_factors").select("date").order("date", desc=True).limit(1).execute()
    last_factor_date = (
        pd.to_datetime(cached.data[0]["date"]).date() if cached.data else None
    )
    if not last_factor_date or last_factor_date < today - timedelta(days=45):
        factor_df   = svc_factors.fetch_factors(START_DATE)
        factor_rows = svc_factors.factors_to_rows(factor_df)
        for i in range(0, len(factor_rows), 500):
            sb.table("ff_factors").upsert(
                factor_rows[i : i + 500], on_conflict="date"
            ).execute()
    else:
        raw = sb.table("ff_factors").select("*").gte("date", START_DATE).order("date").execute()
        factor_df = svc_factors.rows_to_dataframe(raw.data)

    # ── 3. Price history ──────────────────────────────────────────────────────
    _set_status(slot, "prices", "Downloading price histories…", 35)
    all_tickers  = [etf_ticker] + universe_tix
    returns_dict: dict[str, pd.Series] = {}
    fresh_needed = []

    for tk in all_tickers:
        res = (
            sb.table("price_history")
            .select("date, monthly_return")
            .eq("ticker", tk)
            .gte("date", START_DATE)
            .order("date", desc=True)
            .limit(1)
            .execute()
        )
        if not res.data or pd.to_datetime(res.data[0]["date"]).date() < today - timedelta(days=45):
            fresh_needed.append(tk)
        else:
            full = (
                sb.table("price_history")
                .select("date, monthly_return")
                .eq("ticker", tk)
                .gte("date", START_DATE)
                .order("date")
                .execute()
            )
            returns_dict[tk] = svc_prices.rows_to_series(full.data)

    if fresh_needed:
        _set_status(slot, "prices", f"Downloading {len(fresh_needed)} tickers…", 40)
        new_returns = svc_prices.fetch_monthly_returns(fresh_needed, START_DATE)
        for tk in fresh_needed:
            if tk in new_returns.columns:
                series = new_returns[tk].dropna()
                rows   = svc_prices.returns_to_rows(tk, series)
                for i in range(0, len(rows), 500):
                    sb.table("price_history").upsert(
                        [{"ticker": tk, **r} for r in rows[i : i + 500]],
                        on_conflict="ticker,date",
                    ).execute()
                returns_dict[tk] = series

    # ── 4. Regressions ────────────────────────────────────────────────────────
    _set_status(slot, "regressions", "Running factor regressions…", 55)

    def to_ms(idx):
        return pd.DatetimeIndex([pd.Timestamp(d.year, d.month, 1) for d in idx])

    factor_df.index = to_ms(factor_df.index)
    betas_by_ticker: dict[str, dict] = {}

    for tk, series in returns_dict.items():
        series.index = to_ms(series.index)
        b = svc_reg.estimate_latest_betas(series, factor_df)
        if b:
            betas_by_ticker[tk] = b
            sb.table("factor_loadings").upsert({
                "ticker":          tk,
                "window_end_date": today.strftime("%Y-%m-%d"),
                **b,
            }, on_conflict="ticker,window_end_date").execute()

    if etf_ticker not in betas_by_ticker:
        raise ValueError(f"Could not estimate betas for {etf_ticker}")

    etf_betas = svc_reg.betas_to_array(betas_by_ticker[etf_ticker])

    # ── 5. Optimize ───────────────────────────────────────────────────────────
    _set_status(slot, "optimizing", "Optimising portfolio…", 75)
    universe = [
        {"ticker": tk, "name": ticker_name.get(tk, ""),
         "sector": ticker_sector.get(tk, "Unknown"), "r2": b["r2"], **b}
        for tk in universe_tix
        if (b := betas_by_ticker.get(tk))
    ]
    if not universe:
        raise ValueError("No universe tickers with valid betas")

    weights, factor_rmse = svc_opt.optimize(universe, etf_betas, etf_sectors)

    # ── 6. Build payload ──────────────────────────────────────────────────────
    _set_status(slot, "optimizing", "Building result payload…", 90)

    portfolio_items = [
        {
            "ticker":  u["ticker"],
            "name":    u.get("name", ""),
            "weight":  round(float(weights[i]), 4),
            "sector":  u["sector"],
            "r2":      round(u["r2"], 4),
            "betaMkt": round(u["beta_mkt"], 4),
            "betaSmb": round(u["beta_smb"], 4),
            "betaHml": round(u["beta_hml"], 4),
            "betaRmw": round(u["beta_rmw"], 4),
            "betaCma": round(u["beta_cma"], 4),
            "betaMom": round(u["beta_mom"], 4),
        }
        for i, u in enumerate(universe)
        if float(weights[i]) > 0.005
    ]

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

    port_sector_w: dict[str, float] = {}
    for item in portfolio_items:
        s = item["sector"]
        port_sector_w[s] = port_sector_w.get(s, 0.0) + item["weight"]

    sector_weights_list = [
        {
            "sector":          s,
            "etfWeight":       round(etf_sectors.get(s, 0.0), 4),
            "portfolioWeight": round(port_sector_w.get(s, 0.0), 4),
            "diff":            round(port_sector_w.get(s, 0.0) - etf_sectors.get(s, 0.0), 4),
        }
        for s in etf_sectors
    ]
    max_sector_diff = max((abs(r["diff"]) for r in sector_weights_list), default=0.0)

    payload = {
        "run_date":        today.strftime("%Y-%m-%d"),
        "sector_weights":  sector_weights_list,
        "factor_loadings": factor_loadings,
        "portfolio":       portfolio_items,
        "factor_rmse":     round(factor_rmse, 6),
        "max_sector_diff": round(max_sector_diff, 4),
    }

    sb.table("portfolio_runs").insert({
        "slot":            slot,
        "etf_ticker":      etf_ticker,
        **payload,
    }).execute()
    sb.table("etf_config").update({
        "last_run_date": today.strftime("%Y-%m-%d")
    }).eq("slot", slot).execute()

    _set_status(slot, "done", "Pipeline complete", 100)
    return {"slot": slot, "ticker": etf_ticker, **payload}
