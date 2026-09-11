import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { getFileStatus } from '@/lib/server/library'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    return ok(await getFileStatus(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'status check failed'))
  }
}
