import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { getCachedExplorerProfile } from '@/lib/server/hardware'

export const dynamic = 'force-dynamic'

/** 30s-cached explorer hardware profile (shares one probe burst — IPC parity). */
export async function GET() {
  try {
    return ok(await getCachedExplorerProfile())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not load hardware profile'))
  }
}
