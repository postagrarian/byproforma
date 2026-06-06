// Supabase is only accessed server-side via the Railway API (service role key).
// The frontend never queries Supabase directly — all data flows through
// the Railway API endpoints in lib/api.ts.
//
// This file is intentionally empty. If you ever add server-side Next.js
// route handlers that need direct DB access, initialise the client here
// with the service role key from a server-only env var (no NEXT_PUBLIC_ prefix).
export {}
