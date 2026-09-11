import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { loadModel } from '@/lib/server/models'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: Request) {
  try {
    return ok(await loadModel(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid load payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'load failed'))
  }
}
