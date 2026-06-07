import { NextResponse } from 'next/server'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

// Used by the TiltTab "Regime Aware Loading" button (client-side fetch)
export async function GET() {
  try {
    const res  = await fetch(`${API_BASE}/public/regime`)
    if (!res.ok) return NextResponse.json({ error: 'Regime unavailable' }, { status: 502 })
    return NextResponse.json(await res.json())
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
