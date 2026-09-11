import { badRequest, ok, serverError, toErrorMessage } from '@/lib/server/http'
import { getInstanceMetrics } from '@/lib/server/instances'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    return ok(await getInstanceMetrics({ instanceId: params.id }))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid instance id: ${e.message}`)
    return serverError(toErrorMessage(e, 'health check failed'))
  }
}
