import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { toggleSource } from '@/lib/server/skills'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    return ok(await toggleSource(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid skills:toggle payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not toggle skills source'))
  }
}
