from fastapi import FastAPI, HTTPException, BackgroundTasks
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
async def run_slot(slot: int, background_tasks: BackgroundTasks):
    """Kick off the pipeline in the background and return immediately.
    The browser can navigate away — Railway keeps running the job."""
    if slot < 1 or slot > 5:
        raise HTTPException(status_code=400, detail="Slot must be 1–5")
    from services.pipeline import run_pipeline
    background_tasks.add_task(run_pipeline, slot)
    return {"status": "started", "slot": slot}


@app.get("/status/{slot}")
def get_status(slot: int):
    from services.pipeline import get_pipeline_status
    return get_pipeline_status(slot)
