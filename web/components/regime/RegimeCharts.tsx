'use client'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, ReferenceLine, ResponsiveContainer,
  Tooltip, Cell,
} from 'recharts'

function dateTick(d: string) {
  const dt = new Date(d + 'T00:00:00')
  return dt.getMonth() === 0 ? String(dt.getFullYear()) : ''
}

function shortDate(d: string) {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

const TIP = ({ active, payload, label, fmt }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#F7F6F2] border border-black px-2 py-1 font-plex-mono text-[10px] uppercase tracking-widest">
      <div className="text-gray-400">{shortDate(label)}</div>
      {payload.map((p: any) => p.value != null && (
        <div key={p.dataKey} style={{ color: p.color ?? '#000' }}>
          {p.name}: {fmt ? fmt(p.value) : p.value.toFixed(2)}
        </div>
      ))}
    </div>
  )
}

function Panel({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200">
      <div className="flex items-baseline gap-2 px-3 pt-3 pb-2 border-b border-gray-100 bg-white">
        <span className="font-space-mono text-sm font-normal uppercase tracking-tight">{title}</span>
        <span className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-widest">{desc}</span>
      </div>
      <div className="p-1">{children}</div>
    </div>
  )
}

// ── Individual charts ────────────────────────────────────────────────────────

export function CLIChart({ data }: { data: { date: string; value: number }[] }) {
  const absMax = Math.max(...data.map((d) => Math.abs(d.value - 100)), 2)
  return (
    <Panel title="OECD CLI" desc="US Composite Leading Indicator · Growth Signal">
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 8, right: 48, bottom: 4, left: 0 }}>
          <XAxis dataKey="date" tick={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, fill: '#9ca3af' }}
            axisLine={false} tickLine={false} tickFormatter={dateTick} interval="preserveStartEnd" />
          <YAxis orientation="right" tickFormatter={(v) => v.toFixed(1)}
            tick={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, fill: '#9ca3af' }}
            axisLine={false} tickLine={false} width={36} />
          <Tooltip content={<TIP fmt={(v: number) => v.toFixed(2)} />} cursor={{ stroke: '#ddd' }} />
          <ReferenceLine y={100} stroke="#000" strokeWidth={0.75} strokeDasharray="3 3" />
          <Area dataKey="value" stroke="#1a1a1a" strokeWidth={1.2} fill="#1a1a1a" fillOpacity={0.06} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </Panel>
  )
}

export function CPIChart({ data }: { data: { date: string; value: number; avg3m: number | null; avg36m: number | null }[] }) {
  return (
    <Panel title="CPI Signal" desc="3-month avg vs 36-month avg · Inflation Signal">
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 8, right: 48, bottom: 4, left: 0 }}>
          <XAxis dataKey="date" tick={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, fill: '#9ca3af' }}
            axisLine={false} tickLine={false} tickFormatter={dateTick} interval="preserveStartEnd" />
          <YAxis orientation="right" tickFormatter={(v) => v.toFixed(0)}
            tick={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, fill: '#9ca3af' }}
            axisLine={false} tickLine={false} width={36} />
          <Tooltip content={<TIP fmt={(v: number) => v.toFixed(1)} />} cursor={{ stroke: '#ddd' }} />
          <Line dataKey="avg3m"  name="3m avg"  stroke="#1a1a1a" strokeWidth={1.2} dot={false} connectNulls />
          <Line dataKey="avg36m" name="36m avg" stroke="#b91c1c" strokeWidth={1}   dot={false} strokeDasharray="4 2" connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  )
}

export function YieldCurveChart({ data }: { data: { date: string; value?: number; spread?: number | null }[] }) {
  // Accept either `value` (T10Y2Y from FRED) or `spread` (computed)
  const normalised = data.map((d) => ({ ...d, spread: d.value ?? d.spread ?? null }))
  return (
    <Panel title="Yield Curve" desc="10yr − 2yr spread · Growth/Recession Signal">
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={normalised} margin={{ top: 8, right: 48, bottom: 4, left: 0 }} barCategoryGap="2%">
          <XAxis dataKey="date" tick={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, fill: '#9ca3af' }}
            axisLine={false} tickLine={false} tickFormatter={dateTick} interval="preserveStartEnd" />
          <YAxis orientation="right" tickFormatter={(v) => `${v.toFixed(1)}%`}
            tick={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, fill: '#9ca3af' }}
            axisLine={false} tickLine={false} width={36} />
          <Tooltip content={<TIP fmt={(v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`} />}
            cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
          <ReferenceLine y={0} stroke="#000" strokeWidth={0.75} />
          <Bar dataKey="spread" name="10-2 spread" maxBarSize={12} radius={0}>
            {normalised.map((d, i) => (
              <Cell key={i} fill={(d.spread ?? 0) >= 0 ? '#1a1a1a' : '#b91c1c'} opacity={0.8} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  )
}

export function HYSpreadChart({ data }: { data: { date: string; value: number }[] }) {
  const max = Math.max(...data.map((d) => d.value))
  return (
    <Panel title="HY Spread" desc="ICE BofA US High-Yield OAS · Risk Appetite Signal">
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 8, right: 48, bottom: 4, left: 0 }}>
          <XAxis dataKey="date" tick={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, fill: '#9ca3af' }}
            axisLine={false} tickLine={false} tickFormatter={dateTick} interval="preserveStartEnd" />
          <YAxis orientation="right" domain={[0, max + 0.5]} tickFormatter={(v) => `${v.toFixed(0)}%`}
            tick={{ fontFamily: 'var(--font-plex-mono)', fontSize: 9, fill: '#9ca3af' }}
            axisLine={false} tickLine={false} width={36} />
          <Tooltip content={<TIP fmt={(v: number) => `${v.toFixed(2)}%`} />} cursor={{ stroke: '#ddd' }} />
          <ReferenceLine y={4} stroke="#9ca3af" strokeDasharray="3 3" strokeWidth={0.75} />
          <Area dataKey="value" name="HY OAS" stroke="#b91c1c" strokeWidth={1.2}
            fill="#b91c1c" fillOpacity={0.06} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </Panel>
  )
}
