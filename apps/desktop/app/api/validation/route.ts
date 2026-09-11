import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { listValidations, startValidation } from '@/lib/server/validation'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET() {
  try {
    return ok(await listValidations())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not list validations'))
  }
}

export async function POST(req: Request) {
  try {
    return ok(await startValidation(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid validation:start payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not start validation'))
  }
}
