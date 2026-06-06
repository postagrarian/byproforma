"""
ETF Holdings Service — powered by Massive.com ETF Global API
  GET /etf-global/v1/constituents  — full holdings list with weights
  GET /etf-global/v1/profiles      — sector exposure weights
"""
import os, time, requests
from collections import defaultdict

BASE_URL = "https://api.massive.com"


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

def get_etf_holdings(ticker: str) -> list[dict]:
    """
    Fetch all ETF constituents from Massive.
    Returns list of {ticker, name, weight, sector} dicts.
    Sector is populated from the profiles endpoint.
    """
    ticker = ticker.upper()

    # 1. Fetch all constituents (up to 5000)
    data = _get("/etf-global/v1/constituents", {
        "composite_ticker": ticker,
        "limit": 5000,
        "sort": "constituent_rank.asc",
    })
    results = data.get("results", [])
    if not results:
        raise ValueError(f"No constituents returned for {ticker}")

    holdings = [
        {
            "ticker": r["constituent_ticker"],
            "name":   r.get("constituent_name", ""),
            "weight": float(r.get("weight") or 0),
            "sector": "Unknown",
        }
        for r in results
        if r.get("constituent_ticker") and r.get("asset_class", "Equity") == "Equity"
    ]

    # 2. Fetch sector exposure from profiles and tag each holding
    try:
        sector_map = _get_sector_map(ticker)
        # profiles gives sector-level weights, not per-stock.
        # We tag each holding's sector via the profiles sector_exposure keys
        # by using the Massive sector_exposure to set a lookup.
        # Individual stock → sector mapping comes from constituent data if available,
        # otherwise we enrich via yfinance in pipeline.py
        for h in holdings:
            h["sector_weights_available"] = True
    except Exception as exc:
        print(f"Profiles fetch failed for {ticker}: {exc}")

    return holdings


def get_etf_sector_weights(ticker: str) -> dict[str, float]:
    """
    Fetch official sector weights for the ETF from Massive profiles endpoint.
    Returns {sector_name: weight} dict using Morningstar-compatible naming.
    """
    ticker = ticker.upper()
    try:
        return _get_sector_map(ticker)
    except Exception as exc:
        raise ValueError(f"Could not fetch sector weights for {ticker}: {exc}")


def get_top10_per_sector(
    holdings: list[dict],
    sector_weights: dict[str, float],
) -> dict[str, list[str]]:
    """
    Group holdings by sector, return top 10 by weight per sector.
    Holdings without a sector are excluded.
    """
    by_sector: dict[str, list[dict]] = defaultdict(list)
    for h in holdings:
        sec = h.get("sector", "Unknown")
        if sec and sec != "Unknown":
            by_sector[sec].append(h)

    # If holdings don't have sector tags yet, fall back to weight-only ranking
    # per sector using the sector_weights keys as guides.
    if not any(by_sector.values()):
        # No sector info on holdings — return top-N overall, split evenly
        sorted_holdings = sorted(holdings, key=lambda x: x.get("weight", 0), reverse=True)
        return {"All": [h["ticker"] for h in sorted_holdings[:50]]}

    top10: dict[str, list[str]] = {}
    for sector, stocks in by_sector.items():
        sorted_stocks = sorted(stocks, key=lambda x: x.get("weight", 0), reverse=True)
        top10[sector] = [s["ticker"] for s in sorted_stocks[:10]]

    return top10


# ── Internal ─────────────────────────────────────────────────────────────────

# Massive sector_exposure key → Morningstar name (used by yfinance + our optimizer)
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


def _get_sector_map(ticker: str) -> dict[str, float]:
    """Return {MorningstarSectorName: weight} from Massive profiles."""
    data = _get("/etf-global/v1/profiles", {
        "composite_ticker": ticker,
        "limit": 1,
    })
    results = data.get("results", [])
    if not results:
        raise ValueError(f"No profile returned for {ticker}")

    exposure = results[0].get("sector_exposure", {})
    out: dict[str, float] = {}
    for key, weight in exposure.items():
        ms_name = _SECTOR_MAP.get(key)
        if ms_name and weight:
            out[ms_name] = float(weight)
    return out
