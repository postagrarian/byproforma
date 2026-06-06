"""
Tilt Portfolio Pipeline

Builds an "Active Tilt" portfolio by:
1. Collecting all unique stocks from every configured replication portfolio run
2. Getting their factor betas from the factor_loadings cache
3. Running QP with user-specified factor targets and appropriate sector tolerance
4. 25–40 positions, drawn from the full cross-portfolio universe

Sector tolerance:
  factor_betas mode    → ±10% (free to drift for factor precision)
  sector_exposure mode → ±3%  (tight sector discipline)
"""
from datetime import date
import numpy as np
import pandas as pd

from db.supabase import get_client
from services import optimizer as svc_opt
from services.regression import betas_to_array, estimate_latest_betas
from services.factors import rows_to_dataframe
from services.prices import rows_to_series

FACTOR_COLS_DB = ["beta_mkt", "beta_smb", "beta_hml", "beta_rmw", "beta_cma", "beta_mom"]
FACTOR_NAMES   = ["Mkt-RF",   "SMB",      "HML",      "RMW",      "CMA",      "Mom"]

_STATUS: dict = {"stage": "idle", "message": "", "progress": 0}


def get_tilt_status() -> dict:
    return _STATUS


def _set(stage: str, message: str, progress: int):
    global _STATUS
    _STATUS = {"stage": stage, "message": message, "progress": progress}
    print(f"[tilt] {stage} {progress}% — {message}")


def run_tilt_sync(
    foundational_slot: int,
    factor_targets: dict,      # {"Mkt-RF": 1.1, "SMB": 0.4, ...}
    optimization_mode: str,    # "factor_betas" | "sector_exposure"
) -> dict:
    try:
        return _run(foundational_slot, factor_targets, optimization_mode)
    except Exception as exc:
        import traceback
        traceback.print_exc()
        _set("error", str(exc), 0)
        raise


def _compute_portfolio_r2(portfolio_items: list[dict], sb) -> float | None:
    """
    Compute the tilt portfolio's R² by building the weighted return series
    from cached price history and regressing on the most recent factor data.
    """
    try:
        active = {
            item["ticker"]: float(item["weight"])
            for item in portfolio_items
            if float(item.get("weight", 0)) > 0.001
        }
        if not active:
            return None

        # Load price history for each active holding from Supabase
        series_map = {}
        for tk in active:
            res = (sb.table("price_history")
                     .select("date, monthly_return")
                     .eq("ticker", tk)
                     .order("date")
                     .execute())
            if res.data:
                series_map[tk] = rows_to_series(res.data)

        if not series_map:
            return None

        ret_df = pd.DataFrame({tk: series_map[tk] for tk in active if tk in series_map}).dropna()
        if len(ret_df) < 24:
            return None

        w_arr = np.array([active[tk] for tk in ret_df.columns])
        w_arr /= w_arr.sum()
        port_ret = pd.Series(ret_df.values @ w_arr, index=ret_df.index)

        # Load factor data
        factor_res = (sb.table("ff_factors").select("*").order("date").execute())
        if not factor_res.data:
            return None
        factor_df = rows_to_dataframe(factor_res.data)

        # Align to month-start
        def to_ms(idx):
            return pd.DatetimeIndex([pd.Timestamp(d.year, d.month, 1) for d in idx])
        port_ret.index  = to_ms(port_ret.index)
        factor_df.index = to_ms(factor_df.index)

        betas = estimate_latest_betas(port_ret, factor_df)
        if betas:
            return round(betas["r2"], 4)
    except Exception as exc:
        print(f"[tilt] Portfolio R² failed: {exc}")
    return None


def _run(foundational_slot: int, factor_targets: dict, optimization_mode: str) -> dict:
    _set("holdings", "Collecting cross-portfolio universe…", 10)
    sb    = get_client()
    today = date.today()

    # ── 1. Get foundational ETF sector weights + betas ────────────────────────
    found_run = (
        sb.table("portfolio_runs")
        .select("*")
        .eq("slot", foundational_slot)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not found_run.data:
        raise ValueError(f"No portfolio run found for slot {foundational_slot}")

    found_data    = found_run.data[0]
    found_ticker  = found_data["etf_ticker"]
    etf_sectors: dict[str, float] = {}
    for r in (found_data.get("sector_weights") or []):
        etf_sectors[r["sector"]] = r["etfWeight"]

    # Get ETF's factor betas (for comparison in output)
    etf_betas_row = (
        sb.table("factor_loadings")
        .select("*")
        .eq("ticker", found_ticker)
        .order("window_end_date", desc=True)
        .limit(1)
        .execute()
    )
    etf_betas_dict = etf_betas_row.data[0] if etf_betas_row.data else {}
    etf_betas = np.array([
        float(etf_betas_dict.get(c, 0)) for c in FACTOR_COLS_DB
    ])

    # ── 2. Build target betas from user input ─────────────────────────────────
    factor_key_map = {
        "Mkt-RF": "beta_mkt", "SMB": "beta_smb", "HML": "beta_hml",
        "RMW":    "beta_rmw", "CMA": "beta_cma", "Mom": "beta_mom",
    }
    target_betas = np.array([
        factor_targets.get(fn, float(etf_betas_dict.get(fk, 0)))
        for fn, fk in zip(FACTOR_NAMES, FACTOR_COLS_DB)
    ])
    print(f"[tilt] Target betas: {dict(zip(FACTOR_NAMES, target_betas.round(3)))}")

    # ── 3. Collect all unique stocks from all portfolio runs ──────────────────
    _set("holdings", "Gathering universe from all portfolios…", 20)
    all_runs = (
        sb.table("portfolio_runs")
        .select("slot, etf_ticker, portfolio, sector_weights")
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )

    # De-duplicate: keep the latest run per slot
    seen_slots: set[int] = set()
    stock_map: dict[str, dict] = {}   # ticker → {sector, betas}

    for run in (all_runs.data or []):
        slot = run["slot"]
        if slot in seen_slots:
            continue
        seen_slots.add(slot)
        for holding in (run.get("portfolio") or []):
            tk = holding.get("ticker")
            if not tk or tk in stock_map:
                continue
            # Get factor loadings from cache
            lb = (
                sb.table("factor_loadings")
                .select("*")
                .eq("ticker", tk)
                .order("window_end_date", desc=True)
                .limit(1)
                .execute()
            )
            if not lb.data:
                continue
            b = lb.data[0]
            stock_map[tk] = {
                "ticker":    tk,
                "name":      holding.get("name", ""),
                "sector":    holding.get("sector", "Unknown"),
                "r2":        float(b.get("r2", 0)),
                "beta_mkt":  float(b.get("beta_mkt", 0)),
                "beta_smb":  float(b.get("beta_smb", 0)),
                "beta_hml":  float(b.get("beta_hml", 0)),
                "beta_rmw":  float(b.get("beta_rmw", 0)),
                "beta_cma":  float(b.get("beta_cma", 0)),
                "beta_mom":  float(b.get("beta_mom", 0)),
            }

    universe = list(stock_map.values())
    print(f"[tilt] Universe: {len(universe)} stocks from {len(seen_slots)} portfolios")

    if len(universe) < 10:
        raise ValueError("Not enough stocks in combined universe. Run more replication portfolios first.")

    # ── 4. Optimize ───────────────────────────────────────────────────────────
    _set("optimizing", "Running tilt optimization…", 60)
    sector_tol = 0.10 if optimization_mode == "factor_betas" else 0.03

    weights, factor_rmse = svc_opt.optimize(
        universe=universe,
        etf_betas=target_betas,
        etf_sector_weights=etf_sectors,
        max_weight=0.10,           # tighter per-stock cap for tilt portfolio
        sector_tol=sector_tol,
        max_positions=40,
    )

    # ── 5. Build payload ──────────────────────────────────────────────────────
    _set("optimizing", "Building tilt portfolio…", 88)

    portfolio_items = [
        {
            "ticker":  u["ticker"],
            "name":    u.get("name", ""),
            "weight":  round(float(weights[i]), 4),
            "sector":  u["sector"],
            "r2":      round(u["r2"], 4),
            "betaMkt": round(u["beta_mkt"], 4),
            "betaSmb": round(u["beta_smb"], 4),
            "betaHml": round(u["beta_hml"], 4),
            "betaRmw": round(u["beta_rmw"], 4),
            "betaCma": round(u["beta_cma"], 4),
            "betaMom": round(u["beta_mom"], 4),
        }
        for i, u in enumerate(universe)
        if float(weights[i]) > 0.005
    ]

    B = np.column_stack([
        [u["beta_mkt"], u["beta_smb"], u["beta_hml"],
         u["beta_rmw"], u["beta_cma"], u["beta_mom"]]
        for u in universe
    ])
    port_betas = B @ weights

    factor_loadings = [
        {
            "factor":        fn,
            "etfBeta":       round(float(etf_betas[j]), 4),
            "portfolioBeta": round(float(port_betas[j]), 4),
            "diff":          round(float(port_betas[j] - etf_betas[j]), 4),
        }
        for j, fn in enumerate(FACTOR_NAMES)
    ]

    port_sector_w: dict[str, float] = {}
    for item in portfolio_items:
        s = item["sector"]
        port_sector_w[s] = port_sector_w.get(s, 0.0) + item["weight"]

    sector_weights_list = [
        {
            "sector":          s,
            "etfWeight":       round(etf_sectors.get(s, 0.0), 4),
            "portfolioWeight": round(port_sector_w.get(s, 0.0), 4),
            "diff":            round(port_sector_w.get(s, 0.0) - etf_sectors.get(s, 0.0), 4),
        }
        for s in etf_sectors
    ]
    max_sector_diff = max((abs(r["diff"]) for r in sector_weights_list), default=0.0)

    payload = {
        "run_date":            today.strftime("%Y-%m-%d"),
        "foundational_slot":   foundational_slot,
        "foundational_ticker": found_ticker,
        "optimization_mode":   optimization_mode,
        "factor_targets":      factor_targets,
        "sector_weights":      sector_weights_list,
        "factor_loadings":     factor_loadings,
        "portfolio":           portfolio_items,
        "factor_rmse":         round(float(factor_rmse), 6),
        "max_sector_diff":     round(float(max_sector_diff), 4),
        "etf_r2":              round(float(etf_betas_dict.get("r2", 0)), 4) if etf_betas_dict else None,
        "portfolio_r2":        _compute_portfolio_r2(portfolio_items, sb),
    }

    sb.table("tilt_portfolio_runs").insert(payload).execute()
    _set("done", "Tilt portfolio complete", 100)
    return payload
