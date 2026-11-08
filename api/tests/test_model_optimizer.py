"""
Smoke test for the model portfolio optimizer.
Run: python -m pytest tests/test_model_optimizer.py -v
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import numpy as np
from services.model_optimizer import (
    optimize_for_target_return,
    compute_efficient_frontier,
    TICKERS, N, EQUITY_IDX, ALT_IDX,
)

# ── Plausible CMAs for testing ──────────────────────────────────────────────

EXPECTED_RETURNS = {
    "DFAC": 0.090,  # US Large Cap
    "DFAS": 0.100,  # US Small Cap
    "DFAT": 0.105,  # US Value
    "DFIV": 0.085,  # Intl Developed
    "DFIS": 0.095,  # Intl Small Cap
    "DFEM": 0.100,  # EM
    "DFAR": 0.080,  # REITs
    "DFCF": 0.045,  # Core Bonds
    "DFSD": 0.040,  # Short-Term Bonds
    "DFIP": 0.042,  # TIPS
    "IAUM": 0.050,  # Gold
    "IBIT": 0.150,  # Bitcoin
}

VOLATILITIES = {
    "DFAC": 0.160,
    "DFAS": 0.200,
    "DFAT": 0.190,
    "DFIV": 0.170,
    "DFIS": 0.200,
    "DFEM": 0.220,
    "DFAR": 0.200,
    "DFCF": 0.050,
    "DFSD": 0.020,
    "DFIP": 0.060,
    "IAUM": 0.150,
    "IBIT": 0.600,
}

# Build a plausible correlation matrix
def _build_test_corr():
    """Reasonable correlation structure across asset classes."""
    C = np.eye(N)
    # Equity block: high correlation
    eq_idx = EQUITY_IDX
    for i in eq_idx:
        for j in eq_idx:
            if i != j:
                C[i, j] = 0.75
    # REITs moderate with equity
    reit = TICKERS.index("DFAR")
    for i in eq_idx:
        C[reit, i] = C[i, reit] = 0.55
    # Bonds low with equity
    bond_idx = [TICKERS.index(t) for t in ["DFCF", "DFSD", "DFIP"]]
    for b in bond_idx:
        for e in eq_idx:
            C[b, e] = C[e, b] = 0.05
        C[b, reit] = C[reit, b] = 0.15
    # Bond-bond
    for i in bond_idx:
        for j in bond_idx:
            if i != j:
                C[i, j] = 0.70
    # Gold: low/negative with equity, moderate with TIPS
    gold = TICKERS.index("IAUM")
    for e in eq_idx:
        C[gold, e] = C[e, gold] = 0.00
    for b in bond_idx:
        C[gold, b] = C[b, gold] = 0.20
    C[gold, TICKERS.index("DFIP")] = C[TICKERS.index("DFIP"), gold] = 0.35
    C[gold, reit] = C[reit, gold] = 0.10
    # Bitcoin: low correlation with everything
    btc = TICKERS.index("IBIT")
    for e in eq_idx:
        C[btc, e] = C[e, btc] = 0.25
    for b in bond_idx:
        C[btc, b] = C[b, btc] = 0.00
    C[btc, reit] = C[reit, btc] = 0.15
    C[btc, gold] = C[gold, btc] = 0.10
    return C.tolist()


CORRELATIONS = _build_test_corr()


def test_basic_optimize():
    """Target 8% return — should produce a valid allocation."""
    result = optimize_for_target_return(
        EXPECTED_RETURNS, VOLATILITIES, CORRELATIONS,
        target_return=0.08,
    )
    weights = result["weights"]
    total = sum(weights.values())
    assert abs(total - 1.0) < 0.001, f"Weights sum to {total}, expected ~1.0"
    assert abs(result["expected_return"] - 0.08) < 0.005
    assert result["expected_vol"] > 0
    assert result["sharpe_ratio"] > 0
    print(f"  Return: {result['expected_return']:.2%}")
    print(f"  Vol:    {result['expected_vol']:.2%}")
    print(f"  Sharpe: {result['sharpe_ratio']:.3f}")
    print(f"  Positions: {len(weights)}")
    for t, w in sorted(weights.items(), key=lambda x: -x[1]):
        print(f"    {t}: {w:.1%}")


def test_constraints_respected():
    """Verify diversification limits hold."""
    result = optimize_for_target_return(
        EXPECTED_RETURNS, VOLATILITIES, CORRELATIONS,
        target_return=0.08,
    )
    weights = result["weights"]

    # Max single position
    for t, w in weights.items():
        assert w <= 0.40 + 0.001, f"{t} weight {w:.1%} exceeds 40% cap"

    # Min equity
    eq_weight = sum(weights.get(t, 0) for t in [TICKERS[i] for i in EQUITY_IDX])
    assert eq_weight >= 0.50 - 0.001, f"Equity weight {eq_weight:.1%} below 50% floor"

    # Max alternatives
    alt_weight = sum(weights.get(t, 0) for t in [TICKERS[i] for i in ALT_IDX])
    assert alt_weight <= 0.15 + 0.001, f"Alt weight {alt_weight:.1%} exceeds 15% cap"

    # Max single alt
    for t in [TICKERS[i] for i in ALT_IDX]:
        assert weights.get(t, 0) <= 0.10 + 0.001, f"{t} weight exceeds 10% alt cap"

    print(f"  Equity: {eq_weight:.1%}, Alts: {alt_weight:.1%}")


def test_higher_target_more_equity():
    """A higher target return should tilt further into equity/alts."""
    low = optimize_for_target_return(
        EXPECTED_RETURNS, VOLATILITIES, CORRELATIONS, target_return=0.07,
    )
    high = optimize_for_target_return(
        EXPECTED_RETURNS, VOLATILITIES, CORRELATIONS, target_return=0.09,
    )
    low_eq = sum(low["weights"].get(t, 0) for t in [TICKERS[i] for i in EQUITY_IDX])
    high_eq = sum(high["weights"].get(t, 0) for t in [TICKERS[i] for i in EQUITY_IDX])
    assert high_eq >= low_eq - 0.01, (
        f"Expected higher equity at 9% target ({high_eq:.1%}) vs 6% ({low_eq:.1%})"
    )
    print(f"  7% target → equity {low_eq:.1%}, vol {low['expected_vol']:.2%}")
    print(f"  9% target → equity {high_eq:.1%}, vol {high['expected_vol']:.2%}")


def test_frontier():
    """Efficient frontier should have increasing return and generally increasing vol."""
    frontier = compute_efficient_frontier(
        EXPECTED_RETURNS, VOLATILITIES, CORRELATIONS,
        n_points=15,
    )
    assert len(frontier) >= 10, f"Expected ≥10 frontier points, got {len(frontier)}"
    returns = [p["target_return"] for p in frontier]
    assert returns == sorted(returns), "Frontier returns should be non-decreasing"
    print(f"  {len(frontier)} frontier points")
    print(f"  Return range: {returns[0]:.2%} → {returns[-1]:.2%}")
    print(f"  Vol range: {frontier[0]['expected_vol']:.2%} → {frontier[-1]['expected_vol']:.2%}")


def test_infeasible_target():
    """Target above max single-asset return should raise ValueError."""
    try:
        optimize_for_target_return(
            EXPECTED_RETURNS, VOLATILITIES, CORRELATIONS,
            target_return=0.25,
        )
        assert False, "Should have raised ValueError"
    except ValueError as e:
        print(f"  Correctly rejected: {e}")


if __name__ == "__main__":
    for name, fn in [
        ("basic_optimize",        test_basic_optimize),
        ("constraints_respected", test_constraints_respected),
        ("higher_target_equity",  test_higher_target_more_equity),
        ("frontier",              test_frontier),
        ("infeasible_target",     test_infeasible_target),
    ]:
        print(f"\n{'='*60}")
        print(f"TEST: {name}")
        print(f"{'='*60}")
        fn()
        print("  ✓ PASSED")
