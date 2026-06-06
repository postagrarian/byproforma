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
from db.supabase import get_client

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

def get_etf_holdings(ticker: str, top_n: int = 500) -> list[dict]:
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

    sample = [h["ticker"] for h in holdings[:10]]
    print(f"[holdings] Massive returned {len(results)} results, "
          f"{len(holdings)} equity holdings. Sample tickers: {sample}")

    if not holdings:
        raise ValueError(f"No equity constituents returned for {ticker} from Massive")

    # Enrich with yfinance sector labels (3 workers to avoid rate limiting)
    holdings = _enrich_sectors(holdings)

    labeled = sum(1 for h in holdings if h["sector"] != "Unknown")
    print(f"[holdings] Sector enrichment: {labeled}/{len(holdings)} labeled")

    return holdings


def get_etf_sector_weights(holdings: list[dict]) -> dict[str, float]:
    """
    Compute sector weights from the enriched holdings list.
    Each holding already has a sector label (from yfinance) and a weight.
    Sums weights per sector and normalises to 1.
    """
    sector_totals: dict[str, float] = {}
    total = sum(h.get("weight", 0) for h in holdings)
    if total == 0:
        # Fall back to equal-weight per sector
        counts: dict[str, int] = {}
        for h in holdings:
            s = h.get("sector", "Unknown")
            if s != "Unknown":
                counts[s] = counts.get(s, 0) + 1
        n = len(holdings) or 1
        return {s: c / n for s, c in counts.items()}

    for h in holdings:
        s = h.get("sector", "Unknown")
        if s and s != "Unknown":
            sector_totals[s] = sector_totals.get(s, 0.0) + h.get("weight", 0) / total

    return sector_totals


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

def _is_us_ticker(ticker: str) -> bool:
    """
    Filter out non-US identifiers like Bloomberg codes (e.g. 1520745D).
    Accepts: AAPL, BRK.B, BF.B, GOOGL — rejects codes starting with digits.
    """
    import re
    t = ticker.strip()
    return bool(re.match(r'^[A-Z][A-Z0-9.]{0,9}$', t)) and not t[-1].isdigit()


def _fetch_sector(ticker: str) -> tuple[str, str]:
    """Fetch sector for a single ticker. Returns (ticker, sector)."""
    try:
        info = yf.Ticker(ticker).info
        sector = info.get("sector") or info.get("sectorKey") or "Unknown"
        return ticker, sector
    except Exception:
        return ticker, "Unknown"


def _enrich_sectors(holdings: list[dict], max_workers: int = 3) -> list[dict]:
    """
    Add sector label to each holding.
    Checks Supabase cache first — only calls yfinance for uncached tickers.
    Writes any new sectors back to the cache for future runs.
    """
    tickers = [h["ticker"] for h in holdings]
    sector_map: dict[str, str] = {}

    # ── 1. Load cached sectors from Supabase ─────────────────────────────────
    try:
        sb  = get_client()
        res = sb.table("ticker_sectors").select("ticker, sector").in_(
            "ticker", tickers
        ).execute()
        for row in (res.data or []):
            sector_map[row["ticker"]] = row["sector"]
        print(f"[sectors] Cache hit: {len(sector_map)}/{len(tickers)} tickers")
    except Exception as exc:
        print(f"[sectors] Cache read failed: {exc}")

    # ── 2. Fetch missing tickers from yfinance ────────────────────────────────
    missing = [tk for tk in tickers if tk not in sector_map]
    print(f"[sectors] Fetching {len(missing)} tickers from yfinance…")

    if missing:
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {pool.submit(_fetch_sector, tk): tk for tk in missing}
            for future in as_completed(futures):
                tk, sector = future.result()
                sector_map[tk] = sector
                time.sleep(0.1)

        # ── 3. Write new sectors to Supabase cache ────────────────────────────
        new_rows = [
            {"ticker": tk, "sector": sector_map[tk]}
            for tk in missing
            if sector_map.get(tk, "Unknown") != "Unknown"
        ]
        if new_rows:
            try:
                sb.table("ticker_sectors").upsert(
                    new_rows, on_conflict="ticker"
                ).execute()
                print(f"[sectors] Cached {len(new_rows)} new sector labels")
            except Exception as exc:
                print(f"[sectors] Cache write failed: {exc}")

    for h in holdings:
        h["sector"] = sector_map.get(h["ticker"], "Unknown")

    return holdings
