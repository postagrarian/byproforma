from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from db.supabase import get_client

router = APIRouter()


class PreviewRequest(BaseModel):
    run_id:         int
    target_factors: dict
    alpha:          float   # 0 = conservative (minimize turnover), 1 = aggressive (hit targets)


class CommitRequest(BaseModel):
    preview:  dict
    name:     str
    set_live: bool = False


@router.post("/preview")
def preview(body: PreviewRequest):
    if not 0.0 <= body.alpha <= 1.0:
        raise HTTPException(status_code=400, detail="alpha must be between 0 and 1")
    try:
        from services.rebalance import preview_rebalance
        return preview_rebalance(body.run_id, body.target_factors, body.alpha, get_client())
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/commit")
def commit(body: CommitRequest):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    try:
        from services.rebalance import commit_rebalance
        return commit_rebalance(body.preview, body.name.strip(), body.set_live, get_client())
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
