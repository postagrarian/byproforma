// Regime data — tries Railway cache first (fast), falls back to FRED directly.

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export const REGIME_TILTS: Record<string, Record<string, number>> = {
  goldilocks:  { 'Mkt-RF': +0.10, SMB: +0.10, HML: -0.05, RMW: -0.05, CMA: -0.05, Mom: +0.15 },
  heating_up:  { 'Mkt-RF': +0.05, SMB: +0.05, HML: +0.15, RMW: +0.05, CMA: +0.05, Mom:  0.00 },
  stagflation: { 'Mkt-RF': -0.10, SMB: -0.10, HML: +0.05, RMW: +0.20, CMA: +0.10, Mom: -0.15 },
  recession:   { 'Mkt-RF': -0.15, SMB: -0.10, HML: -0.05, RMW: +0.20, CMA: +0.05, Mom: -0.10 },
}

// ── FRED direct fallback ──────────────────────────────────────────────────────

async function fredFetch(series: string): Promise<{ date: string; value: number }[]> {
  try {
    const res  = await fetch(
      `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`,
      { next: { revalidate: 3600 }, signal: AbortSignal.timeout(8000) },
    )
    if (!res.ok) return []
    const text = await res.text()
    return text.trim().split('\n').slice(1)
      .map((l) => { const [d, v] = l.split(','); return { date: d?.trim() ?? '', value: parseFloat(v ?? 'NaN') } })
      .filter((r) => r.date && !isNaN(r.value))
  } catch { return [] }
}

function toMonthly(rows: { date: string; value: number }[]) {
  const map = new Map<string, { date: string; value: number }>()
  for (const r of rows) map.set(r.date.slice(0, 7), r)
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

function mean(arr: number[]) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0 }

async function buildFromFRED() {
  const MONTHS = 36
  const [cpiRaw, cliRaw, hyDaily, yieldRaw] = await Promise.all([
    fredFetch('CPIAUCSL'),
    fredFetch('USALOLITOAASTSAM'),
    fredFetch('BAMLH0A0HYM2'),
    fredFetch('T10Y2YM'),
  ])

  const cpiAll  = cpiRaw.slice(-(MONTHS + 24))
  const cliTrim = cliRaw.slice(-(MONTHS + 12))

  // Growth signal
  const cliVals    = cliTrim.slice(-4).map((r) => r.value)
  const growthRising = cliVals.length >= 2
    ? cliVals[cliVals.length - 1] > cliVals[0] : true

  // CPI YoY vs 3yr avg
  const cpiYoY = cpiAll.slice(12).map((r, i) =>
    (r.value / cpiAll[i].value - 1) * 100
  )
  const cpi3m  = mean(cpiYoY.slice(-3))
  const cpi36m = mean(cpiYoY.slice(-36))
  const inflationRising = cpi3m > cpi36m

  let regime = 'goldilocks'
  if ( growthRising && !inflationRising) regime = 'goldilocks'
  if ( growthRising &&  inflationRising) regime = 'heating_up'
  if (!growthRising &&  inflationRising) regime = 'stagflation'
  if (!growthRising && !inflationRising) regime = 'recession'

  // CPI chart
  const cpiChart = cpiAll.slice(12).map((r, i, arr) => {
    const yoy   = (r.value / cpiAll[i].value - 1) * 100
    const slice = arr.slice(0, i + 1).map((_, j) =>
      (arr[j].value / cpiAll[j].value - 1) * 100)
    return { date: r.date, yoy: +yoy.toFixed(3), avg3yr: +mean(slice.slice(-36)).toFixed(3) }
  }).slice(-MONTHS)

  return {
    regime, growthRising, inflationRising,
    tilts:     REGIME_TILTS[regime],
    updatedAt: new Date().toISOString(),
    charts: {
      cli:        cliRaw.slice(-MONTHS),
      cpi:        cpiChart,
      yieldCurve: yieldRaw.slice(-MONTHS),
      hySpread:   toMonthly(hyDaily).slice(-MONTHS),
    },
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function buildRegimePayload() {
  // 1. Try Railway cache (fast — reads from Supabase)
  try {
    const res = await fetch(`${API_BASE}/public/regime`, {
      next:   { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) return res.json()
  } catch { /* Railway unavailable — fall through */ }

  // 2. Fallback: fetch FRED directly from Vercel server
  return buildFromFRED()
}
