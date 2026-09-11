import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { listDetailed } from '@/lib/server/skills'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await listDetailed())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not list detailed skills'))
  }
}
