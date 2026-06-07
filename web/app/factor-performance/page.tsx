import LandingLayout from '@/components/layout/LandingLayout'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const FACTORS = [
  { key: 'mkt_rf', label: 'Mkt-RF', desc: 'Market' },
  { key: 'smb',    label: 'SMB',    desc: 'Size'   },
  { key: 'hml',    label: 'HML',    desc: 'Value'  },
  { key: 'rmw',    label: 'RMW',    desc: 'Profit' },
  { key: 'cma',    label: 'CMA',    desc: 'Invest' },
  { key: 'mom',    label: 'Mom',    desc: 'Moment' },
  { key: 'rf',     label: 'RF',     desc: 'Risk-Free' },
]

async function fetchFactors() {
  try {
    const res = await fetch(`${API_BASE}/public/factors?months=14`, {
      next: { revalidate: 3600 },
    })
    if (!res.ok) return []
    return res.json()
  } catch {
    return []
  }
}

function pct(v: number | null) {
  if (v == null) return '—'
  const val = (v * 100).toFixed(2)
  return `${v >= 0 ? '+' : ''}${val}%`
}

function color(v: number | null) {
  if (v == null) return 'text-gray-400'
  return v >= 0 ? 'text-black' : 'text-red-700'
}

export default async function FactorPerformancePage() {
  const rows: any[] = await fetchFactors()

  return (
    <LandingLayout>
      <h2 className="font-space-mono text-lg font-bold uppercase tracking-tight mb-1">
        Recent Factor Performance
      </h2>
      <p className="font-plex-mono text-xs text-gray-500 mb-8 uppercase tracking-widest">
        Fama-French Five Factors + Momentum · Monthly returns · Source: Ken French Data Library
      </p>

      {rows.length === 0 ? (
        <p className="font-plex-mono text-xs text-gray-400 uppercase tracking-widest">
          No data available — run a replication portfolio first to populate the factor cache.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full font-plex-mono text-xs border-collapse">
            <thead>
              <tr className="border-b border-black">
                <th className="text-left py-1.5 pr-6 font-normal uppercase tracking-widest text-[10px]">Date</th>
                {FACTORS.map((f) => (
                  <th key={f.key} className="text-right py-1.5 px-3 font-normal uppercase tracking-widest text-[10px]">
                    <div>{f.label}</div>
                    <div className="text-gray-400 text-[9px]">{f.desc}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((row) => (
                <tr key={row.date} className="border-b border-gray-100 hover:bg-white transition-none">
                  <td className="py-1.5 pr-6 text-gray-500">
                    {new Date(row.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                  </td>
                  {FACTORS.map((f) => (
                    <td key={f.key} className={`text-right py-1.5 px-3 tabular-nums ${color(row[f.key])}`}>
                      {pct(row[f.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="font-plex-mono text-[10px] text-gray-300 uppercase tracking-widest mt-8">
        Values are monthly decimal returns converted to percent. Data sourced monthly from mba.tuck.dartmouth.edu.
      </p>
    </LandingLayout>
  )
}
