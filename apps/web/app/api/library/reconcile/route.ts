import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { reconcile } from '@/lib/server/library'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    return ok(await reconcile())
  } catch (e) {
    return serverError(toErrorMessage(e, 'reconcile failed'))
  }
}
