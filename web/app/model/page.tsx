'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter }       from 'next/navigation'
import { isAuthenticated } from '@/lib/auth'
import LandingLayout       from '@/components/layout/LandingLayout'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ── Asset class universe (matches backend) ──────────────────────────────────
const ASSET_CLASSES = [
  { ticker: 'DFAC', name: 'US Large Cap',       group: 'equity' },
  { ticker: 'DFAS', name: 'US Small Cap',       group: 'equity' },
  { ticker: 'DFAT', name: 'US Value',            group: 'equity' },
  { ticker: 'DFIV', name: 'Intl Developed',      group: 'equity' },
  { ticker: 'DFIS', name: 'Intl Small Cap',      group: 'equity' },
  { ticker: 'DFEM', name: 'Emerging Markets',    group: 'equity' },
  { ticker: 'DFAR', name: 'US REITs',            group: 'real_assets' },
  { ticker: 'DFCF', name: 'US Core Bonds',       group: 'fixed_income' },
  { ticker: 'DFSD', name: 'Short-Term Bonds',    group: 'fixed_income' },
  { ticker: 'DFIP', name: 'TIPS',                group: 'fixed_income' },
  { ticker: 'IAUM', name: 'Gold',                group: 'alternatives' },
  { ticker: 'IBIT', name: 'Bitcoin',             group: 'alternatives' },
] as const

const TICKERS = ASSET_CLASSES.map(a => a.ticker)
const N = TICKERS.length

// ── Default CMAs (starting point) ───────────────────────────────────────────
const DEFAULT_RETURNS: Record<string, number> = {
  DFAC: 9.0, DFAS: 10.0, DFAT: 10.5, DFIV: 8.5, DFIS: 9.5, DFEM: 10.0,
  DFAR: 8.0, DFCF: 4.5, DFSD: 4.0, DFIP: 4.2, IAUM: 5.0, IBIT: 15.0,
}
const DEFAULT_VOLS: Record<string, number> = {
  DFAC: 16.0, DFAS: 20.0, DFAT: 19.0, DFIV: 17.0, DFIS: 20.0, DFEM: 22.0,
  DFAR: 20.0, DFCF: 5.0, DFSD: 2.0, DFIP: 6.0, IAUM: 15.0, IBIT: 60.0,
}

// Reasonable default correlation matrix
function defaultCorrelations(): number[][] {
  const C: number[][] = Array.from({ length: N }, () => Array(N).fill(0))
  const eqIdx = [0,1,2,3,4,5]
  const bondIdx = [7,8,9]
  const reit = 6, gold = 10, btc = 11

  for (let i = 0; i < N; i++) C[i][i] = 1.0

  // Equity block
  for (const i of eqIdx) for (const j of eqIdx) if (i !== j) C[i][j] = 0.75
  // REITs ↔ equity
  for (const i of eqIdx) { C[reit][i] = C[i][reit] = 0.55 }
  // Bonds ↔ equity (low)
  for (const b of bondIdx) {
    for (const e of eqIdx) C[b][e] = C[e][b] = 0.05
    C[b][reit] = C[reit][b] = 0.15
  }
  // Bond block
  for (const i of bondIdx) for (const j of bondIdx) if (i !== j) C[i][j] = 0.70
  // Gold
  for (const e of eqIdx) C[gold][e] = C[e][gold] = 0.00
  for (const b of bondIdx) C[gold][b] = C[b][gold] = 0.20
  C[gold][9] = C[9][gold] = 0.35 // TIPS
  C[gold][reit] = C[reit][gold] = 0.10
  // Bitcoin
  for (const e of eqIdx) C[btc][e] = C[e][btc] = 0.25
  for (const b of bondIdx) C[btc][b] = C[b][btc] = 0.00
  C[btc][reit] = C[reit][btc] = 0.15
  C[btc][gold] = C[gold][btc] = 0.10

  return C
}


// ── Types ───────────────────────────────────────────────────────────────────
type OptResult = {
  weights:         Record<string, number>
  expected_return: number
  expected_vol:    number
  sharpe_ratio:    number
  marginal_risk:   Record<string, number>
  constraints_used: Record<string, number>
}

type FrontierPoint = {
  target_return: number
  expected_vol:  number
  sharpe_ratio:  number
  weights:       Record<string, number>
}


// ── Group badge colours ─────────────────────────────────────────────────────
const GROUP_STYLE: Record<string, string> = {
  equity:       'bg-black text-white',
  real_assets:  'bg-gray-600 text-white',
  fixed_income: 'bg-gray-300 text-black',
  alternatives: 'bg-yellow-100 text-black border border-yellow-300',
}

const GROUP_LABEL: Record<string, string> = {
  equity:       'EQ',
  real_assets:  'RE',
  fixed_income: 'FI',
  alternatives: 'ALT',
}


// ═══════════════════════════════════════════════════════════════════════════
export default function ModelPage() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)

  // CMA inputs (percentages for UX, converted to decimals for API)
  const [returns, setReturns]     = useState<Record<string, number>>({ ...DEFAULT_RETURNS })
  const [vols, setVols]           = useState<Record<string, number>>({ ...DEFAULT_VOLS })
  const [corr, setCorr]           = useState<number[][]>(defaultCorrelations)
  const [riskFreeRate, setRfr]    = useState(4.0)

  // Optimizer
  const [targetReturn, setTarget] = useState(8.0)
  const [maxWeight, setMaxW]      = useState(40)
  const [minEquity, setMinEq]     = useState(50)
  const [maxAlts, setMaxAlts]     = useState(15)
  const [maxSingleAlt, setMaxSA]  = useState(10)

  const [result,   setResult]     = useState<OptResult | null>(null)
  const [frontier, setFrontier]   = useState<FrontierPoint[]>([])
  const [loading,  setLoading]    = useState(false)
  const [error,    setError]      = useState('')

  // Sections
  const [showCorr, setShowCorr]   = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) { router.replace('/'); return }
    setAuthed(true)
  }, [])

  // ── API calls ──────────────────────────────────────────────────────────
  const buildPayload = useCallback(() => {
    const r: Record<string, number> = {}
    const v: Record<string, number> = {}
    for (const t of TICKERS) {
      r[t] = (returns[t] ?? 0) / 100
      v[t] = (vols[t] ?? 0) / 100
    }
    return {
      returns: r,
      volatilities: v,
      correlations: corr,
      risk_free_rate: riskFreeRate / 100,
    }
  }, [returns, vols, corr, riskFreeRate])

  async function runOptimize() {
    setLoading(true)
    setError('')
    setResult(null)
    try {
      // First, create/update the CMA set and activate it
      const cma = buildPayload()
      const cmaRes = await fetch(`${API}/model/cma`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Working Set',
          risk_free_rate: cma.risk_free_rate,
          returns: cma.returns,
          volatilities: cma.volatilities,
          correlations: cma.correlations,
        }),
      })
      if (!cmaRes.ok) {
        const err = await cmaRes.json().catch(() => ({}))
        throw new Error(err.detail || `CMA save failed: ${cmaRes.status}`)
      }
      const cmaData = await cmaRes.json()

      // Activate it
      await fetch(`${API}/model/cma/${cmaData.id}/activate`, { method: 'POST' })

      // Run optimizer
      const optRes = await fetch(`${API}/model/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_return: targetReturn / 100,
          cma_set_id: cmaData.id,
          constraints: {
            max_single_weight: maxWeight / 100,
            min_equity: minEquity / 100,
            max_alternatives: maxAlts / 100,
            max_single_alt: maxSingleAlt / 100,
          },
        }),
      })
      if (!optRes.ok) {
        const err = await optRes.json().catch(() => ({}))
        throw new Error(err.detail || `Optimizer failed: ${optRes.status}`)
      }
      const optData = await optRes.json()
      setResult(optData)

      // Compute frontier in background
      fetch(`${API}/model/frontier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cma_set_id: cmaData.id,
          constraints: {
            max_single_weight: maxWeight / 100,
            min_equity: minEquity / 100,
            max_alternatives: maxAlts / 100,
            max_single_alt: maxSingleAlt / 100,
          },
          n_points: 25,
        }),
      }).then(r => r.json()).then(d => setFrontier(d.frontier || []))
        .catch(() => {})

    } catch (e: any) {
      setError(e.message || 'Optimization failed')
    } finally {
      setLoading(false)
    }
  }

  if (!authed) return null

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <LandingLayout>
      <div className="space-y-10">

        {/* ─── Title ─────────────────────────────────────────────────── */}
        <div>
          <h1 className="font-space-mono text-xl font-bold uppercase tracking-tight">
            Model Portfolio Builder
          </h1>
          <p className="font-plex-mono text-xs text-gray-500 mt-1 uppercase tracking-widest">
            DFA ETF Strategic Allocation · Mean-Variance Optimization
          </p>
        </div>

        {/* ─── Capital Market Assumptions ─────────────────────────────── */}
        <section>
          <h2 className="font-space-mono text-sm font-bold uppercase tracking-widest border-b border-black pb-1 mb-4">
            Capital Market Assumptions
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full font-plex-mono text-xs border-collapse">
              <thead className="border-b border-black">
                <tr>
                  <th className="text-left py-1 pr-4 font-bold uppercase tracking-widest text-[10px]">Asset Class</th>
                  <th className="text-left py-1 pr-4 font-bold uppercase tracking-widest text-[10px]">Ticker</th>
                  <th className="text-left py-1 pr-4 font-bold uppercase tracking-widest text-[10px]">Group</th>
                  <th className="text-right py-1 pr-4 font-bold uppercase tracking-widest text-[10px]">Exp. Return (%)</th>
                  <th className="text-right py-1 pr-4 font-bold uppercase tracking-widest text-[10px]">Exp. Vol (%)</th>
                </tr>
              </thead>
              <tbody>
                {ASSET_CLASSES.map(({ ticker, name, group }) => (
                  <tr key={ticker} className="border-b border-gray-100">
                    <td className="py-1.5 pr-4 text-gray-800">{name}</td>
                    <td className="py-1.5 pr-4 font-bold">{ticker}</td>
                    <td className="py-1.5 pr-4">
                      <span className={`px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${GROUP_STYLE[group]}`}>
                        {GROUP_LABEL[group]}
                      </span>
                    </td>
                    <td className="py-1.5 pr-4 text-right">
                      <input
                        type="number"
                        step="0.1"
                        value={returns[ticker] ?? ''}
                        onChange={e => setReturns(r => ({ ...r, [ticker]: parseFloat(e.target.value) || 0 }))}
                        className="w-16 text-right border border-gray-200 px-1 py-0.5 focus:outline-none focus:border-black"
                      />
                    </td>
                    <td className="py-1.5 pr-4 text-right">
                      <input
                        type="number"
                        step="0.1"
                        value={vols[ticker] ?? ''}
                        onChange={e => setVols(v => ({ ...v, [ticker]: parseFloat(e.target.value) || 0 }))}
                        className="w-16 text-right border border-gray-200 px-1 py-0.5 focus:outline-none focus:border-black"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Risk-free rate */}
          <div className="mt-3 flex items-center gap-2">
            <span className="font-plex-mono text-xs text-gray-500 uppercase tracking-widest">Risk-Free Rate:</span>
            <input
              type="number"
              step="0.1"
              value={riskFreeRate}
              onChange={e => setRfr(parseFloat(e.target.value) || 0)}
              className="w-16 text-right border border-gray-200 px-1 py-0.5 font-plex-mono text-xs focus:outline-none focus:border-black"
            />
            <span className="font-plex-mono text-xs text-gray-400">%</span>
          </div>

          {/* Correlation matrix toggle */}
          <button
            onClick={() => setShowCorr(c => !c)}
            className="mt-3 font-plex-mono text-[11px] text-gray-500 uppercase tracking-widest hover:text-black"
          >
            {showCorr ? '▾ Hide' : '▸ Show'} Correlation Matrix
          </button>

          {showCorr && (
            <div className="mt-3 overflow-x-auto">
              <table className="font-plex-mono text-[10px] border-collapse">
                <thead>
                  <tr>
                    <th className="px-1 py-0.5" />
                    {TICKERS.map(t => (
                      <th key={t} className="px-1 py-0.5 font-bold text-center" style={{writingMode: 'vertical-lr', transform: 'rotate(180deg)', height: '60px'}}>
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TICKERS.map((t, i) => (
                    <tr key={t}>
                      <td className="px-1 py-0.5 font-bold">{t}</td>
                      {TICKERS.map((t2, j) => (
                        <td key={t2} className="px-0.5 py-0.5 text-center">
                          {j > i ? (
                            <span className="text-gray-300">{corr[i][j].toFixed(2)}</span>
                          ) : j === i ? (
                            <span className="text-gray-400">1.00</span>
                          ) : (
                            <input
                              type="number"
                              step="0.05"
                              min="-1"
                              max="1"
                              value={corr[i][j]}
                              onChange={e => {
                                const v = Math.max(-1, Math.min(1, parseFloat(e.target.value) || 0))
                                setCorr(c => {
                                  const newC = c.map(row => [...row])
                                  newC[i][j] = v
                                  newC[j][i] = v
                                  return newC
                                })
                              }}
                              className="w-10 text-center border border-gray-200 px-0 py-0 focus:outline-none focus:border-black"
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ─── Optimizer Controls ─────────────────────────────────────── */}
        <section>
          <h2 className="font-space-mono text-sm font-bold uppercase tracking-widest border-b border-black pb-1 mb-4">
            Optimize
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 mb-4">
            <div>
              <label className="font-plex-mono text-[10px] text-gray-500 uppercase tracking-widest block mb-1">
                Target Return (%)
              </label>
              <input
                type="number" step="0.5" value={targetReturn}
                onChange={e => setTarget(parseFloat(e.target.value) || 0)}
                className="w-full border border-black px-2 py-1.5 font-plex-mono text-sm focus:outline-none focus:ring-1 focus:ring-black"
              />
            </div>
            <div>
              <label className="font-plex-mono text-[10px] text-gray-500 uppercase tracking-widest block mb-1">
                Max Position (%)
              </label>
              <input
                type="number" step="5" value={maxWeight}
                onChange={e => setMaxW(parseInt(e.target.value) || 10)}
                className="w-full border border-gray-200 px-2 py-1.5 font-plex-mono text-sm focus:outline-none focus:border-black"
              />
            </div>
            <div>
              <label className="font-plex-mono text-[10px] text-gray-500 uppercase tracking-widest block mb-1">
                Min Equity (%)
              </label>
              <input
                type="number" step="5" value={minEquity}
                onChange={e => setMinEq(parseInt(e.target.value) || 0)}
                className="w-full border border-gray-200 px-2 py-1.5 font-plex-mono text-sm focus:outline-none focus:border-black"
              />
            </div>
            <div>
              <label className="font-plex-mono text-[10px] text-gray-500 uppercase tracking-widest block mb-1">
                Max Alts (%)
              </label>
              <input
                type="number" step="5" value={maxAlts}
                onChange={e => setMaxAlts(parseInt(e.target.value) || 0)}
                className="w-full border border-gray-200 px-2 py-1.5 font-plex-mono text-sm focus:outline-none focus:border-black"
              />
            </div>
            <div>
              <label className="font-plex-mono text-[10px] text-gray-500 uppercase tracking-widest block mb-1">
                Max Single Alt (%)
              </label>
              <input
                type="number" step="1" value={maxSingleAlt}
                onChange={e => setMaxSA(parseInt(e.target.value) || 0)}
                className="w-full border border-gray-200 px-2 py-1.5 font-plex-mono text-sm focus:outline-none focus:border-black"
              />
            </div>
          </div>

          <button
            onClick={runOptimize}
            disabled={loading}
            className={[
              'px-6 py-2 font-plex-mono text-xs uppercase tracking-widest border border-black transition-none',
              loading
                ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : 'bg-black text-white hover:bg-white hover:text-black',
            ].join(' ')}
          >
            {loading ? 'Optimizing…' : 'Build Allocation'}
          </button>

          {error && (
            <p className="font-plex-mono text-xs text-red-700 uppercase tracking-widest mt-3">
              {error}
            </p>
          )}
        </section>

        {/* ─── Results ────────────────────────────────────────────────── */}
        {result && (
          <section>
            <h2 className="font-space-mono text-sm font-bold uppercase tracking-widest border-b border-black pb-1 mb-4">
              Suggested Allocation
            </h2>

            {/* Portfolio summary */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              {[
                { label: 'Expected Return', value: `${(result.expected_return * 100).toFixed(2)}%` },
                { label: 'Expected Volatility', value: `${(result.expected_vol * 100).toFixed(2)}%` },
                { label: 'Sharpe Ratio', value: result.sharpe_ratio.toFixed(3) },
              ].map(({ label, value }) => (
                <div key={label} className="border border-black p-3">
                  <p className="font-plex-mono text-[10px] text-gray-500 uppercase tracking-widest">{label}</p>
                  <p className="font-space-mono text-lg font-bold mt-0.5">{value}</p>
                </div>
              ))}
            </div>

            {/* Weights table */}
            <div className="overflow-x-auto mb-6">
              <table className="w-full font-plex-mono text-xs border-collapse">
                <thead className="border-b border-black">
                  <tr>
                    <th className="text-left py-1 pr-4 font-bold uppercase tracking-widest text-[10px]">Asset Class</th>
                    <th className="text-left py-1 pr-4 font-bold uppercase tracking-widest text-[10px]">Ticker</th>
                    <th className="text-left py-1 pr-4 font-bold uppercase tracking-widest text-[10px]">Group</th>
                    <th className="text-right py-1 pr-4 font-bold uppercase tracking-widest text-[10px]">Weight</th>
                    <th className="text-right py-1 pr-4 font-bold uppercase tracking-widest text-[10px]">Risk Contrib</th>
                    <th className="text-left py-1 font-bold uppercase tracking-widest text-[10px]" style={{width: '200px'}}></th>
                  </tr>
                </thead>
                <tbody>
                  {ASSET_CLASSES
                    .filter(a => (result.weights[a.ticker] ?? 0) > 0.001)
                    .sort((a, b) => (result.weights[b.ticker] ?? 0) - (result.weights[a.ticker] ?? 0))
                    .map(({ ticker, name, group }) => {
                      const w = result.weights[ticker] ?? 0
                      const mr = result.marginal_risk[ticker] ?? 0
                      const pct = (w * 100)
                      return (
                        <tr key={ticker} className="border-b border-gray-100">
                          <td className="py-1.5 pr-4 text-gray-800">{name}</td>
                          <td className="py-1.5 pr-4 font-bold">{ticker}</td>
                          <td className="py-1.5 pr-4">
                            <span className={`px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${GROUP_STYLE[group]}`}>
                              {GROUP_LABEL[group]}
                            </span>
                          </td>
                          <td className="py-1.5 pr-4 text-right font-bold">{pct.toFixed(1)}%</td>
                          <td className="py-1.5 pr-4 text-right text-gray-500">{(mr * 100).toFixed(2)}%</td>
                          <td className="py-1.5">
                            <div className="w-full bg-gray-100 h-3">
                              <div
                                className="h-full bg-black"
                                style={{ width: `${Math.min(pct / 0.4, 100)}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>

            {/* Group summary */}
            <div className="flex gap-6 mb-6">
              {(['equity', 'real_assets', 'fixed_income', 'alternatives'] as const).map(g => {
                const gw = ASSET_CLASSES
                  .filter(a => a.group === g)
                  .reduce((sum, a) => sum + (result.weights[a.ticker] ?? 0), 0)
                if (gw < 0.001) return null
                return (
                  <div key={g} className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 text-[9px] uppercase tracking-widest ${GROUP_STYLE[g]}`}>
                      {GROUP_LABEL[g]}
                    </span>
                    <span className="font-plex-mono text-xs font-bold">{(gw * 100).toFixed(1)}%</span>
                  </div>
                )
              })}
            </div>

            {/* Efficient frontier */}
            {frontier.length > 0 && (
              <div>
                <h3 className="font-space-mono text-xs font-bold uppercase tracking-widest mb-3 text-gray-700">
                  Efficient Frontier
                </h3>
                <div className="border border-gray-200 p-4 font-plex-mono text-xs">
                  <div className="relative" style={{ height: '200px' }}>
                    {/* Y axis label */}
                    <div className="absolute -left-1 top-0 text-[9px] text-gray-400 uppercase tracking-widest"
                         style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)' }}>
                      Return
                    </div>
                    {/* Plot area */}
                    <div className="ml-6 h-full relative">
                      {(() => {
                        const minV = Math.min(...frontier.map(f => f.expected_vol))
                        const maxV = Math.max(...frontier.map(f => f.expected_vol))
                        const minR = Math.min(...frontier.map(f => f.target_return))
                        const maxR = Math.max(...frontier.map(f => f.target_return))
                        const padV = (maxV - minV) * 0.1 || 0.01
                        const padR = (maxR - minR) * 0.1 || 0.01
                        return frontier.map((f, i) => {
                          const x = ((f.expected_vol - minV + padV) / (maxV - minV + 2 * padV)) * 100
                          const y = 100 - ((f.target_return - minR + padR) / (maxR - minR + 2 * padR)) * 100
                          const isSelected = result && Math.abs(f.target_return - result.expected_return) < 0.002
                          return (
                            <div
                              key={i}
                              className={`absolute rounded-full ${isSelected ? 'bg-red-600 z-10' : 'bg-black'}`}
                              style={{
                                left: `${x}%`, top: `${y}%`,
                                width: isSelected ? '8px' : '4px',
                                height: isSelected ? '8px' : '4px',
                                transform: 'translate(-50%, -50%)',
                              }}
                              title={`Return: ${(f.target_return * 100).toFixed(1)}% | Vol: ${(f.expected_vol * 100).toFixed(1)}%`}
                            />
                          )
                        })
                      })()}
                    </div>
                    {/* X axis label */}
                    <div className="ml-6 text-center text-[9px] text-gray-400 uppercase tracking-widest mt-1">
                      Volatility
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

      </div>
    </LandingLayout>
  )
}
