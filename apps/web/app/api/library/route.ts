import { badRequest, ok, serverError, toErrorMessage, readBody } from '@/lib/server/http'
import { deleteEntry, listLibrary } from '@/lib/server/library'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return ok(await listLibrary())
  } catch (e) {
    return serverError(toErrorMessage(e, 'could not scan library'))
  }
}

export async function DELETE(req: Request) {
  try {
    return ok(await deleteEntry(await readBody(req)))
  } catch (e) {
    if (e instanceof Error && e.name === 'ZodError') return badRequest(`invalid library:delete payload: ${e.message}`)
    return serverError(toErrorMessage(e, 'could not delete model file'))
  }
}
