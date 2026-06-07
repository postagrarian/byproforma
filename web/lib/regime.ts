// Shared regime data fetching and classification logic.
// Used by both the server component (regime/page.tsx) and the API route (/api/regime).

const FMP_URL = 'https://financialmodelingprep.com/stable'

export const REGIME_TILTS: Record<string, Record<string, number>> = {
  goldilocks:  { 'Mkt-RF': +0.10, SMB: +0.10, HML: -0.05, RMW: -0.05, CMA: -0.05, Mom: +0.15 },
  heating_up:  { 'Mkt-RF': +0.05, SMB: +0.05, HML: +0.15, RMW: +0.05, CMA: +0.05, Mom:  0.00 },
  stagflation: { 'Mkt-RF': -0.10, SMB: -0.10, HML: +0.05, RMW: +0.20, CMA: +0.10, Mom: -0.15 },
  recession:   { 'Mkt-RF': -0.15, SMB: -0.10, HML: -0.05, RMW: +0.20, CMA: +0.05, Mom: -0.10 },
}

export async function fetchFRED(
  series: string,
  limit = 60,
): Promise<{ date: string; value: number }[]> {
  const res  = await fetch(
    `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series}`,
    { next: { revalidate: 3600 } },
  )
  const text = await res.text()
  return text.trim().split('\n').slice(1)
    .map((line) => {
      const [d, v] = line.split(',')
      return { date: d?.trim() ?? '', value: parseFloat(v ?? '') }
    })
    .filter((r) => r.date && !isNaN(r.value))
    .slice(-limit)
}

export async function fetchFMPEcon(name: string): Promise<any[]> {
  const key = process.env.FMP_API_KEY ?? ''
  try {
    const res = await fetch(
      `${FMP_URL}/economic-indicators?name=${name}&apikey=${key}`,
      { next: { revalidate: 3600 } },
    )
    if (!res.ok) return []
    return res.json()
  } catch { return [] }
}

export async function fetchFMPTreasury(): Promise<any[]> {
  const key = process.env.FMP_API_KEY ?? ''
  try {
    const res = await fetch(
      `${FMP_URL}/treasury-rates?apikey=${key}`,
      { next: { revalidate: 3600 } },
    )
    if (!res.ok) return []
    return res.json()
  } catch { return [] }
}

function rollingMean(arr: number[], n: number): number {
  const slice = arr.slice(-n)
  return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0
}

export function classifyRegime(
  cli:       { date: string; value: number }[],
  cpiValues: number[],
) {
  const cliRecent  = cli.slice(-4).map((r) => r.value)
  const growthRising = cliRecent.length >= 2
    ? cliRecent[cliRecent.length - 1] > cliRecent[0]
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
  const [cli, hyRaw, cpiRaw, treasuryRaw] = await Promise.all([
    fetchFRED('USALOLITOAASTSAM', 60),
    fetchFRED('BAMLH0A0HYM2',     60),
    fetchFMPEcon('CPI'),
    fetchFMPTreasury(),
  ])

  const cpiSeries = (cpiRaw as any[])
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-48)
  const cpiValues = cpiSeries.map((r) => parseFloat(r.value ?? '0'))

  const cpiChart = cpiSeries.map((r, i, arr) => ({
    date:   r.date as string,
    value:  parseFloat(r.value ?? '0'),
    avg3m:  i >= 2  ? rollingMean(arr.slice(0, i + 1).map((x) => parseFloat(x.value)), 3)  : null,
    avg36m: i >= 35 ? rollingMean(arr.slice(0, i + 1).map((x) => parseFloat(x.value)), 36) : null,
  }))

  const yieldCurve = (treasuryRaw as any[])
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-60)
    .map((r) => ({
      date:   r.date as string,
      spread: r.year10 && r.year2 ? Math.round((r.year10 - r.year2) * 100) / 100 : null,
    }))

  const { regime, growthRising, inflationRising } = classifyRegime(cli, cpiValues)

  return {
    regime,
    growthRising,
    inflationRising,
    tilts:     REGIME_TILTS[regime],
    updatedAt: new Date().toISOString(),
    charts: {
      cli:        cli.slice(-48),
      cpi:        cpiChart.slice(-48),
      yieldCurve,
      hySpread:   hyRaw.slice(-60),
    },
  }
}
