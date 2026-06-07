import { NextResponse } from 'next/server'

// Fires weekdays at 10 PM UTC (~5-6 PM ET after market settle)
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const apiUrl = process.env.NEXT_PUBLIC_API_URL
  const res    = await fetch(`${apiUrl}/cron/daily-performance`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  })
  const data = await res.json()
  return NextResponse.json({ ok: res.ok, ...data })
}
