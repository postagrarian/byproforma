"""
Regime classification service — fetches FRED data and classifies the
current macroeconomic regime using the S&P two-axis framework:
  Growth axis:    OECD CLI direction (3-month trend)
  Inflation axis: CPI YoY vs 3-year rolling average
"""
import io, math, requests
import pandas as pd
import numpy as np

FRED_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv"
MONTHS    = 36
TIMEOUT   = 10

REGIME_TILTS = {
    "goldilocks":  {"Mkt-RF": +0.10, "SMB": +0.10, "HML": -0.05, "RMW": -0.05, "CMA": -0.05, "Mom": +0.15},
    "heating_up":  {"Mkt-RF": +0.05, "SMB": +0.05, "HML": +0.15, "RMW": +0.05, "CMA": +0.05, "Mom":  0.00},
    "stagflation": {"Mkt-RF": -0.10, "SMB": -0.10, "HML": +0.05, "RMW": +0.20, "CMA": +0.10, "Mom": -0.15},
    "recession":   {"Mkt-RF": -0.15, "SMB": -0.10, "HML": -0.05, "RMW": +0.20, "CMA": +0.05, "Mom": -0.10},
}


def _fetch(series: str, limit: int = MONTHS + 24) -> pd.Series:
    """Fetch a FRED CSV series, return a date-indexed Series."""
    try:
        r = requests.get(f"{FRED_BASE}?id={series}", timeout=TIMEOUT)
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text), index_col=0)
        df.index = pd.to_datetime(df.index, errors="coerce")
        df = df[df.index.notna()]
        df = df[df.iloc[:, 0] != "."]
        s  = pd.to_numeric(df.iloc[:, 0], errors="coerce").dropna()
        return s.tail(limit)
    except Exception as exc:
        print(f"[regime] FRED {series} failed: {exc}")
        return pd.Series(dtype=float)


def _to_monthly(s: pd.Series) -> pd.Series:
    """Resample a daily series to month-end (last valid observation)."""
    try:
        return s.resample("ME").last().dropna()
    except Exception:
        return s


def classify_regime(cli: pd.Series, cpi: pd.Series):
    # Growth: OECD CLI 3-month direction
    growth_rising = bool(cli.iloc[-1] > cli.iloc[-4]) if len(cli) >= 4 else True

    # Inflation: CPI YoY vs 3-year rolling average of YoY
    yoy = cpi.pct_change(12).dropna() * 100
    if len(yoy) < 4:
        inflation_rising = True
    else:
        cpi3m  = yoy.iloc[-3:].mean()
        cpi36m = yoy.iloc[-36:].mean() if len(yoy) >= 36 else yoy.mean()
        inflation_rising = bool(cpi3m > cpi36m)

    if growth_rising and not inflation_rising:
        regime = "goldilocks"
    elif growth_rising and inflation_rising:
        regime = "heating_up"
    elif not growth_rising and inflation_rising:
        regime = "stagflation"
    else:
        regime = "recession"

    return regime, growth_rising, inflation_rising


def build_regime_payload() -> dict:
    from datetime import datetime, timezone
    import time

    # Fetch all series (individual failures return empty Series)
    cpi    = _fetch("CPIAUCSL")           # monthly CPI level
    cli    = _fetch("USALOLITOAASTSAM")   # monthly OECD CLI
    hy     = _to_monthly(_fetch("BAMLH0A0HYM2"))   # daily → monthly HY spread
    spread = _fetch("T10Y2YM")            # monthly 10-2yr spread

    regime, growth_rising, inflation_rising = classify_regime(cli, cpi)

    # ── CPI YoY chart ────────────────────────────────────────────────────────
    yoy = (cpi.pct_change(12).dropna() * 100).tail(MONTHS)
    rolling36 = yoy.expanding(min_periods=3).mean()
    cpi_chart = [
        {"date": str(d.date()), "yoy": round(float(v), 3),
         "avg3yr": round(float(rolling36.loc[d]), 3)}
        for d, v in yoy.items()
        if d in rolling36.index
    ]

    # ── CLI chart ─────────────────────────────────────────────────────────────
    cli_chart = [
        {"date": str(d.date()), "value": round(float(v), 3)}
        for d, v in cli.tail(MONTHS).items()
    ]

    # ── Yield curve chart ─────────────────────────────────────────────────────
    yield_chart = [
        {"date": str(d.date()), "value": round(float(v), 3)}
        for d, v in spread.tail(MONTHS).items()
    ]

    # ── HY spread chart ───────────────────────────────────────────────────────
    hy_chart = [
        {"date": str(d.date()), "value": round(float(v), 3)}
        for d, v in hy.tail(MONTHS).items()
    ]

    payload = {
        "regime":           regime,
        "growthRising":     growth_rising,
        "inflationRising":  inflation_rising,
        "tilts":            REGIME_TILTS[regime],
        "updatedAt":        datetime.now(timezone.utc).isoformat(),
        "charts": {
            "cli":        cli_chart,
            "cpi":        cpi_chart,
            "yieldCurve": yield_chart,
            "hySpread":   hy_chart,
        },
    }
    return _sanitize(payload)


def _sanitize(obj):
    """Recursively replace nan/inf with None so the payload is JSON-safe."""
    if isinstance(obj, float) and not math.isfinite(obj):
        return None
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    return obj
