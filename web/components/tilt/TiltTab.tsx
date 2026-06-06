'use client'
import { useState, useEffect } from 'react'
import { ETFConfig, ETFResult, FactorTarget, TiltResult } from '@/types'
import FactorSliders    from './FactorSliders'
import SectorTable      from '@/components/etf/SectorTable'
import FactorTable      from '@/components/etf/FactorTable'
import PortfolioTable   from '@/components/etf/PortfolioTable'
import SectorDriftChart from '@/components/charts/SectorDriftChart'
import FactorBarChart   from '@/components/charts/FactorBarChart'
const API_BASE_INNER = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const FACTOR_DEFS = [
  { factor: 'Mkt-RF', label: 'Market (Mkt-RF)', min: 0.3,  max: 1.8  },
  { factor: 'SMB',    label: 'Size (SMB)',       min: -0.3, max: 1.2  },
  { factor: 'HML',    label: 'Value (HML)',      min: -0.5, max: 0.9  },
  { factor: 'RMW',    label: 'Profitability (RMW)', min: -0.3, max: 1.0 },
  { factor: 'CMA',    label: 'Investment (CMA)', min: -0.6, max: 0.6  },
  { factor: 'Mom',    label: 'Momentum (Mom)',   min: -0.5, max: 0.5  },
]


interface Props {
  configs:  ETFConfig[]
  results:  Record<number, ETFResult | null>
}

function initTargets(result: ETFResult | null): FactorTarget[] {
  return FACTOR_DEFS.map((fd) => {
    const row     = result?.factorLoadings?.find((r) => r.factor === fd.factor)
    const existing = row?.etfBeta ?? 0
    return { ...fd, target: existing, existing }
  })
}

export default function TiltTab({ configs, results }: Props) {
  const configured = configs.filter((c) => c.isConfigured)

  const [foundationalSlot, setFoundationalSlot] = useState<number>(
    configured[0]?.slot ?? 1
  )
  const [mode, setMode] = useState<'factor_betas' | 'sector_exposure'>('factor_betas')
  const [targets, setTargets] = useState<FactorTarget[]>(() =>
    initTargets(results[configured[0]?.slot ?? 1] ?? null)
  )
  const [tiltResult, setTiltResult] = useState<TiltResult | null>(null)
  const [stage,    setStage]    = useState('')
  const [progress, setProgress] = useState(0)
  const [error,    setError]    = useState('')

  // When foundational slot changes, reset sliders to that ETF's betas
  useEffect(() => {
    const result = results[foundationalSlot] ?? null
    setTargets(initTargets(result))
  }, [foundationalSlot, results])

  function handleSliderChange(factor: string, value: number) {
    setTargets((prev) =>
      prev.map((t) => (t.factor === factor ? { ...t, target: value } : t))
    )
  }

  function handleReset() {
    const result = results[foundationalSlot] ?? null
    setTargets(initTargets(result))
  }

  async function handleOptimize() {
    setError('')
    setStage('Starting…')
    setProgress(0)
    setTiltResult(null)

    try {
      const resp = await fetch(`${API_BASE_INNER}/tilt/run`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          foundational_slot: foundationalSlot,
          factor_targets: Object.fromEntries(
            targets.map((t) => [t.factor, t.target])
          ),
          optimization_mode: mode,
        }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.detail || resp.statusText)
      }
    } catch (e: any) {
      setStage(`Error: ${e.message}`)
      return
    }

    // Poll status
    const poll = setInterval(async () => {
      try {
        const sr = await fetch(`${API_BASE_INNER}/status/tilt`)
        const s  = await sr.json()
        setStage(s.message || s.stage)
        setProgress(s.progress ?? 0)
        if (s.stage === 'done') {
          clearInterval(poll)
          setStage('Complete')
          setProgress(100)
          // Fetch result
          const res = await fetch(`${API_BASE_INNER}/tilt/latest`)
          if (res.ok) {
            const data = await res.json()
            setTiltResult(mapTiltResult(data))
          }
        } else if (s.stage === 'error') {
          clearInterval(poll)
          setStage(`Error: ${s.message}`)
        }
      } catch { /* transient */ }
    }, 4000)
  }

  const isRunning = stage && stage !== 'Complete' && !stage.startsWith('Error')
  const foundResult = results[foundationalSlot] ?? null

  return (
    <div className="p-6">
      {/* Header */}
      <div className="border-b border-[#7a0000] pb-4 mb-6">
        <div className="flex items-baseline gap-3 mb-1">
          <span className="font-space-mono text-2xl font-bold uppercase tracking-tight text-[#7a0000]">
            Active Tilt Portfolio
          </span>
          <span className="font-plex-mono text-xs text-gray-400 uppercase tracking-widest">
            Smart Beta Overlay
          </span>
        </div>
        <p className="font-plex-mono text-xs text-gray-500 max-w-2xl">
          Start from a replication portfolio's factor profile and apply tilts.
          The optimizer draws from securities across all replication portfolios (25–40 positions).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_2fr]">
        {/* Left: controls */}
        <div className="space-y-6">

          {/* Foundational selector */}
          <div>
            <h3 className="font-space-mono text-xs uppercase tracking-widest mb-3">
              Foundational Portfolio
            </h3>
            <div className="space-y-1">
              {configured.map((c) => (
                <button
                  key={c.slot}
                  onClick={() => setFoundationalSlot(c.slot)}
                  className={[
                    'w-full text-left px-3 py-2 font-plex-mono text-xs uppercase tracking-widest border',
                    foundationalSlot === c.slot
                      ? 'bg-black text-white border-black'
                      : 'bg-white text-black border-black hover:bg-gray-100',
                  ].join(' ')}
                >
                  {c.ticker}
                  {results[c.slot]?.etfOverview?.name && (
                    <span className="ml-2 normal-case tracking-normal text-gray-400">
                      {foundationalSlot === c.slot ? '✓ ' : ''}
                      {results[c.slot]!.etfOverview!.name}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Optimization mode */}
          <div>
            <h3 className="font-space-mono text-xs uppercase tracking-widest mb-3">
              Optimization Model
            </h3>
            <div className="space-y-2">
              {[
                { value: 'factor_betas',    label: 'Factor Betas',     note: 'Sector drift ≤ ±10%' },
                { value: 'sector_exposure', label: 'Sector Exposure',  note: 'Sector drift ≤ ±3%' },
              ].map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-start gap-3 cursor-pointer font-plex-mono text-xs"
                >
                  <input
                    type="radio"
                    name="mode"
                    value={opt.value}
                    checked={mode === opt.value}
                    onChange={() => setMode(opt.value as any)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="uppercase tracking-widest">{opt.label}</div>
                    <div className="text-gray-400 normal-case tracking-normal">{opt.note}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={handleOptimize}
              disabled={!!isRunning || configured.length === 0}
              className="border border-black px-4 py-1.5 font-plex-mono text-xs uppercase tracking-widest bg-black text-white hover:bg-gray-800 disabled:opacity-40"
            >
              {isRunning ? 'Running…' : 'Optimize'}
            </button>
            <button
              onClick={handleReset}
              disabled={!!isRunning}
              className="border border-black px-4 py-1.5 font-plex-mono text-xs uppercase tracking-widest hover:bg-gray-100 disabled:opacity-40"
            >
              Reset
            </button>
          </div>

          {/* Progress */}
          {stage && (
            <div>
              <div className="flex justify-between font-plex-mono text-xs uppercase tracking-widest mb-1">
                <span>{stage}</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full border border-black h-1.5">
                <div
                  className="h-full bg-[#7a0000] transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
          {error && (
            <p className="font-plex-mono text-xs text-red-700 uppercase tracking-widest">{error}</p>
          )}
        </div>

        {/* Right: factor sliders */}
        <div>
          <h3 className="font-space-mono text-xs uppercase tracking-widest mb-4">
            Factor Exposure Adjustments
            {foundResult && (
              <span className="ml-2 font-normal text-gray-400 normal-case tracking-normal">
                baseline: {configs.find((c) => c.slot === foundationalSlot)?.ticker}
              </span>
            )}
          </h3>
          {configured.length === 0 ? (
            <p className="font-plex-mono text-xs text-gray-500 uppercase tracking-widest">
              No replication portfolios configured yet.
            </p>
          ) : (
            <FactorSliders
              targets={targets}
              onChange={handleSliderChange}
              onReset={handleReset}
            />
          )}
        </div>
      </div>

      {/* Results */}
      {tiltResult && (
        <div className="mt-10 space-y-8">
          <div className="border-t border-[#7a0000] pt-6">
            <h3 className="font-space-mono text-xs uppercase tracking-widest text-[#7a0000] mb-6">
              Tilt Portfolio Results — {tiltResult.portfolio.length} Positions
            </h3>
          </div>
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <SectorTable
              rows={tiltResult.sectorWeights}
              etfTicker={configs.find((c) => c.slot === tiltResult.foundationalSlot)?.ticker ?? ''}
            />
            <FactorTable
              rows={tiltResult.factorLoadings}
              etfTicker={configs.find((c) => c.slot === tiltResult.foundationalSlot)?.ticker ?? ''}
              rmse={tiltResult.factorRmse}
              etfR2={tiltResult.etfR2}
              portfolioR2={tiltResult.portfolioR2}
            />
          </div>
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <SectorDriftChart rows={tiltResult.sectorWeights} />
            <FactorBarChart
              rows={tiltResult.factorLoadings}
              etfTicker={configs.find((c) => c.slot === tiltResult.foundationalSlot)?.ticker ?? ''}
            />
          </div>
          <PortfolioTable holdings={tiltResult.portfolio} />
        </div>
      )}
    </div>
  )
}

function mapTiltResult(row: any): TiltResult {
  return {
    runDate:            row.run_date,
    foundationalSlot:   row.foundational_slot,
    foundationalTicker: row.foundational_ticker,
    optimizationMode:   row.optimization_mode,
    sectorWeights:      row.sector_weights  ?? [],
    factorLoadings:     row.factor_loadings ?? [],
    portfolio:          row.portfolio       ?? [],
    factorRmse:         row.factor_rmse     ?? 0,
    maxSectorDiff:      row.max_sector_diff ?? 0,
    etfR2:              row.etf_r2          ?? null,
    portfolioR2:        row.portfolio_r2    ?? null,
  }
}
