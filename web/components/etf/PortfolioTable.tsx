'use client'
import { useState } from 'react'
import { PortfolioHolding } from '@/types'

interface Props { holdings: PortfolioHolding[]; sortable?: boolean }

function pct(n: number) { return (n * 100).toFixed(1) + '%' }
function f3(n: number)   { return n.toFixed(3) }

type SortKey = 'ticker' | 'name' | 'weight' | 'sector' | 'r2' | 'betaMkt' | 'betaSmb' | 'betaHml' | 'betaRmw' | 'betaCma' | 'betaMom'

const COLS: { label: string; key: SortKey; num?: boolean }[] = [
  { label: 'Ticker',  key: 'ticker'  },
  { label: 'Company', key: 'name'    },
  { label: 'Weight',  key: 'weight',  num: true },
  { label: 'Sector',  key: 'sector'  },
  { label: 'R²',      key: 'r2',      num: true },
  { label: 'Mkt-RF',  key: 'betaMkt', num: true },
  { label: 'SMB',     key: 'betaSmb', num: true },
  { label: 'HML',     key: 'betaHml', num: true },
  { label: 'RMW',     key: 'betaRmw', num: true },
  { label: 'CMA',     key: 'betaCma', num: true },
  { label: 'Mom',     key: 'betaMom', num: true },
]

export default function PortfolioTable({ holdings, sortable = false }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('weight')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function handleSort(key: SortKey, isNum?: boolean) {
    if (!sortable) return
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir(isNum ? 'desc' : 'asc')
    }
  }

  const active = [...holdings]
    .filter((h) => h.weight > 0.005)
    .sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      const cmp = typeof av === 'string' && typeof bv === 'string'
        ? av.localeCompare(bv)
        : (av as number) - (bv as number)
      return sortDir === 'asc' ? cmp : -cmp
    })

  return (
    <div>
      <h2 className="font-space-mono text-xs uppercase tracking-widest mb-2">
        Replicating Portfolio — {active.length} Positions
      </h2>
      <table className="w-full font-plex-mono text-xs border-collapse">
        <thead>
          <tr className="border-b border-black">
            {COLS.map(({ label, key, num }, i) => {
              const active = sortable && sortKey === key
              return (
                <th
                  key={key}
                  onClick={() => handleSort(key, num)}
                  className={[
                    'py-1 px-2 font-bold uppercase tracking-widest',
                    i === 0 ? 'text-left' : 'text-right',
                    sortable ? 'cursor-pointer select-none hover:text-black' : 'font-normal',
                    active ? 'text-black' : 'text-gray-400',
                  ].join(' ')}
                >
                  {label}
                  {active && <span className="ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {active.map((h) => (
            <tr key={h.ticker} className="border-b border-gray-200">
              <td className="py-1 px-2 font-bold">{h.ticker}</td>
              <td className="px-2 text-gray-600 max-w-[180px] truncate">{h.name}</td>
              <td className="text-right px-2">{pct(h.weight)}</td>
              <td className="text-right px-2">{h.sector}</td>
              <td className="text-right px-2">{f3(h.r2)}</td>
              <td className="text-right px-2">{f3(h.betaMkt)}</td>
              <td className="text-right px-2">{f3(h.betaSmb)}</td>
              <td className="text-right px-2">{f3(h.betaHml)}</td>
              <td className="text-right px-2">{f3(h.betaRmw)}</td>
              <td className="text-right px-2">{f3(h.betaCma)}</td>
              <td className="text-right px-2">{f3(h.betaMom)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
