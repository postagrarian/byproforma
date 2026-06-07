import LandingLayout  from '@/components/layout/LandingLayout'
import FactorQuilt,
  { type FactorPanel } from '@/components/charts/FactorQuilt'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const FACTORS = [
  { key: 'mkt_rf', label: 'Mkt-RF', desc: 'Market'       },
  { key: 'smb',    label: 'SMB',    desc: 'Size'          },
  { key: 'hml',    label: 'HML',    desc: 'Value'         },
  { key: 'rmw',    label: 'RMW',    desc: 'Profitability' },
  { key: 'cma',    label: 'CMA',    desc: 'Investment'    },
  { key: 'mom',    label: 'Mom',    desc: 'Momentum'      },
]

async function fetchFactors(): Promise<any[]> {
  try {
    // Fetch enough months to compute rolling 12-month returns
    const res = await fetch(`${API_BASE}/public/factors?months=72`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

function rollingReturns(
  rows: any[],
  key: string,
  window: number = 12,
): { date: string; value: number }[] {
  if (rows.length < window) return []
  const result = []
  for (let i = window - 1; i < rows.length; i++) {
    const slice = rows.slice(i - window + 1, i + 1)
    // Compound returns: ∏(1 + r_t) − 1
    const compounded = slice.reduce((acc, r) => acc * (1 + (r[key] ?? 0)), 1) - 1
    result.push({ date: rows[i].date, value: compounded })
  }
  return result
}

export default async function FactorPerformancePage() {
  const rows = await fetchFactors()

  const panels: FactorPanel[] = FACTORS.map(({ key, label, desc }) => {
    const data   = rollingReturns(rows, key)
    const latest = data.length > 0 ? data[data.length - 1].value : null
    return { key, label, desc, data, latest }
  })

  const lastDate = rows.length > 0
    ? new Date(rows[rows.length - 1].date + 'T00:00:00')
        .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null

  return (
    <LandingLayout>
      <div className="mb-8">
        <h2 className="font-space-mono text-lg font-bold uppercase tracking-tight mb-1">
          Factor Performance
        </h2>
        <p className="font-plex-mono text-xs text-gray-500 uppercase tracking-widest">
          12-month rolling compounded returns · Fama-French Five Factors + Momentum
          {lastDate && <span className="ml-2 text-gray-400">· through {lastDate}</span>}
        </p>
      </div>

      {rows.length < 12 ? (
        <p className="font-plex-mono text-xs text-gray-400 uppercase tracking-widest border border-gray-200 p-6">
          No factor data cached yet — run a replication portfolio to populate the cache.
        </p>
      ) : (
        <FactorQuilt panels={panels} />
      )}

      <p className="font-plex-mono text-[10px] text-gray-300 uppercase tracking-widest mt-8">
        Source: Ken French Data Library · mba.tuck.dartmouth.edu · Bars = trailing 12-month compounded return
      </p>
    </LandingLayout>
  )
}
