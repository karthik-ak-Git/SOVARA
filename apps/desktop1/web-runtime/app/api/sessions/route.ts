import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { createSession, listSessions } from '@/lib/server/sessions'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await listSessions())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not list sessions'))
  }
}

export async function POST(req: Request) {
  try {
    return ok(await createSession(await readBody(req)), 201)
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid sessions:create payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not create session'))
  }
}
