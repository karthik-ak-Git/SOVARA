import { ok, serverError, toErrorMessage } from '@/lib/server/http'
import { getRecentLogs } from '@/lib/server/app'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const kind = searchParams.get('kind') ?? 'all'
    return ok(await getRecentLogs(kind))
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not load logs'))
  }
}
