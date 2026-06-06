'use client'
import { ETFConfig } from '@/types'

interface Props {
  configs:    ETFConfig[]
  activeSlot: number
  onSelect:   (slot: number) => void
}

export default function TabBar({ configs, activeSlot, onSelect }: Props) {
  return (
    <nav className="flex items-end border-b border-black">

      {/* Replication portfolio group — label sits above the 5 tabs only */}
      <div className="flex flex-col">
        <div className="px-1 pb-0.5">
          <span className="font-plex-mono text-[9px] text-gray-400 uppercase tracking-[0.18em]">
            Replication Portfolios
          </span>
        </div>
        <div className="flex">
          {configs.map((c) => {
            const isActive = c.slot === activeSlot
            const label    = c.isConfigured ? c.ticker : `Portfolio ${c.slot}`
            return (
              <button
                key={c.slot}
                onClick={() => onSelect(c.slot)}
                className={[
                  'px-5 py-2 text-sm font-space-mono border-r border-black',
                  'tracking-widest uppercase transition-none',
                  isActive
                    ? 'bg-black text-white'
                    : 'bg-white text-black hover:bg-gray-100',
                ].join(' ')}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Thin separator between groups */}
      <div className="w-px self-stretch bg-gray-300 mx-2 mb-0" />

      {/* Active Tilt tab */}
      <button
        onClick={() => onSelect(0)}
        className={[
          'px-5 py-2 text-sm font-space-mono border-r border-black self-end',
          'tracking-widest uppercase transition-none',
          activeSlot === 0
            ? 'bg-[#7a0000] text-white border-[#7a0000]'
            : 'bg-white text-[#7a0000] hover:bg-red-50',
        ].join(' ')}
      >
        Active Tilt
      </button>

    </nav>
  )
}
