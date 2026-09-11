import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { listModelsPage } from '@/lib/server/explore'

export const dynamic = 'force-dynamic'

/** Catalog listing with filters (POST: filter object too rich for query string). */
export async function POST(req: Request) {
  try {
    return ok(await listModelsPage(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid explore:listModels payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'catalog listing failed'))
  }
}
