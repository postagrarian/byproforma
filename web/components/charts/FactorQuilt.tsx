'use client'
import {
  BarChart, Bar, XAxis, YAxis, ReferenceLine,
  ResponsiveContainer, Cell, Tooltip,
} from 'recharts'

export interface FactorPanel {
  key:        string
  label:      string
  desc:       string
  data:       { date: string; value: number }[]
  latest:     number | null
}

interface Props { panels: FactorPanel[] }

function fmt(v: number) {
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const v = payload[0].value as number
  return (
    <div className="bg-[#F7F6F2] border border-black px-2 py-1 font-plex-mono text-[10px] uppercase tracking-widest">
      <div className="text-gray-400">{label}</div>
      <div className={v >= 0 ? 'text-black font-bold' : 'text-red-700 font-bold'}>{fmt(v)}</div>
    </div>
  )
}

function Panel({ panel }: { panel: FactorPanel }) {
  const { label, desc, data, latest } = panel

  // y-axis domain — symmetric around 0
  const absMax = Math.max(...data.map((d) => Math.abs(d.value)), 0.05)
  const domain: [number, number] = [-(absMax + 0.02), absMax + 0.02]

  return (
    <div className="border border-gray-200 p-0">
      {/* Panel header */}
      <div className="flex items-baseline justify-between px-3 pt-3 pb-2 border-b border-gray-100 bg-white">
        <div>
          <span className="font-space-mono text-sm font-normal uppercase tracking-tight">{label}</span>
          <span className="font-plex-mono text-[10px] text-gray-400 ml-2 uppercase tracking-widest">{desc}</span>
        </div>
        {latest != null && (
          <span className={`font-plex-mono text-xs font-bold tabular-nums ${latest >= 0 ? 'text-black' : 'text-red-700'}`}>
            {fmt(latest)}
          </span>
        )}
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 8, right: 48, bottom: 4, left: 0 }} barCategoryGap="2%">
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
            domain={domain}
            tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
            tick={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, fill: '#9ca3af' }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
          <ReferenceLine y={0} stroke="#000" strokeWidth={0.75} />
          <Bar dataKey="value" maxBarSize={16} radius={0}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.value >= 0 ? '#1a1a1a' : '#b91c1c'} opacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function FactorQuilt({ panels }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {panels.map((p) => <Panel key={p.key} panel={p} />)}
    </div>
  )
}
