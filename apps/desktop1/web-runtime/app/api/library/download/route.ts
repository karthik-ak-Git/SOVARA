import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { startDownload } from '@/lib/server/library'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Starts a download job; progress streams on GET /api/library/events. */
export async function POST(req: Request) {
  try {
    return ok(await startDownload(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid library:download payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not start download'))
  }
}
