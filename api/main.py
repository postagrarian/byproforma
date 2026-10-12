from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio, os
from dotenv import load_dotenv

from routers import etf, portfolio, cron, tilt, rebalance

load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield

app = FastAPI(title="byProforma API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(etf.router,       prefix="/etf",       tags=["etf"])
app.include_router(portfolio.router, prefix="/portfolio",  tags=["portfolio"])
app.include_router(cron.router,      prefix="/cron",       tags=["cron"])
app.include_router(tilt.router,      prefix="/tilt",       tags=["tilt"])
app.include_router(rebalance.router, prefix="/rebalance",   tags=["rebalance"])


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/public/regime")
def public_regime(refresh: bool = False):
    """
    Returns the current macro regime payload from Supabase cache.
    If the cache is stale (>6h) or refresh=true, re-fetches from FRED and saves.
    No auth required — used by the public Regime Monitor page.
    """
    from datetime import datetime, timezone, timedelta
    from services.regime import build_regime_payload

    sb = __import__('db.supabase', fromlist=['get_client']).get_client()

    try:
        if not refresh:
            res = sb.table("regime_cache").select("payload, updated_at").eq("id", 1).execute()
            if res.data:
                updated = datetime.fromisoformat(res.data[0]["updated_at"].replace("Z", "+00:00"))
                if datetime.now(timezone.utc) - updated < timedelta(hours=6):
                    return res.data[0]["payload"]
    except Exception as e:
        print(f"[regime] Cache read failed (table may not exist): {e}")

    payload = build_regime_payload()

    try:
        sb.table("regime_cache").upsert({"id": 1, "payload": payload, "updated_at": "now()"}).execute()
    except Exception as e:
        print(f"[regime] Cache write failed: {e}")

    return payload


@app.get("/notes")
def get_notes():
    """All blog posts, newest first."""
    sb  = __import__('db.supabase', fromlist=['get_client']).get_client()
    try:
        res = sb.table("notes_posts").select("*").order("date", desc=True).order("created_at", desc=True).execute()
        return res.data or []
    except Exception:
        return []

@app.post("/notes")
def create_note(body: dict):
    from datetime import date as dt
    sb = __import__('db.supabase', fromlist=['get_client']).get_client()
    row = {
        "date":    body.get("date") or dt.today().strftime("%Y-%m-%d"),
        "title":   (body.get("title") or "").strip() or None,
        "content": body["content"],
    }
    res = sb.table("notes_posts").insert(row).execute()
    return res.data[0]

@app.delete("/notes/{note_id}")
def delete_note(note_id: int):
    sb = __import__('db.supabase', fromlist=['get_client']).get_client()
    sb.table("notes_posts").delete().eq("id", note_id).execute()
    return {"deleted": note_id}


@app.get("/public/performance")
def public_performance(limit: int = 60):
    """Returns daily performance entries, newest first. No auth — gated by frontend."""
    sb  = __import__('db.supabase', fromlist=['get_client']).get_client()
    res = sb.table("portfolio_performance").select("*").order("date", desc=True).limit(limit).execute()
    return res.data or []


@app.get("/public/performance/{trade_date}/holdings")
def performance_holdings(trade_date: str):
    """
    Returns per-holding returns for a given trade date using FMP prices.
    Falls back to the current live portfolio if no performance record exists for that date.
    """
    from datetime import date, timedelta
    from services.performance import fetch_returns

    sb = __import__('db.supabase', fromlist=['get_client']).get_client()

    # Resolve which portfolio was live on that date
    perf_row = sb.table("portfolio_performance").select("live_portfolio_id").eq("date", trade_date).limit(1).execute()
    if perf_row.data:
        run_id = perf_row.data[0]["live_portfolio_id"]
        run_res = sb.table("tilt_portfolio_runs").select("*").eq("id", run_id).limit(1).execute()
    else:
        run_res = sb.table("tilt_portfolio_runs").select("*").eq("is_live", True).eq("is_saved", True).limit(1).execute()

    if not run_res.data:
        raise HTTPException(status_code=404, detail="No portfolio found for this date")

    live_run = run_res.data[0]
    holdings = live_run.get("portfolio") or []

    # Prior trading day (walk back weekends)
    d = date.fromisoformat(trade_date) - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    yesterday = d.strftime("%Y-%m-%d")

    tickers = [h["ticker"] for h in holdings]
    returns = fetch_returns(tickers, trade_date, yesterday)

    rows = []
    for h in holdings:
        tk  = h["ticker"]
        ret = returns.get(tk)
        rows.append({
            "ticker":     tk,
            "name":       h.get("name", ""),
            "weight":     h.get("weight"),
            "return_pct": round(ret * 100, 3) if ret is not None else None,
        })

    rows.sort(key=lambda x: (x["return_pct"] is None, -(x["return_pct"] or 0)))

    advances = sum(1 for r in rows if r["return_pct"] is not None and r["return_pct"] > 0)
    declines = sum(1 for r in rows if r["return_pct"] is not None and r["return_pct"] < 0)
    unchanged = sum(1 for r in rows if r["return_pct"] is not None and r["return_pct"] == 0)

    return {
        "date":             trade_date,
        "portfolio_name":   live_run.get("name"),
        "holdings":         rows,
        "advances":         advances,
        "declines":         declines,
        "unchanged":        unchanged,
        "ad_ratio":         round(advances / declines, 2) if declines else None,
    }


@app.get("/public/performance/{trade_date}/attribution")
def performance_attribution(trade_date: str):
    """
    Brinson-Hood-Beebower attribution for a given trade date.
    Decomposes active return vs VOO (S&P 500) into allocation and selection
    effect per sector.

    VOO is the attribution benchmark because the SPDR sector ETFs used as
    sector return proxies (XLK, XLE, etc.) track S&P 500 sectors — so the
    BHB math closes with minimal residual. Overall performance vs VO (the
    foundational ETF) is tracked separately in the performance chart.
    """
    from services.performance import fetch_etf_sector_weights

    sb = __import__('db.supabase', fromlist=['get_client']).get_client()

    rec = sb.table("portfolio_performance").select("*").eq("date", trade_date).limit(1).execute()
    if not rec.data:
        raise HTTPException(status_code=404, detail=f"No performance record for {trade_date}")

    r               = rec.data[0]
    sector_data     = r.get("sector_data") or {}
    port_sectors    = {s["sector"]: s for s in sector_data.get("portfolio", [])}
    spdr_returns    = {s["sector"]: s for s in sector_data.get("etf", [])}
    bench_total_ret = r.get("sp500_return") or 0.0
    port_total_ret  = r.get("portfolio_return") or 0.0

    # Use VOO sector weights stored at cron time (reproducible for historical dates).
    # Fall back to a live FMP fetch if the row predates this field.
    raw_voo = r.get("voo_sector_weights") or fetch_etf_sector_weights("VOO")
    bench_w = {row["sector"]: row["weight"] for row in raw_voo}

    all_sectors = set(list(port_sectors.keys()) + list(bench_w.keys()))

    rows = []
    for sector in all_sectors:
        port = port_sectors.get(sector, {})
        w_p  = port.get("weight", 0.0)
        r_p  = (port.get("return_pct") or 0.0) / 100

        w_b       = bench_w.get(sector, 0.0)
        spdr      = spdr_returns.get(sector, {})
        r_b       = (spdr.get("return_pct") or 0.0) / 100

        allocation  = (w_p - w_b) * (r_b - bench_total_ret)
        selection   = w_b * (r_p - r_b)
        interaction = (w_p - w_b) * (r_p - r_b)

        rows.append({
            "sector":           sector,
            "portfolio_weight": round(w_p * 100, 2),
            "benchmark_weight": round(w_b * 100, 2),
            "active_weight":    round((w_p - w_b) * 100, 2),
            "portfolio_return": round(r_p * 100, 3),
            "benchmark_return": round(r_b * 100, 3),
            "allocation_bps":   round(allocation * 10000, 2),
            "selection_bps":    round(selection * 10000, 2),
            "interaction_bps":  round(interaction * 10000, 2),
            "total_bps":        round((allocation + selection + interaction) * 10000, 2),
        })

    rows.sort(key=lambda x: abs(x["total_bps"]), reverse=True)

    total_alloc   = sum(x["allocation_bps"]   for x in rows)
    total_sel     = sum(x["selection_bps"]     for x in rows)
    total_inter   = sum(x["interaction_bps"]   for x in rows)
    active_return = port_total_ret - bench_total_ret

    return {
        "date":                   trade_date,
        "benchmark":              "VOO",
        "portfolio_return_pct":   round(port_total_ret * 100, 4),
        "benchmark_return_pct":   round(bench_total_ret * 100, 4),
        "active_return_bps":      round(active_return * 10000, 2),
        "allocation_effect_bps":  round(total_alloc, 2),
        "selection_effect_bps":   round(total_sel, 2),
        "interaction_effect_bps": round(total_inter, 2),
        "explained_bps":          round(total_alloc + total_sel + total_inter, 2),
        "sectors":                rows,
    }


@app.get("/public/factors")
def public_factors(months: int = 14):
    """Public — no auth. Returns recent FF5+Mom monthly factor returns from cache."""
    sb  = __import__('db.supabase', fromlist=['get_client']).get_client()
    res = sb.table("ff_factors").select("*").order("date", desc=True).limit(months).execute()
    return list(reversed(res.data or []))


@app.post("/run/{slot}")
async def run_slot(slot: int):
    if slot < 1 or slot > 5:
        raise HTTPException(status_code=400, detail="Slot must be 1–5")
    from services.pipeline import run_pipeline_sync
    asyncio.get_event_loop().run_in_executor(None, run_pipeline_sync, slot)
    return {"status": "started", "slot": slot}


@app.get("/status/{slot}")
def get_status(slot: int):
    from services.pipeline import get_pipeline_status
    return get_pipeline_status(slot)


