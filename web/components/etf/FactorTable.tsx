import { FactorLoading } from '@/types'

interface Props {
  rows: FactorLoading[]
  etfTicker: string
  rmse: number
}

function fmt4(n: number) { return n.toFixed(4) }
function diffColor(d: number) {
  if (Math.abs(d) < 0.05) return 'text-black'
  return d > 0 ? 'text-green-700' : 'text-red-700'
}

export default function FactorTable({ rows, etfTicker, rmse }: Props) {
  return (
    <div>
      <h2 className="font-space-mono text-xs uppercase tracking-widest mb-2">
        Factor Loadings
      </h2>
      <table className="w-full font-plex-mono text-xs border-collapse">
        <thead>
          <tr className="border-b border-black">
            <th className="text-left py-1 pr-4 font-normal uppercase tracking-widest">Factor</th>
            <th className="text-right py-1 px-3 font-normal uppercase tracking-widest">{etfTicker}</th>
            <th className="text-right py-1 px-3 font-normal uppercase tracking-widest">Portfolio</th>
            <th className="text-right py-1 pl-3 font-normal uppercase tracking-widest">Diff</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.factor} className="border-b border-gray-200">
              <td className="py-1 pr-4">{r.factor}</td>
              <td className="text-right px-3">{fmt4(r.etfBeta)}</td>
              <td className="text-right px-3">{fmt4(r.portfolioBeta)}</td>
              <td className={`text-right pl-3 ${diffColor(r.diff)}`}>
                {r.diff >= 0 ? '+' : ''}{fmt4(r.diff)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="font-plex-mono text-xs text-gray-500 mt-2 uppercase tracking-widest">
        Factor RMSE: {rmse.toFixed(5)}
      </div>
    </div>
  )
}
