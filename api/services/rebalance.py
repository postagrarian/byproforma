"""
Active Tilt rebalancing.

Blended objective:
    minimize  α * ‖B·w − target‖²  +  (1−α) * ‖w − w_current‖²
    s.t.      sum(w) = 1,  0 ≤ wᵢ ≤ MAX_WEIGHT

Universe: current holdings ∪ replication ETF tickers (from etf_config).
Supplement ETFs are treated as w_current = 0, so the turnover penalty
naturally discourages adding them unless they meaningfully close the gap.
"""
import numpy as np
from scipy.optimize import minimize
from datetime import date, datetime, timezone

FACTOR_KEYS  = ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "Mom"]
HOLDING_COLS = ["betaMkt", "betaSmb", "betaHml", "betaRmw", "betaCma", "betaMom"]
MAX_WEIGHT   = 0.15


def _betas(h: dict) -> list[float]:
    return [float(h.get(col) or 0) for col in HOLDING_COLS]


def preview_rebalance(
    run_id:         int,
    target_factors: dict,
    alpha:          float,
    sb,
) -> dict:
    alpha = max(0.0, min(1.0, alpha))

    # ── 1. Fetch current portfolio ────────────────────────────────────────────
    run = (sb.table("tilt_portfolio_runs")
             .select("portfolio, foundational_slot, foundational_ticker, sector_weights, factor_loadings")
             .eq("id", run_id).single().execute())
    if not run.data:
        raise ValueError(f"Run {run_id} not found")

    current_portfolio   = run.data.get("portfolio")       or []
    foundational_slot   = run.data["foundational_slot"]
    foundational_ticker = run.data["foundational_ticker"]
    orig_sector_weights  = run.data.get("sector_weights")  or []
    orig_factor_loadings = run.data.get("factor_loadings") or []

    held_tickers = {h["ticker"] for h in current_portfolio}

    # ── 2. Supplement: replication ETFs not already held ─────────────────────
    etf_res     = sb.table("etf_config").select("ticker").execute()
    etf_tickers = [r["ticker"] for r in (etf_res.data or []) if r["ticker"] not in held_tickers]

    supplement = []
    for ticker in etf_tickers:
        fl = (sb.table("factor_loadings")
                 .select("*")
                 .eq("ticker", ticker)
                 .order("window_end_date", desc=True)
                 .limit(1)
                 .execute())
        if not fl.data:
            continue
        row  = fl.data[0]
        info = sb.table("ticker_sectors").select("name, sector").eq("ticker", ticker).execute()
        name   = (info.data[0].get("name") or ticker) if info.data else ticker
        sector = (info.data[0].get("sector") or "ETF")  if info.data else "ETF"
        supplement.append({
            "ticker":  ticker,
            "name":    name,
            "weight":  0.0,
            "sector":  sector,
            "r2":      row.get("r2")       or 0,
            "betaMkt": row.get("beta_mkt") or 0,
            "betaSmb": row.get("beta_smb") or 0,
            "betaHml": row.get("beta_hml") or 0,
            "betaRmw": row.get("beta_rmw") or 0,
            "betaCma": row.get("beta_cma") or 0,
            "betaMom": row.get("beta_mom") or 0,
        })

    # ── 3. Full universe + current weight vector ──────────────────────────────
    universe = current_portfolio + supplement
    n        = len(universe)
    if n == 0:
        raise ValueError("Universe is empty — no holdings and no ETF betas found")

    w_current = np.array([float(h.get("weight") or 0) for h in universe])
    total = w_current.sum()
    w_current = w_current / total if total > 0 else np.ones(n) / n

    # ── 4. Factor matrix B: shape (6, n) so B @ w → (6,) ─────────────────────
    B      = np.column_stack([_betas(h) for h in universe])
    target = np.array([float(target_factors.get(k, 0.0)) for k in FACTOR_KEYS])

    # ── 5. Blended QP ────────────────────────────────────────────────────────
    def objective(w: np.ndarray) -> float:
        fg = B @ w - target
        to = w - w_current
        return float(alpha * (fg @ fg) + (1 - alpha) * (to @ to))

    def gradient(w: np.ndarray) -> np.ndarray:
        return (2 * alpha * (B.T @ (B @ w - target))
                + 2 * (1 - alpha) * (w - w_current))

    result = minimize(
        objective,
        w_current.copy(),
        jac=gradient,
        method="SLSQP",
        bounds=[(0.0, MAX_WEIGHT)] * n,
        constraints=[{"type": "eq", "fun": lambda w: w.sum() - 1.0}],
        options={"ftol": 1e-10, "maxiter": 1000},
    )
    if not result.success:
        print(f"[rebalance] Optimizer warning: {result.message}")

    w_new = np.clip(result.x, 0.0, None)
    w_new /= w_new.sum()

    # ── 6. Build trade list + new portfolio ───────────────────────────────────
    THRESHOLD = 0.0005   # ignore sub-0.05% positions / changes

    trades        = []
    new_portfolio = []

    for i, h in enumerate(universe):
        cw = float(w_current[i])
        pw = float(w_new[i])
        d  = pw - cw

        if abs(d) > THRESHOLD or pw > THRESHOLD:
            action = "hold" if abs(d) <= THRESHOLD else ("buy" if d > 0 else "sell")
            trades.append({
                "ticker":          h["ticker"],
                "name":            h.get("name", ""),
                "sector":          h.get("sector", ""),
                "current_weight":  round(cw, 6),
                "proposed_weight": round(pw, 6),
                "delta":           round(d, 6),
                "action":          action,
                "is_supplement":   cw < THRESHOLD,
            })

        if pw > THRESHOLD:
            new_portfolio.append({**h, "weight": round(pw, 6)})

    trades.sort(key=lambda x: abs(x["delta"]), reverse=True)

    # ── 7. Factor exposures before/after/target ───────────────────────────────
    before_vec = B @ w_current
    after_vec  = B @ w_new
    factor_before = {k: round(float(before_vec[i]), 4) for i, k in enumerate(FACTOR_KEYS)}
    factor_after  = {k: round(float(after_vec[i]),  4) for i, k in enumerate(FACTOR_KEYS)}
    factor_target = {k: round(float(target[i]),     4) for i, k in enumerate(FACTOR_KEYS)}

    turnover = float(np.sum(np.abs(w_new - w_current))) / 2  # one-sided

    print(f"[rebalance] α={alpha:.2f} | turnover={turnover:.1%} | "
          f"factor_gap_before={np.linalg.norm(before_vec - target):.4f} "
          f"→ after={np.linalg.norm(after_vec - target):.4f}")

    return {
        "run_id":                run_id,
        "alpha":                 alpha,
        "target_factors":        target_factors,
        "trades":                trades,
        "new_portfolio":         new_portfolio,
        "factor_before":         factor_before,
        "factor_after":          factor_after,
        "factor_target":         factor_target,
        "turnover":              round(turnover, 4),
        "foundational_slot":     foundational_slot,
        "foundational_ticker":   foundational_ticker,
        "orig_sector_weights":   orig_sector_weights,
        "orig_factor_loadings":  orig_factor_loadings,
    }


def commit_rebalance(preview: dict, name: str, set_live: bool, sb) -> dict:
    """Save the rebalanced portfolio as a new saved tilt_portfolio_run."""
    new_portfolio       = preview["new_portfolio"]
    foundational_slot   = preview["foundational_slot"]
    foundational_ticker = preview["foundational_ticker"]
    target_factors      = preview["target_factors"]
    alpha               = preview["alpha"]
    after               = preview["factor_after"]

    # ── Sector weights ────────────────────────────────────────────────────────
    orig_sw = {r["sector"]: r for r in preview.get("orig_sector_weights", [])}
    port_sector: dict[str, float] = {}
    for h in new_portfolio:
        s = h.get("sector") or "Unknown"
        port_sector[s] = port_sector.get(s, 0.0) + float(h.get("weight") or 0)

    all_sectors = sorted(set(list(orig_sw) + list(port_sector)))
    sector_weights = []
    for s in all_sectors:
        etf_w  = float(orig_sw[s]["etfWeight"]) if s in orig_sw else 0.0
        port_w = port_sector.get(s, 0.0)
        sector_weights.append({
            "sector":          s,
            "etfWeight":       round(etf_w,        4),
            "portfolioWeight": round(port_w,        4),
            "diff":            round(port_w - etf_w, 4),
        })
    sector_weights.sort(key=lambda x: abs(x["diff"]), reverse=True)

    # ── Factor loadings comparison ────────────────────────────────────────────
    orig_fl = {r["factor"]: r for r in preview.get("orig_factor_loadings", [])}
    factor_loadings = []
    for k in FACTOR_KEYS:
        etf_beta  = float(orig_fl[k]["etfBeta"]) if k in orig_fl else 0.0
        port_beta = float(after.get(k, 0.0))
        factor_loadings.append({
            "factor":        k,
            "etfBeta":       round(etf_beta,  4),
            "portfolioBeta": round(port_beta, 4),
            "diff":          round(port_beta - etf_beta, 4),
        })

    # ── Metrics ───────────────────────────────────────────────────────────────
    etf_vec   = np.array([float(orig_fl[k]["etfBeta"]) if k in orig_fl else 0.0 for k in FACTOR_KEYS])
    port_vec  = np.array([float(after.get(k, 0.0)) for k in FACTOR_KEYS])
    factor_rmse     = float(np.sqrt(np.mean((port_vec - etf_vec) ** 2)))
    max_sector_diff = max((abs(r["diff"]) for r in sector_weights), default=0.0)

    # ── Insert ────────────────────────────────────────────────────────────────
    row = {
        "run_date":             date.today().isoformat(),
        "foundational_slot":    foundational_slot,
        "foundational_ticker":  foundational_ticker,
        "optimization_mode":    "rebalance",
        "factor_targets":       {**target_factors, "_alpha": alpha},
        "sector_weights":       sector_weights,
        "factor_loadings":      factor_loadings,
        "portfolio":            new_portfolio,
        "factor_rmse":          round(factor_rmse, 6),
        "max_sector_diff":      round(max_sector_diff, 4),
        "name":                 name,
        "is_saved":             True,
        "is_live":              False,
    }

    res       = sb.table("tilt_portfolio_runs").insert(row).execute()
    new_run   = res.data[0]
    new_run_id = new_run["id"]

    if set_live:
        sb.table("tilt_portfolio_runs") \
          .update({"is_live": False, "live_since": None}) \
          .eq("is_live", True).execute()
        sb.table("tilt_portfolio_runs").update({
            "is_live":    True,
            "live_since": datetime.now(timezone.utc).isoformat(),
        }).eq("id", new_run_id).execute()
        new_run["is_live"] = True

    return new_run
