import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { installFromUrl } from '@/lib/server/connections'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: Request) {
  try {
    return ok(await installFromUrl(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid mcp:installFromUrl payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'mcp install failed'))
  }
}
