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
        "sort":             "constituent_rank.asc",
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

def _enrich_sectors(holdings: list[dict], batch_size: int = 15) -> list[dict]:
    """
    Add yfinance sector label to each holding.
    Fetches in batches with a short sleep to avoid rate limiting.
    ~150 stocks takes roughly 30–60 seconds.
    """
    tickers = [h["ticker"] for h in holdings]
    sector_map: dict[str, str] = {}

    for i in range(0, len(tickers), batch_size):
        batch = tickers[i : i + batch_size]
        for tk in batch:
            try:
                info = yf.Ticker(tk).info
                sector = (
                    info.get("sector")
                    or info.get("sectorKey")
                    or "Unknown"
                )
                sector_map[tk] = sector
            except Exception:
                sector_map[tk] = "Unknown"
        time.sleep(1)

    for h in holdings:
        h["sector"] = sector_map.get(h["ticker"], "Unknown")

    return holdings
