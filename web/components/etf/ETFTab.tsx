'use client'
import { ETFConfig, ETFResult } from '@/types'
import SettingsDrawer     from './SettingsDrawer'
import SectorTable        from './SectorTable'
import FactorTable        from './FactorTable'
import PortfolioTable     from './PortfolioTable'
import SectorDriftChart   from '@/components/charts/SectorDriftChart'
import FactorRadarChart   from '@/components/charts/FactorRadarChart'
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
      <div className="flex items-baseline justify-between mb-6 border-b border-black pb-3">
        <div>
          <span className="font-space-mono text-2xl font-bold uppercase tracking-tight">
            {config.ticker}
          </span>
          {result && (
            <span className="font-plex-mono text-xs text-gray-500 ml-4 uppercase tracking-widest">
              Run: {new Date(result.runDate).toLocaleDateString()}
            </span>
          )}
        </div>
        <SettingsDrawer
          slot={config.slot}
          currentTicker={config.ticker}
          lastRunDate={config.lastRunDate}
          onSaved={(t) => onConfigSaved(config.slot, t)}
          onRunComplete={handleRunComplete}
        />
      </div>

      {!result ? (
        <p className="font-plex-mono text-sm text-gray-500 uppercase tracking-widest">
          No results yet — click Configure → Run Now to generate the first portfolio.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div className="space-y-8">
            <SectorTable      rows={result.sectorWeights}  etfTicker={config.ticker} />
            <SectorDriftChart rows={result.sectorWeights} />
          </div>
          <div className="space-y-8">
            <FactorTable      rows={result.factorLoadings} etfTicker={config.ticker} rmse={result.factorRmse} etfR2={result.etfR2} portfolioR2={result.portfolioR2} />
            <FactorRadarChart rows={result.factorLoadings} etfTicker={config.ticker} />
          </div>
          <div className="lg:col-span-2">
            <PortfolioTable holdings={result.portfolio} />
          </div>
        </div>
      )}
    </div>
  )
}
