"""
ETF Holdings Service — Massive.com ETF Global API + yfinance sectors

Flow:
  1. GET /etf-global/v1/constituents  — full holdings list with weights/ranks
  2. GET /etf-global/v1/profiles       — ETF-level sector exposure weights
  3. yfinance.Ticker.info              — sector label per constituent stock
"""
import os, time, requests
import yfinance as yf
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_URL = "https://api.massive.com"

# Massive profiles sector keys → Morningstar names (used by yfinance + optimizer)
_SECTOR_MAP = {
    "technology":             "Technology",
    "financials":             "Financial Services",
    "health_care":            "Healthcare",
    "consumer_discretionary": "Consumer Cyclical",
    "consumer_staples":       "Consumer Defensive",
    "communication_services": "Communication Services",
    "communications":         "Communication Services",
    "industrials":            "Industrials",
    "energy":                 "Energy",
    "materials":              "Basic Materials",
    "real_estate":            "Real Estate",
    "utilities":              "Utilities",
}


def _get(path: str, params: dict) -> dict:
    key = os.environ["MASSIVE_API_KEY"]
    resp = requests.get(
        f"{BASE_URL}{path}",
        params={"apiKey": key, **params},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


# ── Public interface ──────────────────────────────────────────────────────────

def get_etf_holdings(ticker: str, top_n: int = 150) -> list[dict]:
    """
    Fetch top_n ETF equity constituents from Massive, then enrich each
    stock with its sector via yfinance.
    Returns list of {ticker, name, weight, sector} dicts.
    """
    ticker = ticker.upper()

    data = _get("/etf-global/v1/constituents", {
        "composite_ticker": ticker,
        "limit":            top_n,
    })
    results = data.get("results", [])
    if not results:
        raise ValueError(f"No constituents returned for {ticker} from Massive")

    holdings = [
        {
            "ticker": r["constituent_ticker"],
            "name":   r.get("constituent_name", ""),
            "weight": float(r.get("weight") or 0),
            "sector": "Unknown",
        }
        for r in results
        if r.get("constituent_ticker")
        and r.get("asset_class", "Equity") in ("Equity", "", None)
    ]

    # Enrich with yfinance sector labels (batched to respect rate limits)
    holdings = _enrich_sectors(holdings)
    return holdings


def get_etf_sector_weights(ticker: str) -> dict[str, float]:
    """
    Fetch official ETF sector weights from Massive profiles endpoint.
    Returns {MorningstarSectorName: weight}.
    """
    ticker = ticker.upper()
    data = _get("/etf-global/v1/profiles", {
        "composite_ticker": ticker,
        "limit":            1,
    })
    results = data.get("results", [])
    if not results:
        raise ValueError(f"No profile returned for {ticker} from Massive")

    exposure = results[0].get("sector_exposure", {})
    out: dict[str, float] = {}
    for key, weight in exposure.items():
        ms_name = _SECTOR_MAP.get(key)
        if ms_name and weight:
            out[ms_name] = float(weight)
    return out


def get_top10_per_sector(
    holdings: list[dict],
    sector_weights: dict[str, float],
) -> dict[str, list[str]]:
    """
    Group holdings by sector, return top 10 by weight per sector.
    Only includes sectors that appear in sector_weights (the ETF's known sectors).
    """
    by_sector: dict[str, list[dict]] = defaultdict(list)
    for h in holdings:
        sec = h.get("sector", "Unknown")
        if sec and sec != "Unknown":
            by_sector[sec].append(h)

    top10: dict[str, list[str]] = {}
    for sector in sector_weights:
        stocks = by_sector.get(sector, [])
        if not stocks:
            continue
        sorted_stocks = sorted(stocks, key=lambda x: x.get("weight", 0), reverse=True)
        top10[sector] = [s["ticker"] for s in sorted_stocks[:10]]

    return top10


# ── Internal ──────────────────────────────────────────────────────────────────

def _fetch_sector(ticker: str) -> tuple[str, str]:
    """Fetch sector for a single ticker. Returns (ticker, sector)."""
    try:
        info = yf.Ticker(ticker).info
        sector = info.get("sector") or info.get("sectorKey") or "Unknown"
        return ticker, sector
    except Exception:
        return ticker, "Unknown"


def _enrich_sectors(holdings: list[dict], max_workers: int = 12) -> list[dict]:
    """
    Add yfinance sector label to each holding using a thread pool.
    Parallel fetching cuts ~150 stocks from ~75s sequential to ~10-15s.
    """
    tickers = [h["ticker"] for h in holdings]
    sector_map: dict[str, str] = {}

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_fetch_sector, tk): tk for tk in tickers}
        for future in as_completed(futures):
            tk, sector = future.result()
            sector_map[tk] = sector

    for h in holdings:
        h["sector"] = sector_map.get(h["ticker"], "Unknown")

    return holdings
