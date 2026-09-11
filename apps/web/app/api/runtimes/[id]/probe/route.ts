import { badRequest, ok, serverError, toErrorMessage } from '@/lib/server/http'
import { testConnection } from '@/lib/server/models'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    return ok(await testConnection({ runtimeId: params.id }))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid runtime ref: ${e.message}`)
    return serverError(toErrorMessage(e, 'probe failed'))
  }
}
