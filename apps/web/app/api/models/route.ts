import { badRequest, ok, serverError, toErrorMessage } from '@/lib/server/http'
import { listModels } from '@/lib/server/models'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const runtimeId = searchParams.get('runtimeId') ?? undefined
    return ok(await listModels(runtimeId ? { runtimeId } : {}))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid list payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'list failed'))
  }
}
