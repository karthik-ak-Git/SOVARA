import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { listTools } from '@/lib/server/settings'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await listTools())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not list tools'))
  }
}
