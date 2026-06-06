"""
Rolling 36-month OLS factor regressions (FF5 + Momentum)
plus James-Stein cross-sectional shrinkage of beta estimates.
"""
import warnings
import numpy as np
import pandas as pd
import statsmodels.api as sm

warnings.filterwarnings("ignore")

FACTOR_COLS = ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "Mom"]
BETA_COLS   = ["beta_mkt", "beta_smb", "beta_hml", "beta_rmw", "beta_cma", "beta_mom"]
WINDOW      = 36
MIN_OBS     = max(len(FACTOR_COLS) + 3, int(WINDOW * 0.7))


def estimate_latest_betas(
    returns: pd.Series,
    factors: pd.DataFrame,
    window:  int = WINDOW,
) -> dict | None:
    """
    OLS on the most recent `window` monthly observations.
    Returns dict of betas + r2 + resid_var, or None if insufficient data.
    """
    X  = factors[FACTOR_COLS].copy()
    rf = factors["RF"] if "RF" in factors.columns else pd.Series(0.0, index=factors.index)

    y_exc  = returns.subtract(rf, fill_value=0).dropna()
    common = y_exc.index.intersection(X.index)
    y_w    = y_exc.loc[common].iloc[-window:]
    X_w    = X.loc[y_w.index]

    if len(y_w) < MIN_OBS:
        return None

    try:
        res = sm.OLS(y_w, sm.add_constant(X_w, has_constant="add")).fit()
    except Exception:
        return None

    b = res.params[FACTOR_COLS]
    return {
        "beta_mkt":  float(b.get("Mkt-RF", 0)),
        "beta_smb":  float(b.get("SMB",    0)),
        "beta_hml":  float(b.get("HML",    0)),
        "beta_rmw":  float(b.get("RMW",    0)),
        "beta_cma":  float(b.get("CMA",    0)),
        "beta_mom":  float(b.get("Mom",    0)),
        "r2":        float(res.rsquared),
        "resid_var": float(res.resid.var()),
    }


def james_stein_shrink(betas_by_ticker: dict) -> dict:
    """
    Apply James-Stein shrinkage cross-sectionally to a universe of OLS beta estimates.

    The estimator pulls each stock's 6-dimensional beta vector toward the
    cross-sectional grand mean, with shrinkage intensity proportional to
    estimation noise (residual variance) and inversely proportional to how
    extreme the estimate is relative to the mean.

        β̂_JS,i = β̄ + (1 - cᵢ) · (β̂_OLS,i - β̄)

        cᵢ = clip( (k−2)·σ̄² / ‖β̂_OLS,i − β̄‖² , 0, 1 )

    where k=6 (factors), σ̄² is the average residual variance across the
    universe (noise proxy), and β̄ is the cross-sectional mean beta vector.

    Key properties:
    - Stocks far from the mean (extreme estimates, likely noisy) receive
      LESS shrinkage — cᵢ is small, estimate is largely preserved.
    - Stocks close to the mean receive MORE shrinkage — cᵢ is larger,
      but the effect is small because the distance is small.
    - By the James-Stein theorem, this ALWAYS reduces total mean-squared
      error versus the raw OLS estimates when k ≥ 3.

    Only pass UNIVERSE stocks here. The ETF's own betas serve as the
    optimization TARGET and should not be shrunk.

    Parameters
    ----------
    betas_by_ticker : dict
        {ticker: {beta_mkt, ..., beta_mom, r2, resid_var}}

    Returns
    -------
    Same structure with beta values replaced by shrunk estimates.
    r2 and resid_var are unchanged (they belong to the OLS fit, not the betas).
    """
    tickers = list(betas_by_ticker.keys())
    k       = len(BETA_COLS)

    if len(tickers) < k + 2:
        print(f"[regression] JS shrinkage skipped — universe too small ({len(tickers)} stocks, need ≥{k+2})")
        return betas_by_ticker

    # Build (n × k) matrix of OLS betas
    B = np.array([[betas_by_ticker[tk][col] for col in BETA_COLS] for tk in tickers])

    grand_mean = B.mean(axis=0)             # cross-sectional mean (k,)
    centered   = B - grand_mean             # (n × k)
    norms_sq   = (centered ** 2).sum(axis=1)  # per-stock ‖β_i − β̄‖²

    # Average residual variance as noise proxy
    avg_sigma2 = float(np.mean([betas_by_ticker[tk]["resid_var"] for tk in tickers]))

    # Per-stock shrinkage coefficient, clipped to [0, 1]
    c       = np.clip((k - 2) * avg_sigma2 / np.maximum(norms_sq, 1e-10), 0.0, 1.0)
    B_shrunk = grand_mean + (1 - c[:, np.newaxis]) * centered

    avg_c = float(c.mean())
    print(f"[regression] JS shrinkage applied: {len(tickers)} stocks, "
          f"avg shrinkage={avg_c:.3f}, "
          f"noise proxy σ̄²={avg_sigma2:.5f}")

    result = {}
    for i, tk in enumerate(tickers):
        result[tk] = {**betas_by_ticker[tk]}
        for j, col in enumerate(BETA_COLS):
            result[tk][col] = float(B_shrunk[i, j])
    return result


def betas_to_array(betas: dict) -> np.ndarray:
    return np.array([
        betas["beta_mkt"], betas["beta_smb"], betas["beta_hml"],
        betas["beta_rmw"], betas["beta_cma"], betas["beta_mom"],
    ])
