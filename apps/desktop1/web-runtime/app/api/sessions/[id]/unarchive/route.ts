import { badRequest, ok, serverError, toErrorMessage } from '@/lib/server/http'
import { unarchiveSession } from '@/lib/server/sessions'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    return ok(await unarchiveSession({ sessionId: params.id }))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid unarchive payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not unarchive session'))
  }
}
