import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { scanSources } from '@/lib/server/skills'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await scanSources())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not scan skills'))
  }
}
