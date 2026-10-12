'use client'
import Link        from 'next/link'
import { usePathname } from 'next/navigation'
import { isAuthenticated } from '@/lib/auth'

const NAV = [
  { href: '/factor-performance', label: 'Factor Performance', locked: false },
  { href: '/regime',             label: 'Regime Monitor',     locked: false },
  { href: '/engine',             label: 'Replication Engine', locked: true  },
  { href: '/notes',              label: 'Notes',              locked: true  },
]

function LockIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="3" y="7" width="10" height="8" rx="1" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" />
    </svg>
  )
}

export default function LandingNav() {
  const pathname = usePathname()
  const authed   = isAuthenticated()

  return (
    <nav className="mt-5 flex flex-col gap-1.5">
      {NAV.map(({ href, label, locked }) => {
        const isActive  = pathname === href
        const isLocked  = locked && !authed
        return (
          <Link
            key={href}
            href={href}
            className={[
              'flex items-center gap-1.5 font-plex-mono text-[11px] uppercase tracking-widest',
              isActive
                ? 'text-black font-bold'
                : 'text-gray-400 hover:text-black',
            ].join(' ')}
          >
            {label}
            {isLocked && <LockIcon />}
          </Link>
        )
      })}
    </nav>
  )
}
