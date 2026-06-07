'use client'
import { useEffect }    from 'react'
import { useRouter }    from 'next/navigation'
import { isAuthenticated } from '@/lib/auth'
import LandingLayout    from '@/components/layout/LandingLayout'

export default function NotesPage() {
  const router = useRouter()

  useEffect(() => {
    if (!isAuthenticated()) router.replace('/')
  }, [])

  if (typeof window !== 'undefined' && !isAuthenticated()) return null

  return (
    <LandingLayout>
      <h2 className="font-space-mono text-lg font-bold uppercase tracking-tight mb-1">
        Notes
      </h2>
      <p className="font-plex-mono text-xs text-gray-500 mb-8 uppercase tracking-widest">
        Research notes, commentary, and portfolio observations
      </p>
      <p className="font-plex-mono text-xs text-gray-400 uppercase tracking-widest border border-gray-200 p-6">
        Coming soon — notes and commentary will appear here.
      </p>
    </LandingLayout>
  )
}
