'use client'
import { ETFConfig } from '@/types'

interface Props {
  configs: ETFConfig[]
  activeSlot: number
  onSelect: (slot: number) => void
}

export default function TabBar({ configs, activeSlot, onSelect }: Props) {
  return (
    <nav className="flex border-b border-black">
      {configs.map((c) => {
        const isActive = c.slot === activeSlot
        const label    = c.isConfigured ? c.ticker : `SLOT ${c.slot}`
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
    </nav>
  )
}
