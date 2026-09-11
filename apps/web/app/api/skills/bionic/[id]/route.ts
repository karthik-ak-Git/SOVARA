import { badRequest, notFound, ok, serverError, toErrorMessage } from '@/lib/server/http'
import { removeBionic } from '@/lib/server/skills'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    return ok(await removeBionic({ id: params.id }))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid skill id: ${e.message}`)
    if (e instanceof Error && e.message === 'skill not found') return notFound('skill not found')
    return serverError(toErrorMessage(e, 'could not remove skill'))
  }
}
