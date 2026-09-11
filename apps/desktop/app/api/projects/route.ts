import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { createProject, listProjects } from '@/lib/server/projects'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await listProjects())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not list projects'))
  }
}

export async function POST(req: Request) {
  try {
    return ok(await createProject(await readBody(req)), 201)
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid projects:create payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not create project'))
  }
}
