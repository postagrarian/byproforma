"""
Monte Carlo retirement drawdown simulator.

Given a model portfolio (weights + CMAs), simulate 30-year paths with
inflation-adjusted withdrawals. Reports probability of success (not
running out of money), percentile wealth paths, and terminal wealth
distribution.

Uses Cholesky decomposition of the covariance matrix to generate
correlated asset-class returns, then applies portfolio weights to get
annual portfolio returns.
"""
import numpy as np
from services.model_optimizer import TICKERS, N, _build_cov_matrix


def simulate_drawdown(
    weights:          dict[str, float],
    expected_returns: dict[str, float],
    volatilities:     dict[str, float],
    correlations:     list[list[float]],
    starting_balance: float,
    annual_withdrawal: float,
    inflation_rate:   float = 0.025,
    years:            int = 30,
    n_simulations:    int = 5000,
    seed:             int | None = None,
) -> dict:
    """
    Run Monte Carlo drawdown simulation.

    Parameters
    ----------
    weights           : dict  ticker → portfolio weight (must sum to ~1)
    expected_returns  : dict  ticker → annualized geometric return (decimal)
    volatilities      : dict  ticker → annualized vol (decimal)
    correlations      : list  12×12 correlation matrix
    starting_balance  : float initial portfolio value ($)
    annual_withdrawal : float first-year withdrawal amount ($), grows by inflation
    inflation_rate    : float annual inflation for withdrawal escalation
    years             : int   simulation horizon
    n_simulations     : int   number of Monte Carlo paths
    seed              : int   random seed for reproducibility (None = random)

    Returns
    -------
    dict with percentile paths, success rate, terminal wealth stats
    """
    rng = np.random.default_rng(seed)

    # Build weight vector (only for tickers with non-zero weight)
    w = np.array([weights.get(t, 0.0) for t in TICKERS])
    total = w.sum()
    if total > 0:
        w /= total

    # Expected returns and covariance matrix
    mu = np.array([expected_returns.get(t, 0.0) for t in TICKERS])
    vols = np.array([volatilities.get(t, 0.0) for t in TICKERS])
    corr = np.array(correlations)
    cov = _build_cov_matrix(vols, corr)

    # Portfolio-level expected return and vol
    port_mu = float(w @ mu)
    port_var = float(w @ cov @ w)
    port_vol = np.sqrt(port_var)

    # Convert geometric return to log-normal parameters
    # If R ~ LogNormal(m, s), then E[R] = exp(m + s²/2)
    # For geometric return g: (1+g) = exp(m + s²/2)
    # m = ln(1+g) - s²/2
    log_vol = port_vol  # approximate: σ_log ≈ σ for moderate vol
    log_mu = np.log(1 + port_mu) - 0.5 * log_vol**2

    # Simulate: each path is a sequence of annual returns
    # Shape: (n_simulations, years)
    log_returns = rng.normal(log_mu, log_vol, size=(n_simulations, years))
    gross_returns = np.exp(log_returns)  # (1 + r) for each year

    # Run drawdown paths
    # balances[sim, year] = portfolio value at START of year (before withdrawal)
    balances = np.zeros((n_simulations, years + 1))
    balances[:, 0] = starting_balance

    withdrawals = np.zeros(years)
    for y in range(years):
        withdrawals[y] = annual_withdrawal * (1 + inflation_rate) ** y

    for y in range(years):
        # Withdraw at start of year, then grow remainder
        after_withdrawal = np.maximum(balances[:, y] - withdrawals[y], 0.0)
        balances[:, y + 1] = after_withdrawal * gross_returns[:, y]

    # ── Results ────────────────────────────────────────────────────────────

    # Success = balance > 0 at end of every year
    # A path "fails" the first year the balance hits 0
    # (once balance is 0, it stays 0 because max(0 - withdrawal, 0) * return = 0)
    terminal = balances[:, -1]
    success_count = int(np.sum(terminal > 0))
    success_rate = success_count / n_simulations

    # Percentile paths (5th, 10th, 25th, 50th, 75th, 90th, 95th)
    percentiles = [5, 10, 25, 50, 75, 90, 95]
    percentile_paths = {}
    for p in percentiles:
        path = np.percentile(balances, p, axis=0)
        percentile_paths[str(p)] = [round(float(v), 2) for v in path]

    # Terminal wealth distribution
    nonzero_terminal = terminal[terminal > 0]
    terminal_stats = {
        "mean":   round(float(np.mean(terminal)), 2),
        "median": round(float(np.median(terminal)), 2),
        "p5":     round(float(np.percentile(terminal, 5)), 2),
        "p10":    round(float(np.percentile(terminal, 10)), 2),
        "p25":    round(float(np.percentile(terminal, 25)), 2),
        "p75":    round(float(np.percentile(terminal, 75)), 2),
        "p90":    round(float(np.percentile(terminal, 90)), 2),
        "p95":    round(float(np.percentile(terminal, 95)), 2),
    }

    # Year-of-ruin distribution (for failed paths)
    failed_mask = terminal <= 0
    if failed_mask.any():
        # Find first year where balance hits 0 for each failed path
        failed_balances = balances[failed_mask]
        ruin_years = []
        for path in failed_balances:
            zero_years = np.where(path <= 0)[0]
            if len(zero_years) > 0:
                ruin_years.append(int(zero_years[0]))
        ruin_year_stats = {
            "mean":   round(float(np.mean(ruin_years)), 1) if ruin_years else None,
            "median": round(float(np.median(ruin_years)), 1) if ruin_years else None,
            "min":    int(np.min(ruin_years)) if ruin_years else None,
            "max":    int(np.max(ruin_years)) if ruin_years else None,
        }
    else:
        ruin_year_stats = None

    # Withdrawal schedule
    withdrawal_schedule = [
        {"year": y + 1, "amount": round(float(withdrawals[y]), 2)}
        for y in range(years)
    ]

    return {
        "success_rate":       round(success_rate, 4),
        "success_count":      success_count,
        "n_simulations":      n_simulations,
        "years":              years,
        "starting_balance":   starting_balance,
        "initial_withdrawal": annual_withdrawal,
        "withdrawal_rate":    round(annual_withdrawal / starting_balance, 4) if starting_balance > 0 else 0,
        "inflation_rate":     inflation_rate,
        "portfolio_return":   round(port_mu, 6),
        "portfolio_vol":      round(port_vol, 6),
        "percentile_paths":   percentile_paths,
        "terminal_wealth":    terminal_stats,
        "ruin_year_stats":    ruin_year_stats,
        "withdrawal_schedule": withdrawal_schedule,
    }
