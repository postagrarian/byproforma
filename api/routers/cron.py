from fastapi import APIRouter, Header, HTTPException
import os, asyncio
from concurrent.futures import ThreadPoolExecutor
from services.pipeline import run_pipeline_sync
from db.supabase import get_configured_slots

router = APIRouter()

_executor = ThreadPoolExecutor(max_workers=5)

@router.post("/refresh")
async def cron_refresh(authorization: str = Header(None)):
    secret = os.getenv("CRON_SECRET", "")
    if authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    slots = await get_configured_slots()
    if not slots:
        return {"message": "No slots configured", "ran": []}

    loop = asyncio.get_event_loop()
    results = await asyncio.gather(
        *[loop.run_in_executor(_executor, run_pipeline_sync, s) for s in slots],
        return_exceptions=True,
    )

    ran = [
        {"slot": s, "status": "error", "detail": str(r)} if isinstance(r, Exception)
        else {"slot": s, "status": "ok"}
        for s, r in zip(slots, results)
    ]
    return {"message": "Cron refresh complete", "ran": ran}


@router.post("/refresh-regime")
async def refresh_regime(authorization: str = Header(None)):
    """Refresh the regime cache from FRED and save to Supabase."""
    secret = os.getenv("CRON_SECRET", "")
    if authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")
    from services.regime import build_regime_payload
    from db.supabase import get_client
    try:
        payload = build_regime_payload()
    except Exception as e:
        print(f"[regime] build_regime_payload failed: {e}")
        raise HTTPException(status_code=500, detail=f"Regime build failed: {e}")
    sb = get_client()
    try:
        sb.table("regime_cache").upsert({"id": 1, "payload": payload, "updated_at": "now()"}).execute()
    except Exception as e:
        print(f"[regime] Cache write failed: {e}")
        raise HTTPException(status_code=500, detail=f"Regime computed but cache write failed: {e}")
    return {"message": f"Regime updated: {payload['regime']}", "updated_at": payload["updatedAt"]}


@router.post("/daily-performance")
async def daily_performance(
    authorization: str = Header(None),
    trade_date: str | None = None,
):
    """
    Weekday end-of-day cron — calculates Live Portfolio daily performance
    vs VOO and the Foundational ETF, stores results in portfolio_performance.

    trade_date: optional YYYY-MM-DD override for backfilling past days.
    When provided, the live_since same-day guard is skipped so inception
    day can be replayed.
    """
    secret = os.getenv("CRON_SECRET", "")
    if authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    from db.supabase import get_client
    from services.performance import compute_daily_performance

    sb = get_client()

    # Get the live portfolio
    res = (sb.table("tilt_portfolio_runs")
             .select("*")
             .eq("is_live", True)
             .eq("is_saved", True)
             .limit(1)
             .execute())
    if not res.data:
        return {"message": "No live portfolio set — skipping", "updated": False}

    live_run = res.data[0]

    # If the portfolio was designated live today (ET), skip — tracking starts tomorrow.
    # Bypassed when trade_date is explicitly supplied (backfill / replay).
    if not trade_date:
        from datetime import datetime, timezone
        from zoneinfo import ZoneInfo
        ET = ZoneInfo("America/New_York")
        live_since = live_run.get("live_since")
        if live_since:
            try:
                dt = datetime.fromisoformat(live_since)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                if dt.astimezone(ET).date() == datetime.now(ET).date():
                    return {"message": "Live portfolio set today — tracking begins tomorrow", "updated": False}
            except Exception:
                pass

    payload = compute_daily_performance(live_run, trade_date=trade_date)

    sb.table("portfolio_performance").upsert(payload, on_conflict="date").execute()
    return {
        "message":          f"Performance recorded for {payload['date']}",
        "portfolio_return": payload["portfolio_return"],
        "cumulative":       payload["cumulative_return"],
        "updated":          True,
    }


@router.post("/refresh-factors")
async def refresh_factors(authorization: str = Header(None)):
    """
    Daily cron — checks whether Ken French has published new factor data
    since the last cached date and upserts any new months found.
    """
    secret = os.getenv("CRON_SECRET", "")
    if authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    from db.supabase import get_client
    from services.factors import fetch_factors, factors_to_rows

    sb = get_client()

    # Latest date already cached
    cached = sb.table("ff_factors").select("date").order("date", desc=True).limit(1).execute()
    latest_cached = cached.data[0]["date"] if cached.data else None

    # Fetch from Ken French
    try:
        factor_df   = fetch_factors()
        factor_rows = factors_to_rows(factor_df)
    except Exception as exc:
        return {"message": f"Ken French fetch failed: {exc}", "updated": False}

    if not factor_rows:
        return {"message": "No factor data returned", "updated": False}

    latest_available = factor_rows[-1]["date"]

    if latest_cached and latest_available <= latest_cached:
        return {
            "message": f"Already up to date — latest: {latest_cached}",
            "updated": False,
        }

    # New months available — upsert
    for i in range(0, len(factor_rows), 500):
        sb.table("ff_factors").upsert(factor_rows[i : i + 500], on_conflict="date").execute()

    return {
        "message":       f"Factor data updated through {latest_available}",
        "updated":       True,
        "previous":      latest_cached,
        "new_latest":    latest_available,
        "months_added":  len([r for r in factor_rows if not latest_cached or r["date"] > latest_cached]),
    }
