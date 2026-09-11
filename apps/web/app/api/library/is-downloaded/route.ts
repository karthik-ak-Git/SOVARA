import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { isDownloaded } from '@/lib/server/library'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    return ok(await isDownloaded(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'check failed'))
  }
}
