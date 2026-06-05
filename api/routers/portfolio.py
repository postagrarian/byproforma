from fastapi import APIRouter, HTTPException
from db.supabase import get_latest_portfolio_run

router = APIRouter()

@router.get("/{slot}")
async def get_portfolio(slot: int):
    if slot < 1 or slot > 5:
        raise HTTPException(status_code=400, detail="Slot must be 1–5")
    result = await get_latest_portfolio_run(slot)
    if not result:
        raise HTTPException(status_code=404, detail="No results yet for this slot")
    return result
