import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { getTotalUsage } from '@/lib/server/settings'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await getTotalUsage())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not load usage'))
  }
}
