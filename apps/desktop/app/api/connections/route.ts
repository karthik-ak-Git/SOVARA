import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { addServer, listServers } from '@/lib/server/connections'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await listServers())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not list MCP servers'))
  }
}

export async function POST(req: Request) {
  try {
    return ok(await addServer(await readBody(req)), 201)
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid mcp:add payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not add MCP server'))
  }
}
