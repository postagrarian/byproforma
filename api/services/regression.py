"""
Rolling 36-month OLS factor regressions (FF5 + Momentum).
Ported from the byProforma research scripts.
"""
import warnings
import numpy as np
import pandas as pd
import statsmodels.api as sm

warnings.filterwarnings("ignore")

FACTOR_COLS = ["Mkt-RF", "SMB", "HML", "RMW", "CMA", "Mom"]
WINDOW      = 36
MIN_OBS     = max(len(FACTOR_COLS) + 3, int(WINDOW * 0.7))


def estimate_latest_betas(
    returns: pd.Series,
    factors: pd.DataFrame,
    window: int = WINDOW,
) -> dict | None:
    """
    OLS on the most recent `window` monthly observations.
    Returns dict of betas + r2 + resid_var, or None if insufficient data.
    """
    X = factors[FACTOR_COLS].copy()
    rf = factors["RF"] if "RF" in factors.columns else pd.Series(0.0, index=factors.index)

    y_exc = returns.subtract(rf, fill_value=0).dropna()
    common = y_exc.index.intersection(X.index)
    y_w = y_exc.loc[common].iloc[-window:]
    X_w = X.loc[y_w.index]

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


def betas_to_array(betas: dict) -> np.ndarray:
    return np.array([
        betas["beta_mkt"], betas["beta_smb"], betas["beta_hml"],
        betas["beta_rmw"], betas["beta_cma"], betas["beta_mom"],
    ])
