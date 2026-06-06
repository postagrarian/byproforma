const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init)
  if (!res.ok) throw new Error(`API error ${res.status}: ${res.statusText}`)
  return res.json()
}

// ── Config ──────────────────────────────────────────────────────────────────
export async function getAllConfigs() {
  return apiFetch<{ slot: number; ticker: string; last_run_date: string | null }[]>('/etf/configs')
}

export async function saveConfig(slot: number, ticker: string) {
  return apiFetch(`/etf/config/${slot}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ticker }),
  })
}

export async function clearSlot(slot: number) {
  return apiFetch(`/etf/config/${slot}`, { method: 'DELETE' })
}

// ── Portfolio results ────────────────────────────────────────────────────────
export async function getPortfolio(slot: number) {
  try {
    return await apiFetch<any>(`/portfolio/${slot}`)
  } catch {
    return null   // 404 = no results yet
  }
}

// ── Pipeline ─────────────────────────────────────────────────────────────────
export async function triggerRun(slot: number) {
  return apiFetch(`/run/${slot}`, { method: 'POST' })
}

export async function getPipelineStatus(slot: number) {
  return apiFetch<{ stage: string; message: string; progress: number }>(`/status/${slot}`)
}
