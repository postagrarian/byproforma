"""
QP portfolio optimizer: match ETF factor loadings while keeping
sector weights within ±3% of ETF sector weights.
Max 20–25 positions, long-only, max 15% per position.
"""
import numpy as np
from scipy.optimize import minimize

FACTOR_COLS   = ["beta_mkt", "beta_smb", "beta_hml", "beta_rmw", "beta_cma", "beta_mom"]
MAX_POSITIONS = 25
MAX_WEIGHT    = 0.15
SECTOR_TOL    = 0.03     # ±3% sector constraint


def build_beta_matrix(universe: list[dict]) -> np.ndarray:
    """Returns (6 × n) matrix from list of beta dicts."""
    return np.column_stack([
        [u[col] for col in FACTOR_COLS] for u in universe
    ])


def get_sector_indices(universe: list[dict], sectors: list[str]) -> dict[str, list[int]]:
    """Map each sector name → list of ticker indices in universe."""
    mapping: dict[str, list[int]] = {s: [] for s in sectors}
    for i, u in enumerate(universe):
        s = u.get("sector", "Unknown")
        if s in mapping:
            mapping[s].append(i)
    return mapping


def optimize(
    universe: list[dict],           # each item: {ticker, sector, r2, beta_mkt, …}
    etf_betas: np.ndarray,          # (6,) target betas
    etf_sector_weights: dict,       # sector → float (0–1)
    max_weight: float = MAX_WEIGHT,
    sector_tol: float = SECTOR_TOL,
) -> tuple[np.ndarray, float]:
    """
    Returns (weights, factor_rmse).
    """
    n = len(universe)
    B = build_beta_matrix(universe)    # (6 × n)
    sectors = list(etf_sector_weights.keys())
    sector_idx = get_sector_indices(universe, sectors)

    def objective(w: np.ndarray) -> float:
        diff = B @ w - etf_betas
        return float(diff @ diff)

    def gradient(w: np.ndarray) -> np.ndarray:
        return 2.0 * (B.T @ (B @ w - etf_betas))

    constraints = [{"type": "eq", "fun": lambda w: w.sum() - 1.0}]

    # Sector weight constraints: sum of weights in sector ≈ etf_sector_weight ± tol
    for sector, target in etf_sector_weights.items():
        idxs = sector_idx.get(sector, [])
        if not idxs:
            continue
        lo, hi = max(0.0, target - sector_tol), min(1.0, target + sector_tol)
        constraints.append({
            "type": "ineq",
            "fun": lambda w, idx=idxs, h=hi: h - sum(w[i] for i in idx),
        })
        constraints.append({
            "type": "ineq",
            "fun": lambda w, idx=idxs, l=lo: sum(w[i] for i in idx) - l,
        })

    result = minimize(
        objective,
        np.ones(n) / n,
        jac=gradient,
        method="SLSQP",
        bounds=[(0.0, max_weight)] * n,
        constraints=constraints,
        options={"ftol": 1e-12, "maxiter": 3000},
    )

    w = np.clip(result.x, 0.0, None)
    w /= w.sum()

    # Trim to max_positions: zero out smallest weights until ≤ MAX_POSITIONS remain
    while (w > 0.005).sum() > MAX_POSITIONS:
        min_idx = np.argmin(np.where(w > 0.005, w, np.inf))
        w[min_idx] = 0.0
        w /= w.sum()

    factor_rmse = float(np.sqrt(objective(w) / len(FACTOR_COLS)))
    return w, factor_rmse
