import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { selectModel } from '@/lib/server/models'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: Request) {
  try {
    return ok(await selectModel(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid selection: ${e.message}`)
    return serverError(toErrorMessage(e, 'selection failed'))
  }
}
