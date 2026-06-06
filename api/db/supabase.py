import os
from supabase import create_client, Client

_client: Client | None = None

def get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(
            os.environ["SUPABASE_URL"],
            os.environ["SUPABASE_SERVICE_KEY"],
        )
    return _client


async def get_configured_slots() -> list[int]:
    sb = get_client()
    res = sb.table("etf_config").select("slot, ticker").execute()
    return [r["slot"] for r in (res.data or []) if r.get("ticker")]


async def get_all_etf_configs() -> list[dict]:
    """Return all 5 slot configs, filling missing slots with empty placeholders."""
    sb = get_client()
    res = sb.table("etf_config").select("*").order("slot").execute()
    saved = {r["slot"]: r for r in (res.data or [])}
    return [
        saved.get(slot, {"slot": slot, "ticker": None, "last_run_date": None})
        for slot in range(1, 6)
    ]


async def upsert_etf_config(slot: int, ticker: str):
    sb = get_client()
    sb.table("etf_config").upsert({
        "slot": slot,
        "ticker": ticker,
        "updated_at": "now()",
    }).execute()


async def get_etf_config(slot: int):
    sb = get_client()
    res = sb.table("etf_config").select("*").eq("slot", slot).single().execute()
    return res.data


async def get_latest_portfolio_run(slot: int):
    sb = get_client()
    res = (
        sb.table("portfolio_runs")
        .select("*")
        .eq("slot", slot)
        .order("run_date", desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


async def upsert_portfolio_run(slot: int, etf_ticker: str, payload: dict):
    sb = get_client()
    sb.table("portfolio_runs").insert({
        "slot":            slot,
        "etf_ticker":      etf_ticker,
        "run_date":        payload["run_date"],
        "sector_weights":  payload["sector_weights"],
        "factor_loadings": payload["factor_loadings"],
        "portfolio":       payload["portfolio"],
        "factor_rmse":     payload["factor_rmse"],
        "max_sector_diff": payload["max_sector_diff"],
    }).execute()

    # Update last_run_date on config
    sb.table("etf_config").update({
        "last_run_date": payload["run_date"]
    }).eq("slot", slot).execute()


# ── Price cache ──────────────────────────────────────────────────────────────
async def get_cached_prices(ticker: str, start: str) -> list[dict] | None:
    sb = get_client()
    res = (
        sb.table("price_history")
        .select("date, monthly_return")
        .eq("ticker", ticker)
        .gte("date", start)
        .order("date")
        .execute()
    )
    return res.data if res.data else None


async def upsert_prices(ticker: str, rows: list[dict]):
    sb = get_client()
    sb.table("price_history").upsert(
        [{"ticker": ticker, **r} for r in rows],
        on_conflict="ticker,date",
    ).execute()


# ── Factor cache ─────────────────────────────────────────────────────────────
async def get_cached_factors(start: str) -> list[dict] | None:
    sb = get_client()
    res = (
        sb.table("ff_factors")
        .select("*")
        .gte("date", start)
        .order("date")
        .execute()
    )
    return res.data if res.data else None


async def upsert_factors(rows: list[dict]):
    sb = get_client()
    sb.table("ff_factors").upsert(rows, on_conflict="date").execute()


# ── Regression cache ─────────────────────────────────────────────────────────
async def get_cached_loadings(ticker: str) -> list[dict] | None:
    sb = get_client()
    res = (
        sb.table("factor_loadings")
        .select("*")
        .eq("ticker", ticker)
        .order("window_end_date", desc=True)
        .limit(1)
        .execute()
    )
    return res.data if res.data else None


async def upsert_loadings(rows: list[dict]):
    sb = get_client()
    sb.table("factor_loadings").upsert(rows, on_conflict="ticker,window_end_date").execute()
