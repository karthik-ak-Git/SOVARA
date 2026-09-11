import { badRequest, ok, serverError, toErrorMessage } from '@/lib/server/http'
import { getRecentUsage } from '@/lib/server/settings'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const limit = searchParams.get('limit')
    return ok(await getRecentUsage(limit ? { limit: Number(limit) } : {}))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid usage:getRecent payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not load recent usage'))
  }
}
