import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { checkUpdates } from '@/lib/server/settings'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    return ok(await checkUpdates())
  } catch (e) {
    return serverError(toErrorMessage(e, 'update check failed'))
  }
}
