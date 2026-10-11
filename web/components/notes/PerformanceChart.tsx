'use client'
import {
  LineChart, Line, XAxis, YAxis, ReferenceLine,
  ResponsiveContainer, Tooltip, Legend,
} from 'recharts'

interface DataPoint {
  date:       string
  portfolio:  number | null
  sp500:      number | null
  etf:        number | null
}

interface Props {
  data:       DataPoint[]
  etfTicker:  string
  portfolioName: string
}

function dateTick(d: string) {
  const dt = new Date(d + 'T00:00:00')
  return dt.getDate() === 1 ? dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : ''
}

const Tip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const dt = new Date(label + 'T00:00:00').toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric' })
  return (
    <div className="bg-[#F7F6F2] border border-black px-3 py-2 font-plex-mono text-xs uppercase tracking-widest space-y-1">
      <div className="text-gray-400 font-bold">{dt}</div>
      {payload.map((p: any) => p.value != null && (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.value.toFixed(2)}
        </div>
      ))}
    </div>
  )
}

// ── Stats computation ──────────────────────────────────────────────────────────

interface SeriesStats {
  totalReturn: number   // since inception, %
  vol:         number    // annualised daily-return std, %
  sharpe:      number    // annualised mean / std (rf = 0)
}

function computeSeriesStats(data: DataPoint[], key: 'portfolio' | 'sp500' | 'etf'): SeriesStats | null {
  const vals = data
    .map(d => d[key])
    .filter((v): v is number => v != null)

  if (vals.length < 2) return null

  // Daily returns from cumulative index
  const returns: number[] = []
  for (let i = 1; i < vals.length; i++) {
    if (vals[i - 1] !== 0) {
      returns.push(vals[i] / vals[i - 1] - 1)
    }
  }
  if (returns.length < 2) return null

  const totalReturn = (vals[vals.length - 1] / vals[0] - 1) * 100

  const n      = returns.length
  const mean    = returns.reduce((a, b) => a + b, 0) / n
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)
  const std      = Math.sqrt(variance)
  const vol      = std * Math.sqrt(252) * 100
  const sharpe   = std > 0 ? (mean / std) * Math.sqrt(252) : 0

  return { totalReturn, vol, sharpe }
}

function fmtPct(n: number) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function fmtNum(n: number, decimals = 2) {
  return n.toFixed(decimals)
}

// ── Stats Table ────────────────────────────────────────────────────────────────

function StatsTable({ data, portfolioName, etfTicker }: Props) {
  const portStats = computeSeriesStats(data, 'portfolio')
  const spStats   = computeSeriesStats(data, 'sp500')
  const etfStats  = computeSeriesStats(data, 'etf')

  if (!portStats && !spStats && !etfStats) return null

  const rows = [
    { label: portfolioName,       stats: portStats, color: '#1a1a1a' },
    { label: 'S&P 500 (VOO)',      stats: spStats,   color: '#b91c1c' },
    { label: etfTicker || 'ETF',   stats: etfStats,  color: '#9ca3af' },
  ].filter(r => r.stats)

  const grid = 'grid grid-cols-[minmax(0,1fr)_5rem_5rem_5rem]'

  return (
    <div className="border-t border-gray-100 pt-4 mt-4">
      <p className="font-plex-mono text-[10px] font-bold uppercase tracking-widest mb-3">
        Since Inception — Risk &amp; Return
      </p>
      <div className={grid}>
        {['', 'Total Return', 'Vol', 'Sharpe'].map((h, i) => (
          <p key={h || 'blank'} className={`font-plex-mono text-[9px] font-bold uppercase tracking-widest pb-1 ${i > 0 ? 'text-right' : ''}`}>
            {h}
          </p>
        ))}
      </div>
      <div className="border-b border-gray-100" />
      {rows.map(({ label, stats, color }) => (
        <div key={label} className={`${grid} py-1.5 border-b border-gray-50 items-baseline`}>
          <div className="flex items-baseline gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
            <span className="font-plex-mono text-[10px] truncate">{label}</span>
          </div>
          <span className={`font-plex-mono text-[10px] tabular-nums text-right ${stats!.totalReturn >= 0 ? 'text-black' : 'text-red-700'}`}>
            {fmtPct(stats!.totalReturn)}
          </span>
          <span className="font-plex-mono text-[10px] tabular-nums text-right text-gray-700">
            {fmtNum(stats!.vol)}
          </span>
          <span className={`font-plex-mono text-[10px] tabular-nums text-right ${stats!.sharpe >= 0 ? 'text-black' : 'text-red-700'}`}>
            {fmtNum(stats!.sharpe)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Chart ──────────────────────────────────────────────────────────────────────

export default function PerformanceChart({ data, etfTicker, portfolioName }: Props) {
  if (!data.length) return null

  const allVals = data.flatMap((d) => [d.portfolio, d.sp500, d.etf].filter(Boolean)) as number[]
  const minVal  = Math.min(...allVals, 95)
  const maxVal  = Math.max(...allVals, 105)
  const pad     = (maxVal - minVal) * 0.05

  // Dynamic inception date from first data point
  const inceptionDate = new Date(data[0].date + 'T00:00:00').toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="font-space-mono text-xs uppercase tracking-widest">
          Cumulative Performance — Indexed to 100
        </h3>
        <span className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest">
          Inception: {inceptionDate}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 48, bottom: 4, left: 0 }}>
          <XAxis
            dataKey="date"
            tick={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, fill: '#9ca3af' }}
            axisLine={false} tickLine={false}
            tickFormatter={dateTick} interval="preserveStartEnd"
          />
          <YAxis
            orientation="right"
            domain={[minVal - pad, maxVal + pad]}
            tickFormatter={(v) => v.toFixed(1)}
            tick={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, fill: '#9ca3af' }}
            axisLine={false} tickLine={false} width={40}
          />
          <Tooltip content={<Tip />} cursor={{ stroke: '#e5e7eb' }} />
          <ReferenceLine y={100} stroke="#9ca3af" strokeDasharray="3 3" strokeWidth={0.75} />
          <Legend
            wrapperStyle={{ fontFamily: 'var(--font-plex-mono)', fontSize: 10,
                            textTransform: 'uppercase', letterSpacing: '0.08em' }}
          />
          <Line dataKey="portfolio" name={portfolioName} stroke="#1a1a1a"
                strokeWidth={1.5} dot={false} connectNulls />
          <Line dataKey="sp500" name="S&P 500 (VOO)" stroke="#b91c1c"
                strokeWidth={1} dot={false} strokeDasharray="4 2" connectNulls />
          <Line dataKey="etf" name={etfTicker} stroke="#9ca3af"
                strokeWidth={1} dot={false} strokeDasharray="2 3" connectNulls />
        </LineChart>
      </ResponsiveContainer>
      <StatsTable data={data} etfTicker={etfTicker} portfolioName={portfolioName} />
    </div>
  )
}
