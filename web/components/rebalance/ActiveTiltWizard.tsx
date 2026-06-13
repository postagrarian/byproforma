'use client'
import { useState } from 'react'
import { SavedTilt } from '@/types'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const FACTOR_DEFS = [
  { factor: 'Mkt-RF', label: 'Market (Mkt-RF)', min: 0.3,  max: 1.8  },
  { factor: 'SMB',    label: 'Size (SMB)',       min: -0.3, max: 1.2  },
  { factor: 'HML',    label: 'Value (HML)',      min: -0.5, max: 0.9  },
  { factor: 'RMW',    label: 'Profitability (RMW)', min: -0.3, max: 1.0 },
  { factor: 'CMA',    label: 'Investment (CMA)', min: -0.6, max: 0.6  },
  { factor: 'Mom',    label: 'Momentum (Mom)',   min: -0.5, max: 0.5  },
]

interface Trade {
  ticker:          string
  name:            string
  sector:          string
  current_weight:  number
  proposed_weight: number
  delta:           number
  action:          'buy' | 'sell' | 'hold'
  is_supplement:   boolean
}

interface PreviewResult {
  run_id:               number
  alpha:                number
  target_factors:       Record<string, number>
  trades:               Trade[]
  new_portfolio:        any[]
  factor_before:        Record<string, number>
  factor_after:         Record<string, number>
  factor_target:        Record<string, number>
  turnover:             number
  foundational_slot:    number
  foundational_ticker:  string
  orig_sector_weights:  any[]
  orig_factor_loadings: any[]
}

interface Props {
  tilt:        SavedTilt
  onClose:     () => void
  onCommitted: () => void
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`
}

function fmtDelta(n: number) {
  const s = n >= 0 ? '+' : ''
  return `${s}${(n * 100).toFixed(1)}%`
}

export default function ActiveTiltWizard({ tilt, onClose, onCommitted }: Props) {
  const [targets, setTargets] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {}
    for (const fd of FACTOR_DEFS) {
      const row = tilt.factorLoadings.find((r) => r.factor === fd.factor)
      map[fd.factor] = row?.portfolioBeta ?? 0
    }
    return map
  })

  const [alpha,      setAlpha]      = useState(50)   // 0–100 slider; divide by 100 for API
  const [step,       setStep]       = useState<1 | 2>(1)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [preview,    setPreview]    = useState<PreviewResult | null>(null)
  const [name,       setName]       = useState(`${tilt.name} Rebalanced`)
  const [goLive,     setGoLive]     = useState(tilt.isLive)
  const [committing, setCommitting] = useState(false)
  const [commitMsg,  setCommitMsg]  = useState('')

  async function handlePreview() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/rebalance/preview`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          run_id:         tilt.id,
          target_factors: targets,
          alpha:          alpha / 100,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || res.statusText)
      }
      setPreview(await res.json())
      setStep(2)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleCommit() {
    if (!preview || !name.trim()) return
    setCommitting(true)
    setCommitMsg('')
    try {
      const res = await fetch(`${API_BASE}/rebalance/commit`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview, name: name.trim(), set_live: goLive }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || res.statusText)
      }
      onCommitted()
      onClose()
    } catch (e: any) {
      setCommitMsg(`Failed: ${e.message}`)
    } finally {
      setCommitting(false)
    }
  }

  const buyTotal  = preview?.trades.filter((t) => t.delta > 0).reduce((s, t) => s + t.delta, 0) ?? 0
  const sellTotal = Math.abs(preview?.trades.filter((t) => t.delta < 0).reduce((s, t) => s + t.delta, 0) ?? 0)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white w-full max-w-3xl max-h-[90vh] overflow-y-auto border border-black">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#7a0000] px-6 py-4 sticky top-0 bg-white z-10">
          <div>
            <span className="font-space-mono text-lg font-bold uppercase tracking-tight text-[#7a0000]">
              Rebalance
            </span>
            <span className="ml-3 font-plex-mono text-xs text-gray-400 uppercase tracking-widest">
              {step === 1 ? 'Set Targets' : 'Preview & Commit'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="font-plex-mono text-xs text-gray-400 hover:text-black uppercase tracking-widest"
          >
            Close
          </button>
        </div>

        <div className="px-6 py-6 space-y-8">

          {/* ── Step 1: Targets + Aggressiveness ─────────────────────────── */}
          {step === 1 && (
            <>
              <div>
                <h3 className="font-space-mono text-xs uppercase tracking-widest mb-4">
                  Factor Targets
                  <span className="ml-2 font-normal text-gray-400 normal-case tracking-normal">
                    baseline: {tilt.foundationalTicker}
                  </span>
                </h3>
                <div className="space-y-5">
                  {FACTOR_DEFS.map((fd) => {
                    const current = tilt.factorLoadings.find((r) => r.factor === fd.factor)?.portfolioBeta ?? 0
                    const val     = targets[fd.factor] ?? current
                    const changed = Math.abs(val - current) > 0.005
                    return (
                      <div key={fd.factor}>
                        <div className="flex justify-between font-plex-mono text-xs mb-1">
                          <span className="uppercase tracking-widest">{fd.label}</span>
                          <div className="flex gap-4 text-gray-500">
                            <span>Current: {current.toFixed(3)}</span>
                            <span className={changed ? 'text-[#7a0000] font-bold' : 'text-black font-bold'}>
                              Target: {val.toFixed(3)}
                            </span>
                          </div>
                        </div>
                        <input
                          type="range"
                          min={fd.min}
                          max={fd.max}
                          step={0.01}
                          value={val}
                          onChange={(e) =>
                            setTargets((prev) => ({ ...prev, [fd.factor]: parseFloat(e.target.value) }))
                          }
                          className="w-full accent-[#7a0000]"
                        />
                        <div className="flex justify-between font-plex-mono text-[10px] text-gray-400 mt-0.5">
                          <span>{fd.min}</span>
                          <span>{fd.max}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Aggressiveness dial */}
              <div className="border-t border-gray-100 pt-6">
                <h3 className="font-space-mono text-xs uppercase tracking-widest mb-1">
                  Aggressiveness
                </h3>
                <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest mb-4">
                  Conservative minimises turnover · Aggressive chases factor targets
                </p>
                <div className="flex items-center gap-4">
                  <span className="font-plex-mono text-[10px] text-gray-500 w-20 uppercase tracking-widest">
                    Conservative
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={alpha}
                    onChange={(e) => setAlpha(parseInt(e.target.value))}
                    className="flex-1 accent-[#7a0000]"
                  />
                  <span className="font-plex-mono text-[10px] text-gray-500 w-20 text-right uppercase tracking-widest">
                    Aggressive
                  </span>
                </div>
                <div className="text-center font-plex-mono text-sm font-bold mt-2">{alpha}%</div>
              </div>

              {error && (
                <p className="font-plex-mono text-xs text-red-700 uppercase tracking-widest">{error}</p>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handlePreview}
                  disabled={loading}
                  className="border border-black px-5 py-2 font-plex-mono text-xs uppercase tracking-widest bg-black text-white hover:bg-gray-800 disabled:opacity-40"
                >
                  {loading ? 'Computing…' : 'Preview Trades'}
                </button>
                <button
                  onClick={onClose}
                  className="border border-black px-5 py-2 font-plex-mono text-xs uppercase tracking-widest hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </>
          )}

          {/* ── Step 2: Preview + Commit ──────────────────────────────────── */}
          {step === 2 && preview && (
            <>
              {/* Factor comparison */}
              <div>
                <h3 className="font-space-mono text-xs uppercase tracking-widest mb-3">
                  Factor Exposure
                </h3>
                <table className="w-full font-plex-mono text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-black">
                      {['Factor', 'Current', 'Target', 'After', 'Remaining Gap'].map((h) => (
                        <th
                          key={h}
                          className="text-right first:text-left py-1 px-2 font-normal uppercase tracking-widest text-[10px]"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {FACTOR_DEFS.map(({ factor, label }) => {
                      const before = preview.factor_before[factor] ?? 0
                      const after  = preview.factor_after[factor]  ?? 0
                      const tgt    = preview.factor_target[factor] ?? 0
                      const gap    = after - tgt
                      return (
                        <tr key={factor} className="border-b border-gray-100">
                          <td className="py-1 px-2 uppercase tracking-widest text-[10px]">{label}</td>
                          <td className="text-right py-1 px-2 text-gray-500">{before.toFixed(3)}</td>
                          <td className="text-right py-1 px-2 text-[#7a0000]">{tgt.toFixed(3)}</td>
                          <td className="text-right py-1 px-2 font-bold">{after.toFixed(3)}</td>
                          <td className={`text-right py-1 px-2 ${Math.abs(gap) < 0.02 ? 'text-green-700' : 'text-gray-600'}`}>
                            {gap >= 0 ? '+' : ''}{gap.toFixed(3)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Trade list */}
              <div>
                <h3 className="font-space-mono text-xs uppercase tracking-widest mb-1">
                  Proposed Trades
                </h3>
                <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest mb-3">
                  {preview.trades.filter((t) => t.action !== 'hold').length} changes ·{' '}
                  {pct(buyTotal)} bought · {pct(sellTotal)} sold ·{' '}
                  Turnover: {pct(preview.turnover)}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full font-plex-mono text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-black">
                        {['Ticker', 'Action', 'Current', 'Proposed', 'Δ'].map((h) => (
                          <th
                            key={h}
                            className="text-right first:text-left py-1 px-2 font-normal uppercase tracking-widest text-[10px]"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.trades.map((t) => (
                        <tr
                          key={t.ticker}
                          className={[
                            'border-b border-gray-100',
                            t.is_supplement ? 'bg-blue-50/50' : '',
                          ].join(' ')}
                        >
                          <td className="py-1 px-2 font-bold">
                            {t.ticker}
                            {t.is_supplement && (
                              <span className="ml-1.5 text-[9px] text-blue-600 uppercase tracking-wider">
                                ETF
                              </span>
                            )}
                          </td>
                          <td className={`text-right py-1 px-2 uppercase tracking-widest text-[10px] font-bold ${
                            t.action === 'buy'  ? 'text-green-700' :
                            t.action === 'sell' ? 'text-red-700'   : 'text-gray-400'
                          }`}>
                            {t.action}
                          </td>
                          <td className="text-right py-1 px-2 text-gray-500">{pct(t.current_weight)}</td>
                          <td className="text-right py-1 px-2 font-bold">{pct(t.proposed_weight)}</td>
                          <td className={`text-right py-1 px-2 ${
                            t.delta > 0.0005 ? 'text-green-700' :
                            t.delta < -0.0005 ? 'text-red-700'  : 'text-gray-400'
                          }`}>
                            {fmtDelta(t.delta)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Commit */}
              <div className="border-t border-gray-200 pt-6 space-y-4">
                <h3 className="font-space-mono text-xs uppercase tracking-widest">
                  Save Rebalanced Portfolio
                </h3>
                <div className="flex items-center gap-4 flex-wrap">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => { setName(e.target.value); setCommitMsg('') }}
                    placeholder="Portfolio name…"
                    className="border border-black px-3 py-1.5 font-plex-mono text-xs w-64 bg-transparent focus:outline-none focus:ring-1 focus:ring-black"
                  />
                  <label className="flex items-center gap-2 font-plex-mono text-xs cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={goLive}
                      onChange={(e) => setGoLive(e.target.checked)}
                    />
                    <span className="uppercase tracking-widest">Set as Live</span>
                  </label>
                </div>
                {commitMsg && (
                  <p className="font-plex-mono text-xs text-red-700 uppercase tracking-widest">{commitMsg}</p>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={handleCommit}
                    disabled={committing || !name.trim()}
                    className="border border-black px-5 py-2 font-plex-mono text-xs uppercase tracking-widest bg-black text-white hover:bg-gray-800 disabled:opacity-40"
                  >
                    {committing ? 'Saving…' : 'Commit'}
                  </button>
                  <button
                    onClick={() => { setStep(1); setPreview(null) }}
                    disabled={committing}
                    className="border border-black px-5 py-2 font-plex-mono text-xs uppercase tracking-widest hover:bg-gray-100 disabled:opacity-40"
                  >
                    Back
                  </button>
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  )
}
