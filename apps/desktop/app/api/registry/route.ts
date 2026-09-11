import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { listRegistry, removeRegistry, updateRegistry } from '@/lib/server/models'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const runtimeId = searchParams.get('runtimeId') ?? undefined
    return ok(await listRegistry(runtimeId ? { runtimeId } : {}))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid list payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not list registry'))
  }
}

export async function PATCH(req: Request) {
  try {
    return ok(await updateRegistry(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid registry update: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not update registry'))
  }
}

export async function DELETE(req: Request) {
  try {
    return ok(await removeRegistry(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid registry ref: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not remove registry row'))
  }
}
