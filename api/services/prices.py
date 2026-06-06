"""
Price History Service — Financial Modeling Prep (FMP)

Uses dividend-adjusted close prices (total return) for factor regressions.
Fama-French factors are constructed with total returns, so adjClose is correct.

Endpoint: GET /stable/historical-price-eod/dividend-adjusted
  ?symbol={ticker}&from={YYYY-MM-DD}&to={YYYY-MM-DD}
  Returns: [{date, adjClose, adjOpen, adjHigh, adjLow, volume}]
"""
import os, time
import requests
import pandas as pd
from concurrent.futures import ThreadPoolExecutor, as_completed

FMP_BASE = "https://financialmodelingprep.com/stable"


def _fmp_prices(ticker: str, start: str, end: str) -> pd.Series | None:
    """
    Fetch dividend-adjusted daily prices for one ticker from FMP.
    Returns a monthly return Series indexed by month-start timestamps, or None.
    """
    key = os.environ["FMP_API_KEY"]
    try:
        resp = requests.get(
            f"{FMP_BASE}/historical-price-eod/dividend-adjusted",
            params={"symbol": ticker, "from": start, "to": end, "apikey": key},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        print(f"[prices] FMP fetch failed for {ticker}: {exc}")
        return None

    if not data:
        return None

    df = pd.DataFrame(data)
    if "adjClose" not in df.columns or df.empty:
        return None

    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()

    # Resample to month-end, then compute returns from adjClose
    try:
        monthly = df["adjClose"].resample("ME").last()
    except ValueError:
        monthly = df["adjClose"].resample("M").last()

    returns = monthly.pct_change().dropna()
    if len(returns) < 12:
        return None

    # Normalise index to month-start timestamps
    returns.index = pd.DatetimeIndex(
        [pd.Timestamp(d.year, d.month, 1) for d in returns.index]
    )
    return returns


def fetch_monthly_returns(
    tickers: list[str],
    start: str = "2010-01-01",
    max_workers: int = 8,
) -> pd.DataFrame:
    """
    Fetch total-return monthly price history for a list of tickers from FMP.
    Returns a DataFrame (date × ticker) of monthly returns.
    Runs in parallel with max_workers threads.
    """
    import datetime
    end = datetime.date.today().strftime("%Y-%m-%d")

    all_series: dict[str, pd.Series] = {}

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {
            pool.submit(_fmp_prices, tk, start, end): tk
            for tk in tickers
        }
        for future in as_completed(futures):
            tk = futures[future]
            result = future.result()
            if result is not None and len(result) >= 12:
                all_series[tk] = result
            time.sleep(0.02)

    if not all_series:
        return pd.DataFrame()

    return pd.DataFrame(all_series)


# ── Cache helpers (used by pipeline) ─────────────────────────────────────────

def returns_to_rows(ticker: str, series: pd.Series) -> list[dict]:
    return [
        {"date": dt.strftime("%Y-%m-%d"), "monthly_return": float(v)}
        for dt, v in series.items()
        if not pd.isna(v)
    ]


def rows_to_series(rows: list[dict]) -> pd.Series:
    if not rows:
        return pd.Series(dtype=float)
    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"])
    s = df.set_index("date")["monthly_return"].sort_index()
    s.index = pd.DatetimeIndex(
        [pd.Timestamp(d.year, d.month, 1) for d in s.index]
    )
    return s
