import { badRequest, notFound, ok, serverError, toErrorMessage } from '@/lib/server/http'
import { removeRuntime } from '@/lib/server/models'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    return ok(await removeRuntime({ runtimeId: params.id }))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid runtime ref: ${e.message}`)
    if (e instanceof Error && e.message === 'unknown runtime') return notFound('unknown runtime')
    return serverError(toErrorMessage(e, 'could not remove runtime'))
  }
}
