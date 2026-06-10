# byProforma — Planned Upgrades

Tracked improvements across the factor model, regime awareness system, and portfolio construction pipeline.

---

## 1. Regime Model — Per-Factor Regime Signals

**Current state:** A single macro regime signal derived from FRED data (yield curve, VIX, CPI) classifies the overall market environment. This signal informs factor targets in the tilt pipeline.

**The problem:** Each factor cycles independently. Value's bear markets do not coincide with momentum's or quality's. A single market-level regime signal is simultaneously wrong for several factors at any given time.

**Upgrade:** Run a separate two-state (bull/bear) regime model per factor — one for each of: Value, Size, Momentum, Quality, Low Volatility, Growth. Use the factor ETF's active return (factor return minus VOO) as the input, not the absolute return. Stripping the market component reveals factor-specific cycles that absolute returns obscure.

### Feature set per factor (ordered by empirical importance)

| Feature | Window(s) | Notes |
|---|---|---|
| RSI | 63, 21, 8 days | Dominant feature by weight in empirical tests |
| Stochastic %K | 63, 21, 8 days | Second most informative |
| EWMA active return | 63, 21, 8 days | Captures trend; quarterly horizon aligns with how factor performance is assessed |
| MACD | (8,21) and (21,63) | Cross-timeframe momentum |
| Downside deviation (log) | 21 days | Risk measure on negative active returns only |
| Active market beta | 21 days | Time-varying sensitivity to market |

### Market environment features (lower weight, secondary role)

| Feature | Transformation | Source |
|---|---|---|
| Market return | EWMA, 21 days | Already in FMP data |
| VIX | log, diff, EWMA — 21 days | FRED (already cached) |
| 2Y Treasury yield | diff, EWMA — 21 days | FRED (already cached) |
| 10Y minus 2Y yield | diff, EWMA — 21 days | FRED (already cached) |

Note: In empirical tests (Shu & Mulvey, Princeton 2024), these market-environment features received near-zero weight for factor-level regime identification. They are useful as context for the overall market overlay but should not dominate factor-specific regime calls. The existing FRED-based macro regime remains valuable as a separate risk-on/risk-off signal.

### Regime signal reliability by factor

| Factor | Long-short Sharpe | Regime shifts/yr | Actionability |
|---|---|---|---|
| Value | 0.39 | 3.16 | High |
| Growth | 0.37 | 1.31 | High |
| Low Volatility | 0.30 | 1.78 | Medium |
| Quality | 0.21 | 0.64 | Low |
| Size | 0.20 | 2.57 | Low |
| Momentum | 0.16 | 3.66 | Low (noisy) |

Practical implication: when the regime model is uncertain, trust its output more for value and growth tilts. Apply meaningful discounting to momentum and size regime calls — momentum in particular has the most shifts and the least reliable signal.

### Implementation notes

- **Online inference lag:** Infer regime at end of day T, apply on day T+1 or T+2. Real-time inference produces approximately 2x as many apparent regime shifts as in-sample fitting. Require persistence across several consecutive days before registering a regime change in the tilt pipeline.
- **Training approach:** Expanding window with minimum 8 years, maximum 12 years. Refit model monthly. Validate hyperparameters on a rolling 6-year window by maximizing Sharpe of the hypothetical long-short strategy for each factor.
- **Output:** Per-factor bull/bear label + confidence score → feed into `factor_targets` in the tilt pipeline. Factors in bear regime get their target pulled toward neutral; factors in bull regime can be expressed at full conviction.
- **Quality factor caveat:** Due to its defensive, low-volatility nature, Quality's regime signal is the least separable. Consider not regime-gating quality tilts, or applying a heavy discount.

---

## 2. Factor Calculations — Weighted Factor Objective

**Current state:** The QP objective minimizes the squared Euclidean distance across all six factor betas equally:

```
min ‖B·w − β_ETF‖²
```

**The problem:** A 0.1 deviation in Mkt-RF has far greater impact on total portfolio risk than a 0.1 deviation in CMA or Mom. Equal weighting treats these identically.

**Upgrade:** Replace the identity weighting with a diagonal weight matrix that reflects each factor's contribution to return variance:

```
min (B·w − β_ETF)ᵀ · W · (B·w − β_ETF)
```

Where W is a diagonal matrix with weights proportional to each factor's historical variance or its contribution to portfolio volatility. Mkt-RF would receive the highest weight; CMA and SMB the lowest. This would produce tighter tracking on the factors that matter most for portfolio risk with minimal change to the optimizer structure.

---

## 3. Factor Calculations — Estimation Error Covariance

**Current state:** The optimizer treats all shrunk beta estimates as exact. It does not account for the fact that estimation errors across securities are correlated (securities in the same sector will have correlated residuals).

**Upgrade:** Incorporate the regression residual covariance into the objective, or at minimum compute per-security regression standard errors and use them to modulate James-Stein shrinkage intensity. Securities with fewer observations or higher residual variance should be shrunk more aggressively toward the cross-sectional mean.

---

## 4. Factor Calculations — Adaptive Regression Window

**Current state:** All securities use a fixed 36-month OLS window regardless of how stable their factor exposures have been over time.

**The problem:** A company that underwent a major acquisition or sector pivot 18 months ago has a beta estimated partly from its old business mix. The 36-month window cannot distinguish structural breaks from natural variation.

**Upgrade:** Implement a simple Chow test or CUSUM test on the residual series for each security. When a structural break is detected within the trailing 36 months, truncate the estimation window to the post-break period (with a minimum of 18 months of data). Fall back to the 36-month estimate if the post-break window is too short. This would improve beta accuracy for recently-transformed businesses without adding significant complexity.

---

## 5. Factor Calculations — Daily or Weekly Factor Proxies for Tilt

**Current state:** Factor loadings are estimated from monthly returns matched to Ken French's monthly factor data. The tilt portfolio is refreshed manually; its factor view is potentially 2–4 weeks stale by mid-month.

**The problem:** Factor tilts (especially momentum and value) can shift meaningfully within a month. A user setting a momentum tilt in late November may be acting on October's factor data.

**Upgrade:** Supplement the monthly Ken French factors with daily factor proxies constructed from the spread returns of the factor ETF pairs (e.g., MTUM minus PBUS for momentum, VLUE minus PBUS for value). These daily proxies would allow the beta estimation to be updated more frequently for the tilt pipeline without waiting for Ken French's next monthly release. This is an approximation — daily factor ETF spreads are noisier than the academic factor construction — but directionally correct for intra-month tilt decisions.

---

## 6. Performance Tracking — Holiday-Aware Prior Close

~~**Current state:** The daily performance cron walks back weekends when looking for the prior trading day's close but does not handle market holidays. If the prior trading day was a holiday (e.g., Monday after a long weekend), the FMP API returns only one data point and the return is recorded as 0.0.~~

~~**Upgrade:** Maintain a static list of US market holidays (or fetch from FMP's market holiday endpoint) and extend the walk-back in `_fmp_daily_return` to skip both weekends and holidays. This ensures correct return calculation for all Tuesday-after-holiday trading days.~~

**Resolved (2026-06-09):** Weekend walk-back already in place; FMP returns only one data point on holidays so no second case exists to compute a return from. Non-issue in practice.

---

## 7. Performance Tracking — Benchmark Cumulative Return

~~**Current state:** The cumulative return chart on the Notes page tracks only the portfolio's indexed return (starting at 100). The `sp500_return` and `etf_return` are stored per day but the chart data always sets them to `null`.~~

**Resolved (2026-06-09):** Chart now computes running cumulative products from stored daily returns on the frontend. Three lines — portfolio, S&P 500, foundational ETF — display from inception without requiring additional DB columns.

---

## 8. Factor Calculations — Beta Significance Filtering (p-values)

**Current state:** Factor beta estimates from the 36-month OLS regressions are stored and used as point estimates only. `statsmodels` computes p-values and standard errors for each coefficient internally but they are discarded. The James-Stein shrinkage reduces estimation noise cross-sectionally but does not distinguish statistically significant loadings from spurious ones.

**The problem:** With 30 degrees of freedom (36 months, 6 factors), individual beta estimates can have wide confidence intervals. A stock with an HML loading of 0.65 and a t-stat of 1.2 is treated identically to one with a t-stat of 3.8. The optimizer may be acting on factor exposures that are statistically indistinguishable from zero.

**Upgrade:** Store `pvalues` alongside beta estimates in `estimate_latest_betas` (one line — `res.pvalues` is already computed). Then in the optimizer, either:
- **Hard filter:** zero out any beta where p > 0.20 before passing to the optimizer
- **Soft weight:** scale each beta by `(1 − p_value)` so uncertain loadings contribute proportionally less

**Expected gain:** Modest — JS shrinkage already handles the worst cases, and portfolio-level factor exposures average down individual noise across 20-30 holdings. Rough estimate: 10–15% reduction in factor loading estimation error at the portfolio level. The more impactful uncertainty is in the factor premia themselves (whether HML, CMA etc. will earn a positive return), which this does not address.

**Prerequisite:** No schema changes required. `factor_loadings` table has a JSONB column that can absorb the additional fields.

---

## Sources

- Shu, Y. & Mulvey, J.M. (2024). *Dynamic Factor Allocation Leveraging Regime-Switching Signals*. Princeton University, arXiv:2410.14841.
- byProforma METHODOLOGY.md — Key Assumptions and Limitations section.
