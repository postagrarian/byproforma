from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio, os
from dotenv import load_dotenv

from routers import etf, portfolio, cron, tilt

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


@app.get("/health")
def health():
    return {"status": "ok"}


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


