import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { listValidationCache } from '@/lib/server/validation'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await listValidationCache())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not list validation cache'))
  }
}
