import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { getUsageByModel } from '@/lib/server/settings'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await getUsageByModel())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not load usage by model'))
  }
}
