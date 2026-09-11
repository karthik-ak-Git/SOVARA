import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { importFromUrl } from '@/lib/server/skills'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    return ok(await importFromUrl(await readBody(req)), 201)
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid skills:importFromUrl payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'skill import failed'))
  }
}
