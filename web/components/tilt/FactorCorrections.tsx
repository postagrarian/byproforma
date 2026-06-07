'use client'
import { useState, useEffect } from 'react'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const FACTORS = ['Mkt-RF', 'SMB', 'HML', 'RMW', 'CMA', 'Mom']

interface Candidate {
  ticker:       string
  sector:       string
  beta_mkt:     number
  beta_smb:     number
  beta_hml:     number
  beta_rmw:     number
  beta_cma:     number
  beta_mom:     number
  long_score:   number
  short_score:  number
  primary_long:  string
  primary_short: string
}

interface Corrections {
  deviation: Record<string, number>
  long:      Candidate[]
  short:     Candidate[]
  message?:  string
}

interface Props {
  runId:       number
  foundTicker: string
}

function f4(n: number) { return n.toFixed(4) }
function sign(n: number) { return n >= 0 ? '+' : '' }

function CandidateTable({
  title, direction, candidates, deviation,
}: {
  title:      string
  direction:  'long' | 'short'
  candidates: Candidate[]
  deviation:  Record<string, number>
}) {
  const isLong = direction === 'long'
  const [expanded, setExpanded] = useState<string | null>(null)

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className={`font-space-mono text-xs font-bold uppercase tracking-widest ${isLong ? 'text-black' : 'text-red-700'}`}>
          {isLong ? '↑' : '↓'} {title}
        </span>
        <span className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest">
          {isLong ? 'add to reduce over-tilt' : 'short to reduce over-tilt'}
        </span>
      </div>

      <table className="w-full font-plex-mono text-xs border-collapse">
        <thead>
          <tr className="border-b border-black">
            <th className="text-left py-1 pr-3 font-normal uppercase tracking-widest text-[10px]">Ticker</th>
            <th className="text-left py-1 pr-3 font-normal uppercase tracking-widest text-[10px]">Sector</th>
            <th className="text-left py-1 pr-3 font-normal uppercase tracking-widest text-[10px]">
              Primary Factor
            </th>
            {FACTORS.map((f) => (
              <th key={f} className="text-right py-1 px-1 font-normal uppercase tracking-widest text-[10px]">{f}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => {
            const primary = isLong ? c.primary_long : c.primary_short
            const betas   = [c.beta_mkt, c.beta_smb, c.beta_hml, c.beta_rmw, c.beta_cma, c.beta_mom]
            const isOpen  = expanded === c.ticker
            return (
              <tr
                key={c.ticker}
                className="border-b border-gray-100 cursor-pointer hover:bg-white"
                onClick={() => setExpanded(isOpen ? null : c.ticker)}
              >
                <td className="py-1.5 pr-3 font-bold">{c.ticker}</td>
                <td className="py-1.5 pr-3 text-gray-500 text-[10px]">{c.sector}</td>
                <td className="py-1.5 pr-3">
                  <span className={`uppercase tracking-widest text-[10px] ${isLong ? 'text-black' : 'text-red-700'}`}>
                    {primary}
                  </span>
                </td>
                {betas.map((b, i) => {
                  const dev   = deviation[FACTORS[i]] ?? 0
                  const helps = isLong ? (dev > 0 ? b < 0 : b > 0) : (dev > 0 ? b > 0 : b < 0)
                  return (
                    <td key={i} className={`text-right py-1.5 px-1 tabular-nums ${helps ? (isLong ? 'text-black font-bold' : 'text-red-700 font-bold') : 'text-gray-400'}`}>
                      {sign(b)}{f4(b)}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function FactorCorrections({ runId, foundTicker }: Props) {
  const [data,    setData]    = useState<Corrections | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    fetch(`${API_BASE}/tilt/${runId}/corrections`)
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then(setData)
      .catch(() => setError('Could not compute corrections'))
      .finally(() => setLoading(false))
  }, [runId])

  if (loading) return (
    <p className="font-plex-mono text-xs text-gray-400 uppercase tracking-widest">
      Scanning universe for correction candidates…
    </p>
  )
  if (error) return (
    <p className="font-plex-mono text-xs text-red-700 uppercase tracking-widest">{error}</p>
  )
  if (!data) return null

  if (!data.long.length && !data.short.length) return (
    <p className="font-plex-mono text-xs text-gray-400 uppercase tracking-widest">
      {data.message ?? 'No candidates found in universe'}
    </p>
  )

  // Factor deviation summary
  const devEntries = Object.entries(data.deviation)
    .filter(([, v]) => Math.abs(v) > 0.01)
    .sort(([, a], [, b]) => Math.abs(b) - Math.abs(a))

  return (
    <div className="space-y-6">
      {/* Deviation summary */}
      {devEntries.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 font-plex-mono text-xs">
          {devEntries.map(([f, v]) => (
            <span key={f}>
              <span className="text-gray-400 uppercase tracking-widest text-[10px]">{f} drift </span>
              <span className={v > 0 ? 'text-black font-bold' : 'text-red-700 font-bold'}>
                {sign(v)}{(v * 100).toFixed(1)}%
              </span>
            </span>
          ))}
        </div>
      )}

      <div className="space-y-8">
        <CandidateTable
          title="Long Candidates"
          direction="long"
          candidates={data.long}
          deviation={data.deviation}
        />
        <CandidateTable
          title="Short Candidates"
          direction="short"
          candidates={data.short}
          deviation={data.deviation}
        />
      </div>
    </div>
  )
}
