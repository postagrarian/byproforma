import { SectorWeight } from '@/types'

interface Props {
  rows: SectorWeight[]
  etfTicker: string
}

function fmt(n: number) { return (n * 100).toFixed(1) + '%' }
function diffColor(d: number) {
  if (Math.abs(d) <= 0.03) return 'text-black'
  return d > 0 ? 'text-green-700' : 'text-red-700'
}

export default function SectorTable({ rows, etfTicker }: Props) {
  const sorted = [...rows].sort((a, b) => b.etfWeight - a.etfWeight)
  return (
    <div>
      <h2 className="font-space-mono text-xs uppercase tracking-widest mb-2">
        Sector Weights
      </h2>
      <table className="w-full font-plex-mono text-xs border-collapse">
        <thead>
          <tr className="border-b border-black">
            <th className="text-left py-1 pr-4 font-normal uppercase tracking-widest">Sector</th>
            <th className="text-right py-1 px-3 font-normal uppercase tracking-widest">{etfTicker}</th>
            <th className="text-right py-1 px-3 font-normal uppercase tracking-widest">Portfolio</th>
            <th className="text-right py-1 pl-3 font-normal uppercase tracking-widest">Diff</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.sector} className="border-b border-gray-200">
              <td className="py-1 pr-4">{r.sector}</td>
              <td className="text-right px-3">{fmt(r.etfWeight)}</td>
              <td className="text-right px-3">{fmt(r.portfolioWeight)}</td>
              <td className={`text-right pl-3 ${diffColor(r.diff)}`}>
                {r.diff >= 0 ? '+' : ''}{fmt(r.diff)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
