'use client'
import Link                from 'next/link'
import { usePathname }     from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import { isAuthenticated } from '@/lib/auth'

type NavItem = {
  href: string
  label: string
  locked?: boolean
  external?: boolean
}

type NavEntry = NavItem | {
  label: string
  children: NavItem[]
}

const NAV: NavEntry[] = [
  { href: '/factor-performance', label: 'Factor Performance' },
  {
    label: 'Macro',
    children: [
      { href: '/regime',         label: 'Regime Monitor' },
      { href: '/chartbook.html', label: 'Chart Book', external: true },
    ],
  },
  { href: '/engine', label: 'Replication Engine', locked: true },
  { href: '/notes',  label: 'Notes',              locked: true },
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

function ChevronDown() {
  return (
    <svg width="8" height="8" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6L8 10L12 6" />
    </svg>
  )
}

function NavLink({ item, isActive, authed }: { item: NavItem; isActive: boolean; authed: boolean }) {
  const isLocked = item.locked && !authed
  const cls = [
    'flex items-center gap-1.5 font-plex-mono text-[11px] uppercase tracking-widest',
    isActive
      ? 'text-black font-bold border-b-2 border-black pb-0.5'
      : 'text-gray-500 hover:text-black',
  ].join(' ')

  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className={cls}>
        {item.label}
        <svg width="7" height="7" viewBox="0 0 16 16" fill="none"
          stroke="currentColor" strokeWidth="1.5" className="opacity-40">
          <path d="M6 3H13V10M13 3L6 10M3 3H3M3 13V3" />
        </svg>
      </a>
    )
  }

  return (
    <Link href={item.href} className={cls}>
      {item.label}
      {isLocked && <LockIcon />}
    </Link>
  )
}

function MacroDropdown({ entry, pathname, authed }: {
  entry: { label: string; children: NavItem[] }
  pathname: string
  authed: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const childPaths   = entry.children.map(c => c.href)
  const isChildActive = childPaths.includes(pathname)

  const btnCls = [
    'flex items-center gap-1 font-plex-mono text-[11px] uppercase tracking-widest cursor-pointer',
    isChildActive
      ? 'text-black font-bold border-b-2 border-black pb-0.5'
      : 'text-gray-500 hover:text-black',
  ].join(' ')

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} className={btnCls}>
        {entry.label}
        <ChevronDown />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 bg-white border border-black py-1 min-w-[160px] z-50 shadow-sm">
          {entry.children.map(child => (
            <div
              key={child.href}
              className="px-3 py-1.5 hover:bg-gray-50"
              onClick={() => setOpen(false)}
            >
              <NavLink item={child} isActive={pathname === child.href} authed={authed} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function LandingNav() {
  const pathname = usePathname()
  const authed   = isAuthenticated()

  return (
    <nav className="flex items-center gap-4">
      {NAV.map((entry, i) => {
        if ('children' in entry) {
          return <MacroDropdown key={i} entry={entry} pathname={pathname} authed={authed} />
        }
        return (
          <NavLink
            key={entry.href}
            item={entry}
            isActive={pathname === entry.href}
            authed={authed}
          />
        )
      })}
    </nav>
  )
}
