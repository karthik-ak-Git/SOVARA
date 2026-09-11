import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { addBionic, listBionic } from '@/lib/server/skills'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await listBionic())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not list bionic skills'))
  }
}

export async function POST(req: Request) {
  try {
    return ok(await addBionic(await readBody(req)), 201)
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid skills:addBionic payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not add skill'))
  }
}
