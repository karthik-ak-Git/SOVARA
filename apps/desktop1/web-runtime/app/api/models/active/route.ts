import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { getActiveModel } from '@/lib/server/models'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await getActiveModel())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not load active model'))
  }
}
