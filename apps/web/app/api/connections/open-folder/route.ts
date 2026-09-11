import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { openFolder } from '@/lib/server/connections'

export const dynamic = 'force-dynamic'

/** Ensures the MCP folder and returns its path (no native explorer on web). */
export async function POST() {
  try {
    return ok(await openFolder())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not resolve MCP folder'))
  }
}
