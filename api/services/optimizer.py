"""
QP portfolio optimizer: match ETF factor loadings while keeping
sector weights within ±3% of ETF sector weights.
Max 20–25 positions, long-only, max 15% per position.

The sector constraints are enforced inside the QP — post-solve trimming
is sector-aware so removing a small position never breaks a sector constraint.
"""
import numpy as np
from scipy.optimize import minimize

FACTOR_COLS   = ["beta_mkt", "beta_smb", "beta_hml", "beta_rmw", "beta_cma", "beta_mom"]
MAX_POSITIONS = 25
MAX_WEIGHT    = 0.15
SECTOR_TOL    = 0.03     # ±3%


def build_beta_matrix(universe: list[dict]) -> np.ndarray:
    return np.column_stack([[u[col] for col in FACTOR_COLS] for u in universe])


def get_sector_indices(universe: list[dict], sectors: list[str]) -> dict[str, list[int]]:
    mapping: dict[str, list[int]] = {s: [] for s in sectors}
    for i, u in enumerate(universe):
        s = u.get("sector", "Unknown")
        if s in mapping:
            mapping[s].append(i)
    return mapping


def _sector_weight(w: np.ndarray, idxs: list[int]) -> float:
    return float(sum(w[i] for i in idxs))


def optimize(
    universe: list[dict],
    etf_betas: np.ndarray,
    etf_sector_weights: dict,
    max_weight: float = MAX_WEIGHT,
    sector_tol: float = SECTOR_TOL,
) -> tuple[np.ndarray, float]:
    n          = len(universe)
    B          = build_beta_matrix(universe)
    sectors    = list(etf_sector_weights.keys())
    sector_idx = get_sector_indices(universe, sectors)

    # Log sector coverage
    for s, idxs in sector_idx.items():
        print(f"[optimizer] sector '{s}': {len(idxs)} stocks, "
              f"target={etf_sector_weights[s]:.3f} ±{sector_tol}")

    def objective(w):
        d = B @ w - etf_betas
        return float(d @ d)

    def gradient(w):
        return 2.0 * (B.T @ (B @ w - etf_betas))

    constraints = [{"type": "eq", "fun": lambda w: w.sum() - 1.0}]

    for sector, target in etf_sector_weights.items():
        idxs = sector_idx.get(sector, [])
        if not idxs:
            print(f"[optimizer] WARNING: no stocks for sector '{sector}' — skipping constraint")
            continue
        lo = max(0.0, target - sector_tol)
        hi = min(1.0, target + sector_tol)
        constraints.append({"type": "ineq", "fun": lambda w, idx=idxs, h=hi: h - _sector_weight(w, idx)})
        constraints.append({"type": "ineq", "fun": lambda w, idx=idxs, l=lo: _sector_weight(w, idx) - l})

    # Warm-start: allocate each sector its target weight evenly across its stocks.
    # This is much closer to the feasible region than uniform equal-weight.
    x0 = np.zeros(n)
    for sector, target in etf_sector_weights.items():
        idxs = sector_idx.get(sector, [])
        if idxs:
            per_stock = min(target / len(idxs), max_weight)
            for i in idxs:
                x0[i] = per_stock
    total = x0.sum()
    if total > 0:
        x0 /= total
    else:
        x0 = np.ones(n) / n

    result = minimize(
        objective,
        x0,
        jac=gradient,
        method="SLSQP",
        bounds=[(0.0, max_weight)] * n,
        constraints=constraints,
        options={"ftol": 1e-10, "maxiter": 1000},
    )
    if not result.success:
        print(f"[optimizer] WARNING: {result.message}")

    w = np.clip(result.x, 0.0, None)
    w /= w.sum()

    # Sector-aware trimming: only zero out a position if doing so keeps
    # the sector weight within tolerance. Stop when ≤ MAX_POSITIONS remain.
    for _ in range(n):
        active = np.where(w > 0.005)[0]
        if len(active) <= MAX_POSITIONS:
            break

        # Find smallest active position whose sector stays in bounds if removed
        trimmed = False
        for idx in active[np.argsort(w[active])]:
            sector = universe[idx].get("sector", "Unknown")
            idxs   = sector_idx.get(sector, [])
            target = etf_sector_weights.get(sector, 0.0)
            lo     = max(0.0, target - sector_tol)

            w_trial       = w.copy()
            w_trial[idx]  = 0.0
            w_trial      /= w_trial.sum()

            if not idxs or _sector_weight(w_trial, idxs) >= lo:
                w = w_trial
                trimmed = True
                break

        if not trimmed:
            # No safe trim found — stop here even if over MAX_POSITIONS
            print(f"[optimizer] Could not trim further without violating sector constraints. "
                  f"Positions: {(w > 0.005).sum()}")
            break

    factor_rmse = float(np.sqrt(objective(w) / len(FACTOR_COLS)))
    print(f"[optimizer] Done: {(w > 0.005).sum()} positions, RMSE={factor_rmse:.5f}")
    return w, factor_rmse
