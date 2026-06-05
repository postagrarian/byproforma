const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export async function triggerRun(slot: number): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE}/run/${slot}`, { method: 'POST' })
  if (!res.ok) throw new Error(`Run failed: ${res.statusText}`)
  return res.json()
}

export async function triggerCronRefresh(): Promise<void> {
  const res = await fetch(`${API_BASE}/cron/refresh`, { method: 'POST' })
  if (!res.ok) throw new Error(`Cron refresh failed: ${res.statusText}`)
}

export async function getPipelineStatus(slot: number) {
  const res = await fetch(`${API_BASE}/status/${slot}`)
  if (!res.ok) throw new Error(`Status fetch failed: ${res.statusText}`)
  return res.json()
}
