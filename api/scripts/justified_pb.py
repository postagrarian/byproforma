"""
Justified Price/Book (P/B) Model — built up from DuPont Analysis.

The justified P/B ratio is the P/B that is "justified" by fundamentals:

    P/B = (ROE - g) / (r - g)

where:
    ROE  = return on equity, decomposed via DuPont (3-factor and 5-factor)
    g    = sustainable growth rate = ROE × retention ratio (capped at g_cap)
    r    = cost of equity (CAPM) = Rf + β × ERP

DuPont 3-factor:
    ROE = Net Profit Margin × Asset Turnover × Equity Multiplier
        = (Net Income / Revenue) × (Revenue / Total Assets) × (Total Assets / Total Equity)

DuPont 5-factor:
    ROE = Tax Burden × Interest Burden × Operating Margin × Asset Turnover × Equity Multiplier
        = (Net Income / EBT) × (EBT / EBIT) × (EBIT / Revenue) × (Revenue / Assets) × (Assets / Equity)

When ROE > r, the firm creates economic value and should trade above book.
When g >= r (growth exceeds cost of equity), the perpetuity diverges; we cap g
at a user-specified long-term ceiling (default 4%) to keep the model finite.

Usage:
    python api/scripts/justified_pb.py AAPL
    python api/scripts/justified_pb.py AAPL --rf 0.04 --erp 0.05 --g-cap 0.03
    python api/scripts/justified_pb.py AAPL --sensitivity

All fundamental data from FMP (Financial Modeling Prep):
    /stable/income-statement          — revenue, net income, EBIT, EBT
    /stable/balance-sheet-statement   — total assets, total equity, total debt
    /stable/cash-flow-statement       — dividends paid
    /stable/profile                   — beta, price
    /stable/ratios-ttm                — current P/B, TTM ratios (cross-check)
"""
import os
import sys
import argparse
import json
import requests

FMP_BASE = "https://financialmodelingprep.com/stable"


def load_env():
    env_path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
    if os.path.exists(env_path) and "FMP_API_KEY" not in os.environ:
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ[k.strip()] = v.strip()


def fmp_get(path: str, params: dict) -> dict | list:
    key = os.environ["FMP_API_KEY"]
    resp = requests.get(
        f"{FMP_BASE}{path}",
        params={"apikey": key, **params},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _fnum(val, default=0.0):
    try:
        return float(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def fetch_fundamentals(ticker: str) -> dict:
    """Fetch all data needed for DuPont + justified P/B from FMP."""
    inc = fmp_get("/income-statement", {"symbol": ticker, "period": "annual", "limit": 1})
    bs = fmp_get("/balance-sheet-statement", {"symbol": ticker, "period": "annual", "limit": 1})
    cf = fmp_get("/cash-flow-statement", {"symbol": ticker, "period": "annual", "limit": 1})
    profile = fmp_get("/profile", {"symbol": ticker})
    ratios = fmp_get("/ratios-ttm", {"symbol": ticker})
    key_metrics = fmp_get("/key-metrics-ttm", {"symbol": ticker})

    if not inc or not bs or not profile:
        raise ValueError(f"FMP returned no data for {ticker}")

    i = inc[0]
    b = bs[0]
    c = cf[0] if cf else {}
    p = profile[0]
    rt = ratios[0] if ratios else {}
    km = key_metrics[0] if key_metrics else {}

    revenue = _fnum(i.get("revenue"))
    net_income = _fnum(i.get("netIncome"))
    ebit = _fnum(i.get("operatingIncome") or i.get("ebit"))
    ebt = _fnum(i.get("incomeBeforeTax") or i.get("ebt"))
    total_assets = _fnum(b.get("totalAssets"))
    total_equity = _fnum(b.get("totalStockholdersEquity") or b.get("totalEquity"))
    total_debt = _fnum(b.get("totalDebt"))
    dividends_paid = abs(_fnum(c.get("commonDividendsPaid") or c.get("netDividendsPaid")))
    beta = _fnum(p.get("beta"), 1.0)
    price = _fnum(p.get("price"))
    sector = p.get("sector", "")
    industry = p.get("industry", "")
    company_name = p.get("companyName", ticker)
    fiscal_date = i.get("date", "")

    # FMP TTM ratios for cross-check
    roe_ttm = _fnum(rt.get("returnOnEquityTTM")) if rt else 0.0
    current_pb = _fnum(rt.get("priceToBookRatioTTM")) if rt else 0.0
    bvps = _fnum(rt.get("bookValuePerShareTTM")) if rt else 0.0
    payout_ratio_ttm = _fnum(rt.get("dividendPayoutRatioTTM")) if rt else 0.0

    # 5-factor DuPont from FMP ratios (cross-check)
    tax_burden_ttm = _fnum(rt.get("ebtPerEbitTTM")) if rt else 0.0  # EBT/EBIT — but this is wrong
    # Actually EBT/EBIT = interest burden. Tax burden = Net Income / EBT.
    # We'll compute 5-factor from raw statements.

    return {
        "ticker": ticker,
        "company_name": company_name,
        "sector": sector,
        "industry": industry,
        "fiscal_date": fiscal_date,
        # Raw financials
        "revenue": revenue,
        "ebit": ebit,
        "ebt": ebt,
        "net_income": net_income,
        "total_assets": total_assets,
        "total_equity": total_equity,
        "total_debt": total_debt,
        "dividends_paid": dividends_paid,
        "beta": beta,
        "price": price,
        # TTM cross-check
        "roe_ttm_fmp": roe_ttm,
        "current_pb": current_pb,
        "bvps": bvps,
        "payout_ratio_ttm": payout_ratio_ttm,
    }


def compute_dupont(data: dict) -> dict:
    """Compute 3-factor and 5-factor DuPont decomposition."""
    rev = data["revenue"]
    ni = data["net_income"]
    ebit = data["ebit"]
    ebt = data["ebt"]
    ta = data["total_assets"]
    te = data["total_equity"]

    # 3-factor
    npm = ni / rev if rev else 0  # Net Profit Margin
    ato = rev / ta if ta else 0  # Asset Turnover
    em = ta / te if te else 0     # Equity Multiplier
    roe_3f = npm * ato * em

    # 5-factor
    tax_burden = ni / ebt if ebt else 0       # Net Income / EBT
    interest_burden = ebt / ebit if ebit else 0  # EBT / EBIT
    op_margin = ebit / rev if rev else 0      # EBIT / Revenue (Operating Margin)
    roe_5f = tax_burden * interest_burden * op_margin * ato * em

    return {
        # 3-factor
        "net_profit_margin": npm,
        "asset_turnover": ato,
        "equity_multiplier": em,
        "roe_3factor": roe_3f,
        # 5-factor
        "tax_burden": tax_burden,
        "interest_burden": interest_burden,
        "operating_margin": op_margin,
        "roe_5factor": roe_5f,
        # ROE used for justified P/B (prefer 3-factor from raw statements)
        "roe": roe_3f,
    }


def compute_justified_pb(
    roe: float,
    retention: float,
    beta: float,
    rf: float,
    erp: float,
    g_cap: float | None = 0.04,
) -> dict:
    """
    Compute justified P/B from DuPont ROE.

    Args:
        roe:      Return on equity (decimal, e.g. 0.15 for 15%)
        retention: Retention ratio (1 - payout ratio)
        beta:     Stock beta
        rf:       Risk-free rate (decimal)
        erp:      Equity risk premium (decimal)
        g_cap:    Cap on sustainable growth rate (None = no cap)
    """
    # Sustainable growth rate
    g_raw = roe * retention  # theoretical ceiling
    g = min(g_raw, g_cap) if g_cap is not None else g_raw
    g = max(g, 0)  # no negative growth in perpetuity

    # CAPM cost of equity
    r = rf + beta * erp

    # Justified P/B
    if r <= g:
        justified_pb = float("inf")
    else:
        justified_pb = (roe - g) / (r - g)

    return {
        "retention": retention,
        "g_raw": g_raw,
        "g": g,
        "g_capped": g_raw > g_cap if g_cap else False,
        "r": r,
        "rf": rf,
        "erp": erp,
        "beta": beta,
        "justified_pb": justified_pb,
    }


def format_pct(x: float, digits: int = 2) -> str:
    return f"{x*100:.{digits}f}%"


def format_num(x: float, digits: int = 4) -> str:
    if abs(x) > 1e9:
        return f"${x/1e9:.1f}B"
    elif abs(x) > 1e6:
        return f"${x/1e6:.1f}M"
    return f"${x:,.0f}"


def print_report(ticker: str, data: dict, dp: dict, pb: dict, sensitivity: bool = False):
    """Print a formatted report to terminal."""
    print()
    print(f"  {'='*60}")
    print(f"  {data['company_name']} ({ticker})")
    print(f"  Sector: {data['sector']} · Industry: {data['industry']}")
    print(f"  Fiscal Year End: {data['fiscal_date']}")
    print(f"  {'='*60}")
    print()

    # Raw financials
    print(f"  ── Income Statement ──────────────────────────────────────")
    print(f"    Revenue:          {format_num(data['revenue'])}")
    print(f"    EBIT:             {format_num(data['ebit'])}")
    print(f"    EBT:              {format_num(data['ebt'])}")
    print(f"    Net Income:       {format_num(data['net_income'])}")
    print()
    print(f"  ── Balance Sheet ────────────────────────────────────────")
    print(f"    Total Assets:     {format_num(data['total_assets'])}")
    print(f"    Total Equity:     {format_num(data['total_equity'])}")
    print(f"    Total Debt:       {format_num(data['total_debt'])}")
    print(f"    Debt/Equity:      {data['total_debt']/data['total_equity']:.2f}x")
    print()

    # DuPont 3-factor
    print(f"  ── DuPont 3-Factor ──────────────────────────────────────")
    print(f"    Net Profit Margin  = NI / Rev       = {dp['net_profit_margin']:.4f}  ({dp['net_profit_margin']*100:.2f}%)")
    print(f"    Asset Turnover     = Rev / Assets    = {dp['asset_turnover']:.4f}")
    print(f"    Equity Multiplier  = Assets / Equity = {dp['equity_multiplier']:.4f}")
    print(f"    ROE = {dp['net_profit_margin']:.4f} × {dp['asset_turnover']:.4f} × {dp['equity_multiplier']:.4f}")
    print(f"        = {dp['roe_3factor']:.4f}  ({dp['roe_3factor']*100:.2f}%)")
    if data['roe_ttm_fmp']:
        print(f"    [FMP TTM cross-check: {data['roe_ttm_fmp']:.4f}]")
    print()

    # DuPont 5-factor
    print(f"  ── DuPont 5-Factor ──────────────────────────────────────")
    print(f"    Tax Burden         = NI / EBT        = {dp['tax_burden']:.4f}")
    print(f"    Interest Burden    = EBT / EBIT      = {dp['interest_burden']:.4f}")
    print(f"    Operating Margin   = EBIT / Rev      = {dp['operating_margin']:.4f}  ({dp['operating_margin']*100:.2f}%)")
    print(f"    Asset Turnover     = Rev / Assets    = {dp['asset_turnover']:.4f}")
    print(f"    Equity Multiplier  = Assets / Equity = {dp['equity_multiplier']:.4f}")
    print(f"    ROE = {dp['tax_burden']:.4f} × {dp['interest_burden']:.4f} × {dp['operating_margin']:.4f} × {dp['asset_turnover']:.4f} × {dp['equity_multiplier']:.4f}")
    print(f"        = {dp['roe_5factor']:.4f}  ({dp['roe_5factor']*100:.2f}%)")
    print()

    # Growth
    print(f"  ── Sustainable Growth ──────────────────────────────────")
    print(f"    Dividends Paid:    {format_num(data['dividends_paid'])}")
    print(f"    Payout Ratio:     {1 - pb['retention']:.4f}  ({(1-pb['retention'])*100:.2f}%)")
    print(f"    Retention (b):    {pb['retention']:.4f}  ({pb['retention']*100:.2f}%)")
    print(f"    g = ROE × b      = {dp['roe']:.4f} × {pb['retention']:.4f} = {pb['g_raw']:.4f}  ({pb['g_raw']*100:.2f}%)")
    if pb['g_capped']:
        print(f"    ⚠ g capped at {pb['g']*100:.2f}% (theoretical g = {pb['g_raw']*100:.2f}%)")
    print()

    # CAPM
    print(f"  ── Cost of Equity (CAPM) ───────────────────────────────")
    print(f"    Beta:             {pb['beta']:.3f}")
    print(f"    Risk-Free Rate:   {pb['rf']*100:.2f}%")
    print(f"    Equity Risk Prem:  {pb['erp']*100:.2f}%")
    print(f"    r = {pb['rf']:.4f} + {pb['beta']:.3f} × {pb['erp']:.4f} = {pb['r']:.4f}  ({pb['r']*100:.2f}%)")
    print()

    # Justified P/B
    print(f"  ── Justified P/B ────────────────────────────────────────")
    print(f"    P/B = (ROE - g) / (r - g)")
    print(f"        = ({dp['roe']:.4f} - {pb['g']:.4f}) / ({pb['r']:.4f} - {pb['g']:.4f})")
    if pb['justified_pb'] == float('inf'):
        print(f"        = ∞  (g ≥ r — perpetuity diverges)")
    else:
        print(f"        = {pb['justified_pb']:.2f}")
    print()
    print(f"    Current P/B:      {data['current_pb']:.2f}")
    print(f"    Justified P/B:    {pb['justified_pb']:.2f}" if pb['justified_pb'] != float('inf') else "    Justified P/B:    ∞")
    if data['bvps'] > 0 and pb['justified_pb'] != float('inf'):
        implied_price = pb['justified_pb'] * data['bvps']
        if data['price'] > 0:
            up_down = (implied_price / data['price'] - 1) * 100
            print(f"    Book Value/Share: ${data['bvps']:.2f}")
            print(f"    Current Price:    ${data['price']:.2f}")
            print(f"    Implied Price:    ${implied_price:.2f}")
            sign = "+" if up_down >= 0 else ""
            print(f"    Upside/Downside:  {sign}{up_down:.1f}%")
    print()

    if sensitivity:
        print_sensitivity(dp['roe'], pb['retention'], pb['beta'], pb['rf'], pb['erp'])

    print(f"  {'='*60}")
    print()


def print_sensitivity(roe: float, retention: float, beta: float, rf: float, erp: float):
    """Print a sensitivity grid of justified P/B across r and g."""
    g_values = [0.0, 0.01, 0.02, 0.03, 0.04, 0.05]
    r_values = [0.06, 0.08, 0.10, 0.12, 0.14]

    print(f"  ── Sensitivity: Justified P/B by (r, g) ─────────────────")
    print(f"    ROE = {roe*100:.2f}%, β = {beta:.2f}")
    print()
    header = "    r \\ g │"
    for g in g_values:
        header += f"  {g*100:>5.1f}%"
    print(header)
    print("    " + "─" * (len(header) - 4))

    for r in r_values:
        row = f"    {r*100:>5.1f}% │"
        for g in g_values:
            if r <= g:
                row += "     ∞"
            else:
                pb_val = (roe - g) / (r - g)
                row += f"  {pb_val:>5.2f}"
        print(row)
    print()


def main():
    parser = argparse.ArgumentParser(
        description="Justified P/B model built from DuPont Analysis (FMP data)"
    )
    parser.add_argument("ticker", help="Stock ticker (e.g., AAPL, MSFT, JPM)")
    parser.add_argument("--rf", type=float, default=0.0425, help="Risk-free rate (default: 4.25%%)")
    parser.add_argument("--erp", type=float, default=0.055, help="Equity risk premium (default: 5.50%%)")
    parser.add_argument("--g-cap", type=float, default=0.04, help="Cap on sustainable growth rate (default: 4%%, use -1 for no cap)")
    parser.add_argument("--sensitivity", action="store_true", help="Print sensitivity grid")
    parser.add_argument("--json", action="store_true", help="Output JSON instead of formatted report")
    args = parser.parse_args()

    load_env()

    g_cap = None if args.g_cap < 0 else args.g_cap

    data = fetch_fundamentals(args.ticker.upper())
    dp = compute_dupont(data)

    # Retention ratio from dividends
    ni = data["net_income"]
    payout = data["dividends_paid"] / ni if ni > 0 else 0.0
    retention = 1 - payout

    pb = compute_justified_pb(
        roe=dp["roe"],
        retention=retention,
        beta=data["beta"],
        rf=args.rf,
        erp=args.erp,
        g_cap=g_cap,
    )

    if args.json:
        result = {**data, **dp, **pb, "payout_ratio": payout}
        print(json.dumps(result, indent=2, default=str))
    else:
        print_report(args.ticker.upper(), data, dp, pb, sensitivity=args.sensitivity)


if __name__ == "__main__":
    main()
