import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { deleteProject, renameProject } from '@/lib/server/projects'

export const dynamic = 'force-dynamic'

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    return ok(await renameProject({ ...(await readBody(req) as object), projectId: params.id }))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid projects:rename payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not rename project'))
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    return ok(await deleteProject({ projectId: params.id }))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid project id: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not delete project'))
  }
}
