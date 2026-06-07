"""
Daily portfolio performance service.

Fetches end-of-day prices from FMP for all Live Portfolio holdings
plus two benchmarks (VOO and the Foundational ETF), computes daily
% returns, identifies top 3 gainers and losers, and calculates the
cumulative return indexed to 100 from the inception date.
"""
import os
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta

FMP_URL = "https://financialmodelingprep.com/stable"


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


def compute_daily_performance(
    live_run: dict,
    trade_date: str | None = None,
) -> dict:
    """
    Calculate end-of-day performance for the Live Portfolio.

    live_run: a tilt_portfolio_runs row with portfolio, foundational_ticker, name, id.
    trade_date: YYYY-MM-DD string (defaults to today).

    Returns a dict ready to INSERT into portfolio_performance.
    """
    from db.supabase import get_client

    today     = trade_date or date.today().strftime("%Y-%m-%d")
    yesterday = (date.fromisoformat(today) - timedelta(days=1)).strftime("%Y-%m-%d")
    # Walk back further if yesterday was a weekend
    d = date.fromisoformat(yesterday)
    while d.weekday() >= 5:          # 5=Sat, 6=Sun
        d -= timedelta(days=1)
    yesterday = d.strftime("%Y-%m-%d")

    holdings      = live_run.get("portfolio") or []
    etf_ticker    = live_run.get("foundational_ticker", "")
    port_name     = live_run.get("name", "Live Portfolio")
    port_id       = live_run.get("id")

    holding_tickers = [h["ticker"] for h in holdings]
    all_tickers     = list(set(holding_tickers + ["VOO", etf_ticker]))

    print(f"[performance] Fetching prices for {len(all_tickers)} tickers ({today})")
    returns = fetch_returns(all_tickers, today, yesterday)

    # ── Portfolio return (weighted) ───────────────────────────────────────────
    portfolio_return = 0.0
    holding_returns  = []
    for h in holdings:
        tk  = h["ticker"]
        ret = returns.get(tk)
        if ret is not None:
            portfolio_return += h["weight"] * ret
            holding_returns.append({
                "ticker":     tk,
                "name":       h.get("name", ""),
                "return_pct": round(ret * 100, 3),
            })

    sp500_return = returns.get("VOO")
    etf_return   = returns.get(etf_ticker)

    # ── Top 3 gainers and losers ──────────────────────────────────────────────
    sorted_h    = sorted(holding_returns, key=lambda x: x["return_pct"], reverse=True)
    top_gainers = sorted_h[:3]
    top_losers  = sorted_h[-3:][::-1]

    # ── Cumulative return (indexed to 100) ────────────────────────────────────
    sb = get_client()
    prev = (sb.table("portfolio_performance")
              .select("cumulative_return")
              .order("date", desc=True)
              .limit(1)
              .execute())
    prev_cumulative = float(prev.data[0]["cumulative_return"]) if prev.data else 100.0
    cumulative      = round(prev_cumulative * (1 + portfolio_return), 4)

    print(f"[performance] Portfolio: {portfolio_return*100:+.3f}%  "
          f"VOO: {(sp500_return or 0)*100:+.3f}%  "
          f"{etf_ticker}: {(etf_return or 0)*100:+.3f}%  "
          f"Cumulative: {cumulative:.2f}")

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
    }
