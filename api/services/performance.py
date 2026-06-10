"""
Daily portfolio performance service.

Fetches end-of-day prices from FMP for all Live Portfolio holdings
plus two benchmarks (VOO and the Foundational ETF), computes daily
% returns, identifies top 3 gainers and losers, and calculates the
cumulative return indexed to 100 from the inception date.
"""
import os
import requests
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta

FMP_URL = "https://financialmodelingprep.com/stable"

# SPDR sector ETF proxies — keyed by FMP sector name
SECTOR_ETFS: dict[str, str] = {
    "Technology":             "XLK",
    "Healthcare":             "XLV",
    "Energy":                 "XLE",
    "Financial Services":     "XLF",
    "Consumer Cyclical":      "XLY",
    "Consumer Defensive":     "XLP",
    "Industrials":            "XLI",
    "Real Estate":            "XLRE",
    "Utilities":              "XLU",
    "Communication Services": "XLC",
    "Basic Materials":        "XLB",
}


def _fmp_daily_return(ticker: str, today: str, yesterday: str) -> tuple[str, float | None]:
    """Fetch dividend-adjusted close for today and yesterday, return daily %."""
    try:
        key  = os.environ.get("FMP_API_KEY", "")
        resp = requests.get(
            f"{FMP_URL}/historical-price-eod/dividend-adjusted",
            params={"symbol": ticker, "from": yesterday, "to": today, "apikey": key},
            timeout=12,
        )
        data = sorted(resp.json(), key=lambda x: x["date"])
        if len(data) >= 2 and data[-1].get("adjClose") and data[-2].get("adjClose"):
            ret = (data[-1]["adjClose"] / data[-2]["adjClose"]) - 1
            return ticker, round(float(ret), 6)
        if len(data) == 1:
            return ticker, 0.0   # only one day of data — no change
    except Exception as exc:
        print(f"[performance] Price fetch failed for {ticker}: {exc}")
    return ticker, None


def _fmp_sector(ticker: str) -> tuple[str, str | None]:
    try:
        key  = os.environ.get("FMP_API_KEY", "")
        # v3 profile endpoint — stable API doesn't carry sector data reliably
        resp = requests.get(
            f"https://financialmodelingprep.com/api/v3/profile/{ticker}",
            params={"apikey": key},
            timeout=10,
        )
        data = resp.json()
        if isinstance(data, list) and data:
            return ticker, data[0].get("sector")
    except Exception as exc:
        print(f"[performance] Sector fetch failed for {ticker}: {exc}")
    return ticker, None


def fetch_returns(tickers: list[str], today: str, yesterday: str,
                  max_workers: int = 10) -> dict[str, float | None]:
    """Batch-fetch daily returns for all tickers in parallel."""
    results: dict[str, float | None] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_fmp_daily_return, tk, today, yesterday): tk
                   for tk in tickers}
        for f in as_completed(futures):
            tk, ret = f.result()
            results[tk] = ret
    return results


def fetch_sectors(tickers: list[str], max_workers: int = 10) -> dict[str, str | None]:
    """Batch-fetch GICS sector for all tickers in parallel."""
    results: dict[str, str | None] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_fmp_sector, tk): tk for tk in tickers}
        for f in as_completed(futures):
            tk, sector = f.result()
            results[tk] = sector
    return results


def fetch_etf_sector_weights(etf_ticker: str) -> list[dict]:
    """Fetch sector weightings for an ETF from FMP."""
    try:
        key  = os.environ.get("FMP_API_KEY", "")
        resp = requests.get(
            f"{FMP_URL}/etf-sector-weightings",
            params={"symbol": etf_ticker, "apikey": key},
            timeout=10,
        )
        data = resp.json()
        if isinstance(data, list):
            return [
                {
                    "sector": row["sector"],
                    "weight": round(float(row["weightPercentage"]) / 100, 4),
                }
                for row in data
                if row.get("sector") and row.get("weightPercentage")
            ]
    except Exception as exc:
        print(f"[performance] ETF sector fetch failed for {etf_ticker}: {exc}")
    return []


def compute_daily_performance(
    live_run: dict,
    trade_date: str | None = None,
) -> dict:
    """
    Calculate end-of-day performance for the Live Portfolio.

    Weights drift daily: each day's return is computed using the prior
    close's drifted weights, not the static inception weights. A new live
    portfolio resets both the drifted weights and the cumulative index.

    live_run: a tilt_portfolio_runs row with portfolio, foundational_ticker, name, id.
    trade_date: YYYY-MM-DD string (defaults to today ET).

    Returns a dict ready to upsert into portfolio_performance.
    """
    from db.supabase import get_client
    from datetime import datetime
    from zoneinfo import ZoneInfo

    ET    = ZoneInfo("America/New_York")
    today = trade_date or datetime.now(ET).strftime("%Y-%m-%d")
    yesterday = (date.fromisoformat(today) - timedelta(days=1)).strftime("%Y-%m-%d")
    d = date.fromisoformat(yesterday)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    yesterday = d.strftime("%Y-%m-%d")

    holdings   = live_run.get("portfolio") or []
    etf_ticker = live_run.get("foundational_ticker", "")
    port_name  = live_run.get("name", "Live Portfolio")
    port_id    = live_run.get("id")

    holding_tickers = [h["ticker"] for h in holdings]
    spdr_tickers    = list(SECTOR_ETFS.values())
    all_tickers     = list(set(holding_tickers + ["VOO", etf_ticker] + spdr_tickers))

    print(f"[performance] Fetching prices for {len(all_tickers)} tickers ({today})")

    # Use sectors stored in portfolio items; only call FMP for any that are missing
    stored_sectors = {h["ticker"]: h.get("sector") for h in holdings if h.get("sector")}
    needs_sector   = [h["ticker"] for h in holdings if not h.get("sector")]
    if needs_sector:
        with ThreadPoolExecutor(max_workers=2) as outer:
            f_returns = outer.submit(fetch_returns, all_tickers, today, yesterday)
            f_sectors = outer.submit(fetch_sectors, needs_sector)
            returns    = f_returns.result()
            sector_map = {**stored_sectors, **f_sectors.result()}
    else:
        returns    = fetch_returns(all_tickers, today, yesterday)
        sector_map = stored_sectors

    # ── Load previous state ───────────────────────────────────────────────────
    sb = get_client()
    prev = (sb.table("portfolio_performance")
              .select("cumulative_return, drifted_weights, live_portfolio_id")
              .order("date", desc=True)
              .limit(1)
              .execute())

    prev_data      = prev.data[0] if prev.data else {}
    same_portfolio = prev_data.get("live_portfolio_id") == port_id

    # Reset cumulative and weights when the live portfolio changes
    prev_cumulative = float(prev_data["cumulative_return"]) if same_portfolio and prev_data.get("cumulative_return") else 100.0

    # Beginning-of-day weights: yesterday's drifted if same portfolio, else inception
    if same_portfolio and prev_data.get("drifted_weights"):
        bod_weights = {item["ticker"]: item["weight"] for item in prev_data["drifted_weights"]}
    else:
        bod_weights = {h["ticker"]: h["weight"] for h in holdings}

    # ── Portfolio return (weighted by beginning-of-day drifted weights) ───────
    # Missing prices are treated as flat (0.0) so weights remain coherent
    portfolio_return = 0.0
    holding_returns  = []
    for h in holdings:
        tk  = h["ticker"]
        ret = returns.get(tk)
        w   = bod_weights.get(tk, h["weight"])
        portfolio_return += w * (ret if ret is not None else 0.0)
        if ret is not None:
            holding_returns.append({
                "ticker":     tk,
                "name":       h.get("name", ""),
                "return_pct": round(ret * 100, 3),
            })

    sp500_return = returns.get("VOO")
    etf_return   = returns.get(etf_ticker)

    # ── Advance / Decline ─────────────────────────────────────────────────────
    advances  = sum(1 for hr in holding_returns if hr["return_pct"] > 0)
    declines  = sum(1 for hr in holding_returns if hr["return_pct"] < 0)
    unchanged = sum(1 for hr in holding_returns if hr["return_pct"] == 0)

    # ── End-of-day drifted weights ────────────────────────────────────────────
    eod_values  = {
        h["ticker"]: bod_weights.get(h["ticker"], h["weight"]) * (1 + (returns.get(h["ticker"]) or 0.0))
        for h in holdings
    }
    total_eod      = sum(eod_values.values()) or 1.0
    drifted_weights = [
        {"ticker": tk, "weight": round(v / total_eod, 6)}
        for tk, v in eod_values.items()
    ]
    eod_weights = {item["ticker"]: item["weight"] for item in drifted_weights}

    # ── Sector breakdown ──────────────────────────────────────────────────────
    # Return uses bod weights (what drove today's P&L); display weight is eod
    buckets: dict[str, dict] = defaultdict(lambda: {"bod_weight": 0.0, "eod_weight": 0.0, "wt_return": 0.0})
    for h in holdings:
        tk     = h["ticker"]
        sector = h.get("sector") or sector_map.get(tk) or "Other"
        w_bod  = bod_weights.get(tk, h["weight"])
        w_eod  = eod_weights.get(tk, h["weight"])
        ret    = returns.get(tk)
        buckets[sector]["bod_weight"] += w_bod
        buckets[sector]["eod_weight"] += w_eod
        buckets[sector]["wt_return"]  += w_bod * (ret if ret is not None else 0.0)

    portfolio_sectors = []
    for sector, data in sorted(buckets.items(), key=lambda x: -x[1]["eod_weight"]):
        w_bod   = data["bod_weight"]
        ret_val = data["wt_return"] / w_bod if w_bod > 0 else 0.0
        portfolio_sectors.append({
            "sector":     sector,
            "weight":     round(data["eod_weight"], 4),
            "return_pct": round(ret_val * 100, 3),
        })

    etf_sectors = [
        {
            "sector":           sector,
            "benchmark_ticker": spdr,
            "return_pct":       round(returns[spdr] * 100, 3) if returns.get(spdr) is not None else None,
        }
        for sector, spdr in SECTOR_ETFS.items()
        if returns.get(spdr) is not None
    ]
    sector_data = {"portfolio": portfolio_sectors, "etf": etf_sectors}

    # ── Top 3 gainers and losers ──────────────────────────────────────────────
    sorted_h    = sorted(holding_returns, key=lambda x: x["return_pct"], reverse=True)
    top_gainers = sorted_h[:3]
    top_losers  = sorted_h[-3:][::-1]

    # ── Cumulative return (indexed to 100 at inception) ───────────────────────
    cumulative = round(prev_cumulative * (1 + portfolio_return), 4)

    print(f"[performance] Portfolio: {portfolio_return*100:+.3f}%  "
          f"VOO: {(sp500_return or 0)*100:+.3f}%  "
          f"{etf_ticker}: {(etf_return or 0)*100:+.3f}%  "
          f"Cumulative: {cumulative:.2f}  "
          f"A/D: {advances}/{declines}  "
          f"{'(new portfolio — weights reset)' if not same_portfolio else ''}")

    return {
        "date":                today,
        "live_portfolio_id":   port_id,
        "live_portfolio_name": port_name,
        "foundational_ticker": etf_ticker,
        "portfolio_return":    round(portfolio_return, 6),
        "sp500_return":        round(sp500_return, 6) if sp500_return is not None else None,
        "etf_return":          round(etf_return, 6)   if etf_return   is not None else None,
        "top_gainers":         top_gainers,
        "top_losers":          top_losers,
        "cumulative_return":   cumulative,
        "advances":            advances,
        "declines":            declines,
        "unchanged":           unchanged,
        "sector_data":         sector_data,
        "drifted_weights":     drifted_weights,
    }
