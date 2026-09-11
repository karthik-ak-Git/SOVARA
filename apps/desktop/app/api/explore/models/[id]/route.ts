import { badRequest, ok, serverError, toErrorMessage } from '@/lib/server/http'
import { getModel } from '@/lib/server/explore'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    // Model ids are `org/name` slugs → URL-encoded by the client.
    return ok(await getModel(decodeURIComponent(params.id)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid model id: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not load model detail'))
  }
}
