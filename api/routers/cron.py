from fastapi import APIRouter, Header, HTTPException
import os, asyncio
from services.pipeline import run_pipeline
from db.supabase import get_configured_slots

router = APIRouter()

@router.post("/refresh")
async def cron_refresh(authorization: str = Header(None)):
    secret = os.getenv("CRON_SECRET", "")
    if authorization != f"Bearer {secret}":
        raise HTTPException(status_code=401, detail="Unauthorized")

    slots = await get_configured_slots()
    if not slots:
        return {"message": "No slots configured", "ran": []}

    results = await asyncio.gather(*[run_pipeline(s) for s in slots], return_exceptions=True)
    ran = []
    for slot, res in zip(slots, results):
        if isinstance(res, Exception):
            ran.append({"slot": slot, "status": "error", "detail": str(res)})
        else:
            ran.append({"slot": slot, "status": "ok"})

    return {"message": "Cron refresh complete", "ran": ran}
