import { NextResponse } from 'next/server'

// Called by Vercel Cron on the 1st of each month
// vercel.json: { "crons": [{ "path": "/api/cron", "schedule": "0 6 1 * *" }] }
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL
  const res    = await fetch(`${apiUrl}/cron/refresh`, { method: 'POST' })

  if (!res.ok) {
    return NextResponse.json({ error: 'Pipeline refresh failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, triggered: new Date().toISOString() })
}
