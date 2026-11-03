# Passive ETF Model Portfolio — Scoping Spec

## What this is

A new module inside byProforma for building, optimizing, and maintaining a strategic asset allocation (SAA) model portfolio using Dimensional Fund Advisors ETFs (plus non-DFA for asset classes DFA doesn't cover). The user inputs their own long-term capital market assumptions — expected returns, volatilities, and a correlation matrix — and the tool produces an efficient-frontier-aware target allocation that can be manually overridden. It then tracks drift against target weights and generates rebalance trades.

---

## Asset Class Universe

| # | Asset Class | Ticker | Fund Name | Expense Ratio |
|---|---|---|---|---|
| 1 | US Large Cap | DFAC | Dimensional US Core Equity 2 ETF | 0.18% |
| 2 | US Small Cap | DFAS | Dimensional US Small Cap ETF | 0.27% |
| 3 | US Value | DFAT | Dimensional US Targeted Value ETF | 0.29% |
| 4 | Intl Developed | DFIV | Dimensional International Value ETF | 0.27% |
| 5 | Intl Small Cap | DFIS | Dimensional International Small Cap ETF | 0.30% |
| 6 | Emerging Markets | DFEM | Dimensional Emerging Markets Core Equity 2 ETF | 0.39% |
| 7 | US REITs | DFAR | Dimensional US Real Estate ETF | 0.19% |
| 8 | US Core Bonds | DFCF | Dimensional Core Fixed Income ETF | 0.17% |
| 9 | Short-Term Bonds | DFSD | Dimensional Short-Duration Fixed Income ETF | 0.16% |
| 10 | TIPS | DFIP | Dimensional Inflation-Protected Securities ETF | 0.11% |
| 11 | Gold | IAUM | iShares Gold Trust Micro ETF | 0.09% |
| 12 | Bitcoin | IBIT | iShares Bitcoin Trust ETF | 0.25% |

**Design decision**: The lineup is **fixed at launch** — these 12 sleeves are the universe. Adding/removing asset classes is a code change, not a user-facing config (keeps the correlation matrix manageable and avoids combinatorial complexity). We can revisit after v1 if you want to make it configurable.

---

## Capital Market Assumptions (CMAs)

User inputs per asset class:
- **Expected annualized return** (geometric, nominal) — e.g. 9.5%
- **Expected annualized volatility** (std dev) — e.g. 16.0%

Plus a **12×12 correlation matrix** — symmetric, diagonal = 1.0.

### Storage
- New Supabase table `model_cma_sets` — stores named CMA sets as JSONB (returns vector, vol vector, correlation matrix, metadata).
- The user can save multiple CMA sets and switch between them ("base case", "bear case", etc.).
- One set is marked `is_active` and drives the optimizer.

### Input UX
- Tabular form: one row per asset class, columns for return and vol.
- Correlation matrix: a 12×12 editable grid (lower triangle + diagonal shown, upper triangle mirrors automatically).
- **Import/Export**: JSON upload/download for the full CMA set so you can version-control assumptions externally.
- **Validation**: returns must be numeric, vols must be > 0, correlation matrix must be positive semi-definite (eigenvalue check), diagonal must equal 1, all entries ∈ [-1, 1].

---

## Mean-Variance Optimizer

### Objective
Classic Markowitz mean-variance optimization:

```
max   w'μ − (λ/2) · w'Σw

subject to:
  Σ wᵢ = 1                        (fully invested)
  0 ≤ wᵢ ≤ max_weight             (long-only, per-position cap)
  wᵢ ≥ min_weight  (if included)  (optional floor per asset class)
```

Where:
- `μ` = vector of expected excess returns (over risk-free rate)
- `Σ` = covariance matrix (derived from vol vector × correlation matrix)
- `λ` = risk aversion parameter (user-adjustable slider, default ~3.0)

### Constraints (user-configurable)
| Constraint | Default | Range |
|---|---|---|
| Max single position | 40% | 10–60% |
| Min equity allocation | 60% | 0–100% |
| Max alternatives (gold + bitcoin) | 15% | 0–30% |
| Max single alternative | 10% | 0–15% |
| Risk aversion (λ) | 3.0 | 0.5–10.0 |

### Output
- **Optimal weights** for the 12 asset classes
- **Expected portfolio return** and **expected portfolio volatility**
- **Sharpe ratio** (using user-supplied risk-free rate from CMAs or a default)
- **Efficient frontier curve** — 20 points from min-variance to max-return, plotted as vol vs. return
- **Marginal contribution to risk** per asset class

### Manual override
After the optimizer suggests weights, the user can:
1. Accept as-is
2. Adjust any weight manually (with re-normalization to 100%)
3. Lock specific weights and re-optimize the remaining sleeves

---

## Model Portfolio Storage

New Supabase table: `model_portfolios`

| Column | Type | Notes |
|---|---|---|
| id | bigserial | PK |
| name | text | e.g. "Core Growth", "Conservative" |
| cma_set_id | bigint | FK → model_cma_sets |
| target_weights | jsonb | { "DFAC": 0.25, "DFAS": 0.10, ... } |
| constraints | jsonb | max_weight, min_equity, etc. |
| optimizer_output | jsonb | frontier data, marginal risk, etc. |
| is_active | boolean | Which model is "live" |
| created_at | timestamptz | |
| updated_at | timestamptz | |

---

## Drift Monitoring & Rebalance

### Price feed
- Fetch daily closing prices for the 12 ETFs from FMP (same vendor as existing pipeline).
- Compute current market-value weights from target shares × current price.

### Drift detection
- **Absolute drift**: `|current_weight − target_weight|` per sleeve
- **Max drift**: the largest absolute drift across all 12 sleeves
- **Trigger**: rebalance suggested when max drift exceeds a threshold (default 5%, configurable 2–10%)

### Rebalance engine
Given current holdings (shares + prices) and target weights:
1. Compute target dollar amounts per sleeve
2. Generate buy/sell trade list (in shares, at current prices)
3. Optionally apply a **tax-aware rule**: sell-only rebalance (redirect new cash to underweight sleeves, don't sell overweight unless drift exceeds a hard cap)

### Rebalance output
- Trade list: ticker, action (buy/sell), shares, dollar amount, weight before → after
- Projected weights post-trade
- Estimated transaction costs (if we add a cost assumption later)

---

## API Design

New FastAPI router: `api/routers/model.py` mounted at `/model`

| Method | Path | Description |
|---|---|---|
| **CMAs** | | |
| GET | `/model/cma` | List all CMA sets |
| GET | `/model/cma/{id}` | Get one CMA set |
| POST | `/model/cma` | Create a CMA set |
| PUT | `/model/cma/{id}` | Update a CMA set |
| DELETE | `/model/cma/{id}` | Delete a CMA set |
| POST | `/model/cma/{id}/activate` | Set as active CMA |
| POST | `/model/cma/{id}/validate` | Validate (PSD check, bounds) |
| **Optimizer** | | |
| POST | `/model/optimize` | Run MVO with active CMA + constraints → suggested weights |
| POST | `/model/frontier` | Compute efficient frontier (20 points) |
| **Portfolios** | | |
| GET | `/model/portfolios` | List all model portfolios |
| GET | `/model/portfolios/{id}` | Get one (with current drift if holdings exist) |
| POST | `/model/portfolios` | Create (from optimizer output or manual weights) |
| PUT | `/model/portfolios/{id}` | Update target weights |
| POST | `/model/portfolios/{id}/activate` | Set as live model |
| **Holdings & Drift** | | |
| POST | `/model/portfolios/{id}/holdings` | Record actual shares held per ticker |
| GET | `/model/portfolios/{id}/drift` | Current drift vs. target |
| POST | `/model/portfolios/{id}/rebalance` | Generate rebalance trade list |

---

## Frontend

New page: `/model` (Next.js app router, `web/app/model/page.tsx`)

### Sections
1. **CMA Editor** — tabular return/vol inputs + correlation matrix grid + save/load/export
2. **Optimizer** — risk aversion slider, constraint inputs, "Optimize" button → results table + efficient frontier chart
3. **Model Portfolio** — current target weights (bar chart), accept/override controls
4. **Drift Monitor** — current vs. target weights (grouped bar chart), max drift indicator, "Rebalance" button
5. **Trade Blotter** — rebalance trade list with export to CSV

---

## Backend Services

New files:
| File | Responsibility |
|---|---|
| `api/services/model_optimizer.py` | Mean-variance optimization (scipy), efficient frontier, marginal risk |
| `api/services/model_drift.py` | Price fetch, drift calculation, rebalance trade generation |
| `api/routers/model.py` | FastAPI endpoints |

Shared with existing code:
- `api/db/supabase.py` — add helpers for the new tables
- `api/services/prices.py` — reuse FMP price fetching

---

## Schema Additions

```sql
-- Capital market assumptions (named sets)
create table if not exists model_cma_sets (
  id            bigserial primary key,
  name          text not null,
  description   text,
  risk_free_rate float8 not null default 0.04,
  returns       jsonb not null,    -- { "DFAC": 0.095, ... }
  volatilities  jsonb not null,    -- { "DFAC": 0.160, ... }
  correlations  jsonb not null,    -- 12x12 matrix as nested array
  is_active     boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- Model portfolios (target allocations)
create table if not exists model_portfolios (
  id               bigserial primary key,
  name             text not null,
  cma_set_id       bigint references model_cma_sets(id),
  target_weights   jsonb not null,      -- { "DFAC": 0.25, ... }
  constraints      jsonb,               -- optimizer constraints used
  optimizer_output jsonb,               -- frontier, marginal risk, etc.
  is_active        boolean default false,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- Actual holdings (shares held, for drift tracking)
create table if not exists model_holdings (
  id            bigserial primary key,
  portfolio_id  bigint references model_portfolios(id) not null,
  ticker        text not null,
  shares        float8 not null,
  cost_basis    float8,            -- per share, optional
  as_of_date    date not null default current_date,
  created_at    timestamptz default now()
);

-- Rebalance history
create table if not exists model_rebalances (
  id             bigserial primary key,
  portfolio_id   bigint references model_portfolios(id) not null,
  rebalance_date date not null default current_date,
  trades         jsonb not null,     -- trade list
  weights_before jsonb,
  weights_after  jsonb,
  max_drift      float8,
  created_at     timestamptz default now()
);
```

---

## What's NOT in v1

- **Backtesting** — historical performance simulation of the model portfolio (good v2 feature)
- **Tax-lot tracking** — specific lot identification for tax-loss harvesting
- **Multi-account** — splitting the model across taxable / IRA / 401k
- **Automated trading** — integration with Schwab API to execute trades (you already have `schwab_trade.py` — could wire up later)
- **Configurable ETF universe** — adding/removing sleeves from the UI
- **Monte Carlo simulation** — probabilistic outcomes from CMAs
- **Black-Litterman** — blending market-implied equilibrium with user views

---

## Build Order

| Phase | Scope | Depends on |
|---|---|---|
| 1 | Schema + CMA CRUD (API + basic UI form) | — |
| 2 | Mean-variance optimizer service + `/model/optimize` + efficient frontier | Phase 1 |
| 3 | Model portfolio CRUD + weight override UI | Phase 2 |
| 4 | Drift monitoring (price fetch + drift calc + UI) | Phase 3 |
| 5 | Rebalance engine + trade blotter | Phase 4 |
| 6 | Polish: efficient frontier chart, correlation heatmap, CSV export | Phase 5 |
