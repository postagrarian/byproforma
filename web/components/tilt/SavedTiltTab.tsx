'use client'
import { useState } from 'react'
import { SavedTilt, ETFConfig } from '@/types'
import SectorTable      from '@/components/etf/SectorTable'
import FactorTable      from '@/components/etf/FactorTable'
import PortfolioTable   from '@/components/etf/PortfolioTable'
import SectorDriftChart from '@/components/charts/SectorDriftChart'
import FactorBarChart   from '@/components/charts/FactorBarChart'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

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
  tilt:     SavedTilt
  configs:  ETFConfig[]
  onDelete: (id: number) => void
}

function fmt$(n: number | null) {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
}

function exportCSV(positions: Position[], name: string, portfolioValue: number) {
  const headers = ['Ticker','Company','Sector','Weight (%)','Target Value','Last Price','Shares','Market Value']
  const rows = positions.map((p) => [
    p.ticker,
    `"${p.name.replace(/"/g, '""')}"`,
    p.sector,
    (p.weight * 100).toFixed(2),
    p.dollar_value.toFixed(2),
    p.last_price?.toFixed(2) ?? '',
    p.shares ?? '',
    p.market_value?.toFixed(2) ?? '',
  ])
  const csv = [headers, ...rows].map((r) => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `${name.replace(/\s+/g, '_')}_positions.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function SavedTiltTab({ tilt, configs, onDelete }: Props) {
  const foundTicker = configs.find((c) => c.slot === tilt.foundationalSlot)?.ticker
    ?? tilt.foundationalTicker

  const [portfolioInput, setPortfolioInput] = useState('')
  const [positions,      setPositions]      = useState<Position[] | null>(null)
  const [loadingPos,     setLoadingPos]     = useState(false)
  const [posError,       setPosError]       = useState('')

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
          <div className="font-plex-mono text-xs text-gray-500 space-x-4 uppercase tracking-widest">
            <span>Baseline: {foundTicker}</span>
            <span>Mode: {tilt.optimizationMode.replace('_', ' ')}</span>
            <span>Run: {new Date(tilt.runDate).toLocaleDateString()}</span>
            <span>{tilt.portfolio.length} positions</span>
          </div>
        </div>
        <button
          onClick={() => { if (confirm(`Delete "${tilt.name}"?`)) onDelete(tilt.id) }}
          className="font-plex-mono text-xs border border-black px-3 py-1 hover:bg-red-700 hover:text-white hover:border-red-700 uppercase tracking-widest text-gray-500 flex-shrink-0"
        >
          Delete
        </button>
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
                  <td className="text-right py-1 px-2 font-bold">
                    {fmt$(positions.reduce((s, p) => s + (p.market_value ?? 0), 0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
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
        <PortfolioTable holdings={tilt.portfolio} />
      </div>
    </div>
  )
}
