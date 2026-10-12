#!/usr/bin/env python3
"""
Daily Chart Book Generator
==========================
Fetches macro data (FRED), market data (FMP), and economic calendar,
then renders 15-20 charts as PNG files and compiles them into a
single HTML page with commentary.

Usage:
    cd /Users/rhh-basic/byproforma
    .venv/bin/python api/scripts/chartbook.py [--out DIR]

Output:
    <out>/chartbook.html        — compiled HTML with embedded base64 images
    <out>/charts/*.png           — individual chart PNGs
    <out>/chartbook_data.json    — raw data + metadata for review
"""
import os, sys, io, json, math, base64, argparse, traceback
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pandas as pd
import numpy as np
import requests
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.ticker import FuncFormatter, MaxNLocator

# ── Load .env ────────────────────────────────────────────────────────────────
def _load_env():
    env = Path(__file__).resolve().parents[2] / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k, v)

_load_env()
FMP_KEY   = os.environ.get("FMP_API_KEY", "")
FMP_BASE  = "https://financialmodelingprep.com/stable"
FRED_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv"
TIMEOUT   = 15

# ── Style ────────────────────────────────────────────────────────────────────
plt.rcParams.update({
    "font.family": "monospace",
    "font.size": 9,
    "axes.edgecolor": "#000000",
    "axes.linewidth": 0.8,
    "axes.grid": True,
    "grid.color": "#e0e0e0",
    "grid.linewidth": 0.5,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "figure.facecolor": "#ffffff",
    "axes.facecolor": "#ffffff",
    "savefig.facecolor": "#ffffff",
    "savefig.dpi": 150,
    "figure.dpi": 150,
})

INK    = "#1a1a1a"
ACCENT = "#1a1a1a"   # black ink — industrial
RED    = "#b91c1c"
GREEN  = "#166534"
GRAY   = "#6b7280"

# ── Data fetchers ────────────────────────────────────────────────────────────

def fred_csv(series_id: str, limit: int = 120) -> pd.Series:
    """Fetch a FRED CSV series, return date-indexed Series."""
    try:
        r = requests.get(f"{FRED_BASE}?id={series_id}", timeout=TIMEOUT)
        r.raise_for_status()
        df = pd.read_csv(io.StringIO(r.text), index_col=0)
        df.index = pd.to_datetime(df.index, errors="coerce")
        df = df[df.index.notna()]
        df = df[df.iloc[:, 0] != "."]
        s = pd.to_numeric(df.iloc[:, 0], errors="coerce").dropna()
        return s.tail(limit)
    except Exception as e:
        print(f"  [FRED] {series_id}: {e}")
        return pd.Series(dtype=float)


def fmp_get(path: str, params: dict = None) -> list | dict:
    params = {**(params or {}), "apikey": FMP_KEY}
    try:
        r = requests.get(f"{FMP_BASE}{path}", params=params, timeout=TIMEOUT)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"  [FMP] {path}: {e}")
        return []


def fmp_eod(ticker: str, days: int = 180) -> pd.DataFrame:
    """Daily EOD prices from FMP."""
    end = datetime.now().strftime("%Y-%m-%d")
    start = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    data = fmp_get("/historical-price-eod/dividend-adjusted",
                   {"symbol": ticker, "from": start, "to": end})
    if not data or not isinstance(data, list):
        return pd.DataFrame()
    df = pd.DataFrame(data)
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date").sort_index()
    for c in ["open", "high", "low", "close", "adjClose", "volume"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def fmp_profile(ticker: str) -> dict:
    data = fmp_get("/profile", {"symbol": ticker})
    if isinstance(data, list) and data:
        return data[0]
    return {}


def fmp_ratios(ticker: str) -> dict:
    data = fmp_get("/ratios-ttm", {"symbol": ticker})
    if isinstance(data, list) and data:
        return data[0]
    return {}


# ── Chart helpers ────────────────────────────────────────────────────────────

def _save(fig, outdir, name):
    path = outdir / f"{name}.png"
    fig.savefig(path, bbox_inches="tight", pad_inches=0.15)
    plt.close(fig)
    return path


def _line_chart(s: pd.Series, title: str, ylabel: str, outdir: Path,
                name: str, color: str = INK, hline: float = None,
                ref_line: float = None) -> Path:
    if s.empty:
        return None
    fig, ax = plt.subplots(figsize=(7, 3))
    ax.plot(s.index, s.values, color=color, linewidth=1.2)
    ax.fill_between(s.index, s.values, ax.get_ylim()[0], alpha=0.06, color=color)
    if hline is not None:
        ax.axhline(hline, color=RED, linewidth=0.8, linestyle="--")
    if ref_line is not None:
        ax.axhline(ref_line, color=GRAY, linewidth=0.5, linestyle=":")
    ax.set_title(title, fontsize=10, fontweight="bold", loc="left", color=INK)
    ax.set_ylabel(ylabel, fontsize=8, color=GRAY)
    ax.tick_params(labelsize=7, colors=GRAY)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %y"))
    fig.autofmt_xdate(rotation=30)
    return _save(fig, outdir, name)


def _bar_chart(labels, values, title, ylabel, outdir, name,
                colors=None, rotate=False) -> Path:
    fig, ax = plt.subplots(figsize=(7, 3))
    if colors is None:
        colors = [INK] * len(labels)
    bars = ax.bar(range(len(labels)), values, color=colors, width=0.7, edgecolor=INK, linewidth=0.5)
    ax.set_xticks(range(len(labels)))
    ax.set_xticklabels(labels, fontsize=7, rotation=45 if rotate else 0, ha="right" if rotate else "center")
    ax.set_title(title, fontsize=10, fontweight="bold", loc="left", color=INK)
    ax.set_ylabel(ylabel, fontsize=8, color=GRAY)
    ax.tick_params(labelsize=7, colors=GRAY)
    ax.axhline(0, color=INK, linewidth=0.5)
    return _save(fig, outdir, name)


def _dual_line(s1, s2, title, label1, label2, ylabel, outdir, name,
                color1=INK, color2=GRAY) -> Path:
    if s1.empty or s2.empty:
        return None
    fig, ax = plt.subplots(figsize=(7, 3))
    ax.plot(s1.index, s1.values, color=color1, linewidth=1.2, label=label1)
    ax.plot(s2.index, s2.values, color=color2, linewidth=1.0, linestyle="--", label=label2)
    ax.set_title(title, fontsize=10, fontweight="bold", loc="left", color=INK)
    ax.set_ylabel(ylabel, fontsize=8, color=GRAY)
    ax.legend(fontsize=7, frameon=False, loc="upper left")
    ax.tick_params(labelsize=7, colors=GRAY)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %y"))
    fig.autofmt_xdate(rotation=30)
    return _save(fig, outdir, name)


def _img_b64(path: Path) -> str:
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode()


# ── Chart generators ─────────────────────────────────────────────────────────

def chart_cpi_yoy(data, outdir):
    cpi = data["cpi"]
    if cpi.empty:
        return None, "CPI: no data"
    yoy = (cpi.pct_change(12).dropna() * 100).tail(60)
    rolling36 = yoy.rolling(36, min_periods=3).mean()
    fig, ax = plt.subplots(figsize=(7, 3))
    ax.plot(yoy.index, yoy.values, color=INK, linewidth=1.2, label="CPI YoY %")
    ax.plot(rolling36.index, rolling36.values, color=RED, linewidth=0.8, linestyle="--", label="3yr avg")
    ax.fill_between(yoy.index, yoy.values, 0, alpha=0.05, color=INK)
    ax.set_title("CPI YoY — Inflation Signal", fontsize=10, fontweight="bold", loc="left", color=INK)
    ax.set_ylabel("% YoY", fontsize=8, color=GRAY)
    ax.legend(fontsize=7, frameon=False)
    ax.tick_params(labelsize=7, colors=GRAY)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %y"))
    fig.autofmt_xdate(rotation=30)
    return _save(fig, outdir, "cpi_yoy"), f"CPI YoY: {yoy.iloc[-1]:.2f}% (3yr avg: {rolling36.iloc[-1]:.2f}%)"


def chart_yield_spread(data, outdir):
    spread = data["yield_spread"]
    if spread.empty:
        return None, "Yield spread: no data"
    return _line_chart(
        spread.tail(60), "10Y–2Y Treasury Yield Spread",
        "Spread (pp)", outdir, "yield_spread",
        hline=0.0,
    ), f"10Y-2Y spread: {spread.iloc[-1]:.2f}pp"


def chart_hy_spread(data, outdir):
    hy = data["hy_spread"]
    if hy.empty:
        return None, "HY spread: no data"
    return _line_chart(
        hy.tail(60), "ICE BofA HY OAS Spread",
        "Spread (pp)", outdir, "hy_spread",
        color=RED, hline=None,
    ), f"HY OAS: {hy.iloc[-1]:.2f}pp"


def chart_oecd_cli(data, outdir):
    cli = data["oecd_cli"]
    if cli.empty:
        return None, "OECD CLI: no data"
    return _line_chart(
        cli.tail(60), "OECD Composite Leading Indicator — US",
        "CLI Index", outdir, "oecd_cli",
        hline=None,
    ), f"OECD CLI: {cli.iloc[-1]:.2f}"


def chart_treasury_curve(data, outdir):
    treas = data["treasury_rates"]
    if not treas:
        return None, "Treasury rates: no data"
    latest = treas[-1]
    maturities = ["month1", "month2", "month3", "month6", "year1", "year2",
                  "year3", "year5", "year7", "year10", "year20", "year30"]
    labels = ["1M", "2M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"]
    values = [latest.get(m, None) for m in maturities]
    values = [v for v in values if v is not None]
    if not values:
        return None, "Treasury curve: no data"

    # Also get 6 months ago for comparison
    past = treas[min(30, len(treas)-1)] if len(treas) > 30 else treas[0]
    past_values = [past.get(m, None) for m in maturities]
    past_values = [v for v in past_values if v is not None]

    fig, ax = plt.subplots(figsize=(7, 3))
    ax.plot(labels[:len(values)], values, color=INK, linewidth=1.2, marker="s", markersize=3, label=f"Today ({latest.get('date','')})")
    if past_values:
        ax.plot(labels[:len(past_values)], past_values, color=GRAY, linewidth=0.8, linestyle="--", label=f"~1mo ago ({past.get('date','')})")
    ax.set_title("US Treasury Yield Curve", fontsize=10, fontweight="bold", loc="left", color=INK)
    ax.set_ylabel("Yield (%)", fontsize=8, color=GRAY)
    ax.legend(fontsize=7, frameon=False)
    ax.tick_params(labelsize=7, colors=GRAY)
    return _save(fig, outdir, "treasury_curve"), f"10Y: {latest.get('year10', '?')}% | 2Y: {latest.get('year2', '?')}% | 30Y: {latest.get('year30', '?')}%"


def chart_unemployment(data, outdir):
    ue = data.get("unemployment")
    if ue is None or not ue:
        return None, "Unemployment: no data"
    fig, ax = plt.subplots(figsize=(7, 3))
    labels = ["Latest", "Prev", "Prev2"]
    vals = [ue.get("value", 0) for ue in ue[:3]]
    vals.reverse()
    labels.reverse()
    ax.bar(labels, vals, color=INK, width=0.5, edgecolor=INK, linewidth=0.5)
    for i, v in enumerate(vals):
        ax.text(i, v + 0.05, f"{v:.1f}%", ha="center", fontsize=8, fontweight="bold")
    ax.set_title("Unemployment Rate", fontsize=10, fontweight="bold", loc="left", color=INK)
    ax.set_ylabel("%", fontsize=8, color=GRAY)
    ax.tick_params(labelsize=7, colors=GRAY)
    ax.set_ylim(0, max(vals) * 1.3)
    return _save(fig, outdir, "unemployment"), f"Unemployment: {vals[-1]:.1f}%"


def chart_consumer_sentiment(data, outdir):
    cs = data.get("consumer_sentiment")
    if cs is None or not cs:
        return None, "Consumer sentiment: no data"
    fig, ax = plt.subplots(figsize=(7, 3))
    vals = [c.get("value", 0) for c in cs[:3]]
    vals.reverse()
    labels = ["Prev2", "Prev", "Latest"]
    ax.bar(labels, vals, color=ACCENT, width=0.5, edgecolor=INK, linewidth=0.5)
    for i, v in enumerate(vals):
        ax.text(i, v + 0.5, f"{v:.1f}", ha="center", fontsize=8, fontweight="bold")
    ax.set_title("Consumer Sentiment (UMich)", fontsize=10, fontweight="bold", loc="left", color=INK)
    ax.set_ylabel("Index", fontsize=8, color=GRAY)
    ax.tick_params(labelsize=7, colors=GRAY)
    ax.set_ylim(0, max(vals) * 1.3 if vals else 100)
    return _save(fig, outdir, "consumer_sentiment"), f"Consumer Sentiment: {vals[-1]:.1f}"


def chart_vix(data, outdir):
    vix = data.get("vix")
    if vix is None or vix.empty:
        return None, "VIX: no data"
    vix_daily = vix.tail(252)
    vix_ma20 = vix_daily.rolling(20, min_periods=10).mean()
    fig, ax = plt.subplots(figsize=(7, 3))
    ax.plot(vix_daily.index, vix_daily.values, color=INK, linewidth=0.8, label="VIX")
    ax.plot(vix_ma20.index, vix_ma20.values, color=RED, linewidth=1.0, linestyle="--", label="20-day MA")
    ax.fill_between(vix_daily.index, vix_daily.values, 10, alpha=0.05, color=INK)
    ax.set_title("CBOE Volatility Index (VIX) — 1 Year", fontsize=10, fontweight="bold", loc="left", color=INK)
    ax.set_ylabel("VIX", fontsize=8, color=GRAY)
    ax.legend(fontsize=7, frameon=False)
    ax.tick_params(labelsize=7, colors=GRAY)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %y"))
    fig.autofmt_xdate(rotation=30)
    latest = vix_daily.iloc[-1]
    ma = vix_ma20.iloc[-1] if not vix_ma20.empty else 0
    return _save(fig, outdir, "vix"), f"VIX: {latest:.1f} (20d MA: {ma:.1f})"


def chart_sp500(data, outdir):
    spx = data.get("spx")
    if spx is None or spx.empty:
        return None, "S&P 500: no data"
    fig, ax = plt.subplots(figsize=(7, 3))
    ax.plot(spx.index, spx["adjClose"].values, color=INK, linewidth=1.0)
    ax.fill_between(spx.index, spx["adjClose"].values, spx["adjClose"].min() * 0.98, alpha=0.05, color=INK)
    ax.set_title("S&P 500 (VOO) — 6 Month", fontsize=10, fontweight="bold", loc="left", color=INK)
    ax.set_ylabel("Price ($)", fontsize=8, color=GRAY)
    ax.tick_params(labelsize=7, colors=GRAY)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %y"))
    fig.autofmt_xdate(rotation=30)
    # Add return annotation
    if len(spx) >= 2:
        ret = (spx["adjClose"].iloc[-1] / spx["adjClose"].iloc[0] - 1) * 100
        color = GREEN if ret >= 0 else RED
        ax.text(0.98, 0.95, f"{ret:+.1f}%", transform=ax.transAxes,
                ha="right", va="top", fontsize=9, fontweight="bold", color=color)
    return _save(fig, outdir, "sp500"), f"S&P 500 6mo return: {((spx['adjClose'].iloc[-1]/spx['adjClose'].iloc[0]-1)*100):+.1f}%"


def chart_sector_perf(data, outdir):
    sectors = data.get("sector_perf", {})
    if not sectors:
        return None, "Sector performance: no data"
    labels = list(sectors.keys())
    vals = list(sectors.values())
    colors = [GREEN if v >= 0 else RED for v in vals]
    return _bar_chart(
        labels, vals, "Sector ETF Performance — 1 Month",
        "Return (%)", outdir, "sector_perf",
        colors=colors, rotate=True,
    ), " | ".join(f"{l}: {v:+.1f}%" for l, v in list(sectors.items())[:3])


def chart_econ_calendar(data, outdir):
    events = data.get("econ_events", [])
    if not events:
        return None, "Economic calendar: no data"

    # Filter US high-impact events in next 5 days
    now = datetime.now()
    upcoming = [e for e in events
                if e.get("country") == "US"
                and e.get("impact") in ("High", "Medium")]
    upcoming = upcoming[:20]

    if not upcoming:
        return None, "No upcoming high-impact US events"

    fig, ax = plt.subplots(figsize=(7, 4))
    y_pos = range(len(upcoming))
    labels = [f"{e['date'][:10]} {e.get('event','')[:35]}" for e in upcoming]
    impacts = [e.get("impact", "") for e in upcoming]
    colors = [RED if i == "High" else GRAY for i in impacts]

    ax.barh(y_pos, [1]*len(upcoming), color=colors, height=0.6)
    ax.set_yticks(y_pos)
    ax.set_yticklabels(labels, fontsize=7)
    ax.invert_yaxis()
    ax.set_title("Economic Calendar — Upcoming US Events", fontsize=10, fontweight="bold", loc="left", color=INK)
    ax.set_xticks([])
    ax.spines["bottom"].set_visible(False)
    ax.spines["left"].set_visible(False)
    ax.tick_params(left=False, bottom=False)
    return _save(fig, outdir, "econ_calendar"), f"{len(upcoming)} upcoming high/medium impact US events"


def chart_fundamentals(ticker: str, data: dict, outdir: Path) -> tuple:
    """Generate 2 fundamental charts for a ticker: price history + key ratios."""
    prices = data.get(f"price_{ticker}")
    profile = data.get(f"profile_{ticker}", {})
    ratios = data.get(f"ratios_{ticker}", {})

    charts = []

    # Price chart
    if prices is not None and not prices.empty:
        fig, ax = plt.subplots(figsize=(7, 2.5))
        ax.plot(prices.index, prices["adjClose"].values, color=INK, linewidth=1.0)
        ax.fill_between(prices.index, prices["adjClose"].values,
                        prices["adjClose"].min() * 0.98, alpha=0.05, color=INK)
        name = profile.get("companyName", ticker)
        ax.set_title(f"{name} ({ticker}) — 3 Month Price", fontsize=10, fontweight="bold", loc="left", color=INK)
        ax.set_ylabel("Price ($)", fontsize=8, color=GRAY)
        ax.tick_params(labelsize=7, colors=GRAY)
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d"))
        fig.autofmt_xdate(rotation=30)
        if len(prices) >= 2:
            ret = (prices["adjClose"].iloc[-1] / prices["adjClose"].iloc[0] - 1) * 100
            color = GREEN if ret >= 0 else RED
            ax.text(0.98, 0.95, f"{ret:+.1f}%", transform=ax.transAxes,
                    ha="right", va="top", fontsize=9, fontweight="bold", color=color)
        p = _save(fig, outdir, f"price_{ticker}")
        charts.append((p, f"{ticker} 3mo: {((prices['adjClose'].iloc[-1]/prices['adjClose'].iloc[0]-1)*100):+.1f}%"))

    # Key ratios bar chart
    if ratios:
        key_ratios = {
            "P/E (TTM)": ratios.get("peRatioTTM"),
            "P/B": ratios.get("pbRatioTTM"),
            "ROE %": ratios.get("returnOnEquityTTM"),
            "Net Margin %": ratios.get("netProfitMarginTTM"),
            "Current Ratio": ratios.get("currentRatio"),
            "Debt/Equity": ratios.get("debtEquityRatio"),
        }
        labels = list(key_ratios.keys())
        vals = [key_ratios[l] for l in labels]
        valid = [(l, v) for l, v in zip(labels, vals) if v is not None]
        if valid:
            labels, vals = zip(*valid)
            colors = [GREEN if (l.startswith("ROE") or l.startswith("Net")) and v > 0 else INK for l, v in zip(labels, vals)]
            fig2, ax2 = plt.subplots(figsize=(7, 2.5))
            ax2.barh(range(len(labels)), vals, color=colors, height=0.5, edgecolor=INK, linewidth=0.5)
            ax2.set_yticks(range(len(labels)))
            ax2.set_yticklabels(labels, fontsize=8)
            ax2.set_title(f"{ticker} — Key Financial Ratios (TTM)", fontsize=10, fontweight="bold", loc="left", color=INK)
            ax2.tick_params(labelsize=7, colors=GRAY)
            for i, v in enumerate(vals):
                ax2.text(v, i, f" {v:.2f}" if v < 100 else f" {v:.0f}",
                        va="center", fontsize=7, color=GRAY)
            p2 = _save(fig2, outdir, f"ratios_{ticker}")
            charts.append((p2, f"{ticker} ratios: {dict(zip(labels, [round(v,2) if v else 'N/A' for v in vals]))}"))

    return charts


# ── Main data collection ────────────────────────────────────────────────────

def collect_data(tickers: list = None) -> dict:
    """Fetch all data needed for the chart book."""
    data = {}
    today = datetime.now().strftime("%Y-%m-%d")
    print(f"Collecting data for {today}…")

    # ── FRED macro series ──
    print("  Fetching FRED series…")
    data["cpi"]          = fred_csv("CPIAUCSL", limit=120)
    data["yield_spread"] = fred_csv("T10Y2YM", limit=120)
    data["hy_spread"]    = fred_csv("BAMLH0A0HYM2", limit=120)
    data["oecd_cli"]     = fred_csv("USALOLITOAASTSAM", limit=120)
    data["vix"]          = fred_csv("VIXCLS", limit=252)  # ~1yr daily

    # ── FMP treasury rates ──
    print("  Fetching FMP treasury rates…")
    treas = fmp_get("/treasury-rates")
    if isinstance(treas, list):
        data["treasury_rates"] = treas
    else:
        data["treasury_rates"] = []

    # ── FMP economic indicators ──
    print("  Fetching FMP economic indicators…")
    for name in ["unemploymentRate", "consumerSentiment", "retailSales", "durableGoods", "GDP", "realGDP"]:
        ind = fmp_get("/economic-indicators", {"name": name})
        if isinstance(ind, list) and ind:
            data[name] = ind

    # ── FMP economic calendar ──
    print("  Fetching FMP economic calendar…")
    cal = fmp_get("/economic-calendar", {"country": "US"})
    if isinstance(cal, list):
        data["econ_events"] = cal

    # ── S&P 500 / VOO price history ──
    print("  Fetching VOO price history…")
    data["spx"] = fmp_eod("VOO", days=180)

    # ── Sector ETF performance ──
    print("  Fetching sector ETFs…")
    sector_etfs = {
        "XLF": "Financials", "XLK": "Tech", "XLE": "Energy", "XLV": "Healthcare",
        "XLY": "Consumer Disc", "XLP": "Consumer Stap", "XLI": "Industrials",
        "XLU": "Utilities", "XLRE": "Real Estate", "XLB": "Materials", "XLC": "Comms",
    }
    data["sector_perf"] = {}
    for etf, label in sector_etfs.items():
        hist = fmp_eod(etf, days=45)
        if not hist.empty and len(hist) >= 2:
            ret = (hist["adjClose"].iloc[-1] / hist["adjClose"].iloc[0] - 1) * 100
            data["sector_perf"][label] = round(ret, 2)

    # ── Individual ticker data ──
    if tickers:
        for t in tickers:
            print(f"  Fetching {t}…")
            data[f"price_{t}"]   = fmp_eod(t, days=90)
            data[f"profile_{t}"] = fmp_profile(t)
            data[f"ratios_{t}"]  = fmp_ratios(t)

    return data


# ── HTML compiler ───────────────────────────────────────────────────────────

HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daily Chart Book — {date}</title>
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    font-family: 'IBM Plex Mono', 'Courier New', monospace;
    background: #ffffff; color: #1a1a1a;
    font-size: 13px; line-height: 1.6;
    max-width: 900px; margin: 0 auto; padding: 32px 24px;
  }}
  header {{
    border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 24px;
  }}
  header h1 {{
    font-size: 16px; font-weight: bold; letter-spacing: -0.02em;
    text-transform: uppercase;
  }}
  header .meta {{
    font-size: 11px; color: #6b7280; margin-top: 4px;
    display: flex; gap: 24px; flex-wrap: wrap;
  }}
  .section {{
    border-bottom: 1px dashed #000; padding: 16px 0;
  }}
  .section h2 {{
    font-size: 14px; font-weight: bold; text-transform: uppercase;
    letter-spacing: 0.05em; margin-bottom: 4px;
  }}
  .section .desc {{
    font-size: 11px; color: #6b7280; margin-bottom: 12px;
  }}
  .chart {{
    margin-bottom: 20px; border: 1px solid #d1d5db; padding: 12px;
  }}
  .chart img {{ width: 100%; height: auto; display: block; }}
  .chart .caption {{
    font-size: 10px; color: #6b7280; margin-top: 6px;
    border-top: 1px solid #e5e7eb; padding-top: 4px;
    text-transform: uppercase; letter-spacing: 0.03em;
  }}
  .brief {{
    border: 1px solid #000; padding: 16px; margin: 20px 0;
    background: #f7f6f2;
  }}
  .brief h2 {{
    font-size: 13px; text-transform: uppercase; margin-bottom: 8px;
  }}
  .brief p {{ font-size: 12px; margin-bottom: 8px; }}
  .brief .tags {{
    font-size: 10px; color: #6b7280; text-transform: uppercase;
    letter-spacing: 0.05em; margin-top: 8px;
  }}
  footer {{
    border-top: 2px solid #000; margin-top: 32px; padding-top: 12px;
    font-size: 10px; color: #6b7280;
  }}
</style>
</head>
<body>

<header>
  <h1>Daily Chart Book</h1>
  <div class="meta">
    <span>{date}</span>
    <span>Generated {gen_time}</span>
    <span>{chart_count} charts</span>
  </div>
</header>

{brief_html}

{sections_html}

<footer>
  Data: FRED (Federal Reserve Bank of St. Louis) · FMP (Financial Modeling Prep) ·
  Generated by byProforma Daily Chart Book Bot
</footer>

</body>
</html>
"""

SECTION_TEMPLATE = """<div class="section">
<h2>{title}</h2>
<div class="desc">{desc}</div>
{charts_html}
</div>"""

CHART_TEMPLATE = """<div class="chart">
<img src="data:image/png;base64,{b64}" alt="{name}">
<div class="caption">{caption}</div>
</div>"""


def compile_html(data: dict, chart_results: list, outdir: Path,
                 brief: str = None, news_tags: list = None) -> Path:
    """Compile all charts into a single HTML file."""

    today = datetime.now().strftime("%Y-%m-%d %a")
    gen_time = datetime.now().strftime("%H:%M %Z")

    # Build brief section
    brief_html = ""
    if brief:
        tags_html = ""
        if news_tags:
            tags_html = f'<div class="tags">Themes: {", ".join(news_tags)}</div>'
        brief_html = f"""<div class="brief">
<h2>Market Brief</h2>
<p>{brief}</p>
{tags_html}
</div>"""

    # Group charts into sections
    sections = []
    current_section = None
    current_charts = []
    current_title = ""
    current_desc = ""

    for result in chart_results:
        if result is None or result[0] is None:
            continue
        path, caption, section_title, section_desc = result
        if section_title != current_title:
            if current_charts:
                charts_html = "\n".join(
                    CHART_TEMPLATE.format(
                        b64=_img_b64(p),
                        name=caption[:40],
                        caption=caption,
                    ) for p, c in current_charts
                )
                sections.append(SECTION_TEMPLATE.format(
                    title=current_title, desc=current_desc,
                    charts_html=charts_html,
                ))
            current_title = section_title
            current_desc = section_desc
            current_charts = []

        current_charts.append((path, caption))

    # Flush last section
    if current_charts:
        charts_html = "\n".join(
            CHART_TEMPLATE.format(
                b64=_img_b64(p), name=c[:40], caption=c,
            ) for p, c in current_charts
        )
        sections.append(SECTION_TEMPLATE.format(
            title=current_title, desc=current_desc,
            charts_html=charts_html,
        ))

    sections_html = "\n\n".join(sections)
    chart_count = sum(1 for r in chart_results if r and r[0] is not None)

    html = HTML_TEMPLATE.format(
        date=today, gen_time=gen_time,
        chart_count=chart_count,
        brief_html=brief_html, sections_html=sections_html,
    )

    out_path = outdir / "chartbook.html"
    out_path.write_text(html)
    return out_path


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Daily Chart Book Generator")
    parser.add_argument("--out", type=str, default="chartbook",
                        help="Output directory (default: chartbook)")
    parser.add_argument("--tickers", type=str, nargs="*", default=None,
                        help="Extra tickers for fundamental charts")
    args = parser.parse_args()

    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    chartdir = outdir / "charts"
    chartdir.mkdir(exist_ok=True)

    # Default tickers for fundamentals if none specified
    tickers = args.tickers or ["AAPL", "MSFT", "NVDA", "JPM"]

    # Collect data
    data = collect_data(tickers=tickers)

    # Save raw data
    with open(outdir / "chartbook_data.json", "w") as f:
        # Strip non-serializable
        serializable = {}
        for k, v in data.items():
            if isinstance(v, pd.Series):
                serializable[k] = {str(d.date()): float(val) for d, val in v.items() if math.isfinite(val)}
            elif isinstance(v, pd.DataFrame):
                serializable[k] = v.reset_index().to_dict(orient="records")
            elif isinstance(v, (list, dict, str, int, float)):
                serializable[k] = v
            elif v is None:
                serializable[k] = None
        json.dump(serializable, f, indent=2, default=str)

    # Generate charts
    print("\nGenerating charts…")
    results = []

    # ── Macro section ──
    for fn in [chart_cpi_yoy, chart_yield_spread, chart_hy_spread, chart_oecd_cli, chart_vix]:
        path, caption = fn(data, chartdir)
        results.append((path, caption, "Macroeconomic Indicators",
                         "FRED-sourced macro series — inflation, yield curve, credit, volatility, leading indicators"))

    path, caption = chart_treasury_curve(data, chartdir)
    results.append((path, caption, "Macroeconomic Indicators",
                    "FRED-sourced macro series — inflation, yield curve, credit, leading indicators"))

    path, caption = chart_unemployment(data, chartdir)
    results.append((path, caption, "Macroeconomic Indicators",
                    "FRED-sourced macro series — inflation, yield curve, credit, leading indicators"))

    path, caption = chart_consumer_sentiment(data, chartdir)
    results.append((path, caption, "Macroeconomic Indicators",
                    "FRED-sourced macro series — inflation, yield curve, credit, leading indicators"))

    # ── Market section ──
    path, caption = chart_sp500(data, chartdir)
    results.append((path, caption, "Market Overview",
                     "Broad market performance and sector dynamics"))

    path, caption = chart_sector_perf(data, chartdir)
    results.append((path, caption, "Market Overview",
                     "Broad market performance and sector dynamics"))

    path, caption = chart_econ_calendar(data, chartdir)
    results.append((path, caption, "Market Overview",
                     "Broad market performance and sector dynamics"))

    # ── Fundamentals section ──
    for ticker in tickers:
        ticker_charts = chart_fundamentals(ticker, data, chartdir)
        for path, caption in ticker_charts:
            results.append((path, caption, f"Company Fundamentals — {ticker}",
                            "Price action and key financial ratios for companies in focus"))

    # Compile HTML
    print(f"\nCompiling HTML…")
    # Auto-generate a basic brief from the data
    brief = _auto_brief(data)

    html_path = compile_html(data, results, outdir, brief=brief)
    chart_count = sum(1 for r in results if r and r[0] is not None)

    print(f"\n✓ Chart book generated: {html_path}")
    print(f"  {chart_count} charts compiled")
    print(f"  Open with: open {html_path}")

    return html_path


def _auto_brief(data: dict) -> str:
    """Generate a brief market summary from the collected data."""
    parts = []

    cpi = data.get("cpi")
    if not cpi.empty:
        yoy = (cpi.pct_change(12).dropna() * 100)
        if len(yoy) >= 1:
            parts.append(f"CPI YoY at {yoy.iloc[-1]:.1f}%, "
                        f"3yr avg {yoy.rolling(36, min_periods=3).mean().iloc[-1]:.1f}%.")

    spread = data.get("yield_spread")
    if not spread.empty:
        s_val = spread.iloc[-1]
        if s_val < 0:
            parts.append(f"Yield curve inverted ({s_val:+.2f}pp) — recession signal.")
        else:
            parts.append(f"Yield curve positive ({s_val:+.2f}pp).")

    hy = data.get("hy_spread")
    if not hy.empty:
        hy_val = hy.iloc[-1]
        if hy_val > 5:
            parts.append(f"HY spreads elevated ({hy_val:.1f}pp) — credit stress.")
        else:
            parts.append(f"HY spreads normal ({hy_val:.1f}pp).")

    ue = data.get("unemploymentRate")
    if ue:
        parts.append(f"Unemployment at {ue[0].get('value', '?')}%.")

    vix = data.get("vix")
    if vix is not None and not vix.empty:
        v_val = vix.iloc[-1]
        if v_val > 25:
            parts.append(f"VIX elevated at {v_val:.1f} — risk-off sentiment.")
        elif v_val < 15:
            parts.append(f"VIX subdued at {v_val:.1f} — low volatility regime.")
        else:
            parts.append(f"VIX at {v_val:.1f} — normal volatility.")

    spx = data.get("spx")
    if spx is not None and not spx.empty and len(spx) >= 2:
        ret = (spx["adjClose"].iloc[-1] / spx["adjClose"].iloc[0] - 1) * 100
        parts.append(f"S&P 500 6-month return: {ret:+.1f}%.")

    if not parts:
        return "Data collection in progress — see charts below for current readings."

    return " ".join(parts)


if __name__ == "__main__":
    main()
