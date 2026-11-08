"""
Mean-variance portfolio optimizer for the passive ETF model.

Given capital market assumptions (expected returns, volatilities, correlations)
and a target portfolio return, find the minimum-variance allocation that
achieves that return subject to diversification constraints.
"""
import numpy as np
from scipy.optimize import minimize

# ── Fixed 12-sleeve universe ────────────────────────────────────────────────
ASSET_CLASSES = [
    {"ticker": "DFAC", "name": "US Large Cap",       "group": "equity"},
    {"ticker": "DFAS", "name": "US Small Cap",       "group": "equity"},
    {"ticker": "DFAT", "name": "US Value",            "group": "equity"},
    {"ticker": "DFIV", "name": "Intl Developed",      "group": "equity"},
    {"ticker": "DFIS", "name": "Intl Small Cap",      "group": "equity"},
    {"ticker": "DFEM", "name": "Emerging Markets",    "group": "equity"},
    {"ticker": "DFAR", "name": "US REITs",            "group": "real_assets"},
    {"ticker": "DFCF", "name": "US Core Bonds",       "group": "fixed_income"},
    {"ticker": "DFSD", "name": "Short-Term Bonds",    "group": "fixed_income"},
    {"ticker": "DFIP", "name": "TIPS",                "group": "fixed_income"},
    {"ticker": "IAUM", "name": "Gold",                "group": "alternatives"},
    {"ticker": "IBIT", "name": "Bitcoin",             "group": "alternatives"},
]

TICKERS = [a["ticker"] for a in ASSET_CLASSES]
N = len(TICKERS)

EQUITY_TICKERS = [a["ticker"] for a in ASSET_CLASSES if a["group"] == "equity"]
ALT_TICKERS    = [a["ticker"] for a in ASSET_CLASSES if a["group"] == "alternatives"]

EQUITY_IDX = [TICKERS.index(t) for t in EQUITY_TICKERS]
ALT_IDX    = [TICKERS.index(t) for t in ALT_TICKERS]


# ── Default diversification constraints ─────────────────────────────────────
DEFAULT_CONSTRAINTS = {
    "max_single_weight":   0.40,   # no sleeve > 40%
    "min_equity":          0.50,   # at least 50% in equity sleeves
    "max_alternatives":    0.15,   # gold + bitcoin combined ≤ 15%
    "max_single_alt":      0.10,   # single alt ≤ 10%
    "min_weight":          0.00,   # per-sleeve floor (0 = allow exclusion)
}


def _build_cov_matrix(
    vols: np.ndarray, corr: np.ndarray
) -> np.ndarray:
    """Σ = diag(σ) × C × diag(σ)"""
    D = np.diag(vols)
    return D @ corr @ D


def _validate_inputs(
    returns: np.ndarray, vols: np.ndarray, corr: np.ndarray
):
    assert returns.shape == (N,), f"Expected {N} returns, got {returns.shape}"
    assert vols.shape == (N,),    f"Expected {N} vols, got {vols.shape}"
    assert corr.shape == (N, N),  f"Expected {N}x{N} corr, got {corr.shape}"
    assert np.allclose(corr, corr.T, atol=1e-8), "Correlation matrix not symmetric"
    assert np.allclose(np.diag(corr), 1.0), "Diagonal of correlation matrix must be 1"
    eigenvalues = np.linalg.eigvalsh(corr)
    if eigenvalues.min() < -1e-8:
        raise ValueError(
            f"Correlation matrix is not positive semi-definite "
            f"(min eigenvalue = {eigenvalues.min():.6f})"
        )


def optimize_for_target_return(
    expected_returns: dict[str, float],
    volatilities:     dict[str, float],
    correlations:     list[list[float]],
    target_return:    float,
    risk_free_rate:   float = 0.04,
    constraints:      dict | None = None,
) -> dict:
    """
    Find the minimum-variance portfolio that achieves `target_return`.

    Parameters
    ----------
    expected_returns : dict  ticker → annualized expected return (e.g. 0.095)
    volatilities     : dict  ticker → annualized vol (e.g. 0.16)
    correlations     : list  12×12 correlation matrix (row-major)
    target_return    : float desired portfolio return (e.g. 0.08)
    risk_free_rate   : float for Sharpe calc
    constraints      : dict  override DEFAULT_CONSTRAINTS keys

    Returns
    -------
    dict with weights, expected return/vol/sharpe, marginal risk contributions
    """
    cons = {**DEFAULT_CONSTRAINTS, **(constraints or {})}

    mu   = np.array([expected_returns[t] for t in TICKERS])
    vols = np.array([volatilities[t]     for t in TICKERS])
    corr = np.array(correlations)

    _validate_inputs(mu, vols, corr)
    cov = _build_cov_matrix(vols, corr)

    max_w   = cons["max_single_weight"]
    min_w   = cons["min_weight"]
    min_eq  = cons["min_equity"]
    max_alt = cons["max_alternatives"]
    max_sa  = cons["max_single_alt"]

    # ── Objective: minimise portfolio variance ──────────────────────────────
    def variance(w):
        return float(w @ cov @ w)

    def var_grad(w):
        return 2.0 * (cov @ w)

    # ── Constraints ────────────────────────────────────────────────────────
    opt_constraints = [
        # fully invested
        {"type": "eq", "fun": lambda w: w.sum() - 1.0},
        # hit the target return
        {"type": "eq", "fun": lambda w: w @ mu - target_return},
        # minimum equity allocation
        {"type": "ineq", "fun": lambda w: sum(w[i] for i in EQUITY_IDX) - min_eq},
        # max alternatives combined
        {"type": "ineq", "fun": lambda w: max_alt - sum(w[i] for i in ALT_IDX)},
    ]

    # per-position bounds: alt tickers get tighter cap
    bounds = []
    for i, t in enumerate(TICKERS):
        upper = max_sa if t in ALT_TICKERS else max_w
        bounds.append((min_w, upper))

    # ── Initial guess: equal-weight (feasible starting point) ──────────────
    x0 = np.ones(N) / N

    result = minimize(
        variance,
        x0,
        jac=var_grad,
        method="SLSQP",
        bounds=bounds,
        constraints=opt_constraints,
        options={"ftol": 1e-12, "maxiter": 2000},
    )

    if not result.success:
        # Check if target return is achievable within constraints
        max_achievable = float(mu.max())
        min_achievable = float(mu.min())
        if target_return > max_achievable:
            raise ValueError(
                f"Target return {target_return:.1%} exceeds the highest "
                f"single-asset return ({max_achievable:.1%}). "
                f"Reduce target or revise CMAs."
            )
        # With min equity constraint, the floor return may be higher than
        # the lowest single-asset return
        min_eq = cons["min_equity"]
        eq_returns = mu[EQUITY_IDX]
        fi_returns = np.delete(mu, EQUITY_IDX)
        approx_floor = min_eq * eq_returns.min() + (1 - min_eq) * fi_returns.min()
        if target_return < approx_floor:
            raise ValueError(
                f"Target return {target_return:.1%} is not achievable with "
                f"the {min_eq:.0%} minimum equity constraint. "
                f"The approximate floor is {approx_floor:.1%}. "
                f"Raise your target or lower the equity minimum."
            )
        # Otherwise report the optimizer message
        raise ValueError(f"Optimizer did not converge: {result.message}")

    w = np.clip(result.x, 0.0, None)
    # Zero out dust
    w[w < 1e-4] = 0.0
    w /= w.sum()

    # ── Portfolio metrics ──────────────────────────────────────────────────
    port_return = float(w @ mu)
    port_vol    = float(np.sqrt(w @ cov @ w))
    sharpe      = (port_return - risk_free_rate) / port_vol if port_vol > 0 else 0.0

    # ── Marginal contribution to risk ──────────────────────────────────────
    # MCR_i = w_i * (Σw)_i / σ_p
    cov_w = cov @ w
    mcr = (w * cov_w) / port_vol if port_vol > 0 else np.zeros(N)

    weights = {t: round(float(w[i]), 6) for i, t in enumerate(TICKERS) if w[i] > 1e-4}

    return {
        "weights":          weights,
        "expected_return":  round(port_return, 6),
        "expected_vol":     round(port_vol, 6),
        "sharpe_ratio":     round(sharpe, 4),
        "risk_free_rate":   risk_free_rate,
        "target_return":    target_return,
        "constraints_used": cons,
        "marginal_risk": {
            t: round(float(mcr[i]), 6)
            for i, t in enumerate(TICKERS) if w[i] > 1e-4
        },
        "asset_classes":    ASSET_CLASSES,
    }


def compute_efficient_frontier(
    expected_returns: dict[str, float],
    volatilities:     dict[str, float],
    correlations:     list[list[float]],
    risk_free_rate:   float = 0.04,
    constraints:      dict | None = None,
    n_points:         int = 25,
) -> list[dict]:
    """
    Compute points along the efficient frontier.

    Returns list of {target_return, expected_vol, sharpe, weights}
    from min-variance to max-achievable return.
    """
    mu = np.array([expected_returns[t] for t in TICKERS])

    # Find the achievable return range by solving for min-var portfolio
    # with no return target, then stepping up to the max feasible return
    cons = {**DEFAULT_CONSTRAINTS, **(constraints or {})}

    # Min-var portfolio (no return constraint)
    vols_arr = np.array([volatilities[t] for t in TICKERS])
    corr = np.array(correlations)
    cov = _build_cov_matrix(vols_arr, corr)

    min_eq  = cons["min_equity"]
    max_alt = cons["max_alternatives"]
    max_sa  = cons["max_single_alt"]
    max_w   = cons["max_single_weight"]
    min_w   = cons["min_weight"]

    bounds = []
    for i, t in enumerate(TICKERS):
        upper = max_sa if t in ALT_TICKERS else max_w
        bounds.append((min_w, upper))

    # Solve for the unconstrained-return min-var to find the floor
    res_floor = minimize(
        lambda w: float(w @ cov @ w),
        np.ones(N) / N,
        jac=lambda w: 2.0 * (cov @ w),
        method="SLSQP",
        bounds=bounds,
        constraints=[
            {"type": "eq",   "fun": lambda w: w.sum() - 1.0},
            {"type": "ineq", "fun": lambda w: sum(w[i] for i in EQUITY_IDX) - min_eq},
            {"type": "ineq", "fun": lambda w: max_alt - sum(w[i] for i in ALT_IDX)},
        ],
        options={"ftol": 1e-12, "maxiter": 2000},
    )
    w_floor = np.clip(res_floor.x, 0.0, None)
    w_floor /= w_floor.sum()
    ret_floor = float(w_floor @ mu)

    # Max achievable: constrained by bounds, so find the max-return portfolio
    res_ceil = minimize(
        lambda w: -float(w @ mu),
        np.ones(N) / N,
        jac=lambda w: -mu,
        method="SLSQP",
        bounds=bounds,
        constraints=[
            {"type": "eq",   "fun": lambda w: w.sum() - 1.0},
            {"type": "ineq", "fun": lambda w: sum(w[i] for i in EQUITY_IDX) - min_eq},
            {"type": "ineq", "fun": lambda w: max_alt - sum(w[i] for i in ALT_IDX)},
        ],
        options={"ftol": 1e-12, "maxiter": 2000},
    )
    w_ceil = np.clip(res_ceil.x, 0.0, None)
    w_ceil /= w_ceil.sum()
    ret_ceil = float(w_ceil @ mu)

    # Step through target returns
    targets = np.linspace(ret_floor, ret_ceil, n_points)
    frontier = []

    for target in targets:
        try:
            result = optimize_for_target_return(
                expected_returns, volatilities, correlations,
                target_return=float(target),
                risk_free_rate=risk_free_rate,
                constraints=constraints,
            )
            frontier.append({
                "target_return":  result["expected_return"],
                "expected_vol":   result["expected_vol"],
                "sharpe_ratio":   result["sharpe_ratio"],
                "weights":        result["weights"],
            })
        except ValueError:
            continue

    return frontier
