from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from db.supabase import upsert_etf_config, get_etf_config

router = APIRouter()

class ETFConfigIn(BaseModel):
    ticker: str

@router.post("/config/{slot}")
async def set_config(slot: int, body: ETFConfigIn):
    if slot < 1 or slot > 5:
        raise HTTPException(status_code=400, detail="Slot must be 1–5")
    await upsert_etf_config(slot, body.ticker.upper())
    return {"slot": slot, "ticker": body.ticker.upper()}

@router.get("/config/{slot}")
async def get_config(slot: int):
    cfg = await get_etf_config(slot)
    if not cfg:
        raise HTTPException(status_code=404, detail="Slot not configured")
    return cfg
