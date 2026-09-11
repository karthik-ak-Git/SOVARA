import { badRequest, ok, serverError, toErrorMessage } from '@/lib/server/http'
import { getSessionEvents } from '@/lib/server/sessions'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    return ok(await getSessionEvents(params.id))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid session id: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not load session events'))
  }
}
