import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { resumeDownload } from '@/lib/server/library'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: Request) {
  try {
    return ok(await resumeDownload(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid library:resumeDownload payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not resume download'))
  }
}
