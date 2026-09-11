import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { getExecMode, setExecMode } from '@/lib/server/settings'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await getExecMode())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not load exec mode'))
  }
}

export async function PUT(req: Request) {
  try {
    const body = await readBody(req)
    // Accept both the raw mode string (IPC parity) and { mode }.
    const mode = typeof body === 'string' ? body : (body as { mode?: unknown }).mode
    return ok(await setExecMode(mode))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid exec mode: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not set exec mode'))
  }
}
