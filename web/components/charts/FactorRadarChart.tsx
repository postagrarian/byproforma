'use client'
import {
  ResponsiveContainer, RadarChart, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Radar, Legend, Tooltip,
} from 'recharts'
import { FactorLoading } from '@/types'

interface Props {
  rows:       FactorLoading[]
  etfTicker:  string
}

// Short display names for radar axes
const LABELS: Record<string, string> = {
  'Mkt-RF': 'Market',
  'SMB':    'Size',
  'HML':    'Value',
  'RMW':    'Profit',
  'CMA':    'Invest',
  'Mom':    'Momentum',
}

export default function FactorRadarChart({ rows, etfTicker }: Props) {
  if (!rows.length) return null

  // Recharts radar needs all positive values — offset so min value = 0
  const allVals  = rows.flatMap((r) => [r.etfBeta, r.portfolioBeta])
  const minVal   = Math.min(...allVals)
  const offset   = minVal < 0 ? Math.abs(minVal) + 0.1 : 0
  const maxVal   = Math.max(...allVals) + offset + 0.1

  const data = rows.map((r) => ({
    factor:    LABELS[r.factor] ?? r.factor,
    raw_etf:   r.etfBeta,
    raw_port:  r.portfolioBeta,
    etf:       +(r.etfBeta + offset).toFixed(4),
    portfolio: +(r.portfolioBeta + offset).toFixed(4),
  }))

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const label = payload[0]?.payload?.factor
    const etf   = payload.find((p: any) => p.dataKey === 'etf')
    const port  = payload.find((p: any) => p.dataKey === 'portfolio')
    return (
      <div className="bg-white border border-black px-2 py-1 font-plex-mono text-xs uppercase tracking-widest space-y-0.5">
        <div className="font-bold">{label}</div>
        {etf   && <div>{etfTicker}: {(etf.value   - offset).toFixed(4)}</div>}
        {port  && <div>Portfolio: {(port.value - offset).toFixed(4)}</div>}
      </div>
    )
  }

  return (
    <div>
      <h2 className="font-space-mono text-xs uppercase tracking-widest mb-3">
        Factor Loadings — {etfTicker} vs Portfolio
      </h2>
      <ResponsiveContainer width="100%" height={300}>
        <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
          <PolarGrid stroke="#ddd" />
          <PolarAngleAxis
            dataKey="factor"
            tick={{ fontFamily: 'var(--font-plex-mono)', fontSize: 10 }}
          />
          <PolarRadiusAxis
            domain={[0, maxVal]}
            tick={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Radar
            name={etfTicker}
            dataKey="etf"
            stroke="#000"
            fill="#000"
            fillOpacity={0.08}
            strokeWidth={1.5}
          />
          <Radar
            name="Portfolio"
            dataKey="portfolio"
            stroke="#b91c1c"
            fill="#b91c1c"
            fillOpacity={0.08}
            strokeWidth={1.5}
          />
          <Legend
            wrapperStyle={{ fontFamily: 'var(--font-plex-mono)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
