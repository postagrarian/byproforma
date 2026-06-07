// Regime data — all sourced from FRED (free, no API key required).
//
// Series used:
//   CPIAUCSL          — CPI All Urban Consumers, monthly
//   USALOLITOAASTSAM  — OECD CLI for the US, monthly
//   BAMLH0A0HYM2      — ICE BofA US HY Option-Adjusted Spread, daily
//   T10Y2Y            — 10yr minus 2yr Treasury constant maturity spread, daily

export const REGIME_TILTS: Record<string, Record<string, number>> = {
  goldilocks:  { 'Mkt-RF': +0.10, SMB: +0.10, HML: -0.05, RMW: -0.05, CMA: -0.05, Mom: +0.15 },
  heating_up:  { 'Mkt-RF': +0.05, SMB: +0.05, HML: +0.15, RMW: +0.05, CMA: +0.05, Mom:  0.00 },
  stagflation: { 'Mkt-RF': -0.10, SMB: -0.10, HML: +0.05, RMW: +0.20, CMA: +0.10, Mom: -0.15 },
  recession:   { 'Mkt-RF': -0.15, SMB: -0.10, HML: -0.05, RMW: +0.20, CMA: +0.05, Mom: -0.10 },
}

// ── FRED fetch ───────────────────────────────────────────────────────────────

async function fetchFRED(series: string): Promise<{ date: string; value: number }[]> {
  const res  = await fetch(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`,
    { next: { revalidate: 3600 } },
  )
  if (!res.ok) throw new Error(`FRED ${series} returned ${res.status}`)
  const text = await res.text()
  return text.trim().split('\n').slice(1)
    .map((line) => {
      const [d, v] = line.split(',')
      return { date: d?.trim() ?? '', value: parseFloat(v ?? 'NaN') }
    })
    .filter((r) => r.date && !isNaN(r.value))
}

// For daily series: keep only the last observation per calendar month
function toMonthly(
  rows: { date: string; value: number }[],
): { date: string; value: number }[] {
  const map = new Map<string, { date: string; value: number }>()
  for (const r of rows) {
    const ym = r.date.slice(0, 7) // "YYYY-MM"
    map.set(ym, r)                // later observation overwrites earlier
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

// ── Rolling helpers ──────────────────────────────────────────────────────────

function rollingMean(arr: number[], n: number): number {
  const slice = arr.slice(-n)
  return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0
}

// ── Regime classification ────────────────────────────────────────────────────

export function classifyRegime(
  cli:       { date: string; value: number }[],
  cpiValues: number[],
) {
  const cliVals     = cli.slice(-4).map((r) => r.value)
  const growthRising = cliVals.length >= 2
    ? cliVals[cliVals.length - 1] > cliVals[0]
    : true

  const cpi3m  = rollingMean(cpiValues, 3)
  const cpi36m = rollingMean(cpiValues, Math.min(36, cpiValues.length))
  const inflationRising = cpi3m > cpi36m

  let regime = 'goldilocks'
  if ( growthRising && !inflationRising) regime = 'goldilocks'
  if ( growthRising &&  inflationRising) regime = 'heating_up'
  if (!growthRising &&  inflationRising) regime = 'stagflation'
  if (!growthRising && !inflationRising) regime = 'recession'

  return { regime, growthRising, inflationRising }
}

// ── Main payload builder ─────────────────────────────────────────────────────

export async function buildRegimePayload() {
  const MONTHS = 36

  // Fetch ~48 months so rolling calculations have warm-up data
  const [cpiRaw, cliRaw, hyRawDaily, spreadRawDaily] = await Promise.all([
    fetchFRED('CPIAUCSL'),
    fetchFRED('USALOLITOAASTSAM'),
    fetchFRED('BAMLH0A0HYM2'),
    fetchFRED('T10Y2Y'),
  ])

  // Monthly series — take last MONTHS+12 for rolling warm-up
  const cpiAll = cpiRaw.slice(-(MONTHS + 12))
  const cliAll = cliRaw.slice(-(MONTHS + 12))

  // Daily → monthly
  const hyMonthly     = toMonthly(hyRawDaily).slice(-(MONTHS + 2))
  const spreadMonthly = toMonthly(spreadRawDaily).slice(-(MONTHS + 2))

  // CPI rolling averages
  const cpiValues = cpiAll.map((r) => r.value)
  const cpiChart  = cpiAll.map((r, i, arr) => ({
    date:   r.date,
    value:  r.value,
    avg3m:  i >= 2  ? rollingMean(arr.slice(0, i + 1).map((x) => x.value), 3)  : null,
    avg36m: i >= 11 ? rollingMean(arr.slice(0, i + 1).map((x) => x.value), Math.min(36, i + 1)) : null,
  })).slice(-MONTHS)

  // Regime classification
  const { regime, growthRising, inflationRising } =
    classifyRegime(cliAll, cpiValues)

  return {
    regime,
    growthRising,
    inflationRising,
    tilts:     REGIME_TILTS[regime],
    updatedAt: new Date().toISOString(),
    charts: {
      cli:        cliAll.slice(-MONTHS),
      cpi:        cpiChart,
      yieldCurve: spreadMonthly.slice(-MONTHS),
      hySpread:   hyMonthly.slice(-MONTHS),
    },
  }
}
