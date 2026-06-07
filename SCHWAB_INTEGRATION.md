# Schwab Integration Roadmap

This document outlines every step required to connect byProforma to the
Schwab Individual Trader API for programmatic order execution, including
the security hardening that must happen first.

---

## Phase 1 — Security Hardening (prerequisite)

These changes are required before any brokerage connection. They replace
the current localStorage-based auth with real server-side sessions and
ensure sensitive tokens never touch the browser.

### 1.1 Replace password auth with proper sessions

**Current state:** `NEXT_PUBLIC_APP_PASSWORD` is baked into the JavaScript
bundle at build time. The auth check is `localStorage.getItem('byproforma_auth') === '1'`,
which is forgeable from the browser console.

**Target state:** Server-side sessions using signed httpOnly cookies.
No auth state lives in localStorage or in the JavaScript bundle.

**Recommended library:** Clerk (free tier, 10-minute setup) or NextAuth.js.
Both integrate natively with Next.js App Router and handle session storage,
token rotation, and cookie signing automatically.

**Steps:**
1. Sign up at clerk.com, create an application
2. Install `@clerk/nextjs`
3. Wrap `app/layout.tsx` in `<ClerkProvider>`
4. Replace the `HomeClient` password form with Clerk's `<SignIn>` component
5. Replace `isAuthenticated()` checks in `engine/page.tsx` and `notes/page.tsx`
   with Clerk's `auth()` server helper
6. Remove `NEXT_PUBLIC_APP_PASSWORD` from Vercel env vars
7. Remove `web/lib/auth.ts` and all `localStorage` auth references

### 1.2 Proxy Railway calls through Next.js API routes

**Current state:** The browser makes direct HTTP calls to the Railway URL
(`byproforma-production.up.railway.app`). This URL is visible in browser
network requests, and several Railway endpoints are unauthenticated.

**Target state:** The browser only ever talks to Vercel (`/api/*`). Next.js
API routes forward requests to Railway with the CRON_SECRET header. The
Railway URL is never exposed to the client.

**Steps:**
1. Create `/api/proxy/[...path]/route.ts` — a catch-all that forwards
   authenticated requests from the browser to Railway
2. Update all client-side `fetch(${API_BASE}/...)` calls in TiltTab,
   FactorCorrections, SavedTiltTab, etc. to call `/api/proxy/...` instead
3. Add CRON_SECRET authentication to all Railway endpoints (currently only
   the cron endpoints check it)
4. Remove `NEXT_PUBLIC_API_URL` from the browser-accessible env vars —
   move it to a server-only `API_URL` variable

### 1.3 Add audit logging

Create a `audit_log` Supabase table to record all significant actions:

```sql
create table if not exists audit_log (
  id          bigserial primary key,
  action      text not null,
  detail      jsonb,
  created_at  timestamptz default now()
);
```

Log: login attempts, portfolio runs triggered, trade orders submitted,
trade orders confirmed, Schwab token refresh events.

---

## Phase 2 — Schwab OAuth Setup

### 2.1 Prerequisites

- Schwab developer account at developer.schwab.com
- byProforma deployed at a stable domain (e.g. byproforma.com)
- Phase 1 security hardening complete

### 2.2 Create the Schwab app

1. Log in to developer.schwab.com → **My Apps → Create App**
2. Set **Callback URL** to:
   ```
   https://byproforma.com/api/schwab/callback
   ```
   This is where Schwab redirects the browser after the user approves access.
   Schwab appends `?code=AUTH_CODE` to this URL — your API route captures it.
3. Note down the **Client ID** and **Client Secret**
4. Add to Railway env vars (never Vercel — the secret must not reach the browser):
   ```
   SCHWAB_CLIENT_ID=your_client_id
   SCHWAB_CLIENT_SECRET=your_client_secret
   SCHWAB_REDIRECT_URI=https://byproforma.com/api/schwab/callback
   ```

### 2.3 How the OAuth callback URL works

When Schwab redirects to `https://byproforma.com/api/schwab/callback?code=ABC123`,
your Next.js route at that path receives the `code` parameter, exchanges it
for an access token and refresh token via a server-to-server POST to Schwab,
and stores the refresh token encrypted in Supabase.

The user never sees the token. The browser never holds the token.

### 2.4 Token lifecycle

| Token | Lifetime | Storage |
|---|---|---|
| Authorization code | ~30 seconds | URL parameter only (never stored) |
| Access token | 30 minutes | Railway memory only (never persisted) |
| Refresh token | 7 days (resets on use) | Supabase, encrypted |

The refresh token resets its 7-day clock every time it is used to get a new
access token. As long as the app exchanges tokens at least weekly, the session
stays alive indefinitely.

---

## Phase 3 — Build the Integration

### 3.1 New Supabase table

```sql
create table if not exists schwab_tokens (
  id             int primary key default 1,   -- singleton
  refresh_token  text not null,               -- encrypted at application layer
  account_hash   text,                        -- Schwab account identifier
  updated_at     timestamptz default now()
);
```

### 3.2 New Railway endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/schwab/auth-url` | GET | Returns the Schwab OAuth authorization URL |
| `/schwab/exchange` | POST | Exchanges auth code for tokens, saves to Supabase |
| `/schwab/status` | GET | Checks whether a valid refresh token exists |
| `/schwab/orders` | POST | Places a batch of orders against the saved portfolio |
| `/schwab/preview` | POST | Validates orders without submitting (dry run) |

### 3.3 New Next.js routes

| Route | Purpose |
|---|---|
| `/api/schwab/callback` | Receives the OAuth redirect from Schwab |
| `/api/schwab/connect` | Initiates the OAuth flow (redirects user to Schwab) |
| `/api/schwab/status` | Proxies status check to Railway |
| `/api/schwab/trade` | Proxies order submission to Railway |

### 3.4 Order placement flow

```
User enters portfolio value → position sizing calculated →
  clicks "Preview Orders" →
    Railway calls GET /trader/v1/quotes for current prices →
    displays order preview table (ticker, shares, estimated $, order type) →
  clicks "Confirm & Send" (with 5-second countdown) →
    Railway loops through positions →
    POST /trader/v1/accounts/{accountHash}/orders for each →
    results written to audit_log →
  UI shows accepted / rejected per order
```

### 3.5 Schwab order payload (per position)

```json
{
  "orderType": "MARKET",
  "session": "NORMAL",
  "duration": "DAY",
  "orderStrategyType": "SINGLE",
  "orderLegCollection": [
    {
      "instruction": "BUY",
      "quantity": 10,
      "instrument": {
        "symbol": "NVDA",
        "assetType": "EQUITY"
      }
    }
  ]
}
```

For sells, change `"instruction"` to `"SELL"`. For limit orders, add
`"price"` and change `"orderType"` to `"LIMIT"`.

### 3.6 UI additions

- **Connect Schwab** button in a new Settings section (triggers OAuth flow)
- **Connection status** badge (connected / token expired / not connected)
- **Preview Orders** button on position sizing table (dry run)
- **Confirm & Send** button with countdown timer (prevents accidental submit)
- **Order history** tab showing audit log with status per order

---

## Phase 4 — Safety Controls

### 4.1 Order guardrails (implement before going live)

- **Single-order cap:** refuse any individual order > $50,000 (configurable)
- **Session cap:** refuse if total order value > portfolio_value × 1.15
  (margin buffer — shouldn't need more than 15% over stated value)
- **Market hours check:** warn if outside regular market hours (9:30–16:00 ET)
- **Duplicate prevention:** hash the order set and reject if the same set
  was submitted within the last 60 seconds
- **Confirmation requirement:** two-click confirm with order summary shown
  between clicks

### 4.2 Credentials checklist before going live

- [ ] `SCHWAB_CLIENT_ID` in Railway Variables (not Vercel)
- [ ] `SCHWAB_CLIENT_SECRET` in Railway Variables (not Vercel)
- [ ] `SCHWAB_REDIRECT_URI` in Railway Variables
- [ ] `regime_cache` Supabase table created
- [ ] `schwab_tokens` Supabase table created
- [ ] `audit_log` Supabase table created
- [ ] Phase 1 session hardening complete
- [ ] Railway proxy pattern in place (browser never sees Railway URL)
- [ ] At least one test trade placed on a paper/practice account first

---

## Phase 5 — Testing Sequence

1. Complete OAuth connection on a **Schwab paper trading account** first
2. Submit a single 10-share market order and verify it appears in Schwab
3. Submit a 5-position basket and verify all legs are accepted
4. Submit a 25-position basket (full portfolio) in paper trading
5. Verify audit log captures all attempts and results
6. Only after all above pass: connect production account

---

## Key Schwab API Reference

| Resource | URL |
|---|---|
| Developer portal | developer.schwab.com |
| API base URL | `https://api.schwabapi.com/trader/v1` |
| Auth endpoint | `https://api.schwabapi.com/v1/oauth/authorize` |
| Token endpoint | `https://api.schwabapi.com/v1/oauth/token` |
| Account list | `GET /accounts` |
| Place order | `POST /accounts/{accountHash}/orders` |
| Order status | `GET /accounts/{accountHash}/orders/{orderId}` |
| Preview order | `POST /accounts/{accountHash}/previewOrder` |
