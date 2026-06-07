export const dynamic = 'force-dynamic'

import LandingLayout        from '@/components/layout/LandingLayout'
import { CLIChart, CPIChart, YieldCurveChart, HYSpreadChart }
  from '@/components/regime/RegimeCharts'
import { buildRegimePayload } from '@/lib/regime'

const REGIME_META: Record<string, {
  label: string; growth: string; inflation: string; color: string; desc: string
}> = {
  goldilocks:  { label: 'Goldilocks',   growth: 'Rising',  inflation: 'Falling', color: '#1a1a1a', desc: 'Broad equity leadership. Momentum, Size, Growth outperform.' },
  heating_up:  { label: 'Heating Up',   growth: 'Rising',  inflation: 'Rising',  color: '#92400e', desc: 'Late-cycle expansion. Value, Dividend, Size hold the edge.' },
  stagflation: { label: 'Stagflation',  growth: 'Falling', inflation: 'Rising',  color: '#b91c1c', desc: 'Most challenging regime. Quality (RMW) and low-vol are the primary refuge.' },
  recession:   { label: 'Contraction',  growth: 'Falling', inflation: 'Falling', color: '#374151', desc: 'Risk-off. Quality and defensive factors outperform; avoid cyclicals and Momentum.' },
}

const FACTOR_GUIDANCE: Record<string, Record<string, string>> = {
  goldilocks:  { 'Mkt-RF': '↑', SMB: '↑', HML: '—', RMW: '—', CMA: '—', Mom: '↑↑' },
  heating_up:  { 'Mkt-RF': '↑', SMB: '↑', HML: '↑', RMW: '↑', CMA: '↑', Mom: '—'  },
  stagflation: { 'Mkt-RF': '↓', SMB: '↓', HML: '—', RMW: '↑↑', CMA: '↑', Mom: '↓' },
  recession:   { 'Mkt-RF': '↓', SMB: '↓', HML: '↓', RMW: '↑↑', CMA: '—', Mom: '↓' },
}

export default async function RegimeMonitorPage() {
  let data: any = null
  try { data = await buildRegimePayload() } catch { /* show error state */ }
  const regime = data?.regime ?? 'goldilocks'
  const meta   = REGIME_META[regime]

  return (
    <LandingLayout>
      {/* Page header */}
      <div className="mb-8">
        <h2 className="font-space-mono text-lg font-bold uppercase tracking-tight mb-1">
          Regime Monitor
        </h2>
        <p className="font-plex-mono text-xs text-gray-500 uppercase tracking-widest">
          Two-axis macroeconomic regime classification · OECD CLI × CPI signal
          {data?.updatedAt && (
            <span className="ml-2 text-gray-400">
              · {new Date(data.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          )}
        </p>
      </div>

      {/* Regime banner */}
      {data ? (
        <div className="border border-black p-6 mb-8" style={{ borderLeftWidth: 4, borderLeftColor: meta.color }}>
          <div className="flex items-start justify-between gap-8">
            <div>
              <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest mb-1">
                Current Regime
              </p>
              <p className="font-space-mono text-3xl font-bold uppercase tracking-tight mb-2"
                style={{ color: meta.color }}>
                {meta.label}
              </p>
              <p className="font-plex-mono text-xs text-gray-600 max-w-lg">{meta.desc}</p>
            </div>
            <div className="flex gap-8 flex-shrink-0">
              {[
                { label: 'Growth',    value: meta.growth,    up: data.growthRising    },
                { label: 'Inflation', value: meta.inflation, up: !data.inflationRising },
              ].map(({ label, value, up }) => (
                <div key={label} className="text-right">
                  <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest mb-1">{label}</p>
                  <p className="font-space-mono text-lg font-bold uppercase" style={{ color: meta.color }}>
                    {data.growthRising && label === 'Growth' ? '↑' : !data.growthRising && label === 'Growth' ? '↓' :
                     data.inflationRising && label === 'Inflation' ? '↑' : '↓'} {value}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Factor guidance */}
          <div className="mt-5 pt-4 border-t border-gray-100">
            <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest mb-3">
              Factor Guidance
            </p>
            <div className="flex gap-6 flex-wrap">
              {Object.entries(FACTOR_GUIDANCE[regime]).map(([f, sig]) => (
                <div key={f} className="text-center">
                  <div className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest">{f}</div>
                  <div className={`font-space-mono text-base font-bold ${
                    sig.includes('↑') ? 'text-black' : sig.includes('↓') ? 'text-red-700' : 'text-gray-300'
                  }`}>{sig || '—'}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="border border-gray-200 p-6 mb-8">
          <p className="font-plex-mono text-xs text-gray-400 uppercase tracking-widest">
            Unable to fetch regime data — check FRED and FMP connectivity.
          </p>
        </div>
      )}

      {/* Charts grid */}
      {data?.charts && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-8">
          <CLIChart        data={data.charts.cli} />
          <CPIChart        data={data.charts.cpi} />
          <YieldCurveChart data={data.charts.yieldCurve} />
          <HYSpreadChart   data={data.charts.hySpread} />
        </div>
      )}

      {/* Regime factor table */}
      <div className="mt-4">
        <h3 className="font-space-mono text-xs uppercase tracking-widest mb-4">
          Historical Factor Behavior by Regime
        </h3>
        <table className="w-full font-plex-mono text-xs border-collapse">
          <thead>
            <tr className="border-b border-black">
              <th className="text-left py-1 pr-4 font-normal uppercase tracking-widest text-[10px]">Regime</th>
              {['Mkt-RF','SMB','HML','RMW','CMA','Mom'].map((f) => (
                <th key={f} className="text-center py-1 px-2 font-normal uppercase tracking-widest text-[10px]">{f}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(REGIME_META).map(([key, m]) => (
              <tr key={key} className={`border-b border-gray-100 ${key === regime ? 'bg-white font-bold' : ''}`}>
                <td className="py-1.5 pr-4" style={{ color: m.color }}>{m.label}</td>
                {Object.values(FACTOR_GUIDANCE[key]).map((sig, i) => (
                  <td key={i} className={`text-center py-1.5 px-2 ${
                    sig.includes('↑') ? 'text-black' : sig.includes('↓') ? 'text-red-700' : 'text-gray-300'
                  }`}>{sig || '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="font-plex-mono text-[10px] text-gray-300 uppercase tracking-widest mt-4">
          Source: S&P Global — A Historical Perspective on Factor Index Performance Across Macroeconomic Cycles (2024)
          · Growth signal: OECD CLI direction · Inflation signal: CPI 3m avg vs 36m avg
        </p>
      </div>
    </LandingLayout>
  )
}
