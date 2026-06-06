"""
ETF Holdings Service — Financial Modeling Prep (FMP)

Endpoints used:
  GET /stable/etf/holdings?symbol={etf}
      → constituent tickers + weights (weightPercentage is %, divide by 100)
  GET /stable/etf/sector-weightings?symbol={etf}
      → sector weights in Morningstar names (weightPercentage is %)
  GET /stable/profile?symbol={ticker}
      → sector label per stock (cached in Supabase ticker_sectors table)
"""
import os, time, requests
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from db.supabase import get_client

FMP_BASE = "https://financialmodelingprep.com/stable"


def _fmp(path: str, params: dict = {}) -> list | dict:
    key = os.environ["FMP_API_KEY"]
    resp = requests.get(
        f"{FMP_BASE}{path}",
        params={"apikey": key, **params},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


# ── Public interface ──────────────────────────────────────────────────────────

def get_etf_holdings(ticker: str) -> list[dict]:
    """
    Fetch all ETF equity constituents from FMP, enrich each with sector.
    Returns list of {ticker, name, weight, sector} dicts.
    weight is a decimal (e.g. 0.0154 = 1.54%).
    """
    ticker = ticker.upper()
    data = _fmp("/etf/holdings", {"symbol": ticker})

    if not data:
        raise ValueError(f"No holdings returned for {ticker} from FMP")

    holdings = [
        {
            "ticker": r["asset"],
            "name":   r.get("name", ""),
            "weight": float(r.get("weightPercentage") or 0) / 100.0,
            "sector": "Unknown",
        }
        for r in data
        if r.get("asset") and r["asset"].upper() != ticker   # filter self-referential rows
    ]

    print(f"[holdings] FMP returned {len(holdings)} constituents for {ticker}")

    if len(holdings) < 20:
        raise ValueError(
            f"{ticker} — FMP only returned {len(holdings)} holdings. "
            f"This ETF may not be supported. Try a broad-market ETF "
            f"(IJH, SPY, QQQ, IWM, MDY)."
        )

    holdings = _enrich_sectors(holdings)

    labeled = sum(1 for h in holdings if h["sector"] != "Unknown")
    print(f"[holdings] {labeled}/{len(holdings)} tickers have sector labels")

    return holdings


def get_etf_sector_weights(ticker: str) -> dict[str, float]:
    """
    Fetch official ETF sector weights from FMP.
    Returns {MorningstarSectorName: decimal_weight}.
    Filters out Cash & Others.
    """
    ticker = ticker.upper()
    data = _fmp("/etf/sector-weightings", {"symbol": ticker})

    if not data:
        raise ValueError(f"No sector weightings returned for {ticker} from FMP")

    out: dict[str, float] = {}
    for r in data:
        sector = r.get("sector", "")
        weight = float(r.get("weightPercentage") or 0) / 100.0
        if sector and sector != "Cash & Others" and weight > 0:
            out[sector] = weight

    return out


def build_universe(
    holdings: list[dict],
    sector_weights: dict[str, float],
    top_global: int = 150,
    min_per_sector: int = 8,
    max_per_sector: int = 20,
) -> dict[str, list[str]]:
    """
    Build the optimizer universe using a global-weight-first approach:

    1. Sort ALL holdings by ETF weight globally (not within sector).
    2. Take the top `top_global` — these drive the ETF's factor profile.
    3. For any sector still below `min_per_sector`, supplement with the
       next heaviest holdings from that sector in the remaining list.

    This preserves factor-relevant stocks (the heaviest holdings are
    overweighted for a reason) while guaranteeing sector coverage for
    the ±3% sector constraints.
    """
    # Sort all labeled holdings by global ETF weight
    labeled = [h for h in holdings if h.get("sector", "Unknown") != "Unknown"]
    by_etf_weight = sorted(labeled, key=lambda x: x.get("weight", 0), reverse=True)

    # Step 1: take top N globally
    selected_tickers: set[str] = set()
    selected: list[dict]       = []
    for h in by_etf_weight[:top_global]:
        if h["ticker"] not in selected_tickers:
            selected_tickers.add(h["ticker"])
            selected.append(h)

    # Step 2: group selected by sector
    by_sector: dict[str, list[dict]] = defaultdict(list)
    for h in selected:
        by_sector[h["sector"]].append(h)

    # Step 3: supplement underrepresented sectors from remaining holdings
    remaining = [
        h for h in by_etf_weight[top_global:]
        if h["ticker"] not in selected_tickers
    ]
    for sector in sector_weights:
        shortfall = min_per_sector - len(by_sector.get(sector, []))
        if shortfall <= 0:
            continue
        candidates = [h for h in remaining if h["sector"] == sector]
        for h in candidates[:shortfall]:
            selected_tickers.add(h["ticker"])
            selected.append(h)
            by_sector[sector].append(h)

    # Build return dict: sector → sorted ticker list (heaviest first, capped)
    universe: dict[str, list[str]] = {}
    for sector in sector_weights:
        stocks = by_sector.get(sector, [])
        if stocks:
            sorted_stocks = sorted(stocks, key=lambda x: x.get("weight", 0), reverse=True)
            universe[sector] = [s["ticker"] for s in sorted_stocks[:max_per_sector]]

    total = sum(len(v) for v in universe.values())
    print(f"[universe] {total} stocks across {len(universe)} sectors "
          f"(global top-{top_global} + sector fill to min {min_per_sector})")
    for s, tks in universe.items():
        print(f"[universe]   {s}: {len(tks)} stocks")
    return universe


# ── Sector enrichment ─────────────────────────────────────────────────────────

def _fetch_sector_fmp(ticker: str) -> tuple[str, str]:
    """Fetch sector for one ticker from FMP profile endpoint."""
    try:
        data = _fmp(f"/profile", {"symbol": ticker})
        if data and isinstance(data, list):
            return ticker, data[0].get("sector") or "Unknown"
        return ticker, "Unknown"
    except Exception:
        return ticker, "Unknown"


def _enrich_sectors(holdings: list[dict], max_workers: int = 5) -> list[dict]:
    """
    Add FMP sector label to each holding.
    Checks Supabase cache first — only calls FMP for uncached tickers.
    Writes new sectors back to Supabase for future runs.
    """
    tickers = [h["ticker"] for h in holdings]
    sector_map: dict[str, str] = {}

    # ── 1. Load from Supabase cache ───────────────────────────────────────────
    try:
        sb  = get_client()
        res = sb.table("ticker_sectors").select("ticker, sector").in_(
            "ticker", tickers
        ).execute()
        for row in (res.data or []):
            sector_map[row["ticker"]] = row["sector"]
        print(f"[sectors] Cache: {len(sector_map)}/{len(tickers)} hit")
    except Exception as exc:
        print(f"[sectors] Cache read failed: {exc}")

    # ── 2. Fetch missing from FMP ─────────────────────────────────────────────
    missing = [tk for tk in tickers if tk not in sector_map]
    if missing:
        print(f"[sectors] Fetching {len(missing)} sectors from FMP…")
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {pool.submit(_fetch_sector_fmp, tk): tk for tk in missing}
            for future in as_completed(futures):
                tk, sector = future.result()
                sector_map[tk] = sector
                time.sleep(0.05)

        # ── 3. Write new sectors to Supabase ──────────────────────────────────
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
