import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { getVersion } from '@/lib/server/settings'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await getVersion())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not load version'))
  }
}
