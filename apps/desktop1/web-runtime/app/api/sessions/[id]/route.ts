import { badRequest, notFound, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { deleteSession, getSession, renameSession } from '@/lib/server/sessions'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const row = await getSession(params.id)
    if (!row) return notFound('session not found')
    return ok(row)
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid session id: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not load session'))
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    return ok(await renameSession({ ...(await readBody(req) as object), sessionId: params.id }))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid sessions:rename payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not rename session'))
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    return ok(await deleteSession(params.id))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid session id: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not delete session'))
  }
}
