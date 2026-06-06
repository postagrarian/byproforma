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
      // Load slot configurations
      const rows = await getAllConfigs()
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

      // Load latest portfolio result for each configured slot
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
    setConfigs((prev) =>
      prev.map((c) => c.slot === slot ? { ...c, ticker, isConfigured: true } : c)
    )
  }

  const active = configs.find((c) => c.slot === activeSlot)!

  return (
    <div className="min-h-screen bg-[#F7F6F2]">
      <Header />
      <TabBar configs={configs} activeSlot={activeSlot} onSelect={setActiveSlot} />
      <main>
        <ETFTab
          key={activeSlot}
          config={active}
          result={results[activeSlot] ?? null}
          onConfigSaved={handleConfigSaved}
        />
      </main>
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
  }
}
