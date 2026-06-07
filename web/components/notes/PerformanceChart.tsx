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

export default function PerformanceChart({ data, etfTicker, portfolioName }: Props) {
  if (!data.length) return null

  const allVals = data.flatMap((d) => [d.portfolio, d.sp500, d.etf].filter(Boolean)) as number[]
  const minVal  = Math.min(...allVals, 95)
  const maxVal  = Math.max(...allVals, 105)
  const pad     = (maxVal - minVal) * 0.05

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="font-space-mono text-xs uppercase tracking-widest">
          Cumulative Performance — Indexed to 100
        </h3>
        <span className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest">
          Inception: Jun 8, 2026
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
    </div>
  )
}
