import { PortfolioHolding } from '@/types'

interface Props { holdings: PortfolioHolding[] }

function pct(n: number) { return (n * 100).toFixed(1) + '%' }
function f3(n: number)   { return n.toFixed(3) }

export default function PortfolioTable({ holdings }: Props) {
  const active = [...holdings]
    .filter((h) => h.weight > 0.005)
    .sort((a, b) => b.weight - a.weight)

  return (
    <div>
      <h2 className="font-space-mono text-xs uppercase tracking-widest mb-2">
        Replicating Portfolio — {active.length} Positions
      </h2>
      <table className="w-full font-plex-mono text-xs border-collapse">
        <thead>
          <tr className="border-b border-black">
            {['Ticker','Weight','Sector','R²','Mkt-RF','SMB','HML','RMW','CMA','Mom'].map((h) => (
              <th key={h} className="text-right first:text-left py-1 px-2 font-normal uppercase tracking-widest">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {active.map((h) => (
            <tr key={h.ticker} className="border-b border-gray-200">
              <td className="py-1 px-2 font-bold">{h.ticker}</td>
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
