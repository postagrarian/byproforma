from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os
from dotenv import load_dotenv

from routers import etf, portfolio, cron

load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield

app = FastAPI(title="byProforma API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # tighten to Vercel domain in production
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(etf.router,       prefix="/etf",      tags=["etf"])
app.include_router(portfolio.router, prefix="/portfolio", tags=["portfolio"])
app.include_router(cron.router,      prefix="/cron",      tags=["cron"])


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/run/{slot}")
async def run_slot(slot: int):
    """Trigger full pipeline for one ETF slot (1–5)."""
    if slot < 1 or slot > 5:
        raise HTTPException(status_code=400, detail="Slot must be 1–5")
    from services.pipeline import run_pipeline
    result = await run_pipeline(slot)
    return result


@app.get("/status/{slot}")
def get_status(slot: int):
    from services.pipeline import get_pipeline_status
    return get_pipeline_status(slot)
