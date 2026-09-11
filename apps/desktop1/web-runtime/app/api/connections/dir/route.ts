import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { getDir } from '@/lib/server/connections'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await getDir())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not load MCP directory'))
  }
}
