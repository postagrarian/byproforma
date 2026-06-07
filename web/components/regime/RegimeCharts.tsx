'use client'
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, ReferenceLine, ResponsiveContainer,
  Tooltip, Cell,
} from 'recharts'

// ── Shared helpers ────────────────────────────────────────────────────────────

function dateTick(d: string) {
  const dt = new Date(d + 'T00:00:00')
  return dt.getMonth() === 0 ? String(dt.getFullYear()) : ''
}

function shortDate(d: string) {
  return new Date(d + 'T00:00:00')
    .toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

const AXIS = { fontFamily: 'var(--font-plex-mono)', fontSize: 9, fill: '#9ca3af' }

function Tip({ active, payload, label, fmt }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#F7F6F2] border border-black px-2 py-1 font-plex-mono text-[10px] uppercase tracking-widest">
      <div className="text-gray-400 mb-0.5">{shortDate(label)}</div>
      {payload.filter((p: any) => p.value != null).map((p: any) => (
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
      <div className="py-1">{children}</div>
    </div>
  )
}

function dataDomain(
  values: (number | null | undefined)[],
  pad = 0.1,
): [number, number] {
  const nums = values.filter((v) => v != null && !isNaN(v as number)) as number[]
  if (!nums.length) return [0, 1]
  const mn = Math.min(...nums)
  const mx = Math.max(...nums)
  const rng = mx - mn || 1
  return [+(mn - rng * pad).toFixed(3), +(mx + rng * pad).toFixed(3)]
}

// ── Charts ────────────────────────────────────────────────────────────────────

export function CLIChart({ data }: { data: { date: string; value: number }[] }) {
  const domain = dataDomain(data.map((d) => d.value), 0.05)
  return (
    <Panel title="OECD CLI" desc="US Composite Leading Indicator — Growth Signal">
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 8, right: 48, bottom: 4, left: 0 }}>
          <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false}
            tickFormatter={dateTick} interval="preserveStartEnd" />
          <YAxis orientation="right" domain={domain} tickFormatter={(v) => v.toFixed(1)}
            tick={AXIS} axisLine={false} tickLine={false} width={36} />
          <Tooltip content={<Tip fmt={(v: number) => v.toFixed(2)} />} cursor={{ stroke: '#e5e7eb' }} />
          <ReferenceLine y={100} stroke="#9ca3af" strokeWidth={0.75} strokeDasharray="3 3" />
          <Area dataKey="value" stroke="#1a1a1a" strokeWidth={1.2} fill="#1a1a1a" fillOpacity={0.06} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </Panel>
  )
}

// CPI chart shows YoY % change vs 3-year rolling average — avoids the flat-line
// problem of absolute index levels (~330) with tiny differences
export function CPIChart({ data }: { data: { date: string; yoy: number; avg3yr: number }[] }) {
  const domain = dataDomain([...data.map((d) => d.yoy), ...data.map((d) => d.avg3yr)], 0.08)
  return (
    <Panel title="CPI YoY" desc="Year-over-year inflation vs 3yr avg — Inflation Signal">
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 8, right: 48, bottom: 4, left: 0 }}>
          <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false}
            tickFormatter={dateTick} interval="preserveStartEnd" />
          <YAxis orientation="right" domain={domain} tickFormatter={(v) => `${v.toFixed(1)}%`}
            tick={AXIS} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={<Tip fmt={(v: number) => `${v.toFixed(2)}%`} />} cursor={{ stroke: '#e5e7eb' }} />
          <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={0.5} />
          <Line dataKey="yoy"    name="YoY"      stroke="#1a1a1a" strokeWidth={1.2} dot={false} connectNulls />
          <Line dataKey="avg3yr" name="3yr avg"  stroke="#b91c1c" strokeWidth={1}   dot={false} strokeDasharray="4 2" connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  )
}

export function YieldCurveChart({ data }: { data: { date: string; value: number }[] }) {
  const domain = dataDomain(data.map((d) => d.value), 0.1)
  return (
    <Panel title="Yield Curve" desc="10yr − 2yr Treasury spread (T10Y2YM) — Growth Signal">
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 8, right: 48, bottom: 4, left: 0 }} barCategoryGap="3%">
          <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false}
            tickFormatter={dateTick} interval="preserveStartEnd" />
          <YAxis orientation="right" domain={domain} tickFormatter={(v) => `${v.toFixed(1)}%`}
            tick={AXIS} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={<Tip fmt={(v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`} />}
            cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
          <ReferenceLine y={0} stroke="#000" strokeWidth={0.75} />
          <Bar dataKey="value" name="Spread" maxBarSize={14} radius={0}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.value >= 0 ? '#1a1a1a' : '#b91c1c'} opacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  )
}

export function HYSpreadChart({ data }: { data: { date: string; value: number }[] }) {
  const domain = dataDomain(data.map((d) => d.value), 0.05)
  const floor  = Math.max(0, (domain[0] as number) - 0.2)
  return (
    <Panel title="HY Spread" desc="ICE BofA US High-Yield OAS — Risk Appetite Signal">
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 8, right: 48, bottom: 4, left: 0 }}>
          <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false}
            tickFormatter={dateTick} interval="preserveStartEnd" />
          <YAxis orientation="right" domain={[floor, domain[1]]}
            tickFormatter={(v) => `${v.toFixed(1)}%`}
            tick={AXIS} axisLine={false} tickLine={false} width={40} />
          <Tooltip content={<Tip fmt={(v: number) => `${v.toFixed(2)}%`} />} cursor={{ stroke: '#e5e7eb' }} />
          <ReferenceLine y={4} stroke="#9ca3af" strokeDasharray="3 3" strokeWidth={0.75} label={{ value: '4%', position: 'right', fontSize: 8, fill: '#9ca3af', fontFamily: 'var(--font-plex-mono)' }} />
          <Area dataKey="value" name="HY OAS" stroke="#b91c1c" strokeWidth={1.2}
            fill="#b91c1c" fillOpacity={0.07} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </Panel>
  )
}
