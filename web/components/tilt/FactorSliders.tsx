'use client'
import { FactorTarget } from '@/types'

interface Props {
  targets:   FactorTarget[]
  onChange:  (factor: string, value: number) => void
  onReset:   () => void
}

function Slider({
  ft, onChange,
}: { ft: FactorTarget; onChange: (v: number) => void }) {
  const range   = ft.max - ft.min
  const fillPct = range > 0 ? ((ft.target - ft.min) / range) * 100 : 50
  const thumbPct = Math.max(1, Math.min(99, fillPct))

  return (
    <tr className="border-b border-gray-100 group">
      <td className="py-2 pr-6 font-plex-mono text-xs uppercase tracking-widest w-36 whitespace-nowrap">
        {ft.label}
      </td>

      {/* Slider cell */}
      <td className="py-2 pr-4 w-full">
        <div className="relative flex items-center">
          <input
            type="range"
            min={ft.min}
            max={ft.max}
            step={0.01}
            value={ft.target}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="w-full h-[2px] appearance-none cursor-pointer outline-none"
            style={{
              background: `linear-gradient(to right, #333 ${fillPct}%, #ddd ${fillPct}%)`,
            }}
          />
          {/* Value bubble positioned at thumb */}
          <span
            className="absolute font-plex-mono text-[10px] bg-white border border-black px-1 pointer-events-none"
            style={{ left: `calc(${thumbPct}% - 16px)`, top: '-18px' }}
          >
            {ft.target.toFixed(2)}
          </span>
        </div>
      </td>

      <td className="py-2 px-3 font-plex-mono text-xs text-gray-500 text-right w-16">
        {ft.existing.toFixed(2)}
      </td>
      <td className="py-2 px-3 font-plex-mono text-xs text-gray-400 text-right w-14">
        {ft.min.toFixed(2)}
      </td>
      <td className="py-2 pl-3 font-plex-mono text-xs text-gray-400 text-right w-14">
        {ft.max.toFixed(2)}
      </td>
    </tr>
  )
}

export default function FactorSliders({ targets, onChange, onReset }: Props) {
  return (
    <div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-black">
            <th className="text-left py-1 pr-6 font-plex-mono text-xs uppercase tracking-widest font-normal">
              Factor
            </th>
            <th className="text-left py-1 pr-4 font-plex-mono text-xs uppercase tracking-widest font-normal">
              Exposure Target
            </th>
            <th className="text-right py-1 px-3 font-plex-mono text-xs uppercase tracking-widest font-normal">
              Existing
            </th>
            <th className="text-right py-1 px-3 font-plex-mono text-xs uppercase tracking-widest font-normal">
              Min
            </th>
            <th className="text-right py-1 pl-3 font-plex-mono text-xs uppercase tracking-widest font-normal">
              Max
            </th>
          </tr>
        </thead>
        <tbody>
          {targets.map((ft) => (
            <Slider
              key={ft.factor}
              ft={ft}
              onChange={(v) => onChange(ft.factor, v)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
