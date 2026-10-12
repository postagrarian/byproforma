'use client'
import {
  LineChart, Line, XAxis, YAxis, ReferenceLine,
  ResponsiveContainer, Tooltip, Legend,
} from 'recharts'

export interface FactorSeries {
  key:   string
  label: string
  data:  { date: string; value: number }[]
}

interface Props { series: FactorSeries[] }

function fmt(v: number) {
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
}

const COLORS: Record<string, string> = {
  mkt_rf: '#1a1a1a',
  smb:    '#2563eb',
  hml:    '#16a34a',
  rmw:    '#9333ea',
  cma:    '#d97706',
  mom:    '#dc2626',
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-black px-3 py-2 font-plex-mono text-[10px] uppercase tracking-widest">
      <div className="text-gray-400 mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 inline-block" style={{ background: p.color }} />
          <span className="text-gray-500 w-12">{p.dataKey.toUpperCase().replace('_', '-')}</span>
          <span className={p.value >= 0 ? 'text-black font-bold' : 'text-red-700 font-bold'}>
            {fmt(p.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function FactorTimeSeries({ series }: Props) {
  if (!series.length || !series[0].data.length) return null

  // Merge all series into a single array keyed by date
  const dateSet = new Set<string>()
  for (const s of series) {
    for (const d of s.data) dateSet.add(d.date)
  }
  const dates = [...dateSet].sort()

  const merged = dates.map((date) => {
    const row: Record<string, number | string> = { date }
    for (const s of series) {
      const found = s.data.find((d) => d.date === date)
      if (found) row[s.key] = found.value
    }
    return row
  })

  return (
    <div className="border border-gray-300 p-0 mb-6">
      {/* Header */}
      <div className="flex items-baseline justify-between px-4 pt-3 pb-2 border-b border-gray-100">
        <div>
          <span className="font-space-mono text-sm font-bold uppercase tracking-tight">
            Factor Rolling Returns
          </span>
          <span className="font-plex-mono text-[10px] text-gray-400 ml-2 uppercase tracking-widest">
            12-month compounded
          </span>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={merged} margin={{ top: 12, right: 48, bottom: 8, left: 8 }}>
          <XAxis
            dataKey="date"
            tick={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            tickFormatter={(d) => {
              const dt = new Date(d + 'T00:00:00')
              return dt.getMonth() === 0 ? String(dt.getFullYear()) : ''
            }}
          />
          <YAxis
            orientation="right"
            tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
            tick={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#e0e0e0' }} />
          <ReferenceLine y={0} stroke="#000" strokeWidth={0.75} />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={COLORS[s.key] ?? '#1a1a1a'}
              strokeWidth={s.key === 'mkt_rf' ? 1.5 : 1}
              dot={false}
              connectNulls
              name={s.label}
            />
          ))}
          <Legend
            wrapperStyle={{
              fontFamily: 'var(--font-plex-mono)',
              fontSize: 10,
              paddingTop: 4,
            }}
            iconType="line"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
