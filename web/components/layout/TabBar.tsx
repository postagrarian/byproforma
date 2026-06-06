'use client'
import { ETFConfig } from '@/types'

interface Props {
  configs:    ETFConfig[]
  activeSlot: number          // 1-5 = replication, 0 = Active Tilt
  onSelect:   (slot: number) => void
}

export default function TabBar({ configs, activeSlot, onSelect }: Props) {
  return (
    <div>
      {/* Group label for replication portfolios */}
      <div className="flex items-center gap-2 pt-3 pb-1">
        <span className="font-plex-mono text-[10px] text-gray-400 uppercase tracking-[0.2em]">
          Replication Portfolios
        </span>
        <div className="flex-1 h-px bg-gray-300" />
      </div>

      <nav className="flex border-b border-black">
        {/* Replication portfolio tabs (slots 1–5) */}
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

        {/* Thin separator */}
        <div className="w-px bg-gray-300 mx-1 self-stretch" />

        {/* Active Tilt tab */}
        <button
          onClick={() => onSelect(0)}
          className={[
            'px-5 py-2 text-sm font-space-mono border-r border-black',
            'tracking-widest uppercase transition-none',
            activeSlot === 0
              ? 'bg-[#7a0000] text-white border-[#7a0000]'
              : 'bg-white text-[#7a0000] hover:bg-red-50',
          ].join(' ')}
        >
          Active Tilt
        </button>
      </nav>
    </div>
  )
}
