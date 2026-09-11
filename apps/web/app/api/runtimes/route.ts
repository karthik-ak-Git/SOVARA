import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { addRuntime, listRuntimes } from '@/lib/server/models'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await listRuntimes())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not list runtimes'))
  }
}

export async function POST(req: Request) {
  try {
    return ok(await addRuntime(await readBody(req)), 201)
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid runtime payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not add runtime'))
  }
}
