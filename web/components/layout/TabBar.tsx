'use client'
import { ETFConfig, SavedTilt } from '@/types'

interface Props {
  configs:      ETFConfig[]
  savedTilts:   SavedTilt[]
  activeTab:    string            // '1'–'5' | 'tilt' | 'saved_<id>'
  onSelect:     (tab: string) => void
  onDeleteTilt: (id: number) => void
}

export default function TabBar({ configs, savedTilts, activeTab, onSelect, onDeleteTilt }: Props) {
  return (
    <nav className="flex items-end border-b border-black">

      {/* Replication portfolio group */}
      <div className="flex flex-col">
        <div className="px-1 pb-0.5">
          <span className="font-plex-mono text-[9px] text-gray-400 uppercase tracking-[0.18em]">
            Replication Portfolios
          </span>
        </div>
        <div className="flex">
          {configs.map((c) => {
            const tab      = String(c.slot)
            const isActive = activeTab === tab
            const label    = c.isConfigured ? c.ticker : `Portfolio ${c.slot}`
            return (
              <button
                key={c.slot}
                onClick={() => onSelect(tab)}
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

      {/* Separator */}
      <div className="w-px self-stretch bg-gray-300 mx-2" />

      {/* Active Tilt tab */}
      <button
        onClick={() => onSelect('tilt')}
        className={[
          'px-5 py-2 text-sm font-space-mono border-r border-black self-end',
          'tracking-widest uppercase transition-none',
          activeTab === 'tilt'
            ? 'bg-[#7a0000] text-white border-[#7a0000]'
            : 'bg-white text-[#7a0000] hover:bg-red-50',
        ].join(' ')}
      >
        Active Tilt
      </button>

      {/* Saved portfolios group */}
      {savedTilts.length > 0 && (
        <>
          <div className="w-px self-stretch bg-gray-300 mx-2" />
          <div className="flex flex-col">
            <div className="px-1 pb-0.5">
              <span className="font-plex-mono text-[9px] text-gray-400 uppercase tracking-[0.18em]">
                Saved Portfolios
              </span>
            </div>
            <div className="flex">
              {savedTilts.map((t) => {
        const tab      = `saved_${t.id}`
        const isActive = activeTab === tab
        return (
          <div
            key={t.id}
            className={[
              'flex items-center border-r border-black self-end',
              isActive ? 'bg-[#7a0000]' : 'bg-white hover:bg-red-50',
            ].join(' ')}
          >
            <button
              onClick={() => onSelect(tab)}
              className={[
                'px-4 py-2 text-xs font-plex-mono tracking-widest uppercase transition-none',
                isActive ? 'text-white' : 'text-[#7a0000]',
              ].join(' ')}
            >
              {t.name}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`Delete "${t.name}"?`)) onDeleteTilt(t.id)
              }}
              className={[
                'pr-3 py-2 text-xs transition-none',
                isActive ? 'text-red-200 hover:text-white' : 'text-gray-300 hover:text-[#7a0000]',
              ].join(' ')}
              title="Delete"
            >
              ×
            </button>
          </div>
        )
              })}
            </div>
          </div>
        </>
      )}

    </nav>
  )
}
