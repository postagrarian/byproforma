'use client'
import { ETFConfig, ETFResult } from '@/types'
import SettingsDrawer     from './SettingsDrawer'
import ETFHeader          from './ETFHeader'
import SectorTable        from './SectorTable'
import FactorTable        from './FactorTable'
import PortfolioTable     from './PortfolioTable'
import SectorDriftChart   from '@/components/charts/SectorDriftChart'
import FactorBarChart     from '@/components/charts/FactorBarChart'
import { getPortfolio } from '@/lib/api'

interface Props {
  config:           ETFConfig
  result:           ETFResult | null
  onConfigSaved:    (slot: number, ticker: string) => void
  onResultUpdated:  (result: ETFResult) => void
}

function mapResult(row: any): ETFResult {
  return {
    slot:           row.slot,
    ticker:         row.etf_ticker,
    runDate:        row.run_date,
    sectorWeights:  row.sector_weights  ?? [],
    factorLoadings: row.factor_loadings ?? [],
    portfolio:      row.portfolio       ?? [],
    factorRmse:     row.factor_rmse     ?? 0,
    maxSectorDiff:  row.max_sector_diff ?? 0,
    etfR2:          row.etf_r2          ?? null,
    portfolioR2:    row.portfolio_r2    ?? null,
    etfOverview:    row.etf_overview    ?? null,
  }
}

export default function ETFTab({ config, result, onConfigSaved, onResultUpdated }: Props) {

  async function handleRunComplete() {
    const data = await getPortfolio(config.slot)
    if (data) {
      const mapped = mapResult(data)
      onResultUpdated(mapped)   // update parent so tab switching preserves it
    }
  }

  if (!config.isConfigured) {
    return (
      <div className="p-6">
        <p className="font-plex-mono text-sm text-gray-500 mb-4 uppercase tracking-widest">
          No ETF configured for this slot.
        </p>
        <SettingsDrawer
          slot={config.slot}
          currentTicker=""
          lastRunDate={null}
          onSaved={(t) => onConfigSaved(config.slot, t)}
          onRunComplete={handleRunComplete}
        />
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <ETFHeader
            ticker={config.ticker}
            overview={result?.etfOverview ?? null}
            runDate={result?.runDate ?? null}
          />
        </div>
        <div className="pt-1 flex-shrink-0">
          <SettingsDrawer
            slot={config.slot}
            currentTicker={config.ticker}
            lastRunDate={config.lastRunDate}
            onSaved={(t) => onConfigSaved(config.slot, t)}
            onRunComplete={handleRunComplete}
          />
        </div>
      </div>

      {!result ? (
        <p className="font-plex-mono text-sm text-gray-500 uppercase tracking-widest">
          No results yet — click Configure → Run Now to generate the first portfolio.
        </p>
      ) : (
        <div className="space-y-8">
          {/* Row 1: tables */}
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <SectorTable rows={result.sectorWeights}  etfTicker={config.ticker} />
            <FactorTable rows={result.factorLoadings} etfTicker={config.ticker} rmse={result.factorRmse} etfR2={result.etfR2} portfolioR2={result.portfolioR2} />
          </div>
          {/* Row 2: charts — aligned because they share the same row */}
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            <SectorDriftChart rows={result.sectorWeights} />
            <FactorBarChart   rows={result.factorLoadings} etfTicker={config.ticker} />
          </div>
          {/* Row 3: portfolio */}
          <PortfolioTable holdings={result.portfolio} />
        </div>
      )}
    </div>
  )
}
