'use client'
import { useState } from 'react'
import { upsertETFConfig } from '@/lib/supabase'
import { triggerRun } from '@/lib/api'

interface Props {
  slot: number
  currentTicker: string
  lastRunDate: string | null
  onSaved: (ticker: string) => void
}

export default function SettingsDrawer({ slot, currentTicker, lastRunDate, onSaved }: Props) {
  const [open,    setOpen]    = useState(false)
  const [ticker,  setTicker]  = useState(currentTicker)
  const [saving,  setSaving]  = useState(false)
  const [running, setRunning] = useState(false)

  async function handleSave() {
    if (!ticker.trim()) return
    setSaving(true)
    await upsertETFConfig(slot, ticker.trim().toUpperCase())
    onSaved(ticker.trim().toUpperCase())
    setSaving(false)
    setOpen(false)
  }

  async function handleRunNow() {
    setRunning(true)
    await triggerRun(slot)
    setRunning(false)
  }

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="font-plex-mono text-xs border border-black px-3 py-1 hover:bg-black hover:text-white uppercase tracking-widest"
      >
        Configure
      </button>

      {open && (
        <div className="border border-black mt-4 p-4 bg-white font-plex-mono text-sm">
          <div className="flex items-center gap-4 mb-3">
            <label className="uppercase tracking-widest text-xs w-16">ETF</label>
            <input
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase())}
              placeholder="e.g. IJH"
              className="border border-black px-2 py-1 w-28 font-plex-mono text-sm uppercase tracking-widest"
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="border border-black px-3 py-1 hover:bg-black hover:text-white uppercase tracking-widest disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>

          <div className="flex items-center gap-4">
            <span className="uppercase tracking-widest text-xs w-16">Run</span>
            <button
              onClick={handleRunNow}
              disabled={running}
              className="border border-black px-3 py-1 hover:bg-black hover:text-white uppercase tracking-widest disabled:opacity-40"
            >
              {running ? 'Running…' : 'Run Now'}
            </button>
            {lastRunDate && (
              <span className="text-gray-500 text-xs">
                Last: {new Date(lastRunDate).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      )}
    </>
  )
}
