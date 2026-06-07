import { NextResponse } from 'next/server'

const FMP_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
const FMP_KEY  = process.env.FMP_API_KEY_PUBLIC ?? ''   // optional public key
const FMP_URL  = 'https://financialmodelingprep.com/stable'

// Factor tilt offsets by regime — additive on top of foundational ETF betas
export const REGIME_TILTS: Record<string, Record<string, number>> = {
  goldilocks:  { 'Mkt-RF': +0.10, SMB: +0.10, HML: -0.05, RMW: -0.05, CMA: -0.05, Mom: +0.15 },
  heating_up:  { 'Mkt-RF': +0.05, SMB: +0.05, HML: +0.15, RMW: +0.05, CMA: +0.05, Mom:  0.00 },
  stagflation: { 'Mkt-RF': -0.10, SMB: -0.10, HML: +0.05, RMW: +0.20, CMA: +0.10, Mom: -0.15 },
  recession:   { 'Mkt-RF': -0.15, SMB: -0.10, HML: -0.05, RMW: +0.20, CMA: +0.05, Mom: -0.10 },
}

async function fetchFRED(series: string, limit = 60): Promise<{ date: string; value: number }[]> {
  const res  = await fetch(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`,
    { next: { revalidate: 3600 } }
  )
  const text = await res.text()
  return text.trim().split('\n').slice(1)
    .map((line) => { const [d, v] = line.split(','); return { date: d.trim(), value: parseFloat(v) } })
    .filter((r) => !isNaN(r.value))
    .slice(-limit)
}

async function fetchFMP(path: string): Promise<any[]> {
  const key = process.env.FMP_API_KEY ?? ''
  try {
    const res  = await fetch(`${FMP_URL}${path}&apikey=${key}`, { next: { revalidate: 3600 } })
    if (!res.ok) return []
    return res.json()
  } catch { return [] }
}

function rollingMean(arr: number[], n: number): number {
  const slice = arr.slice(-n)
  return slice.reduce((a, b) => a + b, 0) / slice.length
}

function classifyRegime(
  cli:       { date: string; value: number }[],
  cpiValues: number[],
): { regime: string; growthRising: boolean; inflationRising: boolean } {
  // Growth: OECD CLI direction over last 3 months
  const cliRecent = cli.slice(-4).map((r) => r.value)
  const growthRising = cliRecent.length >= 4
    ? cliRecent[cliRecent.length - 1] > cliRecent[0]
    : true

  // Inflation: 3-month CPI avg vs 36-month CPI avg
  const cpi3m  = rollingMean(cpiValues, 3)
  const cpi36m = rollingMean(cpiValues, 36)
  const inflationRising = cpi3m > cpi36m

  let regime = 'goldilocks'
  if ( growthRising && !inflationRising) regime = 'goldilocks'
  if ( growthRising &&  inflationRising) regime = 'heating_up'
  if (!growthRising &&  inflationRising) regime = 'stagflation'
  if (!growthRising && !inflationRising) regime = 'recession'

  return { regime, growthRising, inflationRising }
}

export async function GET() {
  const [cli, hyRaw, cpiRaw, treasuryRaw] = await Promise.all([
    fetchFRED('USALOLITOAASTSAM', 60),
    fetchFRED('BAMLH0A0HYM2', 60),
    fetchFMP('/economic-indicators?name=CPI'),
    fetchFMP('/treasury-rates'),
  ])

  // CPI — monthly, normalise to array
  const cpiSeries = (cpiRaw as any[])
    .sort((a, b) => a.date < b.date ? -1 : 1)
    .slice(-48)
  const cpiValues = cpiSeries.map((r) => parseFloat(r.value))

  // CPI rolling averages for chart
  const cpiChart = cpiSeries.map((r, i, arr) => ({
    date:   r.date,
    value:  parseFloat(r.value),
    avg3m:  i >= 2  ? rollingMean(arr.slice(0, i + 1).map((x) => parseFloat(x.value)), 3)  : null,
    avg36m: i >= 35 ? rollingMean(arr.slice(0, i + 1).map((x) => parseFloat(x.value)), 36) : null,
  }))

  // Yield curve: 10yr - 2yr spread
  const yieldCurve = (treasuryRaw as any[])
    .sort((a, b) => a.date < b.date ? -1 : 1)
    .slice(-60)
    .map((r) => ({
      date:   r.date,
      spread: r.year10 && r.year2 ? round2(r.year10 - r.year2) : null,
      y10:    r.year10 ?? null,
      y2:     r.year2  ?? null,
    }))

  // HY spread
  const hySpread = hyRaw.slice(-60)

  const { regime, growthRising, inflationRising } = classifyRegime(cli, cpiValues)

  return NextResponse.json({
    regime,
    growthRising,
    inflationRising,
    tilts:     REGIME_TILTS[regime],
    updatedAt: new Date().toISOString(),
    charts: {
      cli:        cli.slice(-48),
      cpi:        cpiChart.slice(-48),
      yieldCurve: yieldCurve,
      hySpread:   hySpread,
    },
  })
}

function round2(n: number) { return Math.round(n * 100) / 100 }
