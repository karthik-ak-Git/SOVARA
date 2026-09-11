import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { cancelDownload } from '@/lib/server/library'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    return ok(await cancelDownload(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid library:cancelDownload payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not cancel download'))
  }
}
