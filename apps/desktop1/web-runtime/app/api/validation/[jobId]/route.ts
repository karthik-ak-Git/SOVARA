import { badRequest, notFound, ok, serverError, toErrorMessage } from '@/lib/server/http'
import { getValidation } from '@/lib/server/validation'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { jobId: string } }) {
  try {
    return ok(await getValidation({ jobId: params.jobId }))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid job id: ${e.message}`)
    if (e instanceof Error && e.message === 'unknown job') return notFound('unknown job')
    return serverError(toErrorMessage(e, 'could not load validation job'))
  }
}
