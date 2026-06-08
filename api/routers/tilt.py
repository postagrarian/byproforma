from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from db.supabase import get_client
import asyncio
from concurrent.futures import ThreadPoolExecutor

router    = APIRouter()
_executor = ThreadPoolExecutor(max_workers=3)


class TiltRunRequest(BaseModel):
    foundational_slot: int
    factor_targets:    dict
    optimization_mode: str


class SaveTiltRequest(BaseModel):
    name: str


@router.post("/run")
async def run_tilt(body: TiltRunRequest):
    if body.foundational_slot < 1 or body.foundational_slot > 5:
        raise HTTPException(status_code=400, detail="foundational_slot must be 1–5")
    if body.optimization_mode not in ("factor_betas", "sector_exposure"):
        raise HTTPException(status_code=400, detail="Invalid optimization_mode")
    from services.tilt_pipeline import run_tilt_sync
    loop = asyncio.get_event_loop()
    loop.run_in_executor(_executor, run_tilt_sync,
                         body.foundational_slot, body.factor_targets, body.optimization_mode)
    return {"status": "started"}


@router.get("/status")
def get_tilt_status():
    from services.tilt_pipeline import get_tilt_status
    return get_tilt_status()


@router.get("/latest")
def get_latest_tilt():
    sb  = get_client()
    res = (sb.table("tilt_portfolio_runs")
             .select("*")
             .order("created_at", desc=True)
             .limit(1)
             .execute())
    if not res.data:
        raise HTTPException(status_code=404, detail="No tilt runs yet")
    return res.data[0]


@router.get("/saved")
def get_saved_tilts():
    sb  = get_client()
    res = (sb.table("tilt_portfolio_runs")
             .select("*")
             .eq("is_saved", True)
             .order("created_at", desc=True)
             .execute())
    return res.data or []


@router.patch("/{run_id}/save")
def save_tilt(run_id: int, body: SaveTiltRequest):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    sb = get_client()
    res = sb.table("tilt_portfolio_runs").update({
        "is_saved": True,
        "name":     name,
    }).eq("id", run_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Run not found")
    return res.data[0]


@router.get("/{run_id}/stats")
def get_portfolio_stats(run_id: int, refresh: bool = False):
    """
    Trailing portfolio statistics vs the foundational ETF.
    Computed once and cached in tilt_portfolio_runs; pass ?refresh=true to recompute.

    Active Return(t)  = r_portfolio(t) - r_ETF(t)
    Alpha             = mean(Active Return) * 12       (annualised)
    Tracking Error    = std(Active Return)  * sqrt(12) (annualised)
    Information Ratio = Alpha / Tracking Error
    """
    import numpy as np
    import pandas as pd

    sb  = get_client()
    run = sb.table("tilt_portfolio_runs") \
              .select("portfolio, foundational_ticker, alpha, tracking_error, information_ratio, stats_n_months") \
              .eq("id", run_id).single().execute()
    if not run.data:
        raise HTTPException(status_code=404, detail="Run not found")

    # Return cached stats if available and refresh not requested
    if not refresh and run.data.get("alpha") is not None:
        return {
            "alpha":             run.data["alpha"],
            "tracking_error":    run.data["tracking_error"],
            "information_ratio": run.data["information_ratio"],
            "n_months":          run.data["stats_n_months"],
            "cached":            True,
        }

    portfolio  = run.data.get("portfolio") or []
    etf_ticker = run.data["foundational_ticker"]
    weights    = {h["ticker"]: float(h.get("weight", 0)) for h in portfolio}

    # Fetch monthly returns from Supabase
    all_tickers  = list(weights.keys()) + [etf_ticker]
    returns_map: dict[str, dict] = {}

    for tk in all_tickers:
        res = (sb.table("price_history")
                 .select("date, monthly_return")
                 .eq("ticker", tk)
                 .order("date")
                 .execute())
        if res.data:
            returns_map[tk] = {r["date"]: float(r["monthly_return"] or 0) for r in res.data}

    if etf_ticker not in returns_map:
        raise HTTPException(status_code=422, detail="No price history for foundational ETF")

    available = [tk for tk in weights if tk in returns_map]
    if not available:
        raise HTTPException(status_code=422, detail="No price history for portfolio holdings")

    date_sets    = [set(returns_map[etf_ticker].keys())] + [set(returns_map[tk].keys()) for tk in available]
    common_dates = sorted(set.intersection(*date_sets))

    if len(common_dates) < 12:
        raise HTTPException(status_code=422,
            detail=f"Only {len(common_dates)} common months — need ≥12")

    # Use the most recent 36 months — matches the beta estimation window
    common_dates = common_dates[-36:]

    w_total  = sum(weights.get(tk, 0) for tk in available)
    port_ret = pd.Series({
        d: sum(weights[tk] / w_total * returns_map[tk][d] for tk in available)
        for d in common_dates
    })
    etf_ret = pd.Series({d: returns_map[etf_ticker][d] for d in common_dates})
    active  = port_ret - etf_ret

    alpha          = round(float(active.mean() * 12), 4)
    tracking_error = round(float(active.std() * np.sqrt(12)), 4)
    info_ratio     = round(alpha / tracking_error, 4) if tracking_error > 0 else 0.0
    n_months       = len(common_dates)

    # Cache to Supabase
    sb.table("tilt_portfolio_runs").update({
        "alpha":             alpha,
        "tracking_error":    tracking_error,
        "information_ratio": info_ratio,
        "stats_n_months":    n_months,
    }).eq("id", run_id).execute()

    return {
        "alpha":             alpha,
        "tracking_error":    tracking_error,
        "information_ratio": info_ratio,
        "n_months":          n_months,
        "cached":            False,
    }


@router.get("/{run_id}/corrections")
def get_factor_corrections(run_id: int, n: int = 5):
    """
    Find up to n securities to add long or short to push the tilt portfolio's
    factor profile back toward the foundational ETF.

    Scoring:
      deviation  = β_portfolio − β_ETF          (vector of factor overweights)
      long_score = −dot(β_i − β_ETF, deviation)  high → security pulls toward ETF
      short_score =  dot(β_i − β_ETF, deviation)  high → security amplifies tilt, short reduces it
    """
    import numpy as np

    FCOLS  = ["beta_mkt", "beta_smb", "beta_hml", "beta_rmw", "beta_cma", "beta_mom"]
    FNAMES = ["Mkt-RF",  "SMB",      "HML",      "RMW",      "CMA",      "Mom"]

    sb  = get_client()
    run = (sb.table("tilt_portfolio_runs")
             .select("portfolio, foundational_ticker, factor_loadings")
             .eq("id", run_id).single().execute())
    if not run.data:
        raise HTTPException(status_code=404, detail="Run not found")

    portfolio      = run.data.get("portfolio") or []
    etf_ticker     = run.data["foundational_ticker"]
    held_tickers   = {h["ticker"] for h in portfolio}

    # ── Portfolio weighted beta vector ────────────────────────────────────────
    port_betas = np.zeros(6)
    for h in portfolio:
        w = float(h.get("weight") or 0)
        b = np.array([float(h.get(k) or 0) for k in
                      ["betaMkt","betaSmb","betaHml","betaRmw","betaCma","betaMom"]])
        port_betas += w * b

    # ── ETF beta vector from stored factor_loadings ───────────────────────────
    fl = run.data.get("factor_loadings") or []
    etf_betas = np.array([
        float(next((r.get("etfBeta") for r in fl if r.get("factor") == fn), 0.0) or 0.0)
        for fn in FNAMES
    ])

    deviation      = port_betas - etf_betas
    deviation_norm = np.linalg.norm(deviation)
    if deviation_norm < 1e-6:
        return {"long": [], "short": [], "message": "Portfolio already aligned with ETF"}
    deviation_unit = deviation / deviation_norm

    # ── Fetch universe of candidates from factor_loadings cache ───────────────
    # Latest window per ticker (sub-select to get distinct tickers)
    raw = (sb.table("factor_loadings")
             .select("ticker, window_end_date, beta_mkt, beta_smb, beta_hml, beta_rmw, beta_cma, beta_mom")
             .order("window_end_date", desc=True)
             .limit(2000)
             .execute())

    from services.holdings import _is_us_ticker

    # De-duplicate: keep most recent per ticker, exclude non-US and current holdings
    seen: set[str] = set()
    candidates = []
    for row in (raw.data or []):
        tk = row["ticker"]
        if tk in seen or tk in held_tickers or tk == etf_ticker:
            continue
        if not _is_us_ticker(tk):
            continue
        seen.add(tk)
        beta_i = np.array([float(row.get(c) or 0) for c in FCOLS])
        rel    = beta_i - etf_betas                        # relative to ETF
        long_s  = float(-np.dot(rel, deviation_unit))     # want high → pulls toward ETF
        short_s = float( np.dot(rel, deviation_unit))     # want high → amplifies tilt, short reduces

        # Primary factor this security most helps correct (for each direction)
        primary_long  = FNAMES[int(np.argmax(-rel * deviation_unit))]
        primary_short = FNAMES[int(np.argmax( rel * deviation_unit))]

        candidates.append({
            "ticker":        tk,
            "beta_mkt":      round(float(beta_i[0]), 4),
            "beta_smb":      round(float(beta_i[1]), 4),
            "beta_hml":      round(float(beta_i[2]), 4),
            "beta_rmw":      round(float(beta_i[3]), 4),
            "beta_cma":      round(float(beta_i[4]), 4),
            "beta_mom":      round(float(beta_i[5]), 4),
            "long_score":    round(long_s,  4),
            "short_score":   round(short_s, 4),
            "primary_long":  primary_long,
            "primary_short": primary_short,
        })

    # Sort and take top n for each direction
    long_cands  = sorted(candidates, key=lambda x: -x["long_score"])[:n]
    short_cands = sorted(candidates, key=lambda x: -x["short_score"])[:n]

    # Build ticker → name and sector maps from cached portfolio holdings
    all_tickers = list({c["ticker"] for c in long_cands + short_cands})
    sector_map: dict[str, str] = {}
    name_map:   dict[str, str] = {}

    # ticker_sectors now stores both sector AND name — single query covers both
    if all_tickers:
        sec_res = sb.table("ticker_sectors").select("ticker, sector, name") \
                    .in_("ticker", all_tickers).execute()
        for r in (sec_res.data or []):
            sector_map[r["ticker"]] = r["sector"]
            if r.get("name"):
                name_map[r["ticker"]] = r["name"]

    # Supplement names from portfolio run holdings for any still missing
    still_missing = [t for t in all_tickers if t not in name_map]
    if still_missing:
        for table in ("portfolio_runs", "tilt_portfolio_runs"):
            runs = sb.table(table).select("portfolio") \
                     .order("created_at", desc=True).limit(10).execute()
            for run in (runs.data or []):
                for h in (run.get("portfolio") or []):
                    tk = h.get("ticker", "")
                    if tk in still_missing and h.get("name"):
                        name_map[tk] = h["name"]

    # For anything still missing — fetch from FMP profile in parallel and cache
    still_missing = [t for t in all_tickers if t not in name_map]
    if still_missing:
        from services.holdings import _fetch_sector_fmp
        from concurrent.futures import ThreadPoolExecutor, as_completed
        new_cache_rows = []
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {pool.submit(_fetch_sector_fmp, tk): tk for tk in still_missing}
            for f in as_completed(futures):
                tk, sector, name = f.result()
                if name:
                    name_map[tk] = name
                    new_cache_rows.append({
                        "ticker": tk,
                        "sector": sector_map.get(tk, sector),
                        "name":   name,
                    })
        if new_cache_rows:
            try:
                sb.table("ticker_sectors").upsert(
                    new_cache_rows, on_conflict="ticker"
                ).execute()
            except Exception:
                pass

    def enrich(cands):
        for c in cands:
            c["sector"] = sector_map.get(c["ticker"], "—")
            c["name"]   = name_map.get(c["ticker"], "")
        return cands

    return {
        "deviation":   {fn: round(float(d), 4) for fn, d in zip(FNAMES, deviation)},
        "long":        enrich(long_cands),
        "short":       enrich(short_cands),
    }


@router.get("/live")
def get_live_portfolio():
    """Return the currently designated Live Portfolio, or 404 if none set."""
    sb  = get_client()
    res = (sb.table("tilt_portfolio_runs")
             .select("*")
             .eq("is_live", True)
             .eq("is_saved", True)
             .limit(1)
             .execute())
    if not res.data:
        raise HTTPException(status_code=404, detail="No live portfolio set")
    return res.data[0]


@router.patch("/{run_id}/set-live")
def set_live_portfolio(run_id: int):
    """Designate one saved portfolio as Live — clears the flag on all others first."""
    sb = get_client()
    # Verify it exists and is saved
    run = sb.table("tilt_portfolio_runs").select("id, name").eq("id", run_id).single().execute()
    if not run.data:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    from datetime import datetime, timezone
    # Clear existing live flag
    sb.table("tilt_portfolio_runs").update({"is_live": False, "live_since": None}).eq("is_live", True).execute()
    # Set new live — record when it was designated so the cron can guard same-day starts
    sb.table("tilt_portfolio_runs").update({
        "is_live":    True,
        "live_since": datetime.now(timezone.utc).isoformat(),
    }).eq("id", run_id).execute()
    return {"live_portfolio_id": run_id, "name": run.data["name"]}


@router.patch("/{run_id}/unset-live")
def unset_live_portfolio(run_id: int):
    """Remove the Live designation from a portfolio."""
    sb = get_client()
    sb.table("tilt_portfolio_runs").update({"is_live": False, "live_since": None}).eq("id", run_id).execute()
    return {"live_portfolio_id": None}


@router.delete("/{run_id}")
def delete_tilt(run_id: int):
    sb = get_client()
    sb.table("tilt_portfolio_runs").delete().eq("id", run_id).execute()
    return {"deleted": run_id}


@router.get("/{run_id}/positions")
def get_positions(run_id: int, portfolio_value: float):
    """
    Return portfolio holdings enriched with last price, dollar value, and share count
    for a given total portfolio value.
    """
    sb  = get_client()
    res = sb.table("tilt_portfolio_runs").select("portfolio").eq("id", run_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Run not found")

    portfolio = res.data.get("portfolio") or []
    tickers   = [h["ticker"] for h in portfolio if h.get("ticker")]

    # Batch-fetch last prices from FMP
    prices = _fetch_last_prices(tickers)

    positions = []
    for h in portfolio:
        tk          = h["ticker"]
        weight      = float(h.get("weight", 0))
        last_price  = prices.get(tk)
        dollar_val  = round(portfolio_value * weight, 2)
        # Round to nearest 10 shares; use minimum lot of 10 if rounding hits 0
        # (investor uses margin — all positions are filled regardless of overage)
        if last_price:
            raw    = dollar_val / last_price
            shares = max(10, round(raw / 10) * 10)
            mkt_val = round(shares * last_price, 2)
        else:
            shares  = None
            mkt_val = None
        positions.append({
            "ticker":       tk,
            "name":         h.get("name", ""),
            "sector":       h.get("sector", ""),
            "weight":       weight,
            "dollar_value": dollar_val,
            "last_price":   last_price,
            "shares":       shares,
            "market_value": mkt_val,
        })

    # Sort by dollar value descending
    positions.sort(key=lambda x: x["dollar_value"], reverse=True)
    return {"positions": positions, "portfolio_value": portfolio_value}


def _fetch_last_prices(tickers: list[str]) -> dict[str, float]:
    """Fetch last traded prices from FMP for a list of tickers."""
    import os, requests
    from concurrent.futures import ThreadPoolExecutor, as_completed

    api_key  = os.environ.get("FMP_API_KEY", "")
    base     = "https://financialmodelingprep.com/stable"
    price_map: dict[str, float] = {}

    def fetch_one(tk: str) -> tuple[str, float | None]:
        try:
            r = requests.get(
                f"{base}/profile",
                params={"symbol": tk, "apikey": api_key},
                timeout=10,
            )
            data = r.json()
            if data and isinstance(data, list):
                return tk, float(data[0].get("price") or 0) or None
        except Exception:
            pass
        return tk, None

    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(fetch_one, tk): tk for tk in tickers}
        for f in as_completed(futures):
            tk, price = f.result()
            if price:
                price_map[tk] = price

    return price_map
