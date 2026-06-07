import { NextResponse } from 'next/server'

// Called by Vercel Cron daily at 8 AM UTC
// Checks whether Ken French has published new factor data and caches it
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL
  const res    = await fetch(`${apiUrl}/cron/refresh-factors`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Factor refresh failed' }, { status: 500 })
  }

  const data = await res.json()
  return NextResponse.json({ ok: true, ...data })
}
