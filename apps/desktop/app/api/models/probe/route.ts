import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { probeOwnedRuntime } from '@/lib/server/models'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = (await readBody(req)) as { runtimeId?: string }
    return ok(await probeOwnedRuntime(body.runtimeId ?? 'local'))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid runtimeId: ${e.message}`)
    return serverError(toErrorMessage(e, 'probe failed'))
  }
}
