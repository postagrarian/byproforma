"""
FastAPI router for the passive ETF model portfolio builder.

Endpoints:
  /model/cma           — CRUD for capital market assumption sets
  /model/optimize      — run MVO for a target return
  /model/frontier      — compute the efficient frontier
  /model/portfolios    — CRUD for saved model portfolios
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from db.supabase import get_client
from services.model_optimizer import (
    optimize_for_target_return,
    compute_efficient_frontier,
    ASSET_CLASSES,
    TICKERS,
    DEFAULT_CONSTRAINTS,
)

router = APIRouter()


# ── Pydantic models ────────────────────────────────────────────────────────

class CMASetIn(BaseModel):
    name:           str
    description:    str | None = None
    risk_free_rate: float = 0.04
    returns:        dict[str, float]       # ticker → expected return
    volatilities:   dict[str, float]       # ticker → expected vol
    correlations:   list[list[float]]      # 12×12 matrix


class OptimizeRequest(BaseModel):
    target_return:    float                # e.g. 0.08 for 8%
    cma_set_id:       int | None = None    # use specific CMA set; None = active
    constraints:      dict | None = None   # override defaults


class FrontierRequest(BaseModel):
    cma_set_id:  int | None = None
    constraints: dict | None = None
    n_points:    int = 25


class SavePortfolioRequest(BaseModel):
    name:             str
    cma_set_id:       int
    target_weights:   dict[str, float]
    constraints:      dict | None = None
    optimizer_output: dict | None = None


# ── Helpers ────────────────────────────────────────────────────────────────

def _get_cma_set(cma_set_id: int | None) -> dict:
    """Fetch a specific CMA set or the active one."""
    sb = get_client()
    if cma_set_id:
        res = sb.table("model_cma_sets").select("*").eq("id", cma_set_id).execute()
    else:
        res = sb.table("model_cma_sets").select("*").eq("is_active", True).execute()
    if not res.data:
        raise HTTPException(
            status_code=404,
            detail="No CMA set found. Create one first."
        )
    return res.data[0]


# ── CMA CRUD ───────────────────────────────────────────────────────────────

@router.get("/cma")
def list_cma_sets():
    sb = get_client()
    res = sb.table("model_cma_sets").select("*").order("created_at", desc=True).execute()
    return res.data or []


@router.get("/cma/{cma_id}")
def get_cma_set(cma_id: int):
    sb = get_client()
    res = sb.table("model_cma_sets").select("*").eq("id", cma_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="CMA set not found")
    return res.data[0]


@router.post("/cma")
def create_cma_set(body: CMASetIn):
    # Validate that all tickers are present
    missing = set(TICKERS) - set(body.returns.keys())
    if missing:
        raise HTTPException(400, detail=f"Missing return assumptions for: {missing}")
    missing_vol = set(TICKERS) - set(body.volatilities.keys())
    if missing_vol:
        raise HTTPException(400, detail=f"Missing volatility assumptions for: {missing_vol}")
    if len(body.correlations) != len(TICKERS):
        raise HTTPException(400, detail=f"Correlation matrix must be {len(TICKERS)}x{len(TICKERS)}")

    sb = get_client()
    row = {
        "name":           body.name,
        "description":    body.description,
        "risk_free_rate": body.risk_free_rate,
        "returns":        body.returns,
        "volatilities":   body.volatilities,
        "correlations":   body.correlations,
        "is_active":      False,
    }
    res = sb.table("model_cma_sets").insert(row).execute()
    return res.data[0]


@router.put("/cma/{cma_id}")
def update_cma_set(cma_id: int, body: CMASetIn):
    sb = get_client()
    row = {
        "name":           body.name,
        "description":    body.description,
        "risk_free_rate": body.risk_free_rate,
        "returns":        body.returns,
        "volatilities":   body.volatilities,
        "correlations":   body.correlations,
        "updated_at":     "now()",
    }
    res = sb.table("model_cma_sets").update(row).eq("id", cma_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="CMA set not found")
    return res.data[0]


@router.delete("/cma/{cma_id}")
def delete_cma_set(cma_id: int):
    sb = get_client()
    sb.table("model_cma_sets").delete().eq("id", cma_id).execute()
    return {"deleted": cma_id}


@router.post("/cma/{cma_id}/activate")
def activate_cma_set(cma_id: int):
    sb = get_client()
    # Deactivate all
    sb.table("model_cma_sets").update({"is_active": False}).eq("is_active", True).execute()
    # Activate this one
    res = sb.table("model_cma_sets").update({"is_active": True}).eq("id", cma_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="CMA set not found")
    return res.data[0]


# ── Optimizer ──────────────────────────────────────────────────────────────

@router.post("/optimize")
def run_optimize(body: OptimizeRequest):
    cma = _get_cma_set(body.cma_set_id)
    try:
        result = optimize_for_target_return(
            expected_returns=cma["returns"],
            volatilities=cma["volatilities"],
            correlations=cma["correlations"],
            target_return=body.target_return,
            risk_free_rate=cma.get("risk_free_rate", 0.04),
            constraints=body.constraints,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


@router.post("/frontier")
def run_frontier(body: FrontierRequest):
    cma = _get_cma_set(body.cma_set_id)
    frontier = compute_efficient_frontier(
        expected_returns=cma["returns"],
        volatilities=cma["volatilities"],
        correlations=cma["correlations"],
        risk_free_rate=cma.get("risk_free_rate", 0.04),
        constraints=body.constraints,
        n_points=body.n_points,
    )
    return {"frontier": frontier, "asset_classes": ASSET_CLASSES}


# ── Portfolio CRUD ─────────────────────────────────────────────────────────

@router.get("/portfolios")
def list_portfolios():
    sb = get_client()
    res = sb.table("model_portfolios").select("*").order("created_at", desc=True).execute()
    return res.data or []


@router.get("/portfolios/{portfolio_id}")
def get_portfolio(portfolio_id: int):
    sb = get_client()
    res = sb.table("model_portfolios").select("*").eq("id", portfolio_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return res.data[0]


@router.post("/portfolios")
def create_portfolio(body: SavePortfolioRequest):
    sb = get_client()
    row = {
        "name":             body.name,
        "cma_set_id":       body.cma_set_id,
        "target_weights":   body.target_weights,
        "constraints":      body.constraints,
        "optimizer_output": body.optimizer_output,
        "is_active":        False,
    }
    res = sb.table("model_portfolios").insert(row).execute()
    return res.data[0]


@router.put("/portfolios/{portfolio_id}")
def update_portfolio(portfolio_id: int, body: SavePortfolioRequest):
    sb = get_client()
    row = {
        "name":             body.name,
        "cma_set_id":       body.cma_set_id,
        "target_weights":   body.target_weights,
        "constraints":      body.constraints,
        "optimizer_output": body.optimizer_output,
        "updated_at":       "now()",
    }
    res = sb.table("model_portfolios").update(row).eq("id", portfolio_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return res.data[0]


@router.post("/portfolios/{portfolio_id}/activate")
def activate_portfolio(portfolio_id: int):
    sb = get_client()
    sb.table("model_portfolios").update({"is_active": False}).eq("is_active", True).execute()
    res = sb.table("model_portfolios").update({"is_active": True}).eq("id", portfolio_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return res.data[0]


@router.delete("/portfolios/{portfolio_id}")
def delete_portfolio(portfolio_id: int):
    sb = get_client()
    sb.table("model_portfolios").delete().eq("id", portfolio_id).execute()
    return {"deleted": portfolio_id}


# ── Reference data ─────────────────────────────────────────────────────────

@router.get("/asset-classes")
def get_asset_classes():
    return {
        "asset_classes": ASSET_CLASSES,
        "tickers":       TICKERS,
        "default_constraints": DEFAULT_CONSTRAINTS,
    }
