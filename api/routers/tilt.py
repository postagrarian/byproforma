from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from db.supabase import get_client
import asyncio
from concurrent.futures import ThreadPoolExecutor

router    = APIRouter()
_executor = ThreadPoolExecutor(max_workers=3)


class TiltRunRequest(BaseModel):
    foundational_slot: int
    factor_targets:    dict
    optimization_mode: str


class SaveTiltRequest(BaseModel):
    name: str


@router.post("/run")
async def run_tilt(body: TiltRunRequest):
    if body.foundational_slot < 1 or body.foundational_slot > 5:
        raise HTTPException(status_code=400, detail="foundational_slot must be 1–5")
    if body.optimization_mode not in ("factor_betas", "sector_exposure"):
        raise HTTPException(status_code=400, detail="Invalid optimization_mode")
    from services.tilt_pipeline import run_tilt_sync
    loop = asyncio.get_event_loop()
    loop.run_in_executor(_executor, run_tilt_sync,
                         body.foundational_slot, body.factor_targets, body.optimization_mode)
    return {"status": "started"}


@router.get("/status")
def get_tilt_status():
    from services.tilt_pipeline import get_tilt_status
    return get_tilt_status()


@router.get("/latest")
def get_latest_tilt():
    sb  = get_client()
    res = (sb.table("tilt_portfolio_runs")
             .select("*")
             .order("created_at", desc=True)
             .limit(1)
             .execute())
    if not res.data:
        raise HTTPException(status_code=404, detail="No tilt runs yet")
    return res.data[0]


@router.get("/saved")
def get_saved_tilts():
    sb  = get_client()
    res = (sb.table("tilt_portfolio_runs")
             .select("*")
             .eq("is_saved", True)
             .order("created_at", desc=True)
             .execute())
    return res.data or []


@router.patch("/{run_id}/save")
def save_tilt(run_id: int, body: SaveTiltRequest):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    sb = get_client()
    res = sb.table("tilt_portfolio_runs").update({
        "is_saved": True,
        "name":     name,
    }).eq("id", run_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Run not found")
    return res.data[0]


@router.delete("/{run_id}")
def delete_tilt(run_id: int):
    sb = get_client()
    sb.table("tilt_portfolio_runs").delete().eq("id", run_id).execute()
    return {"deleted": run_id}


@router.get("/{run_id}/positions")
def get_positions(run_id: int, portfolio_value: float):
    """
    Return portfolio holdings enriched with last price, dollar value, and share count
    for a given total portfolio value.
    """
    sb  = get_client()
    res = sb.table("tilt_portfolio_runs").select("portfolio").eq("id", run_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Run not found")

    portfolio = res.data.get("portfolio") or []
    tickers   = [h["ticker"] for h in portfolio if h.get("ticker")]

    # Batch-fetch last prices from FMP
    prices = _fetch_last_prices(tickers)

    positions = []
    for h in portfolio:
        tk          = h["ticker"]
        weight      = float(h.get("weight", 0))
        last_price  = prices.get(tk)
        dollar_val  = round(portfolio_value * weight, 2)
        shares      = round(dollar_val / last_price) if last_price else None
        mkt_val     = round(shares * last_price, 2)  if shares and last_price else None
        positions.append({
            "ticker":       tk,
            "name":         h.get("name", ""),
            "sector":       h.get("sector", ""),
            "weight":       weight,
            "dollar_value": dollar_val,
            "last_price":   last_price,
            "shares":       shares,
            "market_value": mkt_val,
        })

    # Sort by dollar value descending
    positions.sort(key=lambda x: x["dollar_value"], reverse=True)
    return {"positions": positions, "portfolio_value": portfolio_value}


def _fetch_last_prices(tickers: list[str]) -> dict[str, float]:
    """Fetch last traded prices from FMP for a list of tickers."""
    import os, requests
    from concurrent.futures import ThreadPoolExecutor, as_completed

    api_key  = os.environ.get("FMP_API_KEY", "")
    base     = "https://financialmodelingprep.com/stable"
    price_map: dict[str, float] = {}

    def fetch_one(tk: str) -> tuple[str, float | None]:
        try:
            r = requests.get(
                f"{base}/profile",
                params={"symbol": tk, "apikey": api_key},
                timeout=10,
            )
            data = r.json()
            if data and isinstance(data, list):
                return tk, float(data[0].get("price") or 0) or None
        except Exception:
            pass
        return tk, None

    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(fetch_one, tk): tk for tk in tickers}
        for f in as_completed(futures):
            tk, price = f.result()
            if price:
                price_map[tk] = price

    return price_map
