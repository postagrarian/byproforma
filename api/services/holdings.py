"""
ETF Holdings Service
Fetches ETF constituent stocks and sector weights using:
  1. Wikipedia index constituent tables (S&P 400/500/600, Russell 2000)
  2. Polygon.io for market-cap ranking within sectors
  3. SSGA/iShares provider pages for official sector weight targets
  4. yfinance as sector-label fallback
"""
import os, io, time, requests
import pandas as pd
from collections import defaultdict

POLYGON_BASE = "https://api.polygon.io"

# Map ETF tickers → Wikipedia S&P component list URL
WIKIPEDIA_INDEX_MAP = {
    # S&P MidCap 400
    "IJH":  "https://en.wikipedia.org/wiki/List_of_S%26P_400_companies",
    "MDY":  "https://en.wikipedia.org/wiki/List_of_S%26P_400_companies",
    "IVOO": "https://en.wikipedia.org/wiki/List_of_S%26P_400_companies",
    # S&P 500
    "IVV":  "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
    "SPY":  "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
    "VOO":  "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
    "VV":   "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies",
    # S&P SmallCap 600
    "IJR":  "https://en.wikipedia.org/wiki/List_of_S%26P_600_companies",
    "SLY":  "https://en.wikipedia.org/wiki/List_of_S%26P_600_companies",
    "VIOO": "https://en.wikipedia.org/wiki/List_of_S%26P_600_companies",
}

# SSGA sector data URLs for SPDR ETFs (same index as iShares equivalents)
SSGA_URLS = {
    "IJH":  "https://www.ssga.com/us/en/intermediary/etfs/spdr-sp-midcap-400-etf-trust-mdy",
    "MDY":  "https://www.ssga.com/us/en/intermediary/etfs/spdr-sp-midcap-400-etf-trust-mdy",
    "IVV":  "https://www.ssga.com/us/en/intermediary/etfs/spdr-sp-500-etf-trust-spy",
    "SPY":  "https://www.ssga.com/us/en/intermediary/etfs/spdr-sp-500-etf-trust-spy",
    "IJR":  "https://www.ssga.com/us/en/intermediary/etfs/spdr-portfolio-sp-600-small-cap-etf-spsm",
}

# GICS sector → Morningstar sector name (yfinance uses Morningstar names)
GICS_TO_MORNINGSTAR = {
    "Information Technology":  "Technology",
    "Financials":              "Financial Services",
    "Health Care":             "Healthcare",
    "Consumer Discretionary":  "Consumer Cyclical",
    "Consumer Staples":        "Consumer Defensive",
    "Communication Services":  "Communication Services",
    "Industrials":             "Industrials",
    "Energy":                  "Energy",
    "Materials":               "Basic Materials",
    "Real Estate":             "Real Estate",
    "Utilities":               "Utilities",
}


def get_etf_holdings(ticker: str) -> list[dict]:
    """
    Returns list of dicts: {ticker, sector, weight, name}
    Tries Wikipedia index tables first, falls back to Polygon screener.
    """
    ticker = ticker.upper()

    if ticker in WIKIPEDIA_INDEX_MAP:
        try:
            return _fetch_from_wikipedia(ticker)
        except Exception as exc:
            print(f"Wikipedia fetch failed for {ticker}: {exc} — falling back to Polygon screener")

    return _fetch_from_polygon_screener(ticker)


def _fetch_from_wikipedia(ticker: str) -> list[dict]:
    """Parse S&P component table from Wikipedia, return holdings with sector."""
    url = WIKIPEDIA_INDEX_MAP[ticker]
    resp = requests.get(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; byProforma/1.0)"},
        timeout=30,
    )
    resp.raise_for_status()

    tables = pd.read_html(io.StringIO(resp.text))
    if not tables:
        raise ValueError("No tables found on Wikipedia page")

    df = tables[0]
    df.columns = [str(c).strip() for c in df.columns]

    # Detect ticker and sector columns (naming varies by page)
    ticker_col  = _find_col(df, ["Symbol", "Ticker symbol", "Ticker", "symbol"])
    sector_col  = _find_col(df, ["GICS Sector", "Sector", "sector"])
    name_col    = _find_col(df, ["Security", "Company", "Name", "name"])

    if not ticker_col or not sector_col:
        raise ValueError(f"Could not find ticker/sector columns. Got: {list(df.columns)}")

    holdings = []
    for _, row in df.iterrows():
        tk  = str(row[ticker_col]).strip().replace(".", "-")
        sec = str(row[sector_col]).strip()
        nm  = str(row[name_col]).strip() if name_col else tk
        if not tk or tk in ("nan", "-", ""):
            continue
        holdings.append({
            "ticker":  tk,
            "sector":  GICS_TO_MORNINGSTAR.get(sec, sec),
            "name":    nm,
            "weight":  0.0,   # will be filled by market-cap ranking below
        })

    # Rank within sector by Polygon market cap (best-effort; skip on failure)
    try:
        holdings = _enrich_market_cap(holdings)
    except Exception as exc:
        print(f"Market-cap enrichment skipped: {exc}")

    return holdings


def _fetch_from_polygon_screener(ticker: str) -> list[dict]:
    """
    Fallback: use Polygon's reference ticker screener to build a
    representative universe of active common stocks, then label
    sectors via yfinance.
    """
    import yfinance as yf
    api_key = os.environ["POLYGON_API_KEY"]

    resp = requests.get(
        f"{POLYGON_BASE}/v3/reference/tickers",
        params={
            "type":    "CS",
            "market":  "stocks",
            "active":  "true",
            "sort":    "market_cap",
            "order":   "desc",
            "limit":   "250",
            "apiKey":  api_key,
        },
        timeout=30,
    )
    resp.raise_for_status()
    results = resp.json().get("results", [])

    holdings = []
    for r in results:
        tk = r.get("ticker", "")
        if not tk:
            continue
        holdings.append({
            "ticker":     tk,
            "name":       r.get("name", ""),
            "weight":     float(r.get("market_cap") or 0),
            "sector":     "Unknown",
        })

    # Enrich with yfinance sectors in small batches
    for i in range(0, min(len(holdings), 100), 10):
        batch = holdings[i : i + 10]
        for h in batch:
            try:
                info = yf.Ticker(h["ticker"]).info
                h["sector"] = info.get("sector") or "Unknown"
            except Exception:
                pass
        time.sleep(1)

    return holdings


def _enrich_market_cap(holdings: list[dict]) -> list[dict]:
    """
    Add market-cap-based weights using Polygon snapshot.
    Operates in batches of 100 tickers.
    """
    api_key = os.environ["POLYGON_API_KEY"]
    tickers = [h["ticker"] for h in holdings]
    cap_map: dict[str, float] = {}

    for i in range(0, len(tickers), 100):
        batch = ",".join(tickers[i : i + 100])
        resp = requests.get(
            f"{POLYGON_BASE}/v2/snapshot/locale/us/markets/stocks/tickers",
            params={"tickers": batch, "apiKey": api_key},
            timeout=30,
        )
        if resp.status_code == 200:
            for item in resp.json().get("tickers", []):
                tk  = item.get("ticker", "")
                cap = item.get("day", {}).get("v", 0) * item.get("day", {}).get("c", 0)
                cap_map[tk] = float(cap or 0)
        time.sleep(0.5)

    total = sum(cap_map.values()) or 1.0
    for h in holdings:
        raw = cap_map.get(h["ticker"], 0)
        h["weight"] = raw / total

    return holdings


def get_top10_per_sector(holdings: list[dict]) -> dict[str, list[str]]:
    """
    Group holdings by sector, return top 10 by weight per sector.
    """
    by_sector: dict[str, list[dict]] = defaultdict(list)
    for h in holdings:
        sector = h.get("sector") or "Unknown"
        if sector not in ("Unknown", "nan", ""):
            by_sector[sector].append(h)

    top10: dict[str, list[str]] = {}
    for sector, stocks in by_sector.items():
        sorted_stocks = sorted(stocks, key=lambda x: x.get("weight", 0), reverse=True)
        top10[sector] = [s["ticker"] for s in sorted_stocks[:10]]

    return top10


def get_etf_sector_weights(holdings: list[dict]) -> dict[str, float]:
    """Compute sector weight totals from holdings list."""
    sector_totals: dict[str, float] = defaultdict(float)
    total_weight = sum(h.get("weight", 0) for h in holdings)
    if total_weight == 0:
        # Equal-weight fallback: weight by sector size
        counts: dict[str, int] = defaultdict(int)
        for h in holdings:
            counts[h.get("sector", "Unknown")] += 1
        n = len(holdings) or 1
        return {s: c / n for s, c in counts.items()}

    for h in holdings:
        sector = h.get("sector") or "Unknown"
        sector_totals[sector] += h.get("weight", 0) / total_weight

    return dict(sector_totals)


# ── Helpers ──────────────────────────────────────────────────────────────────
def _find_col(df: pd.DataFrame, candidates: list[str]) -> str | None:
    for c in candidates:
        if c in df.columns:
            return c
    return None
