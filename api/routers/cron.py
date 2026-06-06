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
