## Overview

byProforma constructs **factor-replicating portfolios** for a user-specified ETF. Given a benchmark fund (e.g., IJH — iShares Core S&P Mid-Cap ETF), it builds a concentrated equity portfolio of 20–25 stocks that matches the ETF's factor risk exposures while keeping sector weights within ±3% of the ETF's sector allocation. An **Active Tilt** overlay then allows the user to shift factor exposures deliberately — constructing a smart-beta portfolio that tilts away from the benchmark along any combination of the six Fama-French factors.

---

## How to Use

### Step 1 — Build your investable universe (Replication Portfolios)

Configure up to five Replication Portfolio slots, each tracking a different ETF. These serve two purposes: they produce investable portfolios that replicate each ETF's factor profile in a concentrated set of 20–25 stocks, and they collectively define the **investable universe** for the Active Tilt step.

A well-constructed universe spans the factor space you care about. Consider including ETFs across the size and style spectrum — for example, a mid-cap blend (IJH), a small-cap value (IJS), and a large-cap quality (QUAL) — so the Active Tilt optimizer has access to stocks with diverse factor profiles to draw from.

Each portfolio runs the full pipeline: ETF holdings are pulled from FMP, price histories are downloaded, rolling 36-month factor regressions are estimated for every holding, and a constrained quadratic program finds the optimal 20–25 stock portfolio. Results are cached in Supabase and auto-refreshed on the 1st of each month.

### Step 2 — Choose a Foundational ETF

In the Active Tilt tab, select one of your five replication portfolios as the **foundational portfolio**. This ETF serves as the benchmark for two purposes:

1. Its sector weights define the sector constraint for the tilt optimization. In Factor Betas mode, the tilt portfolio may drift up to ±10% from these weights. In Sector Exposure mode, the constraint tightens to ±3%.
2. Its factor loadings initialize the six sliders, so you start from the benchmark's actual risk profile before applying tilts.

Choose the foundational ETF that best represents the market segment you want to express a view on. If you are tilting a mid-cap portfolio, use a mid-cap ETF as the foundation.

### Step 3 — Apply factor tilts

The six sliders correspond to the Fama-French Five Factors plus Momentum. Each slider starts at the foundational ETF's current loading and can be moved to express a factor view. The optimizer then finds the portfolio from your combined investable universe that best matches those targets, subject to the sector constraint.

**Market (Mkt-RF)**
The broadest lever — controls overall equity risk. Move higher to increase systematic market exposure (risk-on). Move lower to build a more defensive, low-beta portfolio. This is the factor most directly tied to your directional market view.

**Size (SMB — Small Minus Big)**
A positive tilt adds small-cap exposure; a negative tilt shifts toward larger, more liquid names. Small-cap stocks tend to outperform in early economic expansions when credit is accessible and domestic growth is accelerating. In late-cycle or risk-off environments, tilting negative toward larger companies is typically more defensive.

**Value (HML — High Minus Low book-to-market)**
A positive tilt increases exposure to value stocks (high book-to-market); a negative tilt tilts toward growth. Value has historically outperformed in rising-rate environments and early recoveries, when compressed multiples expand alongside improving earnings. Growth tends to dominate in low-rate, low-inflation regimes where long-duration cash flows are valued more highly.

**Profitability (RMW — Robust Minus Weak)**
A positive tilt concentrates the portfolio in highly profitable companies. This is a quality factor — profitable firms generate cash internally, rely less on external financing, and tend to hold up better in contracting credit environments. Tilting RMW positive is a natural late-cycle or defensive positioning. Tilting negative adds exposure to companies burning cash, which can outperform in speculative or early-stage expansion environments.

**Investment (CMA — Conservative Minus Aggressive)**
A positive tilt favors companies with disciplined capital allocation — low asset growth, selective reinvestment. These tend to be mature, capital-efficient businesses. A negative tilt toward aggressive investors captures companies in capex-heavy expansion phases, which can outperform when infrastructure spending is strong or when the market rewards growth investment over returns.

**Momentum (Mom)**
Momentum tilts capture the tendency of recent winners to continue winning. A positive tilt works well in trending, low-volatility market regimes where existing leadership persists. It is most dangerous at economic inflection points — momentum strategies are prone to sharp reversals when market leadership rotates, such as at the end of a growth cycle or when a policy pivot reorders the return landscape. A negative momentum tilt can act as a mean-reversion or contrarian overlay.

### Macro factor guidance summary

| Macro Environment | Suggested Tilt Direction |
|---|---|
| Early expansion, credit easing | SMB up, HML up, RMW neutral |
| Mid-cycle growth | Mkt-RF up, Mom up, CMA neutral |
| Late cycle, tightening | RMW up, CMA up, SMB down |
| Risk-off, recession concerns | Mkt-RF down, RMW up, Mom down |
| Rate rising, value rotation | HML up, Mom down, Mkt-RF neutral |
| Rate falling, growth regime | HML down, Mom up, CMA down |

These are directional tendencies, not rules. Factor performance is regime-dependent and historically noisy at shorter horizons. The tilt feature is best used to express high-conviction macro views at a portfolio construction level — not as a tactical trading tool.

### Step 4 — Save and size

Once you are satisfied with a tilt portfolio, save it with a name. Saved portfolios persist across sessions and appear as tabs. In any saved portfolio, enter a total portfolio value to generate share counts (rounded to the nearest 10 shares) and dollar position sizes, and export to CSV for execution.

---

## Data Sources

| Data | Source | Frequency | Cache |
|---|---|---|---|
| ETF holdings and weights | FMP `/stable/etf/holdings` | Daily (fresh each run) | Not cached |
| ETF sector weights | FMP `/stable/etf/sector-weightings` | Daily | Not cached |
| Fund name, description, expense ratio | FMP `/stable/etf/info` | Daily | Not cached |
| YTD and 1Y total returns | FMP `/stable/stock-price-change` | Daily | Not cached |
| Equity price history | FMP `/stable/historical-price-eod/dividend-adjusted` | Monthly EOD | Supabase; refreshes if more than 45 days stale |
| Individual stock sectors | FMP `/stable/profile` | Static | Supabase `ticker_sectors`; permanent until overridden |
| Fama-French 5 factors plus Momentum | Ken French Data Library (direct ZIP download) | Monthly | Supabase `ff_factors`; refreshes if more than 45 days stale |

### Price return methodology

All price history uses **dividend-adjusted closing prices** (`adjClose`) from FMP. This gives total return — capital gains plus reinvested dividends — which is necessary because the Fama-French factors are themselves constructed from total returns. Using unadjusted prices would introduce a systematic downward bias in beta estimates for dividend-paying stocks.

---

## Factor Model

The project uses the **Fama-French Five-Factor Model augmented with Momentum** (FF5+Mom), which explains equity returns across six systematic dimensions:

| Factor | Symbol | Intuition |
|---|---|---|
| Market excess return | Mkt-RF | Compensation for bearing market risk above the risk-free rate |
| Size | SMB (Small Minus Big) | Small-cap stocks historically outperform large-cap |
| Value | HML (High Minus Low) | High book-to-market (value) stocks outperform growth |
| Profitability | RMW (Robust Minus Weak) | Highly profitable firms outperform less profitable ones |
| Investment | CMA (Conservative Minus Aggressive) | Conservative-investing firms outperform aggressive investors |
| Momentum | Mom | Recent winners tend to continue outperforming recent losers |

Factor returns are sourced monthly from Kenneth French's data library at Dartmouth. Values are expressed in decimal returns (e.g., 0.0054 = 0.54% for a given month). The risk-free rate (RF) is used to compute excess returns for each security before regression.

### How each factor is constructed

Each factor is built as the return spread between two portfolios, rebalanced annually in June using prior fiscal-year accounting data. Fama and French sort all NYSE, AMEX, and NASDAQ stocks into groups and go long the high-characteristic group and short the low-characteristic group. The long-short spread is the factor return for that month.

**Mkt-RF — Market excess return.** The value-weighted return of all stocks in the sample minus the one-month Treasury bill rate. This is not a long-short portfolio — it is simply the return of the broad equity market above the risk-free rate. A stock's beta to this factor measures its sensitivity to market-wide movements.

**SMB — Small Minus Big.** Each June, stocks are split at the NYSE median market cap into Small and Big groups. Nine size-tilted portfolios are formed by intersecting the size split with value, profitability, and investment sorts. SMB is the average return of the nine small-stock portfolios minus the average return of the nine big-stock portfolios. It captures the historical tendency of smaller companies to earn higher returns, attributed to their lower liquidity, higher distress risk, and lesser analyst coverage.

**HML — High Minus Low.** Stocks are sorted into three groups by book-to-market ratio (book equity divided by market equity): the top 30% (Value), middle 40% (Neutral), and bottom 30% (Growth). HML is the average return of the two Value portfolios minus the two Growth portfolios. It captures the value premium — cheap stocks (high B/M) have historically outperformed expensive ones (low B/M), possibly because they are more exposed to economic distress risk.

**RMW — Robust Minus Weak.** Stocks are sorted by operating profitability (revenues minus cost of goods sold, interest expense, and selling and administrative expenses, scaled by book equity). RMW is the return of highly profitable firms minus unprofitable ones. Profitable companies generate cash internally, require less external financing, and tend to be more resilient — the spread captures a quality premium that persists after controlling for size and value.

**CMA — Conservative Minus Aggressive.** Stocks are sorted by total asset growth (the year-over-year change in total assets). CMA is the return of low-investment (conservative) firms minus high-investment (aggressive) firms. The intuition is that companies expanding aggressively — through acquisitions, capital expenditure, or debt-financed growth — tend to underperform over the following years, possibly because markets initially overprice the growth and because expansion dilutes per-share value.

**Momentum — Prior 12-1 month return.** Unlike the five Fama-French factors, Momentum is not from the original five-factor paper — it was established earlier by Jegadeesh and Titman (1993) and is sourced separately from French's data library. Stocks are sorted by their cumulative return over the prior 12 months, skipping the most recent month (to avoid short-term reversal). The factor is long the top 30% (recent winners) and short the bottom 30% (recent losers). Momentum is the most behaviorally-driven factor — it reflects the tendency of trends to persist over a 3–12 month horizon before eventually reversing.

---

## Rolling OLS Regression

For each security in the universe, factor loadings (betas) are estimated via **Ordinary Least Squares (OLS)** on the most recent 36 months of data:

```
r(i,t) - RF(t) = α(i) + β_Mkt·(Rm-RF)(t) + β_SMB·SMB(t) + β_HML·HML(t)
                       + β_RMW·RMW(t) + β_CMA·CMA(t) + β_Mom·Mom(t) + ε(i,t)
```

**Key choices:**

- **Window**: 36 months. Shorter windows are noisier; longer windows are slow to reflect structural changes in a company's factor profile.
- **Minimum observations**: 70% of the window (25 months or more). Securities with insufficient history are excluded from the universe.
- **Frequency**: Monthly returns. Daily returns amplify microstructure noise and create non-synchronous trading bias; monthly returns are the standard in academic factor research and match the factor construction frequency.
- **Intercept included**: An alpha term is included in every regression but not used in the optimization. Alpha represents unexplained return and is not a factor loading target.
- **Index alignment**: Returns and factors are both normalised to month-start timestamps before regression to avoid date-mismatch artifacts from month-end versus month-start indexing.

### R squared interpretation

The R squared of a regression measures what fraction of that security's return variance is explained by the six factors. For a broad market ETF like IJH, R squared is typically 0.90 to 0.96 — the index is almost entirely systematic. For individual mid-cap stocks, R squared commonly ranges from 0.20 to 0.70, reflecting meaningful idiosyncratic risk.

The replication portfolio's R squared is computed by constructing the weighted portfolio return series and regressing it on the factors. A well-constructed replication portfolio should approach (but not match) the ETF's R squared because 20 to 25 stocks retain more idiosyncratic risk than 400.

---

## James-Stein Beta Shrinkage

Raw OLS beta estimates are noisy. With 36 monthly observations and 6 factors, the 90% confidence interval on a single beta is approximately ±0.7. The optimizer treats these estimates as exact truth, which leads to:

- Over-weighting stocks with temporarily extreme beta estimates
- Portfolios that look precise in-sample but track poorly out-of-sample
- High month-to-month turnover as extreme betas revert

To address this, byProforma applies **James-Stein shrinkage** to the cross-section of universe stock betas before optimization. The estimator pulls each stock's 6-dimensional beta vector toward the cross-sectional grand mean:

```
β_shrunk(i) = β_mean + (1 - c(i)) · (β_OLS(i) - β_mean)

c(i) = clip( (k − 2) · σ_avg² / ‖β_OLS(i) − β_mean‖² , 0, 1 )
```

Where `k = 6` (number of factors), `σ_avg²` is the average residual variance across the universe (the noise proxy), and `β_mean` is the cross-sectional mean beta vector across all universe stocks.

**Key properties of the estimator:**

- Stocks with **extreme** beta estimates (large denominator in `c(i)`) receive **less** shrinkage — their estimate is largely preserved because the signal is strong relative to noise.
- Stocks **close to the mean** receive **more** shrinkage — but since they are close already, the absolute adjustment is small.
- By the James-Stein theorem (Stein, 1956), this strictly reduces total mean-squared error versus raw OLS whenever `k ≥ 3`, even though it introduces bias.

**What is NOT shrunk:** The ETF's own factor betas serve as the optimization target and are kept as raw OLS estimates. Shrinking the target would mean we are no longer replicating the ETF — we would be replicating something pulled toward the average of the universe.

**Benefits in practice:**

| Metric | Without shrinkage | With James-Stein |
|---|---|---|
| Factor RMSE (in-sample) | Lower | Slightly higher |
| Factor tracking (out-of-sample) | Worse | Better |
| Monthly turnover | Higher | Lower |
| Max position concentration | Higher | More distributed |
| Sensitivity to data revisions | Higher | Lower |

---

## Universe Construction

### Global-weight-first selection

The candidate universe for the optimizer is built using a **global-weight-first** approach rather than picking the top N stocks within each sector independently:

1. All ETF holdings are ranked by their weight in the ETF globally (not within-sector).
2. The top 150 holdings are selected first — these drive the majority of the ETF's factor exposures.
3. Each sector is then checked: if any sector has fewer than 8 stocks in the top-150 selection, holdings from the remainder of the ETF are added until the minimum is met.
4. Within each sector, holdings are retained in weight order. A per-sector cap of 20 stocks is applied to keep the problem tractable.

**Why global-weight-first?** The heaviest holdings in an ETF are overweighted for economic reasons — they have the most influence on the ETF's factor loadings. Selecting by sector independently (top-10-per-sector) biases toward the largest stocks within each sector, which may not be the stocks most responsible for the ETF's overall factor profile. Ranking globally and then filling sector gaps preserves factor relevance while guaranteeing the sector coverage needed for the sector constraints.

---

## Portfolio Optimization

### Objective

The optimizer solves a **Quadratic Program (QP)** to find portfolio weights that minimise the squared Euclidean distance between the replication portfolio's factor loadings and the ETF's factor loadings:

```
min   ‖B · w − β_ETF‖²

subject to:
  Σ w(i)  =  1                                       (fully invested)
  0  ≤  w(i)  ≤  0.15                                (long-only, 15% position cap)
  |Σ_{i in sector s} w(i)  −  target(s)|  ≤  0.03   (sector within ±3% of ETF)
```

Where B is the (6 × n) matrix of James-Stein-shrunk factor betas for the n universe stocks, w is the weight vector to solve for, β_ETF is the ETF's own (unshrunk) factor loading vector from its 36-month OLS, and target(s) is the ETF's actual sector weight for sector s.

### Solver

The QP is solved using **scipy's SLSQP** (Sequential Least Squares Programming) method via `scipy.optimize.minimize`. SLSQP handles nonlinear constraints and bounds efficiently for problems of this size (typically 100 to 200 variables).

**Warm start**: The initial guess is set to sector-proportional weights (each sector pre-allocated its target weight distributed equally among its stocks). This starts the solver close to the feasible region and reduces convergence time significantly relative to a uniform initial guess.

### Post-solve trimming

After the QP converges, a sector-aware trimming loop reduces the number of positions to 25 or fewer (replication) or 40 or fewer (Active Tilt):

- Iterate over active positions from smallest to largest weight.
- Zero out a position if and only if removing it keeps every sector weight within the tolerance.
- If no safe trim exists, stop — the sector constraint takes priority over the position count target.

This ensures sector constraints are never violated by the trimming step.

### Factor RMSE

The quality of the factor match is reported as:

```
Factor RMSE = sqrt( mean( (β_portfolio(j) − β_ETF(j))² )   for j in 1..6 )
```

A lower RMSE indicates a tighter factor replication. Typical values for a 20 to 25 stock replication of a 400-stock index range from 0.02 to 0.15, depending on the breadth and factor diversity of the universe.

---

## Active Tilt Portfolio

The Active Tilt feature allows the user to specify custom factor targets — departing from the benchmark's factor profile while still maintaining sector discipline.

### Inputs

- **Foundational portfolio**: One of the five replication portfolios. Its ETF's sector weights serve as the sector constraint baseline, and its factor loadings initialize the sliders.
- **Factor tilts**: Six sliders (one per factor) the user adjusts to set desired loadings.
- **Optimization mode**:
  - *Factor Betas*: Sector tolerance is ±10%. The optimizer has more freedom to match the factor targets, accepting wider sector drift.
  - *Sector Exposure*: Sector tolerance is ±3%. The optimizer is tightly constrained to preserve the sector profile of the foundational ETF.

### Universe

The Active Tilt draws from a merged universe of all stocks across all configured replication portfolios. With five portfolios each contributing 20 to 25 stocks (after deduplication), the tilt universe typically contains 80 to 120 unique securities. James-Stein shrinkage is applied to this combined universe before optimization, providing additional stability given the heterogeneous provenance of the stocks.

### Position limits

- Minimum: 25 positions (enforced by the sector-aware trimming logic)
- Maximum: 40 positions
- Per-position cap: 10% (tighter than the 15% cap for replication portfolios, reflecting the wider universe)

---

## Key Assumptions and Limitations

**Factor stationarity.** OLS betas are estimated on a trailing 36-month window, implicitly assuming that a security's factor exposures are approximately stationary within that window. Structural breaks — a major acquisition, business model change, or index re-classification — will cause the estimated betas to be a lagged average rather than an instantaneous reading. James-Stein shrinkage reduces but does not eliminate this sensitivity.

**Single-period optimization.** The optimizer minimizes factor distance at a single point in time. It does not account for the covariance of estimation errors across securities or model the dynamics of factor exposure changes over time.

**Equal weight on all six factors.** The objective treats deviations in Mkt-RF and Mom identically. In practice, the Mkt-RF beta matters more for total portfolio risk. A weighted objective could improve practical tracking but is not currently implemented.

**Long-only constraint.** The optimizer does not allow short positions. This restricts the achievable factor combinations, particularly for portfolios attempting extreme tilts. If the target is outside the convex hull of available long-only portfolios, the optimizer will find the nearest feasible point.

**Sector weights from FMP.** ETF sector weights use Morningstar's sector classification. Individual stock sectors are also classified by Morningstar via FMP's profile endpoint. Minor discrepancies in classification can introduce small sector constraint errors.

**Monthly refresh cadence.** Factor loadings estimated mid-month may be 2 to 4 weeks stale by the time the next portfolio is produced. For investors with shorter rebalancing horizons this lag is material; for monthly or quarterly rebalancers it is not.

**Data vendor dependency.** Price history and ETF holdings are sourced from Financial Modeling Prep. Factor data is sourced from Ken French's data library. Disruptions to either source will affect pipeline output without warning.

---

## Refresh Schedule

| Data | Refresh trigger |
|---|---|
| ETF holdings and sector weights | Every pipeline run |
| Fund overview (name, expense ratio, returns) | Every pipeline run |
| Price history | If last cached date is more than 45 days old |
| Fama-French factors | If last cached date is more than 45 days old |
| Stock sector labels | Permanent cache; never auto-refreshed |
| Factor loadings (betas) | Every pipeline run (written, not read from cache) |
| Replication portfolios | Automatically on the 1st of each month (Vercel Cron) |
| Active Tilt portfolio | Manual only |
