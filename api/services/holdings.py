"""
Fetch ETF holdings from Polygon.io and return top-10 stocks per sector.
"""
import os, requests
from collections import defaultdict

POLYGON_BASE = "https://api.polygon.io"


def get_etf_holdings(ticker: str) -> list[dict]:
    """
    Returns all holdings for an ETF via Polygon /v3/reference/tickers/{ticker}/related_companies
    or the snapshot endpoint. Uses the ETF snapshot holdings endpoint.
    """
    api_key = os.environ["POLYGON_API_KEY"]
    url = f"{POLYGON_BASE}/v3/snapshot/options/{ticker.upper()}"

    # Primary: ETF holdings endpoint
    holdings_url = f"{POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers"
    etf_url = f"{POLYGON_BASE}/v3/reference/tickers/{ticker.upper()}/related_companies"

    # Use the ETF constituents endpoint
    resp = requests.get(
        f"{POLYGON_BASE}/v3/snapshot",
        params={
            "ticker.any_of": ticker.upper(),
            "apiKey": api_key,
        },
        timeout=30,
    )

    # Polygon ETF holdings — correct endpoint
    resp = requests.get(
        f"{POLYGON_BASE}/v3/reference/tickers",
        params={
            "type":    "ETF",
            "ticker":  ticker.upper(),
            "apiKey":  api_key,
        },
        timeout=30,
    )
    resp.raise_for_status()

    # Actual holdings endpoint for ETF constituents
    resp = requests.get(
        f"{POLYGON_BASE}/v2/aggs/grouped/locale/us/market/stocks/constituents/{ticker.upper()}",
        params={"apiKey": api_key},
        timeout=30,
    )

    if resp.status_code != 200:
        raise RuntimeError(f"Polygon holdings fetch failed: {resp.status_code} {resp.text[:200]}")

    data = resp.json()
    results = data.get("results", [])
    return results


def get_top10_per_sector(holdings: list[dict]) -> dict[str, list[str]]:
    """
    Group holdings by sector and return the top 10 by weight per sector.
    Holdings items expected to have: ticker, weight, sector (or we enrich via Polygon).
    """
    by_sector: dict[str, list[dict]] = defaultdict(list)
    for h in holdings:
        sector = h.get("sector") or h.get("sic_description") or "Unknown"
        by_sector[sector].append(h)

    top10: dict[str, list[str]] = {}
    for sector, stocks in by_sector.items():
        sorted_stocks = sorted(stocks, key=lambda x: x.get("weight", 0), reverse=True)
        top10[sector] = [s["ticker"] for s in sorted_stocks[:10]]

    return top10


def get_etf_sector_weights(holdings: list[dict]) -> dict[str, float]:
    """Compute sector weight totals from holdings list."""
    sector_totals: dict[str, float] = defaultdict(float)
    for h in holdings:
        sector = h.get("sector") or "Unknown"
        sector_totals[sector] += h.get("weight", 0.0)
    return dict(sector_totals)
