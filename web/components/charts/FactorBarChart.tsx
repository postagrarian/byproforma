'use client'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  ReferenceLine, Tooltip, Legend, Cell,
} from 'recharts'
import { FactorLoading } from '@/types'

interface Props {
  rows:      FactorLoading[]
  etfTicker: string
}

export default function FactorBarChart({ rows, etfTicker }: Props) {
  if (!rows.length) return null

  const data = rows.map((r) => ({
    factor:    r.factor,
    etf:       +r.etfBeta.toFixed(4),
    portfolio: +r.portfolioBeta.toFixed(4),
  }))

  const allVals = data.flatMap((d) => [d.etf, d.portfolio])
  const absMax  = Math.max(...allVals.map(Math.abs)) + 0.15
  const domain: [number, number] = [-absMax, absMax]

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-white border border-black px-2 py-1 font-plex-mono text-xs uppercase tracking-widest space-y-0.5">
        <div className="font-bold">{label}</div>
        {payload.map((p: any) => (
          <div key={p.dataKey} style={{ color: p.fill }}>
            {p.name}: {p.value >= 0 ? '+' : ''}{p.value.toFixed(4)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div>
      <h2 className="font-space-mono text-xs uppercase tracking-widest mb-3">
        Factor Loadings — {etfTicker} vs Portfolio
      </h2>
      <ResponsiveContainer width="100%" height={data.length * 42 + 30}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 0, right: 20, bottom: 0, left: 70 }}
          barCategoryGap="30%"
          barGap={2}
        >
          <XAxis
            type="number"
            domain={domain}
            tickFormatter={(v) => v.toFixed(1)}
            tick={{ fontFamily: 'var(--font-plex-mono)', fontSize: 10 }}
            axisLine={{ stroke: '#000' }}
            tickLine={{ stroke: '#000' }}
          />
          <YAxis
            type="category"
            dataKey="factor"
            width={65}
            tick={{ fontFamily: 'var(--font-plex-mono)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F7F6F2' }} />
          <Legend
            wrapperStyle={{
              fontFamily: 'var(--font-plex-mono)',
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          />
          <ReferenceLine x={0} stroke="#000" strokeWidth={1} />
          <Bar dataKey="etf"       name={etfTicker}   fill="#333"    radius={0} barSize={8} />
          <Bar dataKey="portfolio" name="Portfolio"    fill="#b91c1c" radius={0} barSize={8} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
