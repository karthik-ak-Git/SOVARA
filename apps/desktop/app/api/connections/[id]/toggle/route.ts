import { badRequest, notFound, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { toggleServer } from '@/lib/server/connections'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    return ok(await toggleServer({ ...(await readBody(req) as object), id: params.id }))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid mcp:toggle payload: ${e.message}`)
    if (e instanceof Error && e.message === 'unknown mcp server') return notFound('unknown mcp server')
    return serverError(toErrorMessage(e, 'could not toggle MCP server'))
  }
}
