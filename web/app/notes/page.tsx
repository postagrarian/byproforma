'use client'
import { useEffect, useState } from 'react'
import { useRouter }           from 'next/navigation'
import { isAuthenticated }     from '@/lib/auth'
import LandingLayout           from '@/components/layout/LandingLayout'
import PerformanceChart        from '@/components/notes/PerformanceChart'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface PerfRow {
  date:                string
  live_portfolio_name: string
  foundational_ticker: string
  portfolio_return:    number | null
  sp500_return:        number | null
  etf_return:          number | null
  top_gainers:         { ticker: string; name: string; return_pct: number }[]
  top_losers:          { ticker: string; name: string; return_pct: number }[]
  cumulative_return:   number | null
}

function pct(n: number | null) {
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`
}

function pctColor(n: number | null) {
  if (n == null) return 'text-gray-400'
  return n >= 0 ? 'text-black' : 'text-red-700'
}

function formatDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US',
    { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

export default function NotesPage() {
  const router = useRouter()
  const [rows,    setRows]    = useState<PerfRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAuthenticated()) { router.replace('/'); return }
    fetchPerformance()
  }, [])

  async function fetchPerformance() {
    try {
      // Read directly from Supabase via Railway
      const res = await fetch(`${API_BASE}/public/performance`)
      if (res.ok) setRows(await res.json())
    } catch { /* show empty state */ }
    finally { setLoading(false) }
  }

  // Build chart data — cumulative returns indexed to 100
  const chartData = [...rows].reverse().map((r) => ({
    date:      r.date,
    portfolio: r.cumulative_return ?? null,
    sp500:     r.cumulative_return != null && r.sp500_return != null
               ? null  // we'd need cumulative VOO separately; omit for now
               : null,
    etf:       null,
  }))

  const livePortfolioName = rows[0]?.live_portfolio_name ?? 'Live Portfolio'
  const etfTicker         = rows[0]?.foundational_ticker ?? ''

  return (
    <LandingLayout>
      <div className="mb-8">
        <h2 className="font-space-mono text-lg font-bold uppercase tracking-tight mb-1">
          Notes
        </h2>
        <p className="font-plex-mono text-xs text-gray-500 uppercase tracking-widest">
          Daily performance of the Live Portfolio
        </p>
      </div>

      {loading ? (
        <p className="font-plex-mono text-xs text-gray-400 uppercase tracking-widest">
          Loading performance data…
        </p>
      ) : rows.length === 0 ? (
        <div className="border border-gray-200 p-8 text-center">
          <p className="font-space-mono text-xs uppercase tracking-widest text-gray-400 mb-2">
            No performance data yet
          </p>
          <p className="font-plex-mono text-xs text-gray-400">
            Designate a Live Portfolio in the Replication Engine and performance
            will appear here after the first market close.
          </p>
        </div>
      ) : (
        <>
          {/* Cumulative performance chart */}
          <div className="border border-gray-200 p-5 mb-8">
            <PerformanceChart
              data={chartData}
              etfTicker={etfTicker}
              portfolioName={livePortfolioName}
            />
          </div>

          {/* Daily entry feed — newest first */}
          <div className="space-y-6">
            {rows.map((r) => (
              <article key={r.date} className="border border-gray-200 p-5">

                {/* Entry header */}
                <div className="flex items-baseline justify-between border-b border-gray-100 pb-3 mb-4">
                  <div>
                    <p className="font-space-mono text-xs font-bold uppercase tracking-tight">
                      {formatDate(r.date)}
                    </p>
                    <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest mt-0.5">
                      {r.live_portfolio_name}
                    </p>
                  </div>
                  {r.cumulative_return != null && (
                    <div className="text-right">
                      <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest">
                        Cumulative
                      </p>
                      <p className={`font-space-mono text-sm font-bold ${r.cumulative_return >= 100 ? 'text-black' : 'text-red-700'}`}>
                        {r.cumulative_return.toFixed(2)}
                      </p>
                    </div>
                  )}
                </div>

                {/* Daily returns row */}
                <div className="flex gap-8 mb-4">
                  {[
                    { label: 'Live Portfolio',  value: r.portfolio_return },
                    { label: 'S&P 500 (VOO)',   value: r.sp500_return     },
                    { label: r.foundational_ticker || 'ETF', value: r.etf_return },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest mb-0.5">
                        {label}
                      </p>
                      <p className={`font-space-mono text-base font-bold ${pctColor(value)}`}>
                        {pct(value)}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Gainers / Losers */}
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'Top Gainers', items: r.top_gainers, positive: true  },
                    { label: 'Top Losers',  items: r.top_losers,  positive: false },
                  ].map(({ label, items, positive }) => (
                    <div key={label}>
                      <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest mb-2">
                        {label}
                      </p>
                      <div className="space-y-1">
                        {(items || []).map((h) => (
                          <div key={h.ticker} className="flex items-baseline justify-between">
                            <div className="flex items-baseline gap-2">
                              <span className="font-plex-mono text-xs font-bold">{h.ticker}</span>
                              <span className="font-plex-mono text-[10px] text-gray-400 truncate max-w-[100px]">
                                {h.name}
                              </span>
                            </div>
                            <span className={`font-plex-mono text-xs font-bold tabular-nums ${positive ? 'text-black' : 'text-red-700'}`}>
                              {h.return_pct >= 0 ? '+' : ''}{h.return_pct.toFixed(2)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

              </article>
            ))}
          </div>
        </>
      )}
    </LandingLayout>
  )
}
