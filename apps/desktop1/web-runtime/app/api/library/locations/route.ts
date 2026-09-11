import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { detectLocations } from '@/lib/server/library'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await detectLocations())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not detect model locations'))
  }
}
