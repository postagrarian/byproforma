'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { saveConfig, triggerRun, getPipelineStatus } from '@/lib/api'

interface Props {
  slot: number
  currentTicker: string
  lastRunDate: string | null
  onSaved: (ticker: string) => void
  onRunComplete: () => void
}

export default function SettingsDrawer({
  slot, currentTicker, lastRunDate, onSaved, onRunComplete,
}: Props) {
  const [open,     setOpen]     = useState(false)
  const [ticker,   setTicker]   = useState(currentTicker)
  const [saving,   setSaving]   = useState(false)
  const [saveErr,  setSaveErr]  = useState('')
  const [stage,    setStage]    = useState('')
  const [progress, setProgress] = useState(0)
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const runningRef = useRef(false)   // survives re-renders, checked by visibility handler

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    runningRef.current = false
  }, [])

  const pollOnce = useCallback(async () => {
    try {
      const s = await getPipelineStatus(slot)
      setStage(s.message || s.stage)
      setProgress(s.progress ?? 0)
      if (s.stage === 'done') {
        stopPolling()
        setStage('Complete')
        setProgress(100)
        onRunComplete()
      } else if (s.stage === 'error') {
        stopPolling()
        setStage(`Error: ${s.message}`)
      }
    } catch {
      // transient failure — keep trying
    }
  }, [slot, onRunComplete, stopPolling])

  const startPolling = useCallback(() => {
    stopPolling()
    runningRef.current = true
    pollRef.current = setInterval(pollOnce, 4000)
  }, [pollOnce, stopPolling])

  // When tab becomes visible again, immediately re-poll and restart interval.
  // Browsers throttle setInterval in inactive tabs, making progress appear frozen.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && runningRef.current) {
        pollOnce()
        startPolling()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stopPolling()
    }
  }, [pollOnce, startPolling, stopPolling])

  async function handleSave() {
    const t = ticker.trim().toUpperCase()
    if (!t) return
    setSaving(true)
    setSaveErr('')
    try {
      await saveConfig(slot, t)
      onSaved(t)
      setOpen(false)
    } catch (e: any) {
      setSaveErr(`Save failed — is the API running? (${e.message})`)
    } finally {
      setSaving(false)
    }
  }

  async function handleRunNow() {
    setStage('Starting…')
    setProgress(0)
    try {
      await triggerRun(slot)
    } catch (e: any) {
      setStage(`Error: ${e.message}`)
      return
    }
    startPolling()
  }

  const isRunning = stage && stage !== 'Complete' && !stage.startsWith('Error')

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

          {/* Ticker */}
          <div className="flex items-center gap-4 mb-3">
            <label className="uppercase tracking-widest text-xs w-16">ETF</label>
            <input
              type="text"
              value={ticker}
              onChange={(e) => { setTicker(e.target.value.toUpperCase()); setSaveErr('') }}
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
          {saveErr && (
            <p className="text-red-700 text-xs mb-3 uppercase tracking-widest">{saveErr}</p>
          )}

          {/* Run */}
          <div className="flex items-center gap-4">
            <span className="uppercase tracking-widest text-xs w-16">Run</span>
            <button
              onClick={handleRunNow}
              disabled={!!isRunning}
              className="border border-black px-3 py-1 hover:bg-black hover:text-white uppercase tracking-widest disabled:opacity-40"
            >
              {isRunning ? 'Running…' : 'Run Now'}
            </button>
            {lastRunDate && !stage && (
              <span className="text-gray-500 text-xs">
                Last: {new Date(lastRunDate).toLocaleDateString()}
              </span>
            )}
          </div>

          {/* Progress */}
          {stage && (
            <div className="mt-3">
              <div className="flex justify-between text-xs uppercase tracking-widest mb-1">
                <span>{stage}</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full border border-black h-1.5">
                <div
                  className="h-full bg-black transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              {isRunning && (
                <p className="text-gray-400 text-xs mt-1 uppercase tracking-widest">
                  Pipeline runs on server — safe to navigate away
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  )
}
