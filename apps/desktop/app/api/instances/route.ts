import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { listInstances } from '@/lib/server/instances'

export const dynamic = 'force-dynamic'

/** Running instances — dynamic runtime state, never cached. */
export async function GET() {
  try {
    return ok(await listInstances())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not list instances'))
  }
}
