// Regime data — served from the Railway public endpoint which caches in Supabase.
// FRED is only called by Railway; the frontend never hits FRED directly.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export const REGIME_TILTS: Record<string, Record<string, number>> = {
  goldilocks:  { 'Mkt-RF': +0.10, SMB: +0.10, HML: -0.05, RMW: -0.05, CMA: -0.05, Mom: +0.15 },
  heating_up:  { 'Mkt-RF': +0.05, SMB: +0.05, HML: +0.15, RMW: +0.05, CMA: +0.05, Mom:  0.00 },
  stagflation: { 'Mkt-RF': -0.10, SMB: -0.10, HML: +0.05, RMW: +0.20, CMA: +0.10, Mom: -0.15 },
  recession:   { 'Mkt-RF': -0.15, SMB: -0.10, HML: -0.05, RMW: +0.20, CMA: +0.05, Mom: -0.10 },
}

export async function buildRegimePayload() {
  const res = await fetch(`${API_BASE}/public/regime`, {
    next: { revalidate: 3600 },   // Next.js fetch cache — 1h additional layer
  })
  if (!res.ok) throw new Error(`Regime endpoint returned ${res.status}`)
  return res.json()
}

// These are kept for backward compatibility with the API route
export function classifyRegime() { return { regime: 'goldilocks', growthRising: true, inflationRising: false } }
