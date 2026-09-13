import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { localUrl, hardwareId } = await req.json().catch(()=> ({})) as { localUrl?: string; hardwareId?: string }
  if (!localUrl) return NextResponse.json({ ok:false, error:'missing localUrl' }, { status:400 })
  // Validate by fetching consumer hardware from browser-provided localUrl via server-side probe is not possible (Vercel can't reach localhost).
  // Instead we trust browser-validated ping: browser already fetched localUrl/__sovara/ping and sends hardwareId.
  // We just set a cookie if hardwareId looks plausible.
  if (!hardwareId || hardwareId.length < 4) return NextResponse.json({ ok:false, error:'hardware validation failed' }, { status:401 })
  const c = cookies()
  c.set('sovara_hw_token', Buffer.from(`${hardwareId}:${localUrl}`).toString('base64'), { httpOnly:true, sameSite:'lax', path:'/', maxAge: 60*60*24*7 })
  c.set('sovara_local_url', localUrl, { httpOnly:false, sameSite:'lax', path:'/', maxAge: 60*60*24*7 })
  return NextResponse.json({ ok:true })
}

export async function DELETE() {
  const c = cookies()
  c.delete('sovara_hw_token')
  c.delete('sovara_local_url')
  return NextResponse.json({ ok:true })
}

export async function GET() {
  const c = cookies()
  const token = c.get('sovara_hw_token')?.value ?? null
  const localUrl = c.get('sovara_local_url')?.value ?? null
  return NextResponse.json({ connected: !!token, localUrl, token: token ? 'set' : null })
}
