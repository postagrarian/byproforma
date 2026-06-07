'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter }         from 'next/navigation'
import { isAuthenticated }   from '@/lib/auth'
import Header                from '@/components/layout/Header'
import TabBar                from '@/components/layout/TabBar'
import ETFTab                from '@/components/etf/ETFTab'
import TiltTab               from '@/components/tilt/TiltTab'
import SavedTiltTab          from '@/components/tilt/SavedTiltTab'
import { getAllConfigs, getPortfolio } from '@/lib/api'
import { ETFConfig, ETFResult, SavedTilt } from '@/types'

const API_BASE   = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'
const EMPTY_CONFIGS: ETFConfig[] = [1, 2, 3, 4, 5].map((slot) => ({
  slot, ticker: '', lastRunDate: null, isConfigured: false,
}))

export default function Home() {
  const router = useRouter()
  const [activeTab,   setActiveTab]   = useState<string>('1')
  const [configs,     setConfigs]     = useState<ETFConfig[]>(EMPTY_CONFIGS)
  const [results,     setResults]     = useState<Record<number, ETFResult | null>>({})
  const [savedTilts,  setSavedTilts]  = useState<SavedTilt[]>([])
  const [authed,      setAuthed]      = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) { router.replace('/'); return }
    setAuthed(true)
    loadAll()
  }, [])

  async function loadAll() {
    try {
      const rows   = await getAllConfigs()
      const merged = EMPTY_CONFIGS.map((empty) => {
        const saved = rows.find((r) => r.slot === empty.slot)
        if (!saved?.ticker) return empty
        return { slot: saved.slot, ticker: saved.ticker,
                 lastRunDate: saved.last_run_date ?? null, isConfigured: true }
      })
      setConfigs(merged)

      const entries = await Promise.all(
        merged.filter((c) => c.isConfigured).map(async (c) => {
          const data = await getPortfolio(c.slot)
          return [c.slot, data ? mapResult(data) : null] as [number, ETFResult | null]
        })
      )
      setResults(Object.fromEntries(entries))
    } catch (e) { console.error(e) }

    await loadSavedTilts()
  }

  const loadSavedTilts = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/tilt/saved`)
      if (res.ok) setSavedTilts((await res.json()).map(mapSavedTilt))
    } catch (e) { console.error(e) }
  }, [])

  async function handleDeleteTilt(id: number) {
    await fetch(`${API_BASE}/tilt/${id}`, { method: 'DELETE' })
    setSavedTilts((prev) => prev.filter((t) => t.id !== id))
    // If the deleted tab was active, switch back to Active Tilt
    if (activeTab === `saved_${id}`) setActiveTab('tilt')
  }

  function handleConfigSaved(slot: number, ticker: string) {
    if (!ticker) {
      setConfigs((prev) => prev.map((c) =>
        c.slot === slot ? { ...c, ticker: '', isConfigured: false, lastRunDate: null } : c))
      setResults((prev) => ({ ...prev, [slot]: null }))
    } else {
      setConfigs((prev) => prev.map((c) =>
        c.slot === slot ? { ...c, ticker, isConfigured: true } : c))
    }
  }

  function handleResultUpdated(slot: number, result: ETFResult) {
    setResults((prev) => ({ ...prev, [slot]: result }))
  }

  if (!authed) return null

  const slotNum    = parseInt(activeTab)
  const activeConfig = configs.find((c) => c.slot === slotNum)

  const savedTiltId = activeTab.startsWith('saved_')
    ? parseInt(activeTab.replace('saved_', ''))
    : null
  const activeSavedTilt = savedTilts.find((t) => t.id === savedTiltId) ?? null

  return (
    <div className="min-h-screen bg-[#F7F6F2]">
      <div className="max-w-[1400px] mx-auto px-14 pt-6">
        <Header />
        <TabBar
          configs={configs}
          savedTilts={savedTilts}
          activeTab={activeTab}
          onSelect={setActiveTab}
          onDeleteTilt={handleDeleteTilt}
        />
        <main>
          {activeTab === 'tilt' ? (
            <TiltTab
              configs={configs}
              results={results}
              onTiltSaved={() => { loadSavedTilts() }}
            />
          ) : activeSavedTilt ? (
            <SavedTiltTab
              tilt={activeSavedTilt}
              configs={configs}
              onDelete={(id) => { handleDeleteTilt(id) }}
            />
          ) : activeConfig ? (
            <ETFTab
              key={activeTab}
              config={activeConfig}
              result={results[slotNum] ?? null}
              onConfigSaved={handleConfigSaved}
              onResultUpdated={(r) => handleResultUpdated(slotNum, r)}
            />
          ) : null}
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
    etfOverview:    row.etf_overview    ?? null,
  }
}

function mapSavedTilt(row: any): SavedTilt {
  return {
    id:                 row.id,
    name:               row.name ?? 'Untitled',
    runDate:            row.run_date,
    foundationalSlot:   row.foundational_slot,
    foundationalTicker: row.foundational_ticker,
    optimizationMode:   row.optimization_mode,
    sectorWeights:      row.sector_weights  ?? [],
    factorLoadings:     row.factor_loadings ?? [],
    portfolio:          row.portfolio       ?? [],
    factorRmse:         row.factor_rmse     ?? 0,
    maxSectorDiff:      row.max_sector_diff ?? 0,
    etfR2:              row.etf_r2          ?? null,
    portfolioR2:        row.portfolio_r2    ?? null,
  }
}
