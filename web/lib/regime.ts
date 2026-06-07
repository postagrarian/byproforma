// Regime data — all sourced from FRED (free, no API key required).
//
// Series:
//   CPIAUCSL         — CPI All Urban Consumers, monthly (absolute level)
//   USALOLITOAASTSAM — OECD CLI for the US, monthly
//   BAMLH0A0HYM2     — ICE BofA US HY OAS, daily → converted to monthly
//   T10Y2YM          — 10yr minus 2yr Treasury spread, monthly average

export const REGIME_TILTS: Record<string, Record<string, number>> = {
  goldilocks:  { 'Mkt-RF': +0.10, SMB: +0.10, HML: -0.05, RMW: -0.05, CMA: -0.05, Mom: +0.15 },
  heating_up:  { 'Mkt-RF': +0.05, SMB: +0.05, HML: +0.15, RMW: +0.05, CMA: +0.05, Mom:  0.00 },
  stagflation: { 'Mkt-RF': -0.10, SMB: -0.10, HML: +0.05, RMW: +0.20, CMA: +0.10, Mom: -0.15 },
  recession:   { 'Mkt-RF': -0.15, SMB: -0.10, HML: -0.05, RMW: +0.20, CMA: +0.05, Mom: -0.10 },
}

async function fetchFRED(series: string): Promise<{ date: string; value: number }[]> {
  const res  = await fetch(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`,
    { next: { revalidate: 3600 } },
  )
  if (!res.ok) throw new Error(`FRED ${series}: ${res.status}`)
  const text = await res.text()
  return text.trim().split('\n').slice(1)
    .map((line) => {
      const [d, v] = line.split(',')
      return { date: d?.trim() ?? '', value: parseFloat(v ?? 'NaN') }
    })
    .filter((r) => r.date && !isNaN(r.value))
}

// For daily series: keep the last observation per calendar month
function toMonthly(rows: { date: string; value: number }[]): { date: string; value: number }[] {
  const map = new Map<string, { date: string; value: number }>()
  for (const r of rows) map.set(r.date.slice(0, 7), r)
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
}

function rollingMean(arr: number[], n: number): number {
  const sl = arr.slice(-n)
  return sl.length ? sl.reduce((a, b) => a + b, 0) / sl.length : 0
}

export function classifyRegime(
  cli:       { date: string; value: number }[],
  cpiValues: number[],   // absolute CPI levels
) {
  const cliVals      = cli.slice(-4).map((r) => r.value)
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

export async function buildRegimePayload() {
  const MONTHS = 36

  const [cpiRaw, cliRaw, hyDaily, yieldRaw] = await Promise.all([
    fetchFRED('CPIAUCSL'),          // monthly absolute level
    fetchFRED('USALOLITOAASTSAM'),  // monthly CLI
    fetchFRED('BAMLH0A0HYM2'),      // daily HY spread
    fetchFRED('T10Y2YM'),           // monthly 10-2yr spread
  ])

  // ── CPI as YoY % change — readable 0-9% range ────────────────────────────
  const cpiAll    = cpiRaw.slice(-(MONTHS + 24))  // extra for YoY calculation
  const cpiValues = cpiAll.map((r) => r.value)

  const cpiChart = cpiAll.slice(12).map((r, i) => {
    const yoy        = (r.value / cpiAll[i].value - 1) * 100
    const allYoy     = cpiAll.slice(12, 12 + i + 1).map((x, j) =>
      (x.value / cpiAll[j].value - 1) * 100
    )
    const avg3yr     = rollingMean(allYoy, Math.min(36, allYoy.length))
    return { date: r.date, yoy: +yoy.toFixed(3), avg3yr: +avg3yr.toFixed(3) }
  }).slice(-MONTHS)

  // ── Regime classification (uses absolute CPI for the 3m/36m comparison) ──
  const { regime, growthRising, inflationRising } =
    classifyRegime(cliRaw.slice(-(MONTHS + 12)), cpiValues)

  // ── HY spread: daily → monthly ────────────────────────────────────────────
  const hyMonthly = toMonthly(hyDaily).slice(-MONTHS)

  return {
    regime,
    growthRising,
    inflationRising,
    tilts:     REGIME_TILTS[regime],
    updatedAt: new Date().toISOString(),
    charts: {
      cli:        cliRaw.slice(-MONTHS),
      cpi:        cpiChart,
      yieldCurve: yieldRaw.slice(-MONTHS),   // T10Y2YM — already monthly %
      hySpread:   hyMonthly,
    },
  }
}
