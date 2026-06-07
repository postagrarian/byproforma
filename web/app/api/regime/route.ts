import { NextResponse }      from 'next/server'
import { buildRegimePayload } from '@/lib/regime'

export async function GET() {
  try {
    const data = await buildRegimePayload()
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
