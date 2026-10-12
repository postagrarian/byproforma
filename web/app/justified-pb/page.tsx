'use client'
import { useState, useCallback, useEffect }  from 'react'
import LandingLayout                 from '@/components/layout/LandingLayout'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ── Types ───────────────────────────────────────────────────────────────────

interface PbData {
  symbol:         string
  company_name:   string
  sector:         string
  industry:       string
  fiscal_date:     string
  revenue:        number
  ebit:           number
  ebt:            number
  net_income:     number
  total_assets:   number
  total_equity:   number
  total_debt:     number
  dividends_paid:  number
  beta:           number
  price:          number
  current_pb:     number
  bvps:           number
  npm:            number
  ato:            number
  em:             number
  roe:            number
  tax_burden:       number
  interest_burden:  number
  operating_margin: number
  roe_5factor:      number
  payout:         number
  retention:      number
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtB(n: number): string {
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(1)}T`
  if (Math.abs(n) >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`
  if (Math.abs(n) >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`
  if (Math.abs(n) >= 1e3)  return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function pct(n: number, digits: number = 2): string {
  return `${(n * 100).toFixed(digits)}%`
}

function num(n: number, digits: number = 4): string {
  return n.toFixed(digits)
}

// ── Sub-components ──────────────────────────────────────────────────────────

function InputRow({
  label, value, onChange, min, max, step, suffix,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  suffix?: string
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-plex-mono text-[10px] font-bold uppercase tracking-widest text-gray-500">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="w-28 accent-black"
        />
        <span className="font-plex-mono text-xs tabular-nums w-14 text-right">
          {(value * 100).toFixed(2)}%{suffix}
        </span>
      </div>
    </div>
  )
}

function DataRow({
  label, value, highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between py-1 border-b border-gray-100">
      <span className="font-plex-mono text-[10px] text-gray-500 uppercase tracking-widest">
        {label}
      </span>
      <span className={`font-plex-mono text-xs tabular-nums ${highlight ? 'font-bold text-black' : 'text-gray-700'}`}>
        {value}
      </span>
    </div>
  )
}

function FactorCard({
  title, children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="border border-gray-200 p-5">
      <p className="font-plex-mono text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">
        {title}
      </p>
      {children}
    </div>
  )
}

function SensitivityGrid({
  roe, retention, beta, rf, erp,
}: {
  roe: number
  retention: number
  beta: number
  rf: number
  erp: number
}) {
  const gValues = [0, 0.01, 0.02, 0.03, 0.04, 0.05]
  const rValues = [0.06, 0.08, 0.10, 0.12, 0.14]

  return (
    <div>
      <div className="grid grid-cols-[auto_repeat(6,3rem)] gap-1 mb-1">
        <div></div>
        {gValues.map((g) => (
          <div key={g} className="font-plex-mono text-[9px] font-bold uppercase tracking-widest text-gray-400 text-right">
            g={pct(g, 1)}
          </div>
        ))}
      </div>
      {rValues.map((r) => (
        <div key={r} className="grid grid-cols-[auto_repeat(6,3rem)] gap-1 mb-0.5">
          <div className="font-plex-mono text-[9px] font-bold uppercase tracking-widest text-gray-400 text-right pr-2 w-10">
            r={pct(r, 1)}
          </div>
          {gValues.map((g) => {
            if (r <= g) {
              return <div key={g} className="font-plex-mono text-[10px] tabular-nums text-right text-gray-300 pr-1">∞</div>
            }
            const pbVal = (roe - g) / (r - g)
            const isCurrent = Math.abs(r - (rf + beta * erp)) < 0.005 && g === 0.04
            return (
              <div
                key={g}
                className={`font-plex-mono text-[10px] tabular-nums text-right pr-1 ${
                  isCurrent ? 'font-bold text-black bg-gray-100' : 'text-gray-600'
                }`}
              >
                {pbVal.toFixed(2)}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function JustifiedPbPage() {
  const [ticker,      setTicker]      = useState('AAPL')
  const [inputTicker, setInputTicker] = useState('AAPL')
  const [data,        setData]        = useState<PbData | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')

  // Adjustable assumptions
  const [rf,     setRf]     = useState(0.0425)
  const [erp,    setErp]    = useState(0.055)
  const [gCap,   setGCap]   = useState(0.04)

  const fetchPb = useCallback(async (sym: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/public/justified-pb?symbol=${encodeURIComponent(sym)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${res.status}`)
      }
      const json = await res.json()
      setData(json)
      setTicker(json.symbol)
    } catch (e: any) {
      setError(e.message || 'Failed to fetch data')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    fetchPb('AAPL')
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (inputTicker.trim()) {
      fetchPb(inputTicker.trim().toUpperCase())
    }
  }

  // ── Computed values ──────────────────────────────────────────────────────
  const roe       = data?.roe       ?? 0
  const retention = data?.retention ?? 0
  const beta      = data?.beta      ?? 1

  const r       = rf + beta * erp
  const gRaw    = roe * retention
  const g       = Math.min(Math.max(gRaw, 0), gCap)
  const gCapped = gRaw > gCap

  const justifiedPb = r > g ? (roe - g) / (r - g) : Infinity
  const impliedPrice = data && data.bvps > 0 && justifiedPb !== Infinity ? justifiedPb * data.bvps : null
  const upDown = data && impliedPrice && data.price > 0
    ? (impliedPrice / data.price - 1) * 100
    : null

  return (
    <LandingLayout>
      {/* Page header */}
      <div className="mb-8">
        <h2 className="font-space-mono text-lg font-bold uppercase tracking-tight mb-1">
          Justified P/B
        </h2>
        <p className="font-plex-mono text-xs text-gray-500 uppercase tracking-widest">
          DuPont decomposition × CAPM cost of equity · P/B = (ROE − g) / (r − g)
        </p>
      </div>

      {/* Ticker search */}
      <form onSubmit={handleSubmit} className="mb-8 flex items-center gap-3">
        <input
          type="text"
          value={inputTicker}
          onChange={(e) => setInputTicker(e.target.value)}
          placeholder="Ticker"
          className="border border-gray-200 px-3 py-2 font-plex-mono text-sm w-36 bg-transparent focus:outline-none focus:border-black uppercase"
        />
        <button
          type="submit"
          disabled={loading}
          className="border border-black px-4 py-2 font-plex-mono text-xs uppercase tracking-widest hover:bg-black hover:text-white transition-none disabled:opacity-40"
        >
          {loading ? 'Loading…' : 'Analyze'}
        </button>
      </form>

      {error && (
        <div className="border border-gray-200 p-5 mb-8">
          <p className="font-plex-mono text-xs text-red-700 uppercase tracking-widest">{error}</p>
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* Company header */}
          <div className="border border-gray-200 p-5">
            <div className="flex items-baseline justify-between border-b border-gray-100 pb-3 mb-4">
              <div>
                <p className="font-space-mono text-base font-bold uppercase tracking-tight">
                  {data.company_name} ({data.symbol})
                </p>
                <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest mt-0.5">
                  {data.sector} · {data.industry} · FYE {data.fiscal_date}
                </p>
              </div>
              <div className="text-right">
                <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest">Price</p>
                <p className="font-space-mono text-base font-bold">${data.price.toFixed(2)}</p>
              </div>
            </div>

            {/* Justified P/B summary — the headline number */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest mb-1">Current P/B</p>
                <p className="font-space-mono text-2xl font-bold">
                  {data.current_pb > 0 ? data.current_pb.toFixed(2) : '—'}
                </p>
              </div>
              <div>
                <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest mb-1">Justified P/B</p>
                <p className="font-space-mono text-2xl font-bold">
                  {justifiedPb === Infinity ? '∞' : justifiedPb.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest mb-1">Implied Price</p>
                <p className={`font-space-mono text-2xl font-bold ${
                  upDown === null ? '' : upDown >= 0 ? 'text-black' : 'text-red-700'
                }`}>
                  {impliedPrice !== null ? `$${impliedPrice.toFixed(2)}` : '—'}
                </p>
                {upDown !== null && (
                  <p className="font-plex-mono text-[10px] uppercase tracking-widest mt-0.5">
                    {upDown >= 0 ? '+' : ''}{upDown.toFixed(1)}%
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Two-column layout: DuPont + Assumptions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* DuPont 3-Factor */}
            <FactorCard title="DuPont 3-Factor · ROE Decomposition">
              <div className="space-y-1">
                <DataRow label="Net Profit Margin" value={`${num(data.npm)}  (${pct(data.npm)})`} />
                <DataRow label="× Asset Turnover"   value={num(data.ato)} />
                <DataRow label="× Equity Multiplier" value={num(data.em)} />
                <div className="pt-2 mt-2 border-t border-gray-200">
                  <div className="flex items-baseline justify-between">
                    <span className="font-plex-mono text-[10px] font-bold uppercase tracking-widest text-gray-700">
                      ROE
                    </span>
                    <span className="font-space-mono text-lg font-bold">
                      {pct(data.roe)}
                    </span>
                  </div>
                </div>
              </div>
            </FactorCard>

            {/* DuPont 5-Factor */}
            <FactorCard title="DuPont 5-Factor · Extended Decomposition">
              <div className="space-y-1">
                <DataRow label="Tax Burden (NI/EBT)"        value={num(data.tax_burden)} />
                <DataRow label="× Interest Burden (EBT/EBIT)" value={num(data.interest_burden)} />
                <DataRow label="× Operating Margin (EBIT/Rev)" value={`${num(data.operating_margin)}  (${pct(data.operating_margin)})`} />
                <DataRow label="× Asset Turnover"            value={num(data.ato)} />
                <DataRow label="× Equity Multiplier"         value={num(data.em)} />
                <div className="pt-2 mt-2 border-t border-gray-200">
                  <div className="flex items-baseline justify-between">
                    <span className="font-plex-mono text-[10px] font-bold uppercase tracking-widest text-gray-700">
                      ROE (5-factor)
                    </span>
                    <span className="font-space-mono text-lg font-bold">
                      {pct(data.roe_5factor)}
                    </span>
                  </div>
                </div>
              </div>
            </FactorCard>
          </div>

          {/* Growth + CAPM */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Sustainable Growth */}
            <FactorCard title="Sustainable Growth Rate">
              <div className="space-y-1">
                <DataRow label="Net Income"       value={fmtB(data.net_income)} />
                <DataRow label="Dividends Paid"    value={fmtB(data.dividends_paid)} />
                <DataRow label="Payout Ratio"     value={pct(data.payout)} />
                <DataRow label="Retention (b)"    value={pct(data.retention)} />
                <div className="pt-2 mt-2 border-t border-gray-200">
                  <DataRow label="g = ROE × b" value={pct(gRaw)} highlight />
                  {gCapped && (
                    <p className="font-plex-mono text-[9px] text-gray-400 uppercase tracking-widest mt-1">
                      Capped to {pct(gCap)} — theoretical g exceeds cost of equity
                    </p>
                  )}
                </div>
              </div>
            </FactorCard>

            {/* CAPM */}
            <FactorCard title="Cost of Equity (CAPM)">
              <div className="space-y-1 mb-3">
                <DataRow label="Beta"            value={beta.toFixed(3)} />
                <DataRow label="Risk-Free Rate"   value={pct(rf)} />
                <DataRow label="Equity Risk Prem" value={pct(erp)} />
                <div className="pt-2 mt-2 border-t border-gray-200">
                  <DataRow label="r = Rf + β × ERP" value={pct(r)} highlight />
                </div>
              </div>
              <div className="space-y-2 pt-3 border-t border-gray-100">
                <InputRow label="Rf (Risk-Free)"  value={rf}  onChange={setRf}  min={0.01} max={0.08}  step={0.0025} />
                <InputRow label="ERP (Risk Prem)" value={erp} onChange={setErp} min={0.03} max={0.08}  step={0.0025} />
                <InputRow label="Growth Cap"      value={gCap} onChange={setGCap} min={0.01} max={0.06}  step={0.005} />
              </div>
            </FactorCard>
          </div>

          {/* Formula */}
          <div className="border border-gray-200 p-5">
            <p className="font-plex-mono text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">
              Justified P/B Formula
            </p>
            <div className="font-space-mono text-sm text-center py-2">
              P/B = (ROE − g) / (r − g)
            </div>
            <div className="font-plex-mono text-xs text-center text-gray-600 mt-1">
              = ({roe.toFixed(4)} − {g.toFixed(4)}) / ({r.toFixed(4)} − {g.toFixed(4)})
              {r > g && (
                <span className="ml-2 text-black font-bold">
                  = {justifiedPb.toFixed(2)}
                </span>
              )}
              {r <= g && (
                <span className="ml-2 text-red-700 font-bold">
                  = ∞ (g ≥ r — perpetuity diverges)
                </span>
              )}
            </div>
          </div>

          {/* Sensitivity grid */}
          <div className="border border-gray-200 p-5">
            <p className="font-plex-mono text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">
              Sensitivity · Justified P/B by (r, g)
            </p>
            <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest mb-3">
              ROE = {pct(roe)} · β = {beta.toFixed(2)} · highlighted = current assumptions
            </p>
            <SensitivityGrid roe={roe} retention={retention} beta={beta} rf={rf} erp={erp} />
          </div>

          {/* Raw financials */}
          <div className="border border-gray-200 p-5">
            <p className="font-plex-mono text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">
              Underlying Financials (Latest Annual)
            </p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1">
              <DataRow label="Revenue"       value={fmtB(data.revenue)} />
              <DataRow label="Total Assets"  value={fmtB(data.total_assets)} />
              <DataRow label="EBIT"          value={fmtB(data.ebit)} />
              <DataRow label="Total Equity"  value={fmtB(data.total_equity)} />
              <DataRow label="EBT"           value={fmtB(data.ebt)} />
              <DataRow label="Total Debt"    value={fmtB(data.total_debt)} />
              <DataRow label="Net Income"    value={fmtB(data.net_income)} />
              <DataRow label="D/E Ratio"     value={`${(data.total_debt / data.total_equity).toFixed(2)}x`} />
              <DataRow label="Dividends"     value={fmtB(data.dividends_paid)} />
              <DataRow label="BVPS"          value={`$${data.bvps.toFixed(2)}`} />
            </div>
          </div>

          <p className="font-plex-mono text-[10px] text-gray-300 uppercase tracking-widest">
            Source: FMP (Financial Modeling Prep) · DuPont 3-factor: NPM × ATO × EM · 5-factor: Tax Burden × Interest Burden × Op Margin × ATO × EM
          </p>
        </div>
      )}
    </LandingLayout>
  )
}
