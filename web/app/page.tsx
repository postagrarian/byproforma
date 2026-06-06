'use client'
import { useEffect, useState } from 'react'
import Header from '@/components/layout/Header'
import TabBar from '@/components/layout/TabBar'
import ETFTab from '@/components/etf/ETFTab'
import { getAllConfigs, getPortfolio } from '@/lib/api'
import { ETFConfig, ETFResult } from '@/types'

const EMPTY_CONFIGS: ETFConfig[] = [1, 2, 3, 4, 5].map((slot) => ({
  slot,
  ticker: '',
  lastRunDate: null,
  isConfigured: false,
}))

export default function Home() {
  const [activeSlot, setActiveSlot] = useState(1)
  const [configs,    setConfigs]    = useState<ETFConfig[]>(EMPTY_CONFIGS)
  const [results,    setResults]    = useState<Record<number, ETFResult | null>>({})

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    try {
      const rows   = await getAllConfigs()
      const merged = EMPTY_CONFIGS.map((empty) => {
        const saved = rows.find((r) => r.slot === empty.slot)
        if (!saved?.ticker) return empty
        return {
          slot:         saved.slot,
          ticker:       saved.ticker,
          lastRunDate:  saved.last_run_date ?? null,
          isConfigured: true,
        }
      })
      setConfigs(merged)

      const entries = await Promise.all(
        merged
          .filter((c) => c.isConfigured)
          .map(async (c) => {
            const data = await getPortfolio(c.slot)
            return [c.slot, data ? mapResult(data) : null] as [number, ETFResult | null]
          })
      )
      setResults(Object.fromEntries(entries))
    } catch (e) {
      console.error('Failed to load dashboard data', e)
    }
  }

  function handleConfigSaved(slot: number, ticker: string) {
    if (!ticker) {
      // Slot was cleared
      setConfigs((prev) =>
        prev.map((c) => c.slot === slot
          ? { ...c, ticker: '', isConfigured: false, lastRunDate: null }
          : c)
      )
      setResults((prev) => ({ ...prev, [slot]: null }))
    } else {
      setConfigs((prev) =>
        prev.map((c) => c.slot === slot ? { ...c, ticker, isConfigured: true } : c)
      )
    }
  }

  // Called by ETFTab when a pipeline run completes — updates parent results
  // so switching tabs doesn't lose the fresh data
  function handleResultUpdated(slot: number, result: ETFResult) {
    setResults((prev) => ({ ...prev, [slot]: result }))
  }

  const active = configs.find((c) => c.slot === activeSlot)!

  return (
    <div className="min-h-screen bg-[#F7F6F2]">
      <div className="max-w-[1400px] mx-auto px-8 pt-6">
      <Header />
      <TabBar configs={configs} activeSlot={activeSlot} onSelect={setActiveSlot} />
      <main>
        <ETFTab
          key={activeSlot}
          config={active}
          result={results[activeSlot] ?? null}
          onConfigSaved={handleConfigSaved}
          onResultUpdated={(r) => handleResultUpdated(activeSlot, r)}
        />
      </main>
      </div>
    </div>
  )
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
