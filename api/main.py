from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio, os
from dotenv import load_dotenv

from routers import etf, portfolio, cron

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

app.include_router(etf.router,       prefix="/etf",      tags=["etf"])
app.include_router(portfolio.router, prefix="/portfolio", tags=["portfolio"])
app.include_router(cron.router,      prefix="/cron",      tags=["cron"])


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/run/{slot}")
async def run_slot(slot: int):
    """
    Kick off the pipeline in a thread so blocking I/O (yfinance, requests)
    doesn't starve the event loop — Railway health checks stay responsive.
    """
    if slot < 1 or slot > 5:
        raise HTTPException(status_code=400, detail="Slot must be 1–5")
    from services.pipeline import run_pipeline_sync
    # Run synchronous pipeline in a thread pool — frees the event loop
    asyncio.get_event_loop().run_in_executor(None, run_pipeline_sync, slot)
    return {"status": "started", "slot": slot}


@app.get("/status/{slot}")
def get_status(slot: int):
    from services.pipeline import get_pipeline_status
    return get_pipeline_status(slot)
