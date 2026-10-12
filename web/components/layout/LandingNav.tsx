'use client'
import Link        from 'next/link'
import { usePathname } from 'next/navigation'
import { isAuthenticated } from '@/lib/auth'

const NAV = [
  { href: '/factor-performance', label: 'Factor Performance', locked: false },
  { href: '/regime',             label: 'Regime Monitor',     locked: false },
  { href: '/chartbook.html',     label: 'Chart Book',         locked: false, external: true },
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
    <nav className="flex items-center gap-4">
      {NAV.map(({ href, label, locked, external }) => {
        const isActive  = pathname === href
        const isLocked  = locked && !authed
        const className = [
          'flex items-center gap-1.5 font-plex-mono text-[11px] uppercase tracking-widest',
          isActive
            ? 'text-black font-bold border-b-2 border-black pb-0.5'
            : 'text-gray-500 hover:text-black',
        ].join(' ')

        if (external) {
          return (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={className}
            >
              {label}
              <svg width="7" height="7" viewBox="0 0 16 16" fill="none"
                stroke="currentColor" strokeWidth="1.5" className="opacity-40">
                <path d="M6 3H13V10M13 3L6 10M3 3H3M3 13V3" />
              </svg>
            </a>
          )
        }

        return (
          <Link
            key={href}
            href={href}
            className={className}
          >
            {label}
            {isLocked && <LockIcon />}
          </Link>
        )
      })}
    </nav>
  )
}
