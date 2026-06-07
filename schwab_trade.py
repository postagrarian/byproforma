#!/usr/bin/env python3
"""
schwab_trade.py — Place byProforma portfolio orders via the Schwab Individual Trader API.

Usage:
    python schwab_trade.py --file portfolio_schwab_orders.csv
    python schwab_trade.py --file portfolio_schwab_orders.csv --dry-run
    python schwab_trade.py --file portfolio_schwab_orders.csv --duration GTC
    python schwab_trade.py --file portfolio_schwab_orders.csv --spread-limit 1.0

Prerequisites:
    pip install requests python-dotenv

Credentials — create a .env file in the same folder as this script:
    SCHWAB_CLIENT_ID=your_client_id
    SCHWAB_CLIENT_SECRET=your_client_secret
    SCHWAB_REDIRECT_URI=https://127.0.0.1

Steps each run:
    1. Opens a browser URL — log in with your Schwab brokerage credentials
    2. Schwab redirects to https://127.0.0.1 (shows an error — that's expected)
    3. Copy the full URL from your browser address bar and paste it here
    4. Fetches real-time bid/ask for all tickers in one batch call
    5. Prices each limit order at the mid-point (bid+ask)/2
       — falls back to bid if spread > spread_limit %
    6. Shows a preview table — review before committing
    7. Two-step confirmation before any orders are placed
    8. Places orders and logs results to schwab_audit_YYYYMMDD_HHMMSS.csv
"""

import argparse
import base64
import csv
import json
import os
import sys
import webbrowser
from datetime import datetime
from urllib.parse import parse_qs, urlparse

import requests
from dotenv import load_dotenv

# ── Configuration ─────────────────────────────────────────────────────────────

SCHWAB_AUTH_URL  = "https://api.schwabapi.com/v1/oauth/authorize"
SCHWAB_TOKEN_URL = "https://api.schwabapi.com/v1/oauth/token"
SCHWAB_QUOTE_URL = "https://api.schwabapi.com/marketdata/v1/quotes"
SCHWAB_ACCT_URL  = "https://api.schwabapi.com/trader/v1/accounts"

# ── Auth ───────────────────────────────────────────────────────────────────────

def get_access_token(client_id: str, client_secret: str, redirect_uri: str) -> str:
    """
    OAuth 2.0 authorization code flow.
    Opens browser → user logs in → user pastes redirect URL → returns access token.
    """
    auth_url = (
        f"{SCHWAB_AUTH_URL}"
        f"?response_type=code"
        f"&client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
    )

    print("\n" + "=" * 70)
    print("SCHWAB AUTHORIZATION")
    print("=" * 70)
    print("\nOpening Schwab login in your browser...")
    print("Log in with your BROKERAGE credentials (not developer credentials).")
    print("\nAfter approving, your browser will redirect to a page that shows")
    print("an error — that's expected. Copy the full URL from the address bar")
    print("and paste it below.\n")

    webbrowser.open(auth_url)
    redirect_response = input("Paste the full redirect URL here: ").strip()

    parsed = urlparse(redirect_response)
    params = parse_qs(parsed.query)
    if "code" not in params:
        print("\nERROR: Could not find 'code' in the URL. Make sure you copied")
        print("the complete URL including everything after the '?'.")
        sys.exit(1)
    code = params["code"][0]

    credentials = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
    resp = requests.post(
        SCHWAB_TOKEN_URL,
        headers={
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        data={
            "grant_type":   "authorization_code",
            "code":         code,
            "redirect_uri": redirect_uri,
        },
        timeout=15,
    )
    if not resp.ok:
        print(f"\nERROR: Token exchange failed ({resp.status_code}): {resp.text}")
        sys.exit(1)

    tokens = resp.json()
    print("\n✓ Authenticated with Schwab")
    return tokens["access_token"]


def get_account_hash(access_token: str) -> str:
    """Fetch the encrypted account hash required for order placement."""
    resp = requests.get(
        SCHWAB_ACCT_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=15,
    )
    resp.raise_for_status()
    accounts = resp.json()
    if not accounts:
        print("ERROR: No accounts found on this Schwab login.")
        sys.exit(1)

    if len(accounts) == 1:
        acct = accounts[0]
    else:
        print("\nMultiple accounts found:")
        for i, a in enumerate(accounts):
            print(f"  {i+1}. {a['securitiesAccount']['accountNumber']} "
                  f"({a['securitiesAccount']['type']})")
        choice = int(input("Select account number: ")) - 1
        acct = accounts[choice]

    account_hash = acct["hashValue"]
    account_num  = acct["securitiesAccount"]["accountNumber"]
    print(f"✓ Using account {account_num[-4:].rjust(8, '*')}")
    return account_hash


# ── Quotes & pricing ───────────────────────────────────────────────────────────

def fetch_quotes(tickers: list[str], access_token: str) -> dict:
    """Batch-fetch real-time bid/ask for all tickers in one API call."""
    resp = requests.get(
        SCHWAB_QUOTE_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        params={"symbols": ",".join(tickers), "fields": "quote"},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def mid_price(bid: float, ask: float, spread_limit_pct: float) -> tuple[float, str]:
    """
    Returns (limit_price, method) where method is 'mid' or 'bid'.
    Falls back to bid price if spread exceeds spread_limit_pct.
    """
    if bid <= 0 or ask <= 0:
        return None, "unavailable"
    mid        = (bid + ask) / 2
    spread_pct = (ask - bid) / mid * 100
    if spread_pct > spread_limit_pct:
        return round(bid, 2), f"bid (spread {spread_pct:.2f}% > {spread_limit_pct}% limit)"
    return round(mid, 2), f"mid (spread {spread_pct:.3f}%)"


# ── Order placement ────────────────────────────────────────────────────────────

def place_order(
    account_hash: str,
    ticker:       str,
    shares:       int,
    limit_price:  float,
    action:       str,
    duration:     str,
    access_token: str,
    dry_run:      bool,
) -> dict:
    """Submit a single limit order. Returns status dict."""
    payload = {
        "orderType":          "LIMIT",
        "session":            "NORMAL",
        "duration":           duration,
        "price":              limit_price,
        "orderStrategyType":  "SINGLE",
        "orderLegCollection": [{
            "instruction": action.upper(),
            "quantity":    shares,
            "instrument":  {
                "symbol":    ticker,
                "assetType": "EQUITY",
            },
        }],
    }

    if dry_run:
        return {"status": "DRY_RUN", "order_id": "—", "detail": ""}

    resp = requests.post(
        f"{SCHWAB_ACCT_URL}/{account_hash}/orders",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type":  "application/json",
        },
        json=payload,
        timeout=15,
    )

    if resp.status_code == 201:
        order_id = resp.headers.get("Location", "").split("/")[-1]
        return {"status": "ACCEPTED", "order_id": order_id, "detail": ""}
    else:
        return {"status": "REJECTED", "order_id": "—", "detail": resp.text[:200]}


# ── CSV helpers ────────────────────────────────────────────────────────────────

def load_positions(filepath: str) -> list[dict]:
    """Read the byProforma export CSV. Requires Symbol, Action, Quantity columns."""
    positions = []
    with open(filepath, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            ticker = row.get("Symbol", "").strip().upper()
            action = row.get("Action", "BUY").strip().upper()
            qty    = row.get("Quantity", "").strip()
            if not ticker or not qty:
                continue
            try:
                shares = int(float(qty))
            except ValueError:
                print(f"  Skipping {ticker}: invalid quantity '{qty}'")
                continue
            if shares <= 0:
                continue
            positions.append({
                "ticker":   ticker,
                "action":   action,
                "shares":   shares,
                "company":  row.get("Company", "").strip('"'),
                "sector":   row.get("Sector", "").strip(),
                "duration": row.get("Duration", "DAY").strip() or "DAY",
            })
    return positions


def write_audit(results: list[dict], name: str):
    """Write all order results to a timestamped CSV audit file."""
    ts       = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"schwab_audit_{ts}.csv"
    headers  = ["Timestamp", "Ticker", "Company", "Action", "Shares",
                 "Bid", "Ask", "Limit_Price", "Pricing_Method",
                 "Status", "Order_ID", "Detail"]
    with open(filename, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(results)
    print(f"\n✓ Audit log written to {filename}")


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    load_dotenv()

    parser = argparse.ArgumentParser(description="Place byProforma orders via Schwab API")
    parser.add_argument("--file",         required=True, help="Path to byProforma export CSV")
    parser.add_argument("--dry-run",      action="store_true", help="Preview orders without submitting")
    parser.add_argument("--duration",     default="DAY", choices=["DAY", "GTC"],
                        help="Order duration (default: DAY)")
    parser.add_argument("--spread-limit", type=float, default=0.5,
                        help="Max spread %% before falling back to bid price (default: 0.5)")
    args = parser.parse_args()

    client_id     = os.getenv("SCHWAB_CLIENT_ID", "").strip()
    client_secret = os.getenv("SCHWAB_CLIENT_SECRET", "").strip()
    redirect_uri  = os.getenv("SCHWAB_REDIRECT_URI", "https://127.0.0.1").strip()

    if not client_id or not client_secret:
        print("ERROR: SCHWAB_CLIENT_ID and SCHWAB_CLIENT_SECRET must be set in .env")
        sys.exit(1)

    # ── Load positions ──────────────────────────────────────────────────────
    print(f"\nLoading positions from: {args.file}")
    positions = load_positions(args.file)
    if not positions:
        print("ERROR: No valid positions found in the CSV.")
        sys.exit(1)
    print(f"✓ {len(positions)} positions loaded")

    # ── Authenticate ────────────────────────────────────────────────────────
    access_token = get_access_token(client_id, client_secret, redirect_uri)
    account_hash = get_account_hash(access_token)

    # ── Fetch real-time quotes ──────────────────────────────────────────────
    print(f"\nFetching real-time bid/ask for {len(positions)} tickers...")
    tickers     = [p["ticker"] for p in positions]
    quote_data  = fetch_quotes(tickers, access_token)
    print("✓ Quotes received")

    # ── Price orders at mid ─────────────────────────────────────────────────
    priced = []
    for p in positions:
        tk    = p["ticker"]
        q     = quote_data.get(tk, {}).get("quote", {})
        bid   = float(q.get("bidPrice") or 0)
        ask   = float(q.get("askPrice") or 0)
        price, method = mid_price(bid, ask, args.spread_limit)

        if price is None:
            print(f"  WARNING: No quote for {tk} — skipping")
            continue

        priced.append({**p, "bid": bid, "ask": ask,
                       "limit_price": price, "pricing": method})

    if not priced:
        print("ERROR: No positions could be priced. Check quote data.")
        sys.exit(1)

    # ── Preview table ───────────────────────────────────────────────────────
    mode = "DRY RUN — no orders will be placed" if args.dry_run else f"LIVE — {args.duration} limit orders"
    print(f"\n{'=' * 72}")
    print(f"  ORDER PREVIEW  [{mode}]")
    print(f"{'=' * 72}")
    print(f"  {'Ticker':<8}  {'Action':<5}  {'Shares':>7}  {'Bid':>8}  "
          f"{'Ask':>8}  {'Limit':>8}  {'Method'}")
    print(f"  {'-' * 66}")
    total_value = 0.0
    for p in priced:
        est = (p["limit_price"] or 0) * (p["shares"] or 0)
        total_value += est
        print(f"  {p['ticker']:<8}  {p['action']:<5}  {p['shares']:>7,}  "
              f"${p['bid']:>7.2f}  ${p['ask']:>7.2f}  ${p['limit_price']:>7.2f}  "
              f"{p['pricing']}")
    print(f"  {'-' * 66}")
    print(f"  {'TOTAL':>33}                   ${total_value:>10,.2f}")
    print(f"{'=' * 72}")

    # ── Confirmation ────────────────────────────────────────────────────────
    if not args.dry_run:
        confirm1 = input(f"\n  Submit {len(priced)} limit orders? Type YES to continue: ").strip()
        if confirm1 != "YES":
            print("  Aborted.")
            sys.exit(0)
        confirm2 = input(f"  Final confirmation — place {len(priced)} orders NOW? Type CONFIRM: ").strip()
        if confirm2 != "CONFIRM":
            print("  Aborted.")
            sys.exit(0)

    # ── Place orders ────────────────────────────────────────────────────────
    print(f"\n{'Placing orders...' if not args.dry_run else 'Dry run — simulating orders...'}")
    results = []
    for p in priced:
        result = place_order(
            account_hash = account_hash,
            ticker       = p["ticker"],
            shares       = p["shares"],
            limit_price  = p["limit_price"],
            action       = p["action"],
            duration     = args.duration,
            access_token = access_token,
            dry_run      = args.dry_run,
        )
        icon = "✓" if result["status"] in ("ACCEPTED", "DRY_RUN") else "✗"
        print(f"  {icon} {p['ticker']:<8} {result['status']:<10} "
              f"order_id={result['order_id']}"
              + (f"  {result['detail']}" if result["detail"] else ""))

        results.append({
            "Timestamp":      datetime.now().isoformat(),
            "Ticker":         p["ticker"],
            "Company":        p.get("company", ""),
            "Action":         p["action"],
            "Shares":         p["shares"],
            "Bid":            p["bid"],
            "Ask":            p["ask"],
            "Limit_Price":    p["limit_price"],
            "Pricing_Method": p["pricing"],
            "Status":         result["status"],
            "Order_ID":       result["order_id"],
            "Detail":         result["detail"],
        })

    # ── Audit log ───────────────────────────────────────────────────────────
    write_audit(results, args.file)

    accepted = sum(1 for r in results if r["Status"] in ("ACCEPTED", "DRY_RUN"))
    rejected = len(results) - accepted
    print(f"\n  {accepted} accepted  |  {rejected} rejected  |  {len(results)} total")
    print("  Done.\n")


if __name__ == "__main__":
    main()
