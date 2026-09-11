import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { ensureLocalRuntime } from '@/lib/server/models'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** One-time owned-runtime install; progress streams on /api/library/events. */
export async function POST(req: Request) {
  try {
    return ok(await ensureLocalRuntime(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid ensureRuntime payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'runtime install failed'))
  }
}
