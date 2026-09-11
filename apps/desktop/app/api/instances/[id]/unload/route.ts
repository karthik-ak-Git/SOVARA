import { badRequest, ok, serverError, toErrorMessage } from '@/lib/server/http'
import { unloadInstance } from '@/lib/server/instances'

export const dynamic = 'force-dynamic'

/** Unload releases runtime resources (never deletes model files). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    return ok(await unloadInstance({ instanceId: params.id }))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid instance id: ${e.message}`)
    return serverError(toErrorMessage(e, 'unload failed'))
  }
}
