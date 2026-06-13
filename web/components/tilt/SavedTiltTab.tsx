'use client'
import { useState, useEffect } from 'react'
import { SavedTilt, ETFConfig } from '@/types'
import FactorCorrections  from './FactorCorrections'
import SectorTable        from '@/components/etf/SectorTable'
import FactorTable        from '@/components/etf/FactorTable'
import PortfolioTable     from '@/components/etf/PortfolioTable'
import SectorDriftChart   from '@/components/charts/SectorDriftChart'
import FactorBarChart     from '@/components/charts/FactorBarChart'
import ActiveTiltWizard   from '@/components/rebalance/ActiveTiltWizard'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

interface Stats {
  alpha:             number
  tracking_error:    number
  information_ratio: number
  n_months:          number
}

interface Position {
  ticker:        string
  name:          string
  sector:        string
  weight:        number
  dollar_value:  number
  last_price:    number | null
  shares:        number | null
  market_value:  number | null
}

interface Props {
  tilt:          SavedTilt
  configs:       ETFConfig[]
  onDelete:      (id: number) => void
  onRebalanced?: () => void
}

function fmt$(n: number | null) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

function exportCSV(positions: Position[], name: string, portfolioValue: number) {
  // Two sections in one file:
  //   Section 1 — Schwab order columns (used by schwab_trade.py and platform import)
  //   Section 2 — Portfolio analytics (weight, dollar value, sector)

  const orderHeaders = [
    'Symbol',        // Schwab field name
    'Action',        // BUY | SELL
    'Quantity',      // shares (rounded to nearest 10)
    'Order_Type',    // LIMIT
    'Limit_Price',   // last traded price
    'Duration',      // DAY | GTC
    'Asset_Type',    // EQUITY
    // ── analytics (kept for reference) ──
    'Company',
    'Sector',
    'Weight_Pct',
    'Target_Value',
    'Market_Value',
  ]

  const rows = positions.map((p) => [
    p.ticker,
    'BUY',
    p.shares ?? '',
    'LIMIT',
    p.last_price?.toFixed(2) ?? '',
    'DAY',
    'EQUITY',
    `"${(p.name ?? '').replace(/"/g, '""')}"`,
    p.sector,
    (p.weight * 100).toFixed(2),
    p.dollar_value.toFixed(2),
    p.market_value?.toFixed(2) ?? '',
  ])

  const csv = [orderHeaders, ...rows].map((r) => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${name.replace(/\s+/g, '_')}_schwab_orders.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function SavedTiltTab({ tilt, configs, onDelete, onRebalanced }: Props) {
  const foundTicker = configs.find((c) => c.slot === tilt.foundationalSlot)?.ticker
    ?? tilt.foundationalTicker

  const [showActiveTilt, setShowActiveTilt] = useState(false)
  const [isLive,         setIsLive]         = useState(tilt.isLive ?? false)
  const [settingLive,    setSettingLive]    = useState(false)
  const [stats,          setStats]          = useState<Stats | null>(null)
  const [statsError,     setStatsError]     = useState('')
  const [portfolioInput, setPortfolioInput] = useState('')
  const [positions,      setPositions]      = useState<Position[] | null>(null)
  const [loadingPos,     setLoadingPos]     = useState(false)
  const [posError,       setPosError]       = useState('')

  // Auto-load stats on mount
  useEffect(() => {
    fetch(`${API_BASE}/tilt/${tilt.id}/stats`)
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then(setStats)
      .catch(() => setStatsError('Could not compute statistics — insufficient price history'))
  }, [tilt.id])

  async function handleCalculate() {
    const val = parseFloat(portfolioInput.replace(/[^0-9.]/g, ''))
    if (!val || val <= 0) { setPosError('Enter a valid portfolio value'); return }
    setLoadingPos(true)
    setPosError('')
    try {
      const res  = await fetch(`${API_BASE}/tilt/${tilt.id}/positions?portfolio_value=${val}`)
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText)
      const data = await res.json()
      setPositions(data.positions)
    } catch (e: any) {
      setPosError(`Failed: ${e.message}`)
    } finally {
      setLoadingPos(false)
    }
  }

  return (
    <div className="p-6">

      {/* Header */}
      <div className="border-b border-[#7a0000] pb-4 mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-baseline gap-3 mb-1">
            <span className="font-space-mono text-2xl font-bold uppercase tracking-tight text-[#7a0000]">
              {tilt.name}
            </span>
            <span className="font-plex-mono text-xs text-gray-400 uppercase tracking-widest">
              Saved Tilt
            </span>
          </div>
          <div className="font-plex-mono text-xs text-gray-500 space-x-4 uppercase tracking-widest mb-3">
            <span>Baseline: {foundTicker}</span>
            <span>Mode: {tilt.optimizationMode.replace('_', ' ')}</span>
            <span>Run: {new Date(tilt.runDate).toLocaleDateString()}</span>
            <span>{tilt.portfolio.length} positions</span>
          </div>

          {/* Trailing statistics */}
          {stats && (
            <p className="font-plex-mono text-[9px] text-gray-400 uppercase tracking-widest mb-2">
              Trailing {stats.n_months}mo · Constructed from same-period data — reflects in-sample fit, not forward performance
            </p>
          )}
          {stats ? (
            <div className="flex gap-8 font-plex-mono text-xs">
              {[
                {
                  label: `Alpha vs ${foundTicker}`,
                  value: `${stats.alpha >= 0 ? '+' : ''}${(stats.alpha * 100).toFixed(2)}%`,
                  color: stats.alpha >= 0 ? 'text-green-700' : 'text-red-700',
                },
                {
                  label: 'Tracking Error',
                  value: `${(stats.tracking_error * 100).toFixed(2)}%`,
                  color: 'text-black',
                },
                {
                  label: 'Information Ratio',
                  value: stats.information_ratio.toFixed(3),
                  color: stats.information_ratio >= 0 ? 'text-green-700' : 'text-red-700',
                },
                {
                  label: 'Window',
                  value: `${stats.n_months}mo trailing`,
                  color: 'text-gray-500',
                },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div className="text-gray-400 uppercase tracking-widest text-[9px] mb-0.5">{label}</div>
                  <div className={`font-bold text-sm ${color}`}>{value}</div>
                </div>
              ))}
            </div>
          ) : statsError ? (
            <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest">{statsError}</p>
          ) : (
            <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest">Computing statistics…</p>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => setShowActiveTilt(true)}
            className="font-plex-mono text-xs border border-[#7a0000] text-[#7a0000] px-3 py-1 hover:bg-[#7a0000] hover:text-white uppercase tracking-widest"
          >
            Rebalance
          </button>
          <button
            onClick={async () => {
              setSettingLive(true)
              const endpoint = isLive ? 'unset-live' : 'set-live'
              const res = await fetch(`${API_BASE}/tilt/${tilt.id}/${endpoint}`, { method: 'PATCH' })
              if (res.ok) setIsLive(!isLive)
              setSettingLive(false)
            }}
            disabled={settingLive}
            className={[
              'font-plex-mono text-xs border px-3 py-1 uppercase tracking-widest disabled:opacity-40',
              isLive
                ? 'border-green-700 text-green-700 hover:bg-green-700 hover:text-white'
                : 'border-black text-gray-500 hover:bg-black hover:text-white',
            ].join(' ')}
          >
            {isLive ? '● Live' : 'Set Live'}
          </button>
          <button
            onClick={() => { if (confirm(`Delete "${tilt.name}"?`)) onDelete(tilt.id) }}
            className="font-plex-mono text-xs border border-black px-3 py-1 hover:bg-red-700 hover:text-white hover:border-red-700 uppercase tracking-widest text-gray-500"
          >
            Delete
          </button>
        </div>

        {showActiveTilt && (
          <ActiveTiltWizard
            tilt={{ ...tilt, isLive }}
            onClose={() => setShowActiveTilt(false)}
            onCommitted={() => {
              setShowActiveTilt(false)
              onRebalanced?.()
            }}
          />
        )}
      </div>

      {/* Portfolio sizing section */}
      <section className="border border-black p-5 mb-8">
        <h3 className="font-space-mono text-xs uppercase tracking-widest mb-4">
          Position Sizing
        </h3>
        <div className="flex items-center gap-3 mb-3">
          <label className="font-plex-mono text-xs uppercase tracking-widest text-gray-500 w-32">
            Portfolio Value
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-plex-mono text-xs text-gray-400">$</span>
            <input
              type="text"
              value={portfolioInput}
              onChange={(e) => { setPortfolioInput(e.target.value); setPosError('') }}
              onKeyDown={(e) => e.key === 'Enter' && handleCalculate()}
              placeholder="1,000,000"
              className="border border-black pl-6 pr-3 py-1.5 font-plex-mono text-sm w-40 bg-transparent focus:outline-none focus:ring-1 focus:ring-black"
            />
          </div>
          <button
            onClick={handleCalculate}
            disabled={loadingPos}
            className="border border-black px-4 py-1.5 font-plex-mono text-xs uppercase tracking-widest hover:bg-black hover:text-white disabled:opacity-40"
          >
            {loadingPos ? 'Loading…' : 'Calculate'}
          </button>
          {positions && (
            <button
              onClick={() => exportCSV(positions, tilt.name, parseFloat(portfolioInput.replace(/[^0-9.]/g, '')))}
              className="border border-black px-4 py-1.5 font-plex-mono text-xs uppercase tracking-widest hover:bg-black hover:text-white"
            >
              Export CSV
            </button>
          )}
        </div>
        {posError && (
          <p className="font-plex-mono text-xs text-red-700 uppercase tracking-widest">{posError}</p>
        )}

        {/* Positions table */}
        {positions && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full font-plex-mono text-xs border-collapse">
              <thead>
                <tr className="border-b border-black">
                  {['Ticker','Company','Sector','Weight','Target Value','Last Price','Shares','Market Value'].map((h) => (
                    <th key={h} className="text-right first:text-left py-1 px-2 font-normal uppercase tracking-widest text-[10px]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.ticker} className="border-b border-gray-100">
                    <td className="py-1 px-2 font-bold">{p.ticker}</td>
                    <td className="py-1 px-2 text-gray-500 max-w-[160px] truncate">{p.name}</td>
                    <td className="py-1 px-2 text-gray-500">{p.sector}</td>
                    <td className="text-right py-1 px-2">{(p.weight * 100).toFixed(1)}%</td>
                    <td className="text-right py-1 px-2">{fmt$(p.dollar_value)}</td>
                    <td className="text-right py-1 px-2">{p.last_price ? fmt$(p.last_price) : '—'}</td>
                    <td className="text-right py-1 px-2">{p.shares?.toLocaleString() ?? '—'}</td>
                    <td className="text-right py-1 px-2">{fmt$(p.market_value)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-black">
                  <td colSpan={3} className="py-1 px-2 font-bold uppercase tracking-widest text-[10px]">Total</td>
                  <td className="text-right py-1 px-2 font-bold">
                    {(positions.reduce((s, p) => s + p.weight, 0) * 100).toFixed(1)}%
                  </td>
                  <td className="text-right py-1 px-2 font-bold">
                    {fmt$(positions.reduce((s, p) => s + p.dollar_value, 0))}
                  </td>
                  <td />
                  <td className="text-right py-1 px-2 font-bold">
                    {positions.reduce((s, p) => s + (p.shares ?? 0), 0).toLocaleString()}
                  </td>
                  <td className={`text-right py-1 px-2 font-bold ${
                    positions.reduce((s, p) => s + (p.market_value ?? 0), 0) >
                    parseFloat(portfolioInput.replace(/[^0-9.]/g, ''))
                      ? 'text-[#7a0000]'
                      : ''
                  }`}>
                    {fmt$(positions.reduce((s, p) => s + (p.market_value ?? 0), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
            {(() => {
              const total  = positions?.reduce((s, p) => s + (p.market_value ?? 0), 0) ?? 0
              const stated = parseFloat(portfolioInput.replace(/[^0-9.]/g, '')) || 0
              const excess = total - stated
              return excess > 100 ? (
                <p className="font-plex-mono text-[10px] text-[#7a0000] uppercase tracking-widest mt-2">
                  Margin used: {fmt$(excess)} · {((excess / stated) * 100).toFixed(1)}% above stated value
                </p>
              ) : null
            })()}
          </div>
        )}
      </section>

      {/* Factor corrections */}
      <section className="border border-black p-5 mb-8">
        <h3 className="font-space-mono text-xs uppercase tracking-widest mb-1">
          Factor Correction Candidates
        </h3>
        <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest mb-4">
          Up to 5 securities long or short that push the factor profile back toward {foundTicker}
        </p>
        <FactorCorrections runId={tilt.id} foundTicker={foundTicker} />
      </section>

      {/* Factor analysis */}
      <div className="space-y-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <SectorTable rows={tilt.sectorWeights}  etfTicker={foundTicker} />
          <FactorTable
            rows={tilt.factorLoadings}
            etfTicker={foundTicker}
            rmse={tilt.factorRmse}
            etfR2={tilt.etfR2}
            portfolioR2={tilt.portfolioR2}
          />
        </div>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <SectorDriftChart rows={tilt.sectorWeights} />
          <FactorBarChart   rows={tilt.factorLoadings} etfTicker={foundTicker} />
        </div>
        <PortfolioTable holdings={tilt.portfolio} sortable />
      </div>
    </div>
  )
}
