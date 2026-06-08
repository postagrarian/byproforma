'use client'
import { useMemo } from 'react'
import Link from 'next/link'

// Generates a random "factor fingerprint" — a 6-spoke radar shape
// with random spoke lengths, thematic to the 6 FF factors.
// Different on every page load.

export default function RandomIcon({ size = 64 }: { size?: number }) {
  const spokes = useMemo(() => {
    return Array.from({ length: 6 }, () => 0.35 + Math.random() * 0.55)
  }, [])

  const cx   = size / 2
  const cy   = size / 2
  const maxR = size * 0.42
  const pts  = spokes.map((r, i) => {
    const angle = (i / 6) * Math.PI * 2 - Math.PI / 2
    return {
      x: cx + Math.cos(angle) * maxR * r,
      y: cy + Math.sin(angle) * maxR * r,
    }
  })
  const polygon = pts.map((p) => `${p.x},${p.y}`).join(' ')

  // Outer guide hexagon
  const guide = Array.from({ length: 6 }, (_, i) => {
    const angle = (i / 6) * Math.PI * 2 - Math.PI / 2
    return `${cx + Math.cos(angle) * maxR},${cy + Math.sin(angle) * maxR}`
  }).join(' ')

  return (
    <Link href="/" title="Home">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="opacity-60 hover:opacity-100 transition-opacity duration-200 cursor-pointer"
      >
        {/* Guide hexagon */}
        <polygon
          points={guide}
          fill="none"
          stroke="#b91c1c"
          strokeWidth="0.5"
          strokeDasharray="2 2"
          opacity="0.3"
        />
        {/* Spokes */}
        {pts.map((p, i) => (
          <line
            key={i}
            x1={cx} y1={cy}
            x2={p.x} y2={p.y}
            stroke="#b91c1c"
            strokeWidth="0.75"
            opacity="0.4"
          />
        ))}
        {/* Filled polygon */}
        <polygon
          points={polygon}
          fill="#b91c1c"
          fillOpacity="0.12"
          stroke="#b91c1c"
          strokeWidth="1"
          strokeLinejoin="round"
        />
        {/* Center dot */}
        <circle cx={cx} cy={cy} r="2" fill="#b91c1c" opacity="0.6" />
      </svg>
    </Link>
  )
}
