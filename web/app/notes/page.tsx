'use client'
import { useEffect, useState } from 'react'
import { useRouter }           from 'next/navigation'
import { isAuthenticated }     from '@/lib/auth'
import LandingLayout           from '@/components/layout/LandingLayout'
import PerformanceChart        from '@/components/notes/PerformanceChart'
import ReactMarkdown           from 'react-markdown'
import remarkGfm               from 'remark-gfm'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SectorRow {
  sector:     string
  weight:     number
  return_pct: number | null
}

interface PerfEntry {
  kind:                'performance'
  date:                string
  live_portfolio_name: string
  foundational_ticker: string
  portfolio_return:    number | null
  sp500_return:        number | null
  etf_return:          number | null
  top_gainers:         { ticker: string; name: string; return_pct: number }[]
  top_losers:          { ticker: string; name: string; return_pct: number }[]
  cumulative_return:   number | null
  advances:            number | null
  declines:            number | null
  unchanged:           number | null
  sector_data:         { portfolio: SectorRow[]; etf: { sector: string; return_pct: number | null; benchmark_ticker: string | null }[] } | null
}

interface BlogEntry {
  kind:      'blog'
  id:        number
  date:      string
  title:     string | null
  content:   string
  created_at: string
}

type Entry = PerfEntry | BlogEntry

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(n: number | null) {
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`
}
function pctColor(n: number | null) {
  if (n == null) return 'text-gray-400'
  return n >= 0 ? 'text-black' : 'text-red-700'
}
function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US',
    { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PerformanceCard({ e }: { e: PerfEntry }) {
  const portBySector  = Object.fromEntries((e.sector_data?.portfolio ?? []).map(s => [s.sector, s]))
  const etfBySector   = Object.fromEntries((e.sector_data?.etf ?? []).map(s => [s.sector, s]))
  const sectorsSorted = Array.from(new Set([
    ...(e.sector_data?.portfolio.map(s => s.sector) ?? []),
    ...(e.sector_data?.etf.map(s => s.sector) ?? []),
  ])).sort((a, b) => (portBySector[b]?.weight ?? 0) - (portBySector[a]?.weight ?? 0))

  const adRatio = e.advances != null && e.declines != null && e.declines > 0
    ? (e.advances / e.declines).toFixed(2) : null

  const col4 = 'grid grid-cols-[minmax(0,2fr)_minmax(4rem,1fr)_minmax(4rem,1fr)_minmax(4rem,1fr)]'

  return (
    <article className="border border-gray-200 p-5">
      {/* Header */}
      <div className="flex items-baseline justify-between border-b border-gray-100 pb-3 mb-4">
        <div>
          <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest">
            Daily Performance Report
          </p>
          <p className="font-space-mono text-xs font-bold uppercase tracking-tight mt-0.5">
            {fmtDate(e.date)}
          </p>
        </div>
        {e.cumulative_return != null && (
          <div className="text-right">
            <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest">Cumulative</p>
            <p className={`font-space-mono text-sm font-bold ${e.cumulative_return >= 100 ? 'text-black' : 'text-red-700'}`}>
              {e.cumulative_return.toFixed(2)}
            </p>
          </div>
        )}
      </div>

      {/* Daily returns table */}
      <div className="mb-5">
        <div className={`${col4} mb-1`}>
          {[e.live_portfolio_name, 'S&P 500', e.foundational_ticker, 'A / D'].map((h, i) => (
            <p key={h} className={`font-plex-mono text-[10px] font-bold uppercase tracking-widest truncate ${i > 0 ? 'text-right' : ''}`}>{h}</p>
          ))}
        </div>
        <div className={col4}>
          {[
            { value: e.portfolio_return, render: pct(e.portfolio_return) },
            { value: e.sp500_return,     render: pct(e.sp500_return)     },
            { value: e.etf_return,       render: pct(e.etf_return)       },
            { value: adRatio != null ? (e.advances! / e.declines!) - 1 : null, render: adRatio ?? '—' },
          ].map(({ value, render }, i) => (
            <p key={i} className={`font-plex-mono text-sm tabular-nums ${pctColor(value)} ${i > 0 ? 'text-right' : ''}`}>
              {render}
            </p>
          ))}
        </div>
      </div>

      {/* Top gainers / losers */}
      <div className="grid grid-cols-2 gap-6 mb-5">
        {[
          { label: 'Top Gainers', items: e.top_gainers, pos: true  },
          { label: 'Top Losers',  items: e.top_losers,  pos: false },
        ].map(({ label, items, pos }) => (
          <div key={label}>
            <p className="font-plex-mono text-[10px] font-bold uppercase tracking-widest mb-2">{label}</p>
            <div className="space-y-1">
              {(items || []).map((h) => (
                <div key={h.ticker} className="grid grid-cols-[auto_1fr_auto] gap-x-2 items-baseline">
                  <span className="font-plex-mono text-xs font-bold">{h.ticker}</span>
                  <span className="font-plex-mono text-[10px] text-gray-400 truncate">{h.name}</span>
                  <span className={`font-plex-mono text-xs tabular-nums ${pos ? 'text-black' : 'text-red-700'}`}>
                    {h.return_pct >= 0 ? '+' : ''}{h.return_pct.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Sector returns vs S&P sector ETFs */}
      {e.sector_data == null && (
        <div className="border-t border-gray-100 pt-4">
          <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest">
            Sector data unavailable for this date
          </p>
        </div>
      )}
      {sectorsSorted.length > 0 && (
        <div className="border-t border-gray-100 pt-4">
          <p className="font-plex-mono text-[10px] font-bold uppercase tracking-widest mb-3">
            Sector Returns — vs S&P Sectors
          </p>
          <div className="space-y-1">
            <div className="grid grid-cols-[minmax(0,1fr)_5rem_5rem_4rem] pb-1 border-b border-gray-100">
              {['Sector', 'Portfolio', 'S&P ETF', 'Wt'].map((h, i) => (
                <p key={h} className={`font-plex-mono text-[9px] font-bold uppercase tracking-widest ${i > 0 ? 'text-right' : ''}`}>{h}</p>
              ))}
            </div>
            {sectorsSorted.map((sector) => {
              const port = portBySector[sector]
              const etf  = etfBySector[sector]
              return (
                <div key={sector} className="grid grid-cols-[minmax(0,1fr)_5rem_5rem_4rem] items-baseline">
                  <span className="font-plex-mono text-[10px] text-gray-700 truncate pr-2">{sector}</span>
                  <span className={`font-plex-mono text-[10px] tabular-nums text-right ${pctColor(port?.return_pct ?? null)}`}>
                    {port?.return_pct != null ? `${port.return_pct >= 0 ? '+' : ''}${port.return_pct.toFixed(2)}%` : '—'}
                  </span>
                  <span className={`font-plex-mono text-[10px] tabular-nums text-right ${pctColor(etf?.return_pct ?? null)}`}>
                    {etf?.return_pct != null ? `${etf.return_pct >= 0 ? '+' : ''}${etf.return_pct.toFixed(2)}%` : '—'}
                  </span>
                  <span className="font-plex-mono text-[10px] tabular-nums text-gray-400 text-right">
                    {port ? `${(port.weight * 100).toFixed(1)}%` : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </article>
  )
}

function BlogCard({ e, onDelete }: { e: BlogEntry; onDelete: (id: number) => void }) {
  return (
    <article className="border border-gray-200 p-5">
      <div className="flex items-baseline justify-between border-b border-gray-100 pb-3 mb-4">
        <div>
          <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest">Commentary</p>
          <p className="font-space-mono text-xs font-bold uppercase tracking-tight mt-0.5">
            {e.title || fmtDate(e.date)}
          </p>
          {e.title && (
            <p className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest mt-0.5">
              {fmtDate(e.date)}
            </p>
          )}
        </div>
        <button
          onClick={() => { if (confirm('Delete this post?')) onDelete(e.id) }}
          className="font-plex-mono text-[10px] text-gray-300 hover:text-red-700 uppercase tracking-widest ml-4 flex-shrink-0"
        >
          Delete
        </button>
      </div>
      <div className="font-plex-mono text-xs text-gray-800 leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]}
          components={{
            p:      ({ children }) => <p className="mb-2">{children}</p>,
            strong: ({ children }) => <strong className="font-bold text-black">{children}</strong>,
            em:     ({ children }) => <em className="italic">{children}</em>,
            ul:     ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
            ol:     ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
            li:     ({ children }) => <li>{children}</li>,
          }}
        >{e.content}</ReactMarkdown>
      </div>
    </article>
  )
}

function WriteForm({ onSaved }: { onSaved: (entry: BlogEntry) => void }) {
  const [open,    setOpen]    = useState(false)
  const [title,   setTitle]   = useState('')
  const [content, setContent] = useState('')
  const [saving,  setSaving]  = useState(false)

  async function handleSave() {
    if (!content.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/notes`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ title: title.trim() || null, content: content.trim() }),
      })
      if (res.ok) {
        const row = await res.json()
        onSaved({ kind: 'blog', ...row })
        setTitle(''); setContent(''); setOpen(false)
      }
    } finally { setSaving(false) }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="font-plex-mono text-xs border border-black px-4 py-1.5 uppercase tracking-widest hover:bg-black hover:text-white"
      >
        + Write Post
      </button>
    )
  }

  return (
    <div className="border border-black p-5 space-y-3">
      <input
        type="text"
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full font-space-mono text-sm border-b border-gray-200 pb-1 bg-transparent focus:outline-none focus:border-black uppercase tracking-tight"
      />
      <textarea
        placeholder="Write in plain text or markdown…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={6}
        className="w-full font-plex-mono text-xs bg-transparent border border-gray-200 p-3 focus:outline-none focus:border-black resize-y"
      />
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !content.trim()}
          className="font-plex-mono text-xs border border-black px-4 py-1.5 uppercase tracking-widest bg-black text-white hover:bg-gray-800 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Publish'}
        </button>
        <button
          onClick={() => setOpen(false)}
          className="font-plex-mono text-xs border border-black px-4 py-1.5 uppercase tracking-widest hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NotesPage() {
  const router = useRouter()
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!isAuthenticated()) { router.replace('/'); return }
    loadAll()
  }, [])

  async function loadAll() {
    const safeFetch = async (url: string) => {
      try { const r = await fetch(url); return r.ok ? r.json() : [] }
      catch { return [] }
    }

    const [perfRaw, blogRaw] = await Promise.all([
      safeFetch(`${API_BASE}/public/performance`),
      safeFetch(`${API_BASE}/notes`),
    ])

    const perf: PerfEntry[] = (perfRaw as any[]).map((r) => ({ kind: 'performance' as const, ...r }))
    const blog: BlogEntry[] = (blogRaw as any[]).map((r) => ({ kind: 'blog'        as const, ...r }))

    const merged = [...perf, ...blog].sort((a, b) => {
      if (b.date !== a.date) return b.date > a.date ? 1 : -1
      if (a.kind === 'performance' && b.kind === 'blog') return 1
      if (a.kind === 'blog' && b.kind === 'performance') return -1
      return 0
    })
    setEntries(merged)
    setLoading(false)
  }

  function handleBlogSaved(entry: BlogEntry) {
    setEntries((prev) => {
      const updated = [...prev, entry]
      return updated.sort((a, b) => {
        if (b.date !== a.date) return b.date > a.date ? 1 : -1
        if (a.kind === 'performance' && b.kind === 'blog') return 1
        if (a.kind === 'blog' && b.kind === 'performance') return -1
        return 0
      })
    })
  }

  function handleBlogDeleted(id: number) {
    fetch(`${API_BASE}/notes/${id}`, { method: 'DELETE' })
    setEntries((prev) => prev.filter((e) => !(e.kind === 'blog' && e.id === id)))
  }

  // Chart data — all three series indexed to 100 at inception.
  // Filter to rows where VOO has a return: null sp500_return means FMP had no data
  // (market holiday or cron fired before close), so those days are excluded entirely.
  const perfRows = entries.filter((e): e is PerfEntry => e.kind === 'performance')
  const chartData = (() => {
    let sp500 = 100, etf = 100
    return [...perfRows].reverse()
      .filter((r) => r.sp500_return != null)
      .map((r) => ({
        date:      r.date,
        portfolio: r.cumulative_return ?? null,
        sp500:     (sp500 = +(sp500 * (1 + r.sp500_return!)).toFixed(4)),
        etf:       r.etf_return != null ? (etf = +(etf * (1 + r.etf_return)).toFixed(4)) : null,
      }))
  })()

  const livePortfolioName = perfRows[0]?.live_portfolio_name ?? 'Live Portfolio'
  const etfTicker         = perfRows[0]?.foundational_ticker ?? ''

  return (
    <LandingLayout>
      <div className="mb-8">
        <h2 className="font-space-mono text-lg font-bold uppercase tracking-tight mb-1">Notes</h2>
        <p className="font-plex-mono text-xs text-gray-500 uppercase tracking-widest">
          Performance journal · Research · Commentary
        </p>
      </div>

      {/* Cumulative performance chart — pinned at top */}
      {chartData.length > 0 && (
        <div className="border border-gray-200 p-5 mb-8">
          <PerformanceChart data={chartData} etfTicker={etfTicker} portfolioName={livePortfolioName} />
        </div>
      )}

      {/* Feed header with write button */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-space-mono text-xs uppercase tracking-widest text-gray-500">Feed</h3>
        <WriteForm onSaved={handleBlogSaved} />
      </div>

      {loading ? (
        <p className="font-plex-mono text-xs text-gray-400 uppercase tracking-widest">Loading…</p>
      ) : entries.length === 0 ? (
        <div className="border border-gray-200 p-8 text-center">
          <p className="font-plex-mono text-xs text-gray-400 uppercase tracking-widest">
            No entries yet — write a post or designate a Live Portfolio to start tracking performance.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {entries.map((e, i) =>
            e.kind === 'performance'
              ? <PerformanceCard key={`perf-${e.date}`} e={e} />
              : <BlogCard key={`blog-${e.id}`} e={e} onDelete={handleBlogDeleted} />
          )}
        </div>
      )}
    </LandingLayout>
  )
}
