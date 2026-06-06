import { ETFOverview } from '@/types'

interface Props {
  ticker:   string
  overview: ETFOverview | null
  runDate:  string | null
}

function pct(n: number | null | undefined, dp = 2) {
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(dp)}%`
}

function aum(n: number | null | undefined) {
  if (n == null) return '—'
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toFixed(0)}`
}

function returnColor(n: number | null | undefined) {
  if (n == null) return 'text-black'
  return n >= 0 ? 'text-green-700' : 'text-red-700'
}

export default function ETFHeader({ ticker, overview, runDate }: Props) {
  return (
    <div className="border-b border-black pb-5 mb-6">
      {/* Name + ticker row */}
      <div className="flex items-baseline justify-between mb-1">
        <div className="flex items-baseline gap-4">
          <span className="font-space-mono text-2xl font-bold uppercase tracking-tight">
            {ticker}
          </span>
          {overview?.name && (
            <span className="font-plex-mono text-sm text-gray-600">
              {overview.name}
            </span>
          )}
        </div>
        {runDate && (
          <span className="font-plex-mono text-xs text-gray-400 uppercase tracking-widest">
            Run: {new Date(runDate).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Description */}
      {overview?.description && (
        <p className="font-plex-mono text-xs text-gray-500 mb-4 leading-relaxed max-w-3xl">
          {overview.description}
        </p>
      )}

      {/* Stats bar */}
      <div className="flex flex-wrap gap-x-8 gap-y-2 font-plex-mono text-xs uppercase tracking-widest">
        <div>
          <span className="text-gray-400">Expense Ratio</span>
          <span className="ml-2 font-bold">
            {overview?.expenseRatio != null
              ? `${overview.expenseRatio.toFixed(2)}%`
              : '—'}
          </span>
        </div>
        <div>
          <span className="text-gray-400">YTD</span>
          <span className={`ml-2 font-bold ${returnColor(overview?.ytd)}`}>
            {pct(overview?.ytd)}
          </span>
        </div>
        <div>
          <span className="text-gray-400">1 Yr</span>
          <span className={`ml-2 font-bold ${returnColor(overview?.return1Y)}`}>
            {pct(overview?.return1Y)}
          </span>
        </div>
        <div>
          <span className="text-gray-400">AUM</span>
          <span className="ml-2 font-bold">{aum(overview?.aum)}</span>
        </div>
        <div>
          <span className="text-gray-400">Holdings</span>
          <span className="ml-2 font-bold">
            {overview?.holdings ?? '—'}
          </span>
        </div>
      </div>
    </div>
  )
}
