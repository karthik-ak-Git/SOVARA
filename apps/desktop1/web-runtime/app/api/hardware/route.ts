import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { getSystemResources } from '@/lib/server/hardware'

export const dynamic = 'force-dynamic'

/** Live system snapshot (CPU/RAM/GPU/VRAM/instances) — dynamic, never cached. */
export async function GET() {
  try {
    return ok(await getSystemResources())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not read system resources'))
  }
}
