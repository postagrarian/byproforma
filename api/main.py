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


@app.get("/public/regime")
def public_regime(refresh: bool = False):
    """
    Returns the current macro regime payload from Supabase cache.
    If the cache is stale (>6h) or refresh=true, re-fetches from FRED and saves.
    No auth required — used by the public Regime Monitor page.
    """
    from datetime import datetime, timezone, timedelta
    from services.regime import build_regime_payload

    sb = __import__('db.supabase', fromlist=['get_client']).get_client()

    try:
        if not refresh:
            res = sb.table("regime_cache").select("payload, updated_at").eq("id", 1).execute()
            if res.data:
                updated = datetime.fromisoformat(res.data[0]["updated_at"].replace("Z", "+00:00"))
                if datetime.now(timezone.utc) - updated < timedelta(hours=6):
                    return res.data[0]["payload"]
    except Exception as e:
        print(f"[regime] Cache read failed (table may not exist): {e}")

    payload = build_regime_payload()

    try:
        sb.table("regime_cache").upsert({"id": 1, "payload": payload, "updated_at": "now()"}).execute()
    except Exception as e:
        print(f"[regime] Cache write failed: {e}")

    return payload


@app.get("/notes")
def get_notes():
    """All blog posts, newest first."""
    sb  = __import__('db.supabase', fromlist=['get_client']).get_client()
    res = sb.table("notes_posts").select("*").order("date", desc=True).order("created_at", desc=True).execute()
    return res.data or []

@app.post("/notes")
def create_note(body: dict):
    from datetime import date as dt
    sb = __import__('db.supabase', fromlist=['get_client']).get_client()
    row = {
        "date":    body.get("date") or dt.today().strftime("%Y-%m-%d"),
        "title":   (body.get("title") or "").strip() or None,
        "content": body["content"],
    }
    res = sb.table("notes_posts").insert(row).execute()
    return res.data[0]

@app.delete("/notes/{note_id}")
def delete_note(note_id: int):
    sb = __import__('db.supabase', fromlist=['get_client']).get_client()
    sb.table("notes_posts").delete().eq("id", note_id).execute()
    return {"deleted": note_id}


@app.get("/public/performance")
def public_performance(limit: int = 60):
    """Returns daily performance entries, newest first. No auth — gated by frontend."""
    sb  = __import__('db.supabase', fromlist=['get_client']).get_client()
    res = sb.table("portfolio_performance").select("*").order("date", desc=True).limit(limit).execute()
    return res.data or []


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


