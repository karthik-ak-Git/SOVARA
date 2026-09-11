import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { pauseDownload } from '@/lib/server/library'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    return ok(await pauseDownload(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid library:pauseDownload payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not pause download'))
  }
}
