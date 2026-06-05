"""
Download and cache monthly price histories via yfinance.
"""
import time, warnings
import pandas as pd
import yfinance as yf

warnings.filterwarnings("ignore")


def _to_month_start(idx: pd.DatetimeIndex) -> pd.DatetimeIndex:
    return pd.DatetimeIndex([pd.Timestamp(d.year, d.month, 1) for d in idx])


def fetch_monthly_returns(
    tickers: list[str],
    start: str = "2010-01-01",
    batch_size: int = 10,
    sleep: float = 2.0,
) -> pd.DataFrame:
    all_series: dict[str, pd.Series] = {}

    for i in range(0, len(tickers), batch_size):
        batch = tickers[i : i + batch_size]
        for attempt in range(3):
            try:
                raw = yf.download(
                    batch, start=start,
                    auto_adjust=True, progress=False, threads=False,
                )
                if raw.empty:
                    raise ValueError("Empty result")
                close = raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw.get("Close", raw)
                if isinstance(close, pd.Series):
                    close = close.to_frame(batch[0])
                for tk in batch:
                    if tk in close.columns and close[tk].notna().sum() > 30:
                        try:
                            monthly = close[tk].resample("ME").last().pct_change().dropna()
                        except ValueError:
                            monthly = close[tk].resample("M").last().pct_change().dropna()
                        all_series[tk] = monthly
                break
            except Exception:
                if attempt == 2:
                    pass
                time.sleep(2 ** attempt)
        time.sleep(sleep)

    if not all_series:
        return pd.DataFrame()

    df = pd.DataFrame(all_series)
    df.index = _to_month_start(df.index)
    return df


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
    return df.set_index("date")["monthly_return"].sort_index()
