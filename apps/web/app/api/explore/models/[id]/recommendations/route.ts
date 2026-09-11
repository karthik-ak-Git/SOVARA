import { badRequest, ok, serverError, toErrorMessage } from '@/lib/server/http'
import { getRecommendations } from '@/lib/server/explore'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    return ok(await getRecommendations({ modelId: decodeURIComponent(params.id) }))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid model id: ${e.message}`)
    return serverError(toErrorMessage(e, 'recommendations failed'))
  }
}
