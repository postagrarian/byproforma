'use client'
import { SavedTilt, ETFConfig } from '@/types'
import SectorTable      from '@/components/etf/SectorTable'
import FactorTable      from '@/components/etf/FactorTable'
import PortfolioTable   from '@/components/etf/PortfolioTable'
import SectorDriftChart from '@/components/charts/SectorDriftChart'
import FactorBarChart   from '@/components/charts/FactorBarChart'

interface Props {
  tilt:    SavedTilt
  configs: ETFConfig[]
  onDelete: (id: number) => void
}

export default function SavedTiltTab({ tilt, configs, onDelete }: Props) {
  const foundTicker = configs.find((c) => c.slot === tilt.foundationalSlot)?.ticker
    ?? tilt.foundationalTicker

  return (
    <div className="p-6">

      {/* Header */}
      <div className="border-b border-[#7a0000] pb-4 mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-baseline gap-3 mb-1">
            <span className="font-space-mono text-2xl font-bold uppercase tracking-tight text-[#7a0000]">
              {tilt.name}
            </span>
            <span className="font-plex-mono text-xs text-gray-400 uppercase tracking-widest">
              Saved Tilt
            </span>
          </div>
          <div className="font-plex-mono text-xs text-gray-500 space-x-4 uppercase tracking-widest">
            <span>Baseline: {foundTicker}</span>
            <span>Mode: {tilt.optimizationMode.replace('_', ' ')}</span>
            <span>Run: {new Date(tilt.runDate).toLocaleDateString()}</span>
            <span>{tilt.portfolio.length} positions</span>
          </div>
        </div>
        <button
          onClick={() => {
            if (confirm(`Delete "${tilt.name}"?`)) onDelete(tilt.id)
          }}
          className="font-plex-mono text-xs border border-black px-3 py-1 hover:bg-red-700 hover:text-white hover:border-red-700 uppercase tracking-widest text-gray-500 flex-shrink-0"
        >
          Delete
        </button>
      </div>

      {/* Results */}
      <div className="space-y-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <SectorTable rows={tilt.sectorWeights}  etfTicker={foundTicker} />
          <FactorTable
            rows={tilt.factorLoadings}
            etfTicker={foundTicker}
            rmse={tilt.factorRmse}
            etfR2={tilt.etfR2}
            portfolioR2={tilt.portfolioR2}
          />
        </div>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <SectorDriftChart rows={tilt.sectorWeights} />
          <FactorBarChart   rows={tilt.factorLoadings} etfTicker={foundTicker} />
        </div>
        <PortfolioTable holdings={tilt.portfolio} />
      </div>
    </div>
  )
}
