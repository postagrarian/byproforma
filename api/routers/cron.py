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
