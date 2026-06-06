from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from db.supabase import get_client
import asyncio
from concurrent.futures import ThreadPoolExecutor

router   = APIRouter()
_executor = ThreadPoolExecutor(max_workers=3)

TILT_SLOT = -1   # sentinel for pipeline status

class TiltRunRequest(BaseModel):
    foundational_slot: int
    factor_targets:    dict   # {factor_name: float}
    optimization_mode: str    # 'factor_betas' | 'sector_exposure'

@router.post("/run")
async def run_tilt(body: TiltRunRequest):
    if body.foundational_slot < 1 or body.foundational_slot > 5:
        raise HTTPException(status_code=400, detail="foundational_slot must be 1–5")
    if body.optimization_mode not in ("factor_betas", "sector_exposure"):
        raise HTTPException(status_code=400, detail="Invalid optimization_mode")

    from services.tilt_pipeline import run_tilt_sync
    loop = asyncio.get_event_loop()
    loop.run_in_executor(
        _executor,
        run_tilt_sync,
        body.foundational_slot,
        body.factor_targets,
        body.optimization_mode,
    )
    return {"status": "started"}

@router.get("/latest")
def get_latest_tilt():
    sb  = get_client()
    res = (
        sb.table("tilt_portfolio_runs")
        .select("*")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="No tilt runs yet")
    return res.data[0]

@router.get("/status")
def get_tilt_status():
    from services.tilt_pipeline import get_tilt_status
    return get_tilt_status()
