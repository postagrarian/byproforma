'use client'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  ReferenceLine, Cell, Tooltip, LabelList,
} from 'recharts'
import { SectorWeight } from '@/types'

interface Props { rows: SectorWeight[] }

const TOL = 0.03   // ±3% tolerance band

export default function SectorDriftChart({ rows }: Props) {
  if (!rows.length) return null

  const data = [...rows]
    .sort((a, b) => b.diff - a.diff)
    .map((r) => ({
      sector: r.sector.replace('Consumer ', 'Cons. ').replace(' Services', ' Svcs'),
      diff:   Math.round(r.diff * 1000) / 10,  // decimal → % with 1dp
      inside: Math.abs(r.diff) <= TOL,
    }))

  const maxAbs = Math.max(...data.map((d) => Math.abs(d.diff)), TOL * 100 + 0.5)
  const domain: [number, number] = [-maxAbs - 0.5, maxAbs + 0.5]

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <div className="bg-white border border-black px-2 py-1 font-plex-mono text-xs uppercase tracking-widest">
        {d.sector}: {d.diff >= 0 ? '+' : ''}{d.diff.toFixed(1)}%
      </div>
    )
  }

  return (
    <div>
      <h2 className="font-space-mono text-xs uppercase tracking-widest mb-3">
        Sector Drift vs {'±'}3% Tolerance
      </h2>
      <ResponsiveContainer width="100%" height={data.length * 28 + 20}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 40, bottom: 0, left: 110 }}
          barSize={10}
        >
          <XAxis
            type="number"
            domain={domain}
            tickFormatter={(v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
            tick={{ fontFamily: 'var(--font-plex-mono)', fontSize: 10 }}
            axisLine={{ stroke: '#000' }}
            tickLine={{ stroke: '#000' }}
          />
          <YAxis
            type="category"
            dataKey="sector"
            width={105}
            tick={{ fontFamily: 'var(--font-plex-mono)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F7F6F2' }} />

          {/* tolerance band markers */}
          <ReferenceLine x={TOL * 100}  stroke="#ccc" strokeDasharray="3 3" />
          <ReferenceLine x={-TOL * 100} stroke="#ccc" strokeDasharray="3 3" />
          <ReferenceLine x={0} stroke="#000" strokeWidth={1} />

          <Bar dataKey="diff" radius={0}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={d.inside ? '#333' : (d.diff > 0 ? '#b91c1c' : '#b91c1c')}
                opacity={d.inside ? 0.75 : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
