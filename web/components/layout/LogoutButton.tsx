'use client'
import { useRouter } from 'next/navigation'
import { logout }    from '@/lib/auth'

export default function LogoutButton() {
  const router = useRouter()

  function handleClick() {
    logout()
    router.push('/')
  }

  return (
    <button
      onClick={handleClick}
      title="Back to login"
      className="text-gray-300 hover:text-black transition-none"
    >
      {/* Padlock SVG — 16px, minimal */}
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="7" width="10" height="8" rx="1" />
        <path d="M5 7V5a3 3 0 0 1 6 0v2" />
      </svg>
    </button>
  )
}
