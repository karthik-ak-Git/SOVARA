import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { removeRegistryByPath } from '@/lib/server/models'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    return ok(await removeRegistryByPath(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid registry path: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not remove registry rows'))
  }
}
