import { badRequest, notFound, ok, serverError, toErrorMessage } from '@/lib/server/http'
import { probeServer } from '@/lib/server/connections'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    return ok(await probeServer({ id: params.id }))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid mcp id: ${e.message}`)
    if (e instanceof Error && e.message === 'unknown mcp server') return notFound('unknown mcp server')
    return serverError(toErrorMessage(e, 'probe failed'))
  }
}
