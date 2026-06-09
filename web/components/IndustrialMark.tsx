'use client'
import Link from 'next/link'

export default function IndustrialMark({ size = 64 }: { size?: number }) {
  const cx = size / 2
  const cy = size / 2

  const rOuter  = size * 0.46
  const rMiddle = size * 0.28
  const rInner  = size * 0.12
  const rDot    = size * 0.045

  // Cross arms: from rMiddle edge to rOuter edge
  const arm = (angle: number) => {
    const rad = (angle * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    return {
      x1: cx + cos * rMiddle,
      y1: cy + sin * rMiddle,
      x2: cx + cos * rOuter,
      y2: cy + sin * rOuter,
    }
  }

  // Diagonal tick marks at 45° — short, between rMiddle and rOuter
  const tick = (angle: number) => {
    const rad = (angle * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const tStart = rMiddle + (rOuter - rMiddle) * 0.15
    const tEnd   = rMiddle + (rOuter - rMiddle) * 0.40
    return {
      x1: cx + cos * tStart,
      y1: cy + sin * tStart,
      x2: cx + cos * tEnd,
      y2: cy + sin * tEnd,
    }
  }

  const sw = { thin: 0.6, med: 0.9 }

  return (
    <Link href="/" title="Home">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="opacity-40 hover:opacity-80 transition-opacity duration-200 cursor-pointer"
      >
        {/* Outer circle */}
        <circle cx={cx} cy={cy} r={rOuter}  fill="none" stroke="currentColor" strokeWidth={sw.thin} />
        {/* Middle circle */}
        <circle cx={cx} cy={cy} r={rMiddle} fill="none" stroke="currentColor" strokeWidth={sw.thin} />
        {/* Inner circle */}
        <circle cx={cx} cy={cy} r={rInner}  fill="none" stroke="currentColor" strokeWidth={sw.thin} />

        {/* Cardinal cross arms */}
        {[0, 90, 180, 270].map((a) => {
          const l = arm(a)
          return <line key={a} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="currentColor" strokeWidth={sw.med} />
        })}

        {/* Diagonal tick marks */}
        {[45, 135, 225, 315].map((a) => {
          const t = tick(a)
          return <line key={a} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke="currentColor" strokeWidth={sw.thin} />
        })}

        {/* Center dot */}
        <circle cx={cx} cy={cy} r={rDot} fill="currentColor" />
      </svg>
    </Link>
  )
}
