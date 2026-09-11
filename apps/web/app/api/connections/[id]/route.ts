import { badRequest, notFound, ok, serverError, toErrorMessage } from '@/lib/server/http'
import { removeServer } from '@/lib/server/connections'

export const dynamic = 'force-dynamic'

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    return ok(await removeServer({ id: params.id }))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid mcp id: ${e.message}`)
    if (e instanceof Error && e.message === 'unknown mcp server') return notFound('unknown mcp server')
    return serverError(toErrorMessage(e, 'could not remove MCP server'))
  }
}
